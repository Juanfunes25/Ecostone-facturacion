import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { obtenerParametros, numero } from '../lib/parametros.js';
import { round2, round3 } from '../lib/cotizacion.js';
import { traerTodo } from '../lib/consultas.js';
import { actualizarCostoEstandar, costoDeReceta, crearOrdenProduccion, hoyHn, sumarDias } from '../lib/produccion.js';
import { colarOrden, liberarCuradosVencidos, terminarOrden } from '../lib/colada.js';

export const fabricacion = Router();
const LEE = ['admin', 'gerente', 'produccion', 'bodega'];
const PRODUCE = ['admin', 'gerente', 'produccion'];
const GERENCIA = ['admin', 'gerente'];
const fallo = (res, e, status = 400) => res.status(e.status ?? status).json({ error: e.message ?? String(e) });

// ── Moldes ──────────────────────────────────────────────────────────────────
fabricacion.get('/moldes', requireRole(...LEE), async (req, res) => {
  const { data, error } = await db.from('moldes').select('*, productos(nombre)').order('codigo');
  if (error) return fallo(res, error, 500);
  res.json(data.map((m) => ({ ...m, vida_restante: Number(m.vida_util_usos) - Number(m.usos), por_reemplazar: Number(m.vida_util_usos) > 0 && Number(m.usos) >= Number(m.vida_util_usos) * 0.9 })));
});

fabricacion.post('/moldes', requireRole(...PRODUCE), async (req, res) => {
  const { codigo, nombre, producto_id, piezas_por_colada, m2_por_colada, vida_util_usos, notas } = req.body;
  if (!String(codigo ?? '').trim() || !String(nombre ?? '').trim()) return res.status(400).json({ error: 'Código y nombre del molde son obligatorios' });
  const { data, error } = await db.from('moldes').insert({ codigo: codigo.trim(), nombre: nombre.trim(), producto_id: producto_id || null, piezas_por_colada: numero(piezas_por_colada, 1), m2_por_colada: numero(m2_por_colada), vida_util_usos: numero(vida_util_usos, 300), notas }).select().single();
  if (error) return fallo(res, error.code === '23505' ? { message: 'Ya existe un molde con ese código' } : error);
  await registrarAuditoria(req, { accion: 'molde.crear', entidad: 'molde', entidadId: data.id, detalle: { codigo: data.codigo } });
  res.status(201).json(data);
});

fabricacion.put('/moldes/:id', requireRole(...PRODUCE), async (req, res) => {
  const { nombre, producto_id, piezas_por_colada, m2_por_colada, vida_util_usos, estado, notas } = req.body;
  const { data, error } = await db.from('moldes').update({ nombre, producto_id: producto_id || null, piezas_por_colada, m2_por_colada, vida_util_usos, estado, notas }).eq('id', req.params.id).select().single();
  if (error) return fallo(res, error);
  res.json(data);
});

// ── Recetas ─────────────────────────────────────────────────────────────────
fabricacion.get('/recetas', requireRole(...LEE), async (req, res) => {
  const { data, error } = await db.from('recetas').select('*, productos(nombre, modelo, color, precio), receta_items(mp_id, cantidad_m2, materias_primas(nombre, unidad, categoria, costo_promedio))').order('created_at', { ascending: false });
  if (error) return fallo(res, error, 500);
  const verCostos = GERENCIA.includes(req.perfil.rol);
  res.json(
    data.map((r) => {
      const costo = costoDeReceta(r);
      const precioBase = Number(r.productos?.precio ?? 0);
      return { ...r, costo: verCostos ? costo : undefined, margen_pct_publico: verCostos && precioBase > 0 ? round2(((precioBase / 1.15 - costo.total_m2) / (precioBase / 1.15)) * 100) : null };
    })
  );
});

async function guardarItems(recetaId, items) {
  const limpios = (items ?? []).filter((i) => i.mp_id && numero(i.cantidad_m2) > 0);
  if (!limpios.length) throw new Error('La receta necesita al menos un insumo con cantidad por m²');
  if (new Set(limpios.map((i) => i.mp_id)).size !== limpios.length) throw new Error('Un insumo está repetido en la receta');
  await db.from('receta_items').delete().eq('receta_id', recetaId);
  const { error } = await db.from('receta_items').insert(limpios.map((i) => ({ receta_id: recetaId, mp_id: i.mp_id, cantidad_m2: numero(i.cantidad_m2) })));
  if (error) throw new Error(error.message);
}

fabricacion.post('/recetas', requireRole(...GERENCIA), async (req, res) => {
  try {
    const { producto_id, nombre, merma_esperada_pct, mano_obra_m2, indirectos_m2, dias_curado, horas_desmolde, notas, items } = req.body;
    if (!producto_id || !String(nombre ?? '').trim()) throw new Error('Producto y nombre de la receta son obligatorios');
    await db.from('recetas').update({ activa: false }).eq('producto_id', producto_id).eq('activa', true);
    const { data, error } = await db.from('recetas').insert({ producto_id, nombre: nombre.trim(), merma_esperada_pct: numero(merma_esperada_pct, 5), mano_obra_m2: numero(mano_obra_m2), indirectos_m2: numero(indirectos_m2), dias_curado: numero(dias_curado, 7), horas_desmolde: numero(horas_desmolde, 24), notas }).select().single();
    if (error) throw new Error(error.message);
    try {
      await guardarItems(data.id, items);
    } catch (e) {
      await db.from('recetas').delete().eq('id', data.id);
      throw e;
    }
    const costo = await actualizarCostoEstandar(producto_id);
    await registrarAuditoria(req, { accion: 'receta.crear', entidad: 'receta', entidadId: data.id, detalle: { nombre: data.nombre, costo_m2: costo?.total_m2 } });
    res.status(201).json({ ...data, costo });
  } catch (e) {
    fallo(res, e);
  }
});

fabricacion.put('/recetas/:id', requireRole(...GERENCIA), async (req, res) => {
  try {
    const { nombre, merma_esperada_pct, mano_obra_m2, indirectos_m2, dias_curado, horas_desmolde, notas, items, activa } = req.body;
    const { data: antes } = await db.from('recetas').select('*').eq('id', req.params.id).single();
    if (!antes) return res.status(404).json({ error: 'Receta no encontrada' });
    if (activa === true && !antes.activa) await db.from('recetas').update({ activa: false }).eq('producto_id', antes.producto_id).eq('activa', true);
    const { data, error } = await db.from('recetas').update({ nombre, merma_esperada_pct, mano_obra_m2, indirectos_m2, dias_curado, horas_desmolde, notas, activa }).eq('id', req.params.id).select().single();
    if (error) throw new Error(error.message);
    if (items) await guardarItems(data.id, items);
    const costo = await actualizarCostoEstandar(data.producto_id);
    await registrarAuditoria(req, { accion: 'receta.editar', entidad: 'receta', entidadId: data.id, detalle: { nombre: data.nombre, costo_m2: costo?.total_m2 } });
    res.json({ ...data, costo });
  } catch (e) {
    fallo(res, e);
  }
});

// ── Órdenes de producción ───────────────────────────────────────────────────
fabricacion.get('/ordenes', requireRole(...LEE), async (req, res) => {
  let q = db.from('ordenes_produccion').select('*, productos(nombre, modelo, color), moldes(codigo, nombre), cotizaciones(numero, proyecto), perfiles!ordenes_produccion_responsable_id_fkey(nombre)').order('created_at', { ascending: false }).limit(300);
  if (req.query.estado) q = q.in('estado', String(req.query.estado).split(','));
  const { data, error } = await q;
  if (error) return fallo(res, error, 500);
  const hoy = hoyHn();
  res.json(data.map((o) => ({ ...o, atrasada: o.estado === 'planificada' && o.fecha_programada < hoy })));
});

fabricacion.get('/ordenes/:id', requireRole(...LEE), async (req, res) => {
  const { data: orden, error } = await db.from('ordenes_produccion').select('*, productos(nombre, modelo, color, m2_por_caja), moldes(codigo, nombre, m2_por_colada), cotizaciones(numero, proyecto, fecha_entrega), recetas(nombre, dias_curado, merma_esperada_pct, mano_obra_m2, indirectos_m2)').eq('id', req.params.id).single();
  if (error || !orden) return res.status(404).json({ error: 'Orden no encontrada' });
  const [{ data: consumos }, { data: calidad }, stock] = await Promise.all([
    db.from('orden_consumos').select('*, materias_primas(nombre, unidad, categoria)').eq('orden_id', orden.id),
    db.from('controles_calidad').select('*, perfiles(nombre)').eq('orden_id', orden.id).order('created_at'),
    traerTodo(() => db.from('stock_mp').select('mp_id, stock').order('mp_id')),
  ]);
  const stockPorMp = new Map(stock.map((s) => [s.mp_id, Number(s.stock)]));
  const verCostos = GERENCIA.includes(req.perfil.rol);
  res.json({
    ...orden,
    consumos: (consumos ?? []).map((c) => ({ ...c, stock: stockPorMp.get(c.mp_id) ?? 0, alcanza: (stockPorMp.get(c.mp_id) ?? 0) >= Number(c.teorico), costo_unitario: verCostos ? c.costo_unitario : undefined })),
    calidad: calidad ?? [],
  });
});

fabricacion.post('/ordenes', requireRole(...PRODUCE), async (req, res) => {
  try {
    const { producto_id, m2_planificado, fecha_programada, molde_id, notas, responsable_id } = req.body;
    if (!producto_id) throw new Error('Elige el producto a fabricar');
    const orden = await crearOrdenProduccion(req, { producto_id, m2: numero(m2_planificado), fecha_programada, molde_id: molde_id || null, notas, responsable_id: responsable_id || req.perfil.id });
    await registrarAuditoria(req, { accion: 'produccion.crear_orden', entidad: 'orden_produccion', entidadId: orden.id, detalle: { lote: orden.lote, m2: orden.m2_planificado } });
    res.status(201).json(orden);
  } catch (e) {
    fallo(res, e);
  }
});

// Colada: se descuentan los insumos reales del inventario y empieza el curado.
fabricacion.post('/ordenes/:id/colar', requireRole(...PRODUCE), async (req, res) => {
  try {
    const { data: orden } = await db.from('ordenes_produccion').select('*').eq('id', req.params.id).single();
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    if (orden.estado !== 'planificada') throw new Error(`La orden está "${orden.estado}": solo se puede colar una orden planificada`);
    const reales = new Map((req.body.consumos ?? []).map((c) => [c.mp_id, numero(c.real, NaN)]));
    const r = await colarOrden(req, orden, { reales });
    res.json({ ...r.orden, desvios: r.desvios });
  } catch (e) {
    fallo(res, e);
  }
});

// Fin del curado: entra producto terminado al inventario y se calcula el costo real.
fabricacion.post('/ordenes/:id/terminar', requireRole(...PRODUCE), async (req, res) => {
  try {
    const { data: orden } = await db.from('ordenes_produccion').select('*').eq('id', req.params.id).single();
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    if (orden.estado !== 'curando') throw new Error('Solo se puede terminar una orden que ya fue colada y está curando');
    const bueno = round3(numero(req.body.m2_bueno));
    const segunda = round3(numero(req.body.m2_segunda));
    const merma = round3(numero(req.body.m2_merma));
    if (bueno < 0 || segunda < 0 || merma < 0) throw new Error('Los m² no pueden ser negativos');
    if (bueno + segunda <= 0) throw new Error('Indica cuántos m² buenos (o de segunda) salieron');
    const motivo = String(req.body.motivo_anticipado ?? '').trim();
    if (orden.fecha_disponible && orden.fecha_disponible > hoyHn() && !(motivo && GERENCIA.includes(req.perfil.rol))) {
      throw new Error(`El curado termina el ${orden.fecha_disponible}. Solo gerencia puede liberarla antes, con motivo.`);
    }
    const { data: controles } = await db.from('controles_calidad').select('resultado').eq('orden_id', orden.id);
    if ((controles ?? []).some((c) => c.resultado === 'rechazado') && req.perfil.rol === 'produccion') {
      throw new Error('Hay un control de calidad RECHAZADO en esta orden: gerencia debe revisarla antes de liberar el lote');
    }
    const r = await terminarOrden(req, orden, { bueno, segunda, merma, motivoAnticipado: motivo });
    res.json({ ...r.orden, merma_pct: r.merma_pct, rendimiento_pct: r.rendimiento_pct, sin_control_calidad: r.sin_control_calidad, reserva: r.reserva });
  } catch (e) {
    fallo(res, e);
  }
});

fabricacion.post('/ordenes/:id/cancelar', requireRole(...GERENCIA), async (req, res) => {
  const motivo = String(req.body.motivo ?? '').trim();
  if (!motivo) return res.status(400).json({ error: 'El motivo de la cancelación es obligatorio' });
  const { data: orden } = await db.from('ordenes_produccion').select('*').eq('id', req.params.id).single();
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
  if (orden.estado !== 'planificada') return res.status(409).json({ error: 'Solo se cancelan órdenes planificadas (una colada ya gastó insumos)' });
  await db.from('ordenes_produccion').update({ estado: 'cancelada', notas: `${orden.notas ? orden.notas + ' | ' : ''}Cancelada: ${motivo}` }).eq('id', orden.id);
  await registrarAuditoria(req, { accion: 'produccion.cancelar', entidad: 'orden_produccion', entidadId: orden.id, detalle: { lote: orden.lote, motivo } });
  res.json({ ok: true });
});

const PRUEBAS = ['Inspección visual y color', 'Dimensiones y espesor', 'Peso por m²', 'Absorción de agua', 'Resistencia a compresión', 'Adherencia (bond) al mortero', 'Eflorescencia', 'Consistencia de la mezcla'];
fabricacion.get('/calidad/pruebas', requireRole(...LEE), (req, res) => res.json(PRUEBAS));

fabricacion.post('/ordenes/:id/calidad', requireRole(...PRODUCE), async (req, res) => {
  try {
    const { prueba, resultado, valor, unidad, notas } = req.body;
    if (!String(prueba ?? '').trim()) throw new Error('Indica la prueba realizada');
    if (!['aprobado', 'observado', 'rechazado'].includes(resultado)) throw new Error('Resultado inválido');
    const { data: orden } = await db.from('ordenes_produccion').select('lote').eq('id', req.params.id).single();
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });
    const { data, error } = await db.from('controles_calidad').insert({ orden_id: req.params.id, prueba: prueba.trim(), resultado, valor: valor === '' || valor == null ? null : numero(valor), unidad: unidad || null, notas: notas || null, usuario_id: req.perfil.id }).select().single();
    if (error) throw new Error(error.message);
    await registrarAuditoria(req, { accion: 'calidad.control', entidad: 'orden_produccion', entidadId: req.params.id, detalle: { lote: orden.lote, prueba, resultado, valor } });
    if (resultado === 'rechazado') {
      await crearAlerta(req, { tipo: 'calidad.rechazado', severidad: 'alta', titulo: `Control de calidad RECHAZADO en ${orden.lote}: ${prueba}`, entidad: 'orden_produccion', entidadId: req.params.id, detalle: { lote: orden.lote, prueba, valor, unidad, notas }, correo: true });
    }
    res.status(201).json(data);
  } catch (e) {
    fallo(res, e);
  }
});

// ── Planificación de compras (MRP) ──────────────────────────────────────────
fabricacion.get('/mrp', requireRole(...LEE), async (req, res) => {
  try {
    const [{ data: mps }, stockRows, { data: ordenes }] = await Promise.all([
      db.from('materias_primas').select('id, nombre, unidad, categoria, costo_promedio, moneda, stock_minimo, proveedores(nombre)').eq('activo', true),
      traerTodo(() => db.from('stock_mp').select('mp_id, stock').order('mp_id')),
      db.from('ordenes_produccion').select('id').eq('estado', 'planificada'),
    ]);
    const stock = new Map(stockRows.map((s) => [s.mp_id, Number(s.stock)]));
    const requerido = new Map();
    if (ordenes?.length) {
      const { data: cons } = await db.from('orden_consumos').select('mp_id, teorico').in('orden_id', ordenes.map((o) => o.id));
      for (const c of cons ?? []) requerido.set(c.mp_id, round3((requerido.get(c.mp_id) ?? 0) + Number(c.teorico)));
    }
    const verCostos = GERENCIA.includes(req.perfil.rol);
    const filas = mps
      .map((m) => {
        const s = stock.get(m.id) ?? 0;
        const req_ = requerido.get(m.id) ?? 0;
        const minimo = Number(m.stock_minimo);
        const faltante = round3(Math.max(0, req_ - s));
        const sugerido = round3(Math.max(0, req_ + minimo - s));
        return { ...m, stock: s, requerido: req_, minimo, faltante, sugerido_comprar: sugerido, costo_estimado: verCostos ? round2(sugerido * Number(m.costo_promedio)) : undefined };
      })
      .filter((f) => f.requerido > 0 || f.sugerido_comprar > 0)
      .sort((a, b) => b.faltante - a.faltante || b.sugerido_comprar - a.sugerido_comprar);
    res.json({ ordenes_planificadas: ordenes?.length ?? 0, insumos: filas });
  } catch (e) {
    fallo(res, e, 500);
  }
});

// ── Agenda: producción, disponibilidad y entregas comprometidas ────────────
fabricacion.get('/agenda', requireRole(...LEE, 'vendedor'), async (req, res) => {
  const desde = req.query.desde || sumarDias(hoyHn(), -7);
  const hasta = req.query.hasta || sumarDias(hoyHn(), 45);
  const [{ data: ordenes }, { data: cots }] = await Promise.all([
    db.from('ordenes_produccion').select('id, lote, estado, m2_planificado, fecha_programada, fecha_disponible, productos(nombre), cotizaciones(numero, proyecto)').neq('estado', 'cancelada'),
    db.from('cotizaciones').select('id, numero, proyecto, nombre_cliente, estado, fecha_entrega, total').in('estado', ['aprobada', 'facturada']).not('fecha_entrega', 'is', null),
  ]);
  const hoy = hoyHn();
  const eventos = [];
  for (const o of ordenes ?? []) {
    if (o.estado === 'planificada' && o.fecha_programada) eventos.push({ fecha: o.fecha_programada, tipo: 'colada', titulo: `Colar ${o.lote} · ${o.productos?.nombre}`, detalle: `${o.m2_planificado} m²${o.cotizaciones ? ` · Cot. #${o.cotizaciones.numero}` : ''}`, atrasado: o.fecha_programada < hoy, orden_id: o.id });
    if (o.estado === 'curando' && o.fecha_disponible) eventos.push({ fecha: o.fecha_disponible, tipo: 'curado', titulo: `Fin de curado ${o.lote} · ${o.productos?.nombre}`, detalle: `${o.m2_planificado} m²`, atrasado: o.fecha_disponible < hoy, orden_id: o.id });
  }
  for (const c of cots ?? []) eventos.push({ fecha: c.fecha_entrega, tipo: 'entrega', titulo: `Entrega Cot. #${c.numero} · ${c.proyecto || c.nombre_cliente}`, detalle: c.proyecto ? c.nombre_cliente : '', atrasado: c.fecha_entrega < hoy && c.estado === 'aprobada', cotizacion_id: c.id });
  res.json(eventos.filter((e) => e.fecha >= desde && e.fecha <= hasta).sort((a, b) => a.fecha.localeCompare(b.fecha)));
});

fabricacion.get('/resumen', requireRole(...LEE), async (req, res) => {
  await liberarCuradosVencidos().catch(() => {});
  const [{ data: ordenes }, mp, pt] = await Promise.all([
    db.from('ordenes_produccion').select('estado, m2_planificado, fecha_programada, fecha_disponible'),
    Promise.all([db.from('materias_primas').select('id, stock_minimo').eq('activo', true), traerTodo(() => db.from('stock_mp').select('mp_id, stock').order('mp_id'))]),
    traerTodo(() => db.from('stock_pt').select('producto_id, lote, calidad, fisico, disponible').order('producto_id')),
  ]);
  const hoy = hoyHn();
  const stock = new Map(mp[1].map((s) => [s.mp_id, Number(s.stock)]));
  const bajoMinimo = (mp[0].data ?? []).filter((m) => Number(m.stock_minimo) > 0 && (stock.get(m.id) ?? 0) < Number(m.stock_minimo)).length;
  const cuenta = (est) => (ordenes ?? []).filter((o) => o.estado === est);
  res.json({
    planificadas: cuenta('planificada').length,
    atrasadas: cuenta('planificada').filter((o) => o.fecha_programada < hoy).length,
    curando: cuenta('curando').length,
    m2_curando: round3(cuenta('curando').reduce((s, o) => s + Number(o.m2_planificado), 0)),
    listas_para_liberar: cuenta('curando').filter((o) => o.fecha_disponible && o.fecha_disponible <= hoy).length,
    insumos_bajo_minimo: bajoMinimo,
    m2_disponible_primera: round3(pt.filter((s) => s.calidad === 'primera').reduce((s, r) => s + Number(r.disponible), 0)),
    m2_fisico_total: round3(pt.reduce((s, r) => s + Number(r.fisico), 0)),
  });
});
