import { Router } from 'express';
import { db } from '../db.js';
import { porEmpresa } from '../lib/empresas.js';
import { round2 } from '../lib/facturacion.js';
import { calcularCuadre, desgloseTurno, totalesPorForma } from '../lib/cierre.js';
import { enviarResumenCierre } from '../lib/correo.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { obtenerReglas } from '../lib/reglas.js';
import { requireRole } from '../middleware/requireRole.js';
import { anchoValido, envolverTicketHtml, formatearCierre } from '../lib/ticket.js';

export const cierres = Router();

const ZONA = 'America/Tegucigalpa';
const CAMPOS_SISTEMA = [
  'efectivo_sistema',
  'tarjeta_sistema',
  'transferencia_sistema',
  'total_esperado',
  'diferencia',
  'diferencia_tarjeta',
  'diferencia_efectivo',
  'total_ventas',
  'desglose_pagos',
];
const SELECT_CIERRE = '*, sucursales(nombre, alias), cajero:cajero_id(nombre), elaboro:elaboro_id(nombre)';

// Cierre ciego: el cajero cuenta sin ver cuánto "debería" haber, para que
// no ajuste el conteo al número del sistema. El servidor ni siquiera le
// manda esas cifras (no basta con esconderlas en pantalla).
function esCiego(perfil) {
  return perfil.cierre_ciego && ['cajero', 'ventas'].includes(perfil.rol);
}

function sinSistema(cierre) {
  const copia = { ...cierre };
  for (const campo of CAMPOS_SISTEMA) delete copia[campo];
  return copia;
}

// Un cajero con sucursal fija sólo puede cerrar la suya.
function sucursalPermitida(perfil, sucursalId) {
  return !(['cajero', 'ventas'].includes(perfil.rol) && perfil.sucursal_id && perfil.sucursal_id !== sucursalId);
}

function fechaLocal(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: ZONA }); // YYYY-MM-DD
}

// Supabase devuelve máximo 1000 filas por consulta: un día de mucho
// movimiento puede pasarse, así que se pide por páginas.
export async function ventasDelTurno(sucursal_id, desde, hasta) {
  const todas = [];
  for (let desdeFila = 0; ; desdeFila += 1000) {
    const { data, error } = await db
      .from('ventas')
      .select('id, total, numero_factura, correlativo, anulada, cambio, descuento, impresiones, cajero_id, venta_pagos(monto, formas_pago(nombre)), detalle_venta(descuento, descuento_porcentaje)')
      .eq('sucursal_id', sucursal_id)
      .eq('estado', 'pagada')
      .gte('fecha_emision', desde)
      .lte('fecha_emision', hasta)
      .order('correlativo', { ascending: true })
      .range(desdeFila, desdeFila + 999);
    if (error) throw new Error(error.message);
    todas.push(...data);
    if (data.length < 1000) return todas;
  }
}

async function resumenTurno(sucursal_id, desde, hasta) {
  const ventas = await ventasDelTurno(sucursal_id, desde, hasta);
  const t = totalesPorForma(ventas);

  // Salidas sugeridas: lo registrado en caja chica esos días (editable).
  const { data: gastos } = await db
    .from('caja_chica')
    .select('monto')
    .eq('sucursal_id', sucursal_id)
    .gte('fecha', fechaLocal(desde))
    .lte('fecha', fechaLocal(hasta));

  return {
    ...t,
    cantidad_facturas: ventas.length,
    factura_desde: ventas[0]?.numero_factura ?? null,
    factura_hasta: ventas[ventas.length - 1]?.numero_factura ?? null,
    salidas_sugeridas: round2((gastos ?? []).reduce((s, g) => s + Number(g.monto), 0)),
  };
}

// Patrones sospechosos que un solo cierre no muestra a simple vista:
//  - Desvío tarjeta→efectivo: el cliente paga en efectivo pero se registra
//    como tarjeta; el POS da de menos y la gaveta de más (sobrante que se
//    lo lleva quien cierra).
//  - Reincidencia: el mismo cajero con faltantes en varios cierres recientes.
//  - Facturas del turno que nunca se imprimieron (¿el cliente recibió factura?).
async function patronesDeCierre(req, cierre, cuadre, sucursalId, desde, hasta) {
  const reglas = await obtenerReglas();
  const nombre = cierre.sucursales?.nombre ?? 'sucursal';

  if (cuadre.diferencia_efectivo >= 1 && cuadre.diferencia_tarjeta <= -1) {
    await crearAlerta(req, {
      tipo: 'cierre.patron_desvio',
      severidad: 'alta',
      titulo: `Patrón de desvío en ${nombre}: sobra efectivo (L ${cuadre.diferencia_efectivo.toFixed(2)}) y falta tarjeta (L ${Math.abs(cuadre.diferencia_tarjeta).toFixed(2)})`,
      sucursalId,
      entidad: 'cierre',
      entidadId: cierre.id,
      correo: true,
      detalle: {
        cajero: req.perfil.nombre,
        sobrante_efectivo: cuadre.diferencia_efectivo,
        faltante_tarjeta: cuadre.diferencia_tarjeta,
        explicacion: 'Ventas cobradas en efectivo pero registradas como tarjeta',
      },
    });
  }

  if (cuadre.diferencia_efectivo <= -1) {
    const hace7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: previos } = await db
      .from('cierres_caja')
      .select('id, diferencia_efectivo')
      .eq('cajero_id', req.perfil.id)
      .lte('diferencia_efectivo', -1)
      .gte('fecha_fin', hace7);
    const cantidad = previos?.length ?? 0;
    if (cantidad >= reglas.faltantes_reincidencia) {
      const total = (previos ?? []).reduce((s, c) => s + Math.abs(Number(c.diferencia_efectivo)), 0);
      await crearAlerta(req, {
        tipo: 'cierre.reincidencia',
        severidad: 'alta',
        titulo: `${req.perfil.nombre} acumula ${cantidad} cierres con faltante en 7 días (L ${total.toFixed(2)})`,
        sucursalId,
        entidad: 'cierre',
        entidadId: cierre.id,
        correo: true,
        detalle: { cajero: req.perfil.nombre, cierres_con_faltante: cantidad, monto_total: round2(total) },
      });
    }
  }

  const ventas = await ventasDelTurno(sucursalId, desde, hasta);
  const sinImprimir = ventas.filter((v) => !v.anulada && Number(v.impresiones ?? 0) === 0);
  if (sinImprimir.length > 0) {
    await crearAlerta(req, {
      tipo: 'cierre.sin_imprimir',
      severidad: sinImprimir.length >= 3 ? 'alta' : 'media',
      titulo: `${sinImprimir.length} factura(s) del turno en ${nombre} nunca se imprimieron`,
      sucursalId,
      entidad: 'cierre',
      entidadId: cierre.id,
      detalle: {
        cajero: req.perfil.nombre,
        facturas: sinImprimir.slice(0, 15).map((v) => v.numero_factura).join(', '),
        monto: round2(sinImprimir.reduce((s, v) => s + Number(v.total), 0)),
      },
    });
  }
}

function validarRango(desde, hasta) {
  if (!desde || !hasta) return 'Faltan las fechas del turno';
  const a = new Date(desde);
  const b = new Date(hasta);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 'Fechas del turno inválidas';
  if (b <= a) return 'La hora de cierre debe ser posterior a la de apertura';
  if (b.getTime() > Date.now() + 5 * 60 * 1000) return 'La hora de cierre no puede estar en el futuro';
  return null;
}

// Último cierre de la sucursal: de ahí arranca el turno siguiente y se
// sugiere el mismo fondo de caja.
cierres.get('/ultimo', async (req, res) => {
  const { sucursal_id } = req.query;
  if (!sucursal_id) return res.status(400).json({ error: 'Falta la sucursal' });
  const { data, error } = await db
    .from('cierres_caja')
    .select('fecha_fin, fondo_caja')
    .eq('sucursal_id', sucursal_id)
    .order('fecha_fin', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? null);
});

cierres.get('/resumen', async (req, res) => {
  try {
    const { sucursal_id, desde, hasta } = req.query;
    if (!sucursal_id) return res.status(400).json({ error: 'Falta la sucursal' });
    if (!sucursalPermitida(req.perfil, sucursal_id)) return res.status(403).json({ error: 'No puedes cerrar otra sucursal' });
    const problema = validarRango(desde, hasta);
    if (problema) return res.status(400).json({ error: problema });

    const resumen = await resumenTurno(sucursal_id, desde, hasta);
    if (esCiego(req.perfil)) {
      return res.json({
        ciego: true,
        cantidad_facturas: resumen.cantidad_facturas,
        factura_desde: resumen.factura_desde,
        factura_hasta: resumen.factura_hasta,
        salidas_sugeridas: resumen.salidas_sugeridas,
      });
    }
    res.json({ ciego: false, ...resumen });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

cierres.post('/', async (req, res) => {
  try {
    const { sucursal_id, fecha_inicio, fecha_fin, observaciones } = req.body;
    if (!sucursal_id) return res.status(400).json({ error: 'Falta la sucursal' });
    if (!sucursalPermitida(req.perfil, sucursal_id)) return res.status(403).json({ error: 'No puedes cerrar otra sucursal' });
    const problema = validarRango(fecha_inicio, fecha_fin);
    if (problema) return res.status(400).json({ error: problema });

    for (const campo of ['pos_bac', 'pos_ficohsa', 'efectivo_contado', 'fondo_caja', 'salidas']) {
      const v = req.body[campo];
      if (v === undefined || v === null || v === '') {
        if (['pos_bac', 'pos_ficohsa', 'efectivo_contado'].includes(campo)) {
          return res.status(400).json({ error: 'Llena POS BAC, POS Ficohsa y el efectivo contado (usa 0 si no hubo)' });
        }
        continue;
      }
      if (!Number.isFinite(Number(v)) || Number(v) < 0) return res.status(400).json({ error: `Monto inválido en ${campo}` });
    }

    // Evita cerrar dos veces el mismo turno (o turnos que se traslapan) en la
    // misma sucursal — eso duplicaría las facturas contadas en el total.
    const { data: solapados, error: errSolape } = await db
      .from('cierres_caja')
      .select('id, fecha_inicio, fecha_fin')
      .eq('sucursal_id', sucursal_id)
      .lt('fecha_inicio', fecha_fin)
      .gt('fecha_fin', fecha_inicio);
    if (errSolape) throw new Error(errSolape.message);
    if (solapados.length > 0) {
      const c = solapados[0];
      const fmt = (f) => new Date(f).toLocaleString('es-HN', { timeZone: ZONA });
      return res.status(409).json({
        error: `Ya existe un cierre en ese rango (del ${fmt(c.fecha_inicio)} al ${fmt(c.fecha_fin)}). Ajusta las fechas para no contar las mismas facturas dos veces.`,
      });
    }

    // El sistema se recalcula acá, nunca se toma lo que mande la pantalla.
    const sistema = await resumenTurno(sucursal_id, fecha_inicio, fecha_fin);
    const cuadre = calcularCuadre(sistema, req.body);

    const noCuadra = Math.abs(cuadre.diferencia_tarjeta) >= 1 || Math.abs(cuadre.diferencia_efectivo) >= 1;
    if (noCuadra && !esCiego(req.perfil) && !String(observaciones ?? '').trim()) {
      return res.status(400).json({ error: 'El cierre no cuadra: escribe en Observaciones qué pasó con la diferencia' });
    }

    const { data: cierre, error: errInsert } = await db
      .from('cierres_caja')
      .insert({
        sucursal_id,
        cajero_id: req.perfil.id,
        elaboro_id: req.perfil.id,
        fecha_inicio,
        fecha_fin,
        efectivo_contado: cuadre.efectivo_contado,
        fondo_caja: cuadre.fondo_caja,
        salidas: cuadre.salidas,
        factura_desde: sistema.factura_desde,
        factura_hasta: sistema.factura_hasta,
        cantidad_facturas: sistema.cantidad_facturas,
        total_ventas: sistema.total_ventas,
        efectivo_sistema: sistema.efectivo,
        tarjeta_sistema: sistema.tarjeta,
        transferencia_sistema: sistema.transferencia,
        pos_bac: cuadre.pos_bac,
        pos_ficohsa: cuadre.pos_ficohsa,
        diferencia_tarjeta: cuadre.diferencia_tarjeta,
        diferencia_efectivo: cuadre.diferencia_efectivo,
        total_esperado: cuadre.efectivo_esperado,
        total_contado: cuadre.efectivo_contado,
        diferencia: cuadre.diferencia_total,
        desglose_pagos: [
          { nombre: 'Efectivo', monto: sistema.efectivo },
          { nombre: 'Tarjeta', monto: sistema.tarjeta },
          { nombre: 'Transferencia', monto: sistema.transferencia },
        ],
        observaciones: String(observaciones ?? '').trim() || null,
        cierre_ciego: req.perfil.cierre_ciego,
        estado: 'cerrado',
      })
      .select(SELECT_CIERRE)
      .single();
    if (errInsert) throw new Error(errInsert.message);

    await registrarAuditoria(req, {
      accion: 'cierre.crear',
      entidad: 'cierre',
      entidadId: cierre.id,
      sucursalId: sucursal_id,
      detalle: {
        factura_desde: sistema.factura_desde,
        factura_hasta: sistema.factura_hasta,
        total_esperado: cuadre.efectivo_esperado,
        total_contado: cuadre.efectivo_contado,
        diferencia: cuadre.diferencia_total,
        diferencia_tarjeta: cuadre.diferencia_tarjeta,
        diferencia_efectivo: cuadre.diferencia_efectivo,
        pos_bac: cuadre.pos_bac,
        pos_ficohsa: cuadre.pos_ficohsa,
      },
    });
    // Descuadre (L 1 o más en tarjeta o efectivo): alerta en Antifraude y
    // correo inmediato a todos los administradores.
    let alertaDescuadre = false;
    if (noCuadra) {
      const d = cuadre.diferencia_total;
      const tipoDif = (x) => (x < 0 ? `faltante L ${Math.abs(x).toFixed(2)}` : `sobrante L ${x.toFixed(2)}`);
      const partes = [];
      if (Math.abs(cuadre.diferencia_tarjeta) >= 1) partes.push(`tarjeta ${tipoDif(cuadre.diferencia_tarjeta)}`);
      if (Math.abs(cuadre.diferencia_efectivo) >= 1) partes.push(`efectivo ${tipoDif(cuadre.diferencia_efectivo)}`);
      alertaDescuadre = Boolean(
        await crearAlerta(req, {
          tipo: 'cierre.descuadre',
          severidad: Math.abs(d) >= 100 || Math.abs(cuadre.diferencia_efectivo) >= 100 ? 'alta' : 'media',
          titulo: `Descuadre en cierre de ${cierre.sucursales?.nombre ?? 'sucursal'}: ${partes.join(', ')}`,
          sucursalId: sucursal_id,
          entidad: 'cierre',
          entidadId: cierre.id,
          correo: true,
          detalle: {
            cajero: req.perfil.nombre,
            desde: new Date(fecha_inicio).toLocaleString('es-HN', { timeZone: ZONA }),
            hasta: new Date(fecha_fin).toLocaleString('es-HN', { timeZone: ZONA }),
            tarjeta_sistema: sistema.tarjeta,
            pos_bac: cuadre.pos_bac,
            pos_ficohsa: cuadre.pos_ficohsa,
            diferencia_tarjeta: cuadre.diferencia_tarjeta,
            efectivo_esperado: cuadre.efectivo_esperado,
            efectivo_contado: cuadre.efectivo_contado,
            diferencia_efectivo: cuadre.diferencia_efectivo,
            transferencias: sistema.transferencia,
            diferencia_total: d,
            observaciones: String(observaciones ?? '').trim() || '(sin observaciones)',
          },
        })
      );
    }
    await patronesDeCierre(req, cierre, cuadre, sucursal_id, fecha_inicio, fecha_fin).catch((e) =>
      console.error('[cierre] patrones', e.message)
    );
    // No bloquea el cierre si el correo falla o no está configurado.
    enviarResumenCierre(cierre, cierre.sucursales?.nombre ?? '').catch(() => {});

    const respuesta = esCiego(req.perfil) ? sinSistema(cierre) : cierre;
    res.status(201).json({ ...respuesta, descuadre: Boolean(noCuadra), alerta_enviada: alertaDescuadre });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

cierres.get('/', requireRole('admin', 'gerente'), async (req, res) => {
  const { sucursal_id, fechaInicio, fechaFin } = req.query;
  let query = db.from('cierres_caja').select(SELECT_CIERRE).order('fecha_fin', { ascending: false }).limit(200);
  if (sucursal_id) query = query.eq('sucursal_id', sucursal_id);
  else query = await porEmpresa(req, query);
  if (fechaInicio) query = query.gte('fecha_inicio', fechaInicio);
  if (fechaFin) query = query.lte('fecha_fin', fechaFin);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

async function cierrePermitido(req) {
  const { data } = await db.from('cierres_caja').select(SELECT_CIERRE).eq('id', req.params.id).maybeSingle();
  if (!data) return null;
  if (['cajero', 'ventas'].includes(req.perfil.rol) && data.cajero_id !== req.perfil.id) return null;
  return data;
}

cierres.get('/:id/ticket', async (req, res) => {
  const cierre = await cierrePermitido(req);
  if (!cierre) return res.status(404).json({ error: 'Cierre no encontrado' });
  const ancho = anchoValido(req.query.columnas);
  const ocultarSistema = esCiego(req.perfil);
  // Desglose con las facturas reales del turno (igual que la factura, el
  // ticket del cierre sale en la térmica).
  let desglose = null;
  if (!ocultarSistema) {
    try {
      desglose = desgloseTurno(await ventasDelTurno(cierre.sucursal_id, cierre.fecha_inicio, cierre.fecha_fin));
    } catch (e) {
      console.error('[cierre ticket] desglose', e.message);
    }
  }
  await registrarAuditoria(req, { accion: 'cierre.imprimir', entidad: 'cierre', entidadId: cierre.id, sucursalId: cierre.sucursal_id });
  res.type('text/html').send(envolverTicketHtml(formatearCierre(cierre, ancho, { ocultarSistema, desglose }), ancho));
});

cierres.get('/:id', async (req, res) => {
  const cierre = await cierrePermitido(req);
  if (!cierre) return res.status(404).json({ error: 'Cierre no encontrado' });
  res.json(esCiego(req.perfil) ? sinSistema(cierre) : cierre);
});
