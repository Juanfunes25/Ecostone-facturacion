import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { fechaHn, inicioDelDia, finDelDia } from '../lib/fechas.js';
import { hoyHn, sumarDias } from '../lib/produccion.js';
import { liberarCuradosVencidos } from '../lib/colada.js';
import { round2, round3 } from '../lib/cotizacion.js';
import { traerTodo, traerPorIds } from '../lib/consultas.js';

// Panorama de producción: qué se produjo, quién, cuánto material se gastó, qué
// está curando, cuánto hay en inventario y qué alertas hay.
export const reporteProduccion = Router();

reporteProduccion.get('/', requireRole('admin', 'gerente'), async (req, res) => {
  try {
    await liberarCuradosVencidos().catch(() => {});
    const hasta = /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta ?? '') ? req.query.hasta : hoyHn();
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde ?? '') ? req.query.desde : sumarDias(hasta, -29);

    const ordenes = await traerTodo(() =>
      db.from('ordenes_produccion')
        .select('id, lote, estado, m2_planificado, m2_bueno, m2_segunda, m2_merma, fecha_colado, fecha_disponible, fecha_terminada, costo_mp, costo_total, costo_m2, cotizacion_id, responsable_id, productos(nombre, modelo, color, unidad_venta), perfiles!ordenes_produccion_responsable_id_fkey(nombre)')
        .not('fecha_colado', 'is', null).gte('fecha_colado', inicioDelDia(desde)).lte('fecha_colado', finDelDia(hasta)).order('fecha_colado', { ascending: false })
    );
    const ids = ordenes.map((o) => o.id);
    const [consumos, { data: pendientes }, { data: alertas }, { data: calidad }, stockPt, stockMp, { data: mps }] = await Promise.all([
      traerPorIds(() => db.from('orden_consumos').select('orden_id, mp_id, teorico, real, costo_unitario, materias_primas(nombre, unidad)').order('id'), 'orden_id', ids),
      db.from('ordenes_produccion').select('id, lote, m2_planificado, fecha_programada, cotizacion_id, productos(nombre, unidad_venta), cotizaciones(numero)').eq('estado', 'planificada').order('fecha_programada'),
      db.from('alertas').select('id, created_at, tipo, severidad, titulo, estado').or('tipo.like.produccion.*,tipo.like.calidad.*,tipo.like.inventario.*').gte('created_at', inicioDelDia(desde)).lte('created_at', finDelDia(hasta)).order('created_at', { ascending: false }).limit(25),
      db.from('controles_calidad').select('resultado').gte('created_at', inicioDelDia(desde)).lte('created_at', finDelDia(hasta)),
      traerTodo(() => db.from('stock_pt').select('producto_id, calidad, fisico, disponible').order('producto_id')),
      traerTodo(() => db.from('stock_mp').select('mp_id, stock').order('mp_id')),
      db.from('materias_primas').select('id, nombre, unidad, stock_minimo, costo_promedio').eq('activo', true),
    ]);

    const uni = (o) => (o.productos?.unidad_venta === 'caja' ? 'cajas' : 'm²');
    const m2s = ordenes.filter((o) => uni(o) === 'm²');
    const suma = (arr, f) => round3(arr.reduce((s, o) => s + Number(f(o) ?? 0), 0));
    const terminadas = m2s.filter((o) => o.estado === 'terminada');
    const bueno = suma(terminadas, (o) => o.m2_bueno), segunda = suma(terminadas, (o) => o.m2_segunda), merma = suma(terminadas, (o) => o.m2_merma);
    const kpis = {
      registros: ordenes.length,
      m2_producidos: suma(m2s, (o) => o.m2_planificado),
      cajas_esquina_producidas: suma(ordenes.filter((o) => uni(o) === 'cajas'), (o) => o.m2_planificado),
      en_curado_m2: suma(m2s.filter((o) => o.estado === 'curando'), (o) => o.m2_planificado),
      en_curado_lotes: ordenes.filter((o) => o.estado === 'curando').length,
      liberado_m2: bueno, segunda_m2: segunda, merma_m2: merma,
      merma_pct: bueno + segunda + merma > 0 ? round2((merma / (bueno + segunda + merma)) * 100) : 0,
      costo_insumos: round2(ordenes.reduce((s, o) => s + Number(o.costo_mp ?? 0), 0)),
      costo_m2_promedio: bueno + segunda > 0 ? round2(terminadas.reduce((s, o) => s + Number(o.costo_total ?? 0), 0) / (bueno + segunda)) : null,
    };

    // Serie diaria continua
    const porDiaMap = new Map();
    for (const o of m2s) { const f = fechaHn(o.fecha_colado); porDiaMap.set(f, round3((porDiaMap.get(f) ?? 0) + Number(o.m2_planificado))); }
    const por_dia = [];
    for (let f = desde, n = 0; f <= hasta && n < 400; f = sumarDias(f, 1), n++) por_dia.push({ fecha: f, etiqueta: f.slice(8) + '/' + f.slice(5, 7), valor: porDiaMap.get(f) ?? 0 });

    const agrupar = (lista, clave, etiqueta) => {
      const m = new Map();
      for (const o of lista) { const k = clave(o); const x = m.get(k) ?? { nombre: etiqueta(o), valor: 0, registros: 0 }; x.valor = round3(x.valor + Number(o.m2_planificado)); x.registros++; m.set(k, x); }
      return [...m.values()].sort((a, b) => b.valor - a.valor);
    };
    const por_modelo = agrupar(m2s, (o) => o.productos?.modelo ?? o.productos?.nombre, (o) => o.productos?.modelo ?? o.productos?.nombre);
    const por_producto = [...agrupar(ordenes, (o) => `${o.productos?.nombre}|${uni(o)}`, (o) => o.productos?.nombre).map((x) => x)].map((x, i) => x);
    const unidadPorNombre = new Map(ordenes.map((o) => [o.productos?.nombre, uni(o)]));
    const por_operario = agrupar(ordenes, (o) => o.perfiles?.nombre ?? 'Sin usuario', (o) => o.perfiles?.nombre ?? 'Sin usuario');

    const mpAgg = new Map();
    for (const c of consumos) {
      if (c.real == null) continue;
      const x = mpAgg.get(c.mp_id) ?? { insumo: c.materias_primas?.nombre, unidad: c.materias_primas?.unidad, teorico: 0, real: 0, costo: 0 };
      x.teorico += Number(c.teorico); x.real += Number(c.real); x.costo += Number(c.real) * Number(c.costo_unitario);
      mpAgg.set(c.mp_id, x);
    }
    const consumo = [...mpAgg.values()].map((x) => ({ ...x, teorico: round3(x.teorico), real: round3(x.real), costo: round2(x.costo), desvio_pct: x.teorico > 0 ? round2(((x.real - x.teorico) / x.teorico) * 100) : null })).sort((a, b) => b.costo - a.costo);

    const stockMpMap = new Map(stockMp.map((s) => [s.mp_id, Number(s.stock)]));
    const insumos_criticos = (mps ?? []).map((m) => ({ nombre: m.nombre, unidad: m.unidad, stock: round3(stockMpMap.get(m.id) ?? 0), minimo: Number(m.stock_minimo) })).filter((m) => m.stock < 0 || (m.minimo > 0 && m.stock < m.minimo)).sort((a, b) => a.stock - b.stock);

    const { data: prods } = await db.from('productos').select('id, nombre, unidad_venta').eq('tipo', 'piedra').eq('activo', true);
    const inventario = (prods ?? []).map((p) => {
      const f = stockPt.filter((s) => s.producto_id === p.id);
      const disp = round3(f.filter((s) => s.calidad === 'primera').reduce((a, s) => a + Number(s.disponible), 0));
      const fis = round3(f.reduce((a, s) => a + Number(s.fisico), 0));
      return { nombre: p.nombre, unidad: p.unidad_venta === 'caja' ? 'cajas' : 'm²', disponible: disp, fisico: fis };
    }).filter((x) => x.fisico !== 0 || x.disponible !== 0).sort((a, b) => b.disponible - a.disponible);

    const cal = { aprobado: 0, observado: 0, rechazado: 0 };
    for (const c of calidad ?? []) cal[c.resultado]++;

    res.json({
      rango: { desde, hasta }, kpis, por_dia, por_modelo,
      por_producto: por_producto.map((x) => ({ ...x, unidad: unidadPorNombre.get(x.nombre) ?? 'm²' })),
      por_operario, consumo, calidad: cal, insumos_criticos, inventario,
      por_producir: (pendientes ?? []).map((o) => ({ lote: o.lote, producto: o.productos?.nombre, cantidad: Number(o.m2_planificado), unidad: o.productos?.unidad_venta === 'caja' ? 'cajas' : 'm²', fecha_programada: o.fecha_programada, cotizacion: o.cotizaciones?.numero ?? null })),
      alertas: alertas ?? [],
      registros: ordenes.map((o) => ({ id: o.id, lote: o.lote, registrado_at: o.fecha_colado, operario: o.perfiles?.nombre ?? '—', producto: o.productos?.nombre, cantidad: Number(o.m2_planificado), unidad: uni(o), estado: o.estado, disponible_desde: o.fecha_disponible, liberado_at: o.fecha_terminada, cotizacion_id: o.cotizacion_id })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
