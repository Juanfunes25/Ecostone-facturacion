import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { numero } from '../lib/parametros.js';
import { round2 } from '../lib/cotizacion.js';
import { sucursalesDe } from '../lib/empresas.js';

// Salidas de material a proyecto: lo que se llevan los empleados queda registrado
// (producto, cantidad, proyecto y responsable). Se puede sumar (sacar más), restar
// (devolver a bodega) y cerrar el proyecto; lo que no regresa cuenta como consumido.
export const disercoSalidas = Router();
// Sacar material lo registra cualquiera del equipo autorizado; verlo y modificarlo después es solo del administrador.
const MUEVE = ['admin', 'gerente', 'bodega', 'gestor'];
const ADMIN = ['admin'];
const fallo = (res, e, status = 400) => res.status(e.status ?? status).json({ error: e.message ?? String(e), codigo: e.codigo, faltantes: e.faltantes });
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

const SEL = '*, cotizacion:d_cotizaciones(codigo, proyecto, nombre_cliente), creador:perfiles!d_salidas_creada_por_fkey(nombre), items:d_salida_items(id, producto_id, cantidad_salida, cantidad_retorno, costo_unitario, productos(nombre, presentacion, unidad_venta, codigo))';

// El gestor de proyecto ve cantidades, no costos.
function sinCostos(rol, s) {
  if (rol !== 'gestor') return s;
  return { ...s, costo_total: undefined, items: s.items.map((i) => ({ ...i, costo: undefined, costo_unitario: undefined })) };
}

function resumen(s) {
  const items = (s.items ?? []).map((i) => {
    const pendiente = Number(i.cantidad_salida) - Number(i.cantidad_retorno);
    return { ...i, pendiente, costo: round2(pendiente * Number(i.costo_unitario)) };
  }).sort((a, b) => String(a.productos?.nombre).localeCompare(String(b.productos?.nombre)));
  return { ...s, items, unidades: items.reduce((t, i) => t + i.pendiente, 0), costo_total: round2(items.reduce((t, i) => t + i.costo, 0)) };
}

async function cargar(id) {
  const { data } = await db.from('d_salidas').select(SEL).eq('id', id).maybeSingle();
  return data ? resumen(data) : null;
}

async function existencias(ids) {
  const { data } = await db.from('inv_stock').select('producto_id, existencia').in('producto_id', ids);
  return new Map((data ?? []).map((x) => [x.producto_id, Number(x.existencia)]));
}

// Mueve material entre la bodega y el proyecto. cantidad > 0 saca de la bodega; < 0 devuelve.
async function mover(req, salida, producto_id, cantidad, { forzar }) {
  const { data: prod } = await db.from('productos').select('id, nombre, costo_estandar, controla_inventario, empresa').eq('id', producto_id).maybeSingle();
  if (!prod || prod.empresa !== 'diserco') throw err('Producto no encontrado', 404);
  if (!prod.controla_inventario) throw err(`${prod.nombre} no controla inventario: actívalo en Productos`);
  const { data: previo } = await db.from('d_salida_items').select('*').eq('salida_id', salida.id).eq('producto_id', producto_id).maybeSingle();
  const pendiente = previo ? Number(previo.cantidad_salida) - Number(previo.cantidad_retorno) : 0;
  if (cantidad < 0 && -cantidad > pendiente) throw err(`Solo hay ${pendiente} de ${prod.nombre} en este proyecto: no se pueden devolver ${-cantidad}`);
  const costo = Number(prod.costo_estandar) || 0;
  const motivo = `${cantidad > 0 ? 'Salida a proyecto' : 'Retorno de proyecto'}: ${salida.proyecto} (${salida.responsable})`;
  const { error } = await db.rpc('inv_mover', { p_producto: producto_id, p_tipo: cantidad > 0 ? 'salida_proyecto' : 'retorno_proyecto', p_cantidad: -cantidad, p_costo: costo, p_motivo: motivo, p_venta: null, p_proveedor: null, p_referencia: `Salida #${salida.numero}`, p_usuario: req.perfil.id, p_forzar: !!forzar, p_salida: salida.id });
  if (error) throw err(error.message);
  if (previo) {
    const salio = Number(previo.cantidad_salida) + (cantidad > 0 ? cantidad : 0);
    const retorno = Number(previo.cantidad_retorno) + (cantidad < 0 ? -cantidad : 0);
    // costo promedio de lo que lleva el proyecto
    const costoProm = cantidad > 0 ? (pendiente * Number(previo.costo_unitario) + cantidad * costo) / (pendiente + cantidad) : Number(previo.costo_unitario);
    await db.from('d_salida_items').update({ cantidad_salida: salio, cantidad_retorno: retorno, costo_unitario: Math.round(costoProm * 10000) / 10000 }).eq('id', previo.id);
  } else {
    await db.from('d_salida_items').insert({ salida_id: salida.id, producto_id, cantidad_salida: cantidad, cantidad_retorno: 0, costo_unitario: costo });
  }
  return prod;
}

function leerItems(lista) {
  if (!Array.isArray(lista) || !lista.length) throw err('Agrega al menos un producto');
  const mapa = new Map();
  for (const it of lista) {
    const c = numero(it.cantidad, NaN);
    if (!it.producto_id || !Number.isInteger(c) || c === 0) throw err('Cada producto necesita una cantidad entera distinta de cero');
    mapa.set(it.producto_id, (mapa.get(it.producto_id) ?? 0) + c);
  }
  return [...mapa].map(([producto_id, cantidad]) => ({ producto_id, cantidad })).filter((x) => x.cantidad !== 0);
}

// Avisa de faltantes (409 SIN_STOCK) salvo que el usuario ya lo haya confirmado.
async function revisarFaltantes(items, confirmar) {
  const sacando = items.filter((i) => i.cantidad > 0);
  if (!sacando.length) return [];
  const hay = await existencias(sacando.map((i) => i.producto_id));
  const { data: prods } = await db.from('productos').select('id, nombre').in('id', sacando.map((i) => i.producto_id));
  const nombre = new Map((prods ?? []).map((p) => [p.id, p.nombre]));
  const faltantes = sacando.filter((i) => (hay.get(i.producto_id) ?? 0) < i.cantidad).map((i) => ({ producto: nombre.get(i.producto_id) ?? '—', pedido: i.cantidad, hay: Math.max(0, Math.floor(hay.get(i.producto_id) ?? 0)) }));
  if (faltantes.length && !confirmar) {
    throw Object.assign(new Error(`Sin existencia suficiente: ${faltantes.map((f) => `${f.producto} (pides ${f.pedido}, hay ${f.hay})`).join('; ')}`), { status: 409, codigo: 'SIN_STOCK', faltantes });
  }
  return faltantes;
}

// Proyectos para elegir al sacar material: solo nombres (sin cantidades ni costos).
disercoSalidas.get('/proyectos', requireRole(...MUEVE), async (req, res) => {
  const [{ data: cots, error }, { data: abiertas }] = await Promise.all([
    db.from('d_cotizaciones').select('id, codigo, proyecto, nombre_cliente').eq('tipo', 'proyecto').in('estado', ['aprobada', 'facturada']).order('created_at', { ascending: false }).limit(200),
    db.from('d_salidas').select('proyecto, cotizacion_id').eq('estado', 'abierta').order('created_at', { ascending: false }),
  ]);
  if (error) return fallo(res, error, 500);
  const enCurso = (abiertas ?? []).map((a) => ({ nombre: a.proyecto, cotizacion_id: a.cotizacion_id }));
  const nombres = new Set(enCurso.map((a) => a.nombre));
  res.json({
    en_curso: enCurso,
    cotizaciones: (cots ?? []).filter((c) => !nombres.has(`${c.proyecto} — ${c.nombre_cliente}`)).map((c) => ({ nombre: `${c.proyecto} — ${c.nombre_cliente}`, cotizacion_id: c.id, codigo: c.codigo, proyecto: c.proyecto, cliente: c.nombre_cliente })),
  });
});

// Historial de un proyecto: cada movimiento de material y cada cierre/reapertura, con quién y cuándo.
disercoSalidas.get('/:id/historial', requireRole(...ADMIN), async (req, res) => {
  const [{ data: movs }, { data: eventos }] = await Promise.all([
    db.from('inv_movimientos').select('id, created_at, tipo, cantidad, productos(nombre), perfiles(nombre)').eq('salida_id', req.params.id).order('created_at', { ascending: false }).limit(500),
    db.from('auditoria').select('id, created_at, accion, usuario_nombre, detalle').eq('entidad', 'd_salida').eq('entidad_id', req.params.id).in('accion', ['salida.cerrar', 'salida.reabrir']).order('created_at', { ascending: false }),
  ]);
  const filas = [
    ...(movs ?? []).map((m) => ({ clave: `m${m.id}`, fecha: m.created_at, usuario: m.perfiles?.nombre ?? '—', texto: `${Number(m.cantidad) < 0 ? 'Sacó' : 'Devolvió'} ${Math.abs(Number(m.cantidad))} × ${m.productos?.nombre ?? ''}` , tipo: Number(m.cantidad) < 0 ? 'salida' : 'retorno' })),
    ...(eventos ?? []).map((e) => ({ clave: `e${e.id}`, fecha: e.created_at, usuario: e.usuario_nombre ?? '—', texto: e.accion === 'salida.cerrar' ? `Cerró el proyecto${e.detalle?.sobrante === 'devolver' ? ' (el sobrante regresó a bodega)' : ' (todo se consumió)'}` : 'Reabrió el proyecto', tipo: 'estado' })),
  ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  res.json(filas);
});

disercoSalidas.get('/', requireRole(...ADMIN), async (req, res) => {
  let q = db.from('d_salidas').select(SEL).order('created_at', { ascending: false }).limit(200);
  if (req.query.estado) q = q.eq('estado', req.query.estado);
  if (req.query.cotizacion_id) q = q.eq('cotizacion_id', req.query.cotizacion_id);
  const { data, error } = await q;
  if (error) return fallo(res, error, 500);
  const t = String(req.query.q ?? '').trim().toLowerCase();
  res.json(data.map(resumen).filter((s) => !t || [s.proyecto].some((v) => String(v).toLowerCase().includes(t))).map((s) => sinCostos(req.perfil.rol, s)));
});

disercoSalidas.get('/:id', requireRole(...ADMIN), async (req, res) => {
  const s = await cargar(req.params.id);
  if (!s) return res.status(404).json({ error: 'Salida no encontrada' });
  res.json(sinCostos(req.perfil.rol, s));
});

disercoSalidas.post('/', requireRole(...MUEVE), async (req, res) => {
  let creada = null;
  try {
    const proyecto = String(req.body.proyecto ?? '').trim();
    const responsable = req.perfil.nombre; // quién saca el material se sabe por su usuario
    if (proyecto.length < 3) throw err('Indica a qué proyecto va el material (obligatorio)');
    const items = leerItems(req.body.items);
    if (items.some((i) => i.cantidad < 0)) throw err('Una salida nueva solo lleva cantidades positivas');
    const faltantes = await revisarFaltantes(items, !!req.body.confirmar_sin_stock);
    // Un proyecto = un registro: si ya hay material abierto para ese proyecto, se suma ahí.
    const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const { data: abiertas } = await db.from('d_salidas').select('id, proyecto, cotizacion_id').eq('estado', 'abierta');
    const existente = (abiertas ?? []).find((a) => (req.body.cotizacion_id && a.cotizacion_id === req.body.cotizacion_id) || norm(a.proyecto) === norm(proyecto));
    if (existente) {
      const salidaExistente = await cargar(existente.id);
      for (const it of items) await mover(req, salidaExistente, it.producto_id, it.cantidad, { forzar: faltantes.length > 0 });
      await registrarAuditoria(req, { accion: 'salida.movimiento', entidad: 'd_salida', entidadId: existente.id, sucursalId: salidaExistente.sucursal_id, detalle: { numero: salidaExistente.numero, proyecto: salidaExistente.proyecto, items } });
      return res.status(200).json(req.perfil.rol === 'admin' ? { ...(await cargar(existente.id)), sumada: true } : { id: existente.id, proyecto: existente.proyecto, sumada: true, unidades: items.reduce((t, i) => t + i.cantidad, 0) });
    }
    const ids = await sucursalesDe('diserco');
    const sucursal_id = req.perfil.sucursal_id && ids.includes(req.perfil.sucursal_id) ? req.perfil.sucursal_id : ids[0];
    const { data: salida, error } = await db.from('d_salidas').insert({ proyecto, responsable, cotizacion_id: req.body.cotizacion_id || null, notas: String(req.body.notas ?? '').trim() || null, sucursal_id, creada_por: req.perfil.id }).select().single();
    if (error) throw err(error.message);
    creada = salida;
    for (const it of items) await mover(req, salida, it.producto_id, it.cantidad, { forzar: faltantes.length > 0 });
    await registrarAuditoria(req, { accion: 'salida.crear', entidad: 'd_salida', entidadId: salida.id, sucursalId: sucursal_id, detalle: { numero: salida.numero, proyecto, responsable, productos: items.length } });
    if (faltantes.length) await crearAlerta(req, { tipo: 'inventario.salida_sin_stock', severidad: 'baja', titulo: `Salida a ${proyecto} sin existencia suficiente (${req.perfil.nombre})`, sucursalId: sucursal_id, entidad: 'd_salida', entidadId: salida.id, detalle: { faltantes: faltantes.map((f) => `${f.producto}: pidió ${f.pedido}, había ${f.hay}`).join(' · ') } });
    res.status(201).json(req.perfil.rol === 'admin' ? await cargar(salida.id) : { id: salida.id, numero: salida.numero, proyecto: salida.proyecto, unidades: items.reduce((t, i) => t + i.cantidad, 0) });
  } catch (e) {
    if (creada) {
      // Si algo falló a medias, lo ya movido regresa a bodega y la salida se descarta.
      const { data: its } = await db.from('d_salida_items').select('producto_id, cantidad_salida, cantidad_retorno').eq('salida_id', creada.id);
      for (const i of its ?? []) {
        const pend = Number(i.cantidad_salida) - Number(i.cantidad_retorno);
        if (pend > 0) await db.rpc('inv_mover', { p_producto: i.producto_id, p_tipo: 'retorno_proyecto', p_cantidad: pend, p_costo: 0, p_motivo: 'Salida cancelada por error', p_venta: null, p_proveedor: null, p_referencia: `Salida #${creada.numero}`, p_usuario: req.perfil.id, p_forzar: true, p_salida: creada.id });
      }
      await db.from('d_salidas').delete().eq('id', creada.id);
    }
    fallo(res, e);
  }
});

// Sumar o restar material en una salida abierta: cantidad > 0 saca más de la bodega; < 0 devuelve.
disercoSalidas.post('/:id/movimiento', requireRole(...ADMIN), async (req, res) => {
  try {
    const salida = await cargar(req.params.id);
    if (!salida) return res.status(404).json({ error: 'Salida no encontrada' });
    if (salida.estado !== 'abierta') throw err('El proyecto ya está cerrado: reábrelo para mover material', 409);
    const items = leerItems(req.body.items ?? [{ producto_id: req.body.producto_id, cantidad: req.body.cantidad }]);
    const faltantes = await revisarFaltantes(items, !!req.body.confirmar_sin_stock);
    for (const it of items) await mover(req, salida, it.producto_id, it.cantidad, { forzar: faltantes.length > 0 });
    await registrarAuditoria(req, { accion: 'salida.movimiento', entidad: 'd_salida', entidadId: salida.id, sucursalId: salida.sucursal_id, detalle: { numero: salida.numero, proyecto: salida.proyecto, items } });
    if (faltantes.length) await crearAlerta(req, { tipo: 'inventario.salida_sin_stock', severidad: 'baja', titulo: `Material para ${salida.proyecto} sacado sin existencia suficiente (${req.perfil.nombre})`, sucursalId: salida.sucursal_id, entidad: 'd_salida', entidadId: salida.id, detalle: { faltantes: faltantes.map((f) => `${f.producto}: pidió ${f.pedido}, había ${f.hay}`).join(' · ') } });
    res.json(sinCostos(req.perfil.rol, await cargar(salida.id)));
  } catch (e) {
    fallo(res, e);
  }
});

// Cierra el proyecto. sobrante: 'devolver' regresa a bodega lo pendiente; 'consumido' lo da por usado.
disercoSalidas.post('/:id/cerrar', requireRole(...ADMIN), async (req, res) => {
  try {
    const salida = await cargar(req.params.id);
    if (!salida) return res.status(404).json({ error: 'Salida no encontrada' });
    if (salida.estado !== 'abierta') throw err('Ya está cerrada', 409);
    if (req.body.sobrante === 'devolver') {
      for (const i of salida.items) if (i.pendiente > 0) await mover(req, salida, i.producto_id, -i.pendiente, { forzar: true });
    }
    await db.from('d_salidas').update({ estado: 'cerrada', cerrada_at: new Date().toISOString(), cerrada_por: req.perfil.id }).eq('id', salida.id);
    const fin = await cargar(salida.id);
    const finVisible = sinCostos(req.perfil.rol, fin);
    await registrarAuditoria(req, { accion: 'salida.cerrar', entidad: 'd_salida', entidadId: salida.id, sucursalId: salida.sucursal_id, detalle: { numero: salida.numero, proyecto: salida.proyecto, sobrante: req.body.sobrante ?? 'consumido', costo_consumido: fin.costo_total } });
    res.json(finVisible);
  } catch (e) {
    fallo(res, e);
  }
});

disercoSalidas.post('/:id/reabrir', requireRole(...ADMIN), async (req, res) => {
  try {
    const salida = await cargar(req.params.id);
    if (!salida) return res.status(404).json({ error: 'Salida no encontrada' });
    if (salida.estado !== 'cerrada') throw err('La salida no está cerrada', 409);
    await db.from('d_salidas').update({ estado: 'abierta', cerrada_at: null, cerrada_por: null }).eq('id', salida.id);
    await registrarAuditoria(req, { accion: 'salida.reabrir', entidad: 'd_salida', entidadId: salida.id, sucursalId: salida.sucursal_id, detalle: { numero: salida.numero, proyecto: salida.proyecto } });
    res.json(await cargar(salida.id));
  } catch (e) {
    fallo(res, e);
  }
});
