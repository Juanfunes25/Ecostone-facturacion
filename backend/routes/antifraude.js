import { Router } from 'express';
import { db } from '../db.js';
import { round2 } from '../lib/facturacion.js';
import { traerTodo } from '../lib/consultas.js';
import { fechaHn, filtrarRango, horaHn } from '../lib/fechas.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { requireRole } from '../middleware/requireRole.js';
import { alertaFueraDeHorario } from '../lib/antifraude.js';
import { destinatariosAdmins } from '../lib/correo.js';
import { crearAlerta } from '../lib/alertas.js';
import { guardarReglas, obtenerReglas } from '../lib/reglas.js';
import { hoyHn, inicioDelDia } from '../lib/fechas.js';
import { totalesPorForma } from '../lib/cierre.js';
import { ventasDelTurno } from './cierres.js';

export const antifraude = Router();

// ── Eventos que manda la app (navegación, carrito, búsquedas) ───────────
// Cualquier usuario logueado; sólo prefijos permitidos y detalle acotado,
// para que nadie pueda usar esto para llenar la bitácora de basura.
const PREFIJOS_EVENTO = ['sesion.', 'pantalla.', 'orden.', 'factura.', 'reporte.', 'cierre.ver'];
const eventosPorUsuario = new Map();

function limitarDetalle(detalle) {
  const limpio = {};
  for (const [k, v] of Object.entries(detalle ?? {}).slice(0, 12)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      limpio[String(k).slice(0, 40)] = typeof v === 'string' ? v.slice(0, 200) : v;
    }
  }
  return limpio;
}

antifraude.post('/evento', async (req, res) => {
  const { accion, detalle, sucursal_id } = req.body ?? {};
  if (typeof accion !== 'string' || !PREFIJOS_EVENTO.some((p) => accion.startsWith(p)) || accion.length > 60) {
    return res.status(400).json({ error: 'Evento no permitido' });
  }
  // Máximo 120 eventos por minuto por usuario.
  const minuto = Math.floor(Date.now() / 60000);
  const clave = `${req.perfil.id}:${minuto}`;
  const cuenta = (eventosPorUsuario.get(clave) ?? 0) + 1;
  eventosPorUsuario.set(clave, cuenta);
  if (eventosPorUsuario.size > 5000) eventosPorUsuario.clear();
  if (cuenta > 120) return res.status(429).json({ error: 'Demasiados eventos' });

  await registrarAuditoria(req, {
    accion,
    entidad: accion.split('.')[0],
    sucursalId: sucursal_id || req.perfil.sucursal_id || null,
    detalle: limitarDetalle(detalle),
  });
  if (accion === 'sesion.inicio' || accion === 'pantalla.ver') alertaFueraDeHorario(req, accion);
  res.status(204).end();
});

// ── Estado del correo de alertas ────────────────────────────────────────
antifraude.get('/correo', requireRole('admin'), async (req, res) => {
  const configurado = Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
  res.json({ configurado, destinatarios: configurado ? await destinatariosAdmins() : [] });
});

// ── Alertas ─────────────────────────────────────────────────────────────
// Estados: pendiente → investigando → resuelta / falso_positivo.
const ESTADOS_ALERTA = ['pendiente', 'investigando', 'resuelta', 'falso_positivo'];
const ABIERTAS = ['pendiente', 'investigando'];

antifraude.get('/alertas/pendientes', requireRole('admin'), async (req, res) => {
  const { count, error } = await db.from('alertas').select('id', { count: 'exact', head: true }).in('estado', ABIERTAS);
  if (error) return res.status(500).json({ error: error.message });
  const { count: ordenes } = await db.from('alertas').select('id', { count: 'exact', head: true }).in('estado', ABIERTAS).eq('tipo', 'orden.estacionada');
  res.json({ pendientes: count ?? 0, ordenes_abiertas: ordenes ?? 0 });
});

// Para las notificaciones en vivo: alertas nuevas desde el último id visto.
antifraude.get('/alertas/nuevas', requireRole('admin'), async (req, res) => {
  const desdeId = Number(req.query.desde_id ?? 0);
  let q = db.from('alertas').select('id, titulo, severidad, tipo, created_at, sucursales(nombre)').order('id', { ascending: false }).limit(10);
  if (req.query.desde_id !== undefined && Number.isFinite(desdeId)) q = q.gt('id', desdeId);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

antifraude.get('/alertas', requireRole('admin'), async (req, res) => {
  let q = db
    .from('alertas')
    .select('*, sucursales(nombre), revisor:revisada_por(nombre)')
    .order('revisada', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(300);
  if (req.query.solo_pendientes === '1') q = q.in('estado', ABIERTAS);
  if (req.query.estado && ESTADOS_ALERTA.includes(req.query.estado)) q = q.eq('estado', req.query.estado);
  if (req.query.sucursal_id) q = q.eq('sucursal_id', req.query.sucursal_id);
  q = filtrarRango(q, 'created_at', req.query.desde, req.query.hasta);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

async function cambiarEstadoAlerta(req, res, estado) {
  if (!ESTADOS_ALERTA.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  const nota = String(req.body?.nota ?? '').trim().slice(0, 500) || null;
  const cerrada = estado === 'resuelta' || estado === 'falso_positivo';
  const { data, error } = await db
    .from('alertas')
    .update({
      estado,
      revisada: cerrada,
      revisada_por: req.perfil.id,
      revisada_at: new Date().toISOString(),
      ...(nota ? { nota_revision: nota } : {}),
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  await registrarAuditoria(req, {
    accion: 'alerta.revisar',
    entidad: 'alerta',
    entidadId: data.id,
    sucursalId: data.sucursal_id,
    detalle: { titulo: data.titulo, estado, nota },
  });
  res.json(data);
}

// Cierra de un solo golpe todas las alertas abiertas (opcionalmente de un solo tipo).
antifraude.post('/alertas/resolver-masivo', requireRole('admin'), async (req, res) => {
  const tipo = req.body?.tipo ? String(req.body.tipo).slice(0, 60) : null;
  const nota = String(req.body?.nota ?? 'Cerradas en bloque por el administrador').trim().slice(0, 300);
  let q = db.from('alertas').update({ estado: 'resuelta', revisada: true, revisada_por: req.perfil.id, revisada_at: new Date().toISOString(), nota_revision: nota }).in('estado', ABIERTAS);
  if (tipo) q = q.eq('tipo', tipo);
  const { data, error } = await q.select('id');
  if (error) return res.status(500).json({ error: error.message });
  await registrarAuditoria(req, { accion: 'alerta.resolver_masivo', entidad: 'alerta', detalle: { tipo: tipo ?? 'todas', cantidad: data.length, nota } });
  res.json({ resueltas: data.length });
});

antifraude.put('/alertas/:id/revisar', requireRole('admin'), (req, res) => cambiarEstadoAlerta(req, res, 'resuelta'));
antifraude.put('/alertas/:id/estado', requireRole('admin'), (req, res) => cambiarEstadoAlerta(req, res, req.body?.estado));

// ── Reglas y umbrales ───────────────────────────────────────────────────
// Lectura para cualquier usuario (la app necesita, p. ej., los minutos de
// bloqueo por inactividad); sólo el admin las cambia.
antifraude.get('/reglas', async (req, res) => {
  res.json(await obtenerReglas());
});

antifraude.put('/reglas', requireRole('admin'), async (req, res) => {
  try {
    const antes = await obtenerReglas();
    const reglas = await guardarReglas(req.body ?? {}, req.perfil.id);
    const cambios = Object.keys(reglas)
      .filter((k) => String(antes[k]) !== String(reglas[k]))
      .map((k) => `${k}: ${antes[k]} → ${reglas[k]}`);
    await registrarAuditoria(req, { accion: 'antifraude.reglas', entidad: 'sistema', detalle: { cambios: cambios.join(' · ') } });
    res.json(reglas);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Arqueo sorpresa ─────────────────────────────────────────────────────
// Conteo a mitad de turno SIN mostrar antes cuánto debería haber: se
// cuenta, se guarda y recién entonces el sistema dice si cuadra.
antifraude.post('/arqueos', requireRole('admin', 'gerente'), async (req, res) => {
  try {
    const { sucursal_id, contado, nota } = req.body ?? {};
    if (!sucursal_id) return res.status(400).json({ error: 'Elige la sucursal' });
    const efectivoContado = Number(contado);
    if (!Number.isFinite(efectivoContado) || efectivoContado < 0) return res.status(400).json({ error: 'Monto contado inválido' });

    const { data: ultimo } = await db
      .from('cierres_caja')
      .select('fecha_fin, fondo_caja')
      .eq('sucursal_id', sucursal_id)
      .order('fecha_fin', { ascending: false })
      .limit(1)
      .maybeSingle();
    const desde = ultimo?.fecha_fin ?? inicioDelDia(hoyHn());
    const fondo = req.body.fondo_caja !== undefined && req.body.fondo_caja !== '' ? Number(req.body.fondo_caja) : Number(ultimo?.fondo_caja ?? 0);
    const ventas = await ventasDelTurno(sucursal_id, desde, new Date().toISOString());
    const sistema = totalesPorForma(ventas);
    const { data: gastos } = await db.from('caja_chica').select('monto').eq('sucursal_id', sucursal_id).eq('fecha', hoyHn());
    const salidas = round2((gastos ?? []).reduce((s, g) => s + Number(g.monto), 0));
    const esperado = round2(fondo + sistema.efectivo - salidas);
    const diferencia = round2(efectivoContado - esperado);
    const idsCajeros = [...new Set(ventas.map((v) => v.cajero_id).filter(Boolean))];
    const { data: cajeros } = idsCajeros.length ? await db.from('perfiles').select('nombre').in('id', idsCajeros) : { data: [] };
    const cajerosTurno = (cajeros ?? []).map((c) => c.nombre).join(', ');

    const { data, error } = await db
      .from('arqueos')
      .insert({
        sucursal_id,
        usuario_id: req.perfil.id,
        desde,
        fondo_caja: fondo,
        efectivo_sistema: sistema.efectivo,
        salidas,
        esperado,
        contado: efectivoContado,
        diferencia,
        cajeros_turno: cajerosTurno || null,
        nota: String(nota ?? '').trim().slice(0, 300) || null,
      })
      .select('*, sucursales(nombre)')
      .single();
    if (error) throw new Error(error.message);

    await registrarAuditoria(req, {
      accion: 'arqueo.sorpresa',
      entidad: 'arqueo',
      entidadId: data.id,
      sucursalId: sucursal_id,
      detalle: { esperado, contado: efectivoContado, diferencia, cajeros: cajerosTurno },
    });
    if (Math.abs(diferencia) >= 1) {
      await crearAlerta(req, {
        tipo: 'arqueo.descuadre',
        severidad: diferencia <= -1 ? 'alta' : 'media',
        titulo: `Arqueo sorpresa en ${data.sucursales?.nombre ?? 'sucursal'}: ${diferencia < 0 ? 'faltan' : 'sobran'} L ${Math.abs(diferencia).toFixed(2)}`,
        sucursalId: sucursal_id,
        entidad: 'arqueo',
        entidadId: data.id,
        correo: diferencia <= -1,
        detalle: { esperado, contado: efectivoContado, diferencia, cajeros_en_turno: cajerosTurno, conto: req.perfil.nombre },
      });
    }
    res.status(201).json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

antifraude.get('/arqueos', requireRole('admin', 'gerente'), async (req, res) => {
  const { data, error } = await db
    .from('arqueos')
    .select('*, sucursales(nombre), usuario:usuario_id(nombre)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Línea de tiempo de un usuario en un día (reconstrucción del turno) ──
antifraude.get('/usuarios', requireRole('admin'), async (req, res) => {
  const { data, error } = await db.from('perfiles').select('id, nombre, rol, sucursal_id').order('nombre');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

antifraude.get('/linea-tiempo', requireRole('admin'), async (req, res) => {
  try {
    const { usuario_id, fecha } = req.query;
    if (!usuario_id || !fecha) return res.status(400).json({ error: 'Elige el usuario y el día' });
    const [eventos, ventas] = await Promise.all([
      traerTodo(() =>
        filtrarRango(db.from('auditoria').select('id, created_at, accion, detalle, entidad_id, ip, sucursales(nombre)').eq('usuario_id', usuario_id), 'created_at', fecha, fecha).order('id')
      ),
      traerTodo(() =>
        filtrarRango(
          db.from('ventas').select('id, numero_factura, total, anulada, impresiones, reimpresiones, fecha_emision, tercera_edad_identidad, venta_pagos(monto, formas_pago(nombre))').eq('cajero_id', usuario_id).eq('estado', 'pagada'),
          'fecha_emision',
          fecha,
          fecha
        ).order('fecha_emision').order('id')
      ),
    ]);
    const facturadas = new Set(eventos.filter((e) => e.accion === 'venta.facturar').map((e) => e.entidad_id));
    const items = [
      ...eventos.map((e) => ({ tipo: 'evento', momento: e.created_at, accion: e.accion, detalle: e.detalle, sucursal: e.sucursales?.nombre ?? '', ip: e.ip })),
      // Facturas cuyo evento no quedó en la bitácora (versiones viejas).
      ...ventas
        .filter((v) => !facturadas.has(v.id))
        .map((v) => ({ tipo: 'factura', momento: v.fecha_emision, accion: 'venta.facturar', detalle: { numero_factura: v.numero_factura, total: Number(v.total) } })),
    ].sort((a, b) => a.momento.localeCompare(b.momento));
    const resumen = {
      facturas: ventas.filter((v) => !v.anulada).length,
      total: round2(ventas.filter((v) => !v.anulada).reduce((s, v) => s + Number(v.total), 0)),
      sin_imprimir: ventas.filter((v) => !v.anulada && Number(v.impresiones ?? 0) === 0).length,
      reimpresiones: ventas.reduce((s, v) => s + Number(v.reimpresiones ?? 0), 0),
      tercera_edad: ventas.filter((v) => v.tercera_edad_identidad).length,
      primer_movimiento: items[0]?.momento ?? null,
      ultimo_movimiento: items[items.length - 1]?.momento ?? null,
    };
    res.json({ resumen, items });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Tendencia de riesgo: últimas 4 semanas por cajero ───────────────────
const TIPOS_RIESGO = new Set([
  'cierre.descuadre',
  'cierre.patron_desvio',
  'cierre.reincidencia',
  'cierre.sin_imprimir',
  'venta.descartar_orden',
  'venta.reimpresion_repetida',
  'venta.doble_factura',
  'tercera_edad.carne_repetido',
  'tercera_edad.exceso',
  'acceso.denegado',
  'arqueo.descuadre',
  'orden.estacionada',
  'sesion.simultanea',
]);

antifraude.get('/tendencia', requireRole('admin'), async (req, res) => {
  const desde = new Date(Date.now() - 28 * 86400000).toISOString();
  const alertas = await traerTodo(() => db.from('alertas').select('id, tipo, created_at, usuario_id, usuario_nombre, estado').gte('created_at', desde).order('id'));
  const porUsuario = new Map();
  for (const a of alertas) {
    if (!TIPOS_RIESGO.has(a.tipo) || !a.usuario_id || a.estado === 'falso_positivo') continue;
    const semana = Math.min(3, Math.floor((Date.now() - new Date(a.created_at).getTime()) / (7 * 86400000)));
    const fila = porUsuario.get(a.usuario_id) ?? { usuario_id: a.usuario_id, nombre: a.usuario_nombre ?? '', semanas: [0, 0, 0, 0], total: 0 };
    fila.semanas[3 - semana] += 1;
    fila.total += 1;
    porUsuario.set(a.usuario_id, fila);
  }
  res.json([...porUsuario.values()].sort((a, b) => b.total - a.total));
});

// ── Indicadores por cajero y huecos sin facturar ────────────────────────
const ACCIONES_RIESGO = [
  'venta.descartar_orden',
  'venta.editar_orden',
  'orden.quitar_producto',
  'venta.imprimir_ticket',
  'venta.reimprimir_ticket',
  'acceso.denegado',
  'sesion.inicio',
  'pantalla.ver',
];

const HUECO_MINUTOS = 45;
const HORA_ABRE = 11;
const HORA_CIERRA = 21;

function minutosHn(iso) {
  const d = new Date(iso);
  return horaHn(iso) * 60 + d.getUTCMinutes();
}

antifraude.get('/indicadores', requireRole('admin'), async (req, res) => {
  try {
    const { desde, hasta, sucursal_id } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'Elige el rango de fechas' });
    const reglas = await obtenerReglas();

    const [ventas, eventos, cierres, perfiles] = await Promise.all([
      traerTodo(() => {
        let q = db
          .from('ventas')
          .select('id, cajero_id, sucursal_id, numero_factura, total, anulada, descuento, cambio, fecha_emision, venta_pagos(monto, formas_pago(nombre)), detalle_venta(descuento, descuento_porcentaje)')
          .eq('estado', 'pagada');
        if (sucursal_id) q = q.eq('sucursal_id', sucursal_id);
        return filtrarRango(q, 'fecha_emision', desde, hasta).order('fecha_emision').order('id');
      }),
      traerTodo(() => {
        let q = db.from('auditoria').select('id, created_at, usuario_id, usuario_nombre, accion, entidad_id, sucursal_id, detalle').in('accion', ACCIONES_RIESGO);
        if (sucursal_id) q = q.eq('sucursal_id', sucursal_id);
        return filtrarRango(q, 'created_at', desde, hasta).order('id');
      }),
      traerTodo(() => {
        let q = db.from('cierres_caja').select('id, cajero_id, sucursal_id, diferencia_efectivo, diferencia_tarjeta, fecha_fin');
        if (sucursal_id) q = q.eq('sucursal_id', sucursal_id);
        return filtrarRango(q, 'fecha_fin', desde, hasta).order('id');
      }),
      db.from('perfiles').select('id, nombre, rol, sin_horario').then((r) => r.data ?? []),
    ]);

    const nombreDe = new Map(perfiles.map((p) => [p.id, p.nombre]));
    const porCajero = new Map();
    const fila = (id) => {
      if (!porCajero.has(id)) {
        porCajero.set(id, {
          cajero_id: id,
          nombre: nombreDe.get(id) ?? 'Desconocido',
          facturas: 0,
          total: 0,
          efectivo: 0,
          con_descuento: 0,
          desc_25: 0,
          desc_10: 0,
          monto_descuentos: 0,
          anuladas: 0,
          monto_anulado: 0,
          descartadas: 0,
          monto_descartado: 0,
          quitados: 0,
          monto_quitado: 0,
          reimpresiones: 0,
          no_impresas: 0,
          faltantes: 0,
          monto_faltante: 0,
          accesos_denegados: 0,
          fuera_horario: 0,
          pantallas: 0,
        });
      }
      return porCajero.get(id);
    };

    const impresas = new Set(eventos.filter((e) => e.accion === 'venta.imprimir_ticket' || e.accion === 'venta.reimprimir_ticket').map((e) => e.entidad_id));

    for (const v of ventas) {
      const f = fila(v.cajero_id);
      if (v.anulada) {
        f.anuladas += 1;
        f.monto_anulado += Number(v.total);
        continue;
      }
      f.facturas += 1;
      f.total += Number(v.total);
      let ef = 0;
      for (const p of v.venta_pagos ?? []) if (p.formas_pago?.nombre === 'Efectivo') ef += Number(p.monto);
      f.efectivo += ef > 0 ? ef - Number(v.cambio ?? 0) : 0;
      const lineasDesc = (v.detalle_venta ?? []).filter((d) => Number(d.descuento) > 0);
      if (lineasDesc.length > 0) f.con_descuento += 1;
      f.desc_25 += lineasDesc.filter((d) => Number(d.descuento_porcentaje) === 25).length;
      f.desc_10 += lineasDesc.filter((d) => Number(d.descuento_porcentaje) === 10).length;
      f.monto_descuentos += Number(v.descuento ?? 0);
      if (!impresas.has(v.id)) f.no_impresas += 1;
    }

    const recientes = [];
    for (const e of eventos) {
      if (!e.usuario_id) continue;
      const f = fila(e.usuario_id);
      const d = e.detalle ?? {};
      if (e.accion === 'venta.descartar_orden') {
        f.descartadas += 1;
        f.monto_descartado += Number(d.total ?? 0);
      } else if (e.accion === 'orden.quitar_producto') {
        f.quitados += Number(d.cantidad ?? 1);
        f.monto_quitado += Number(d.monto ?? 0);
      } else if (e.accion === 'venta.reimprimir_ticket') {
        f.reimpresiones += 1;
      } else if (e.accion === 'acceso.denegado') {
        f.accesos_denegados += 1;
      } else if (e.accion === 'pantalla.ver') {
        f.pantallas += 1;
      }
      if ((e.accion === 'sesion.inicio' || e.accion === 'pantalla.ver') && (horaHn(e.created_at) < reglas.hora_apertura || horaHn(e.created_at) >= reglas.hora_cierre)) {
        f.fuera_horario += 1;
      }
      if (['venta.descartar_orden', 'orden.quitar_producto', 'venta.reimprimir_ticket', 'acceso.denegado'].includes(e.accion)) {
        recientes.push(e);
      }
    }

    for (const c of cierres) {
      if (Number(c.diferencia_efectivo) <= -1) {
        const f = fila(c.cajero_id);
        f.faltantes += 1;
        f.monto_faltante += Math.abs(Number(c.diferencia_efectivo));
      }
    }

    // Señales: comparan a cada cajero contra el promedio del grupo, para no
    // marcar a todos en un día de muchos descuentos legítimos.
    const filas = [...porCajero.values()].filter((f) => f.facturas + f.anuladas + f.descartadas + f.quitados + f.accesos_denegados + f.pantallas > 0);
    const conVentas = filas.filter((f) => f.facturas > 0);
    const promedio = (fn) => (conVentas.length ? conVentas.reduce((s, f) => s + fn(f), 0) / conVentas.length : 0);
    const promDesc = promedio((f) => f.con_descuento / f.facturas);
    const promAnul = promedio((f) => f.anuladas / (f.facturas || 1));

    for (const f of filas) {
      const s = [];
      const pctDesc = f.facturas ? f.con_descuento / f.facturas : 0;
      if (f.facturas >= 10 && pctDesc > Math.max(0.15, promDesc * 2)) s.push({ nivel: 'alta', texto: `${Math.round(pctDesc * 100)}% de sus facturas llevan descuento` });
      if (f.anuladas >= 2 && f.anuladas / (f.facturas || 1) > promAnul * 1.5) s.push({ nivel: 'alta', texto: `${f.anuladas} facturas anuladas` });
      if (f.descartadas >= 5 || f.monto_descartado > Math.max(500, f.total * 0.03)) s.push({ nivel: 'media', texto: `${f.descartadas} órdenes descartadas (L ${round2(f.monto_descartado)})` });
      if (f.quitados >= 8 || f.monto_quitado > Math.max(400, f.total * 0.02)) s.push({ nivel: 'media', texto: `${f.quitados} productos quitados de órdenes (L ${round2(f.monto_quitado)})` });
      if (f.no_impresas >= 3 && f.no_impresas > f.facturas * 0.03) s.push({ nivel: 'alta', texto: `${f.no_impresas} facturas nunca se imprimieron (¿el cliente recibió factura?)` });
      if (f.reimpresiones >= 3) s.push({ nivel: 'media', texto: `${f.reimpresiones} reimpresiones de facturas` });
      if (f.faltantes >= 1) s.push({ nivel: 'alta', texto: `${f.faltantes} cierre(s) con faltante (L ${round2(f.monto_faltante)})` });
      if (f.accesos_denegados >= 1) s.push({ nivel: 'media', texto: `${f.accesos_denegados} intento(s) de entrar a funciones sin permiso` });
      if (f.fuera_horario >= 1) s.push({ nivel: 'baja', texto: `${f.fuera_horario} uso(s) del sistema fuera de horario` });
      f.senales = s;
      f.riesgo = s.reduce((acc, x) => acc + (x.nivel === 'alta' ? 3 : x.nivel === 'media' ? 2 : 1), 0);
      for (const k of Object.keys(f)) if (typeof f[k] === 'number' && !Number.isInteger(f[k])) f[k] = round2(f[k]);
      f.ticket_promedio = f.facturas ? round2(f.total / f.facturas) : 0;
      f.pct_efectivo = f.total ? Math.round((f.efectivo / f.total) * 100) : 0;
      f.pct_descuento = Math.round(pctDesc * 100);
    }
    filas.sort((a, b) => b.riesgo - a.riesgo || b.total - a.total);

    // Huecos: más de 45 min sin facturar con la tienda abierta. Puede ser
    // un rato flojo… o ventas que no se están facturando.
    const porSucursalDia = new Map();
    for (const v of ventas) {
      const clave = `${v.sucursal_id}|${fechaHn(v.fecha_emision)}`;
      if (!porSucursalDia.has(clave)) porSucursalDia.set(clave, []);
      porSucursalDia.get(clave).push(v.fecha_emision);
    }
    const { data: sucursales } = await db.from('sucursales').select('id, nombre');
    const nombreSucursal = new Map((sucursales ?? []).map((s) => [s.id, s.nombre]));
    const huecos = [];
    for (const [clave, fechas] of porSucursalDia) {
      if (fechas.length < 5) continue;
      const [sid, dia] = clave.split('|');
      const mins = fechas.map(minutosHn).sort((a, b) => a - b);
      const puntos = [HORA_ABRE * 60, ...mins.filter((m) => m >= HORA_ABRE * 60 && m <= HORA_CIERRA * 60), HORA_CIERRA * 60];
      for (let i = 1; i < puntos.length; i++) {
        const gap = puntos[i] - puntos[i - 1];
        if (gap >= reglas.minutos_hueco) {
          const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
          huecos.push({ sucursal: nombreSucursal.get(sid) ?? '', fecha: dia, desde: hhmm(puntos[i - 1]), hasta: hhmm(puntos[i]), minutos: gap, facturas_dia: fechas.length });
        }
      }
    }
    huecos.sort((a, b) => b.minutos - a.minutos);

    res.json({
      cajeros: filas,
      huecos: huecos.slice(0, 60),
      recientes: recientes.sort((a, b) => b.id - a.id).slice(0, 100),
      totales: { facturas: ventas.filter((v) => !v.anulada).length, eventos: eventos.length },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
