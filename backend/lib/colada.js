import { db } from '../db.js';
import { registrarAuditoria } from './auditoria.js';
import { crearAlerta } from './alertas.js';
import { obtenerParametros, numero } from './parametros.js';
import { round2, round3 } from './cotizacion.js';
import { hoyHn, reservarCotizacion, sumarDias } from './produccion.js';

// Request "de sistema" para acciones automáticas (sin usuario).
export const reqSistema = { headers: {}, socket: {}, perfil: null, originalUrl: '/sistema', method: 'SISTEMA' };

// Colada: descuenta los insumos del inventario (según la receta o lo que se indique)
// y arranca la cuenta para pasar a inventario. forzar=true registra aunque falte existencia (la producción
// ya ocurrió en planta): queda stock negativo y una alerta para que se cargue la compra.
export async function colarOrden(req, orden, { reales = null, forzar = false } = {}) {
  const { data: consumos } = await db.from('orden_consumos').select('*, materias_primas(nombre, unidad)').eq('orden_id', orden.id);
  const params = await obtenerParametros();
  const tolerancia = numero(params.tolerancia_consumo_pct, 10);
  const { data: stockRows } = consumos.length ? await db.from('stock_mp').select('mp_id, stock').in('mp_id', consumos.map((c) => c.mp_id)) : { data: [] };
  const stock = new Map((stockRows ?? []).map((s) => [s.mp_id, Number(s.stock)]));

  const plan = consumos.map((c) => {
    const pedido = reales?.get(c.mp_id);
    const real = Number.isFinite(pedido) ? pedido : Number(c.teorico);
    if (real < 0) throw new Error('El consumo real no puede ser negativo');
    return { c, real };
  });
  const faltantes = plan.filter(({ c, real }) => (stock.get(c.mp_id) ?? 0) < real).map(({ c, real }) => ({ insumo: c.materias_primas.nombre, unidad: c.materias_primas.unidad, hay: stock.get(c.mp_id) ?? 0, necesita: real }));
  if (faltantes.length && !forzar) {
    throw new Error(`Insumos insuficientes: ${faltantes.map((f) => `${f.insumo} (hay ${f.hay}, se necesitan ${f.necesita} ${f.unidad})`).join('; ')}`);
  }

  let costoMp = 0;
  const desvios = [];
  const consumido = [];
  for (const { c, real } of plan) {
    let costoUnit = Number(c.costo_unitario);
    if (real > 0) {
      const { data: mov, error } = await db.rpc('mp_registrar_movimiento', { p_mp: c.mp_id, p_tipo: 'consumo', p_cantidad: -real, p_motivo: `Colada ${orden.lote}`, p_orden: orden.id, p_usuario: req.perfil?.id ?? null, p_forzar: forzar });
      if (error) throw new Error(error.message);
      costoUnit = Number(mov.costo_unitario);
    }
    costoMp += real * costoUnit;
    await db.from('orden_consumos').update({ real, costo_unitario: costoUnit }).eq('id', c.id);
    consumido.push({ insumo: c.materias_primas.nombre, unidad: c.materias_primas.unidad, cantidad: round3(real) });
    const teo = Number(c.teorico);
    if (teo > 0 && (Math.abs(real - teo) / teo) * 100 > tolerancia) desvios.push({ insumo: c.materias_primas.nombre, teorico: teo, real, desvio_pct: round2(((real - teo) / teo) * 100) });
  }

  const dias = numero(params.dias_a_inventario, 5);
  const { data: actualizada, error } = await db.from('ordenes_produccion').update({ estado: 'curando', fecha_colado: new Date().toISOString(), etiqueta_at: new Date().toISOString(), fecha_disponible: sumarDias(hoyHn(), dias), costo_mp: round2(costoMp), responsable_id: orden.responsable_id ?? req.perfil?.id ?? null }).eq('id', orden.id).select().single();
  if (error) throw new Error(error.message);
  if (orden.molde_id && orden.coladas) {
    const { data: m } = await db.from('moldes').select('usos').eq('id', orden.molde_id).single();
    await db.from('moldes').update({ usos: Number(m?.usos ?? 0) + Number(orden.coladas) }).eq('id', orden.molde_id);
  }
  await registrarAuditoria(req, { accion: 'produccion.colada', entidad: 'orden_produccion', entidadId: orden.id, detalle: { lote: orden.lote, costo_mp: round2(costoMp), desvios, faltantes: faltantes.length ? faltantes : undefined } });
  if (desvios.length) {
    await crearAlerta(req, { tipo: 'produccion.consumo_desviado', severidad: desvios.some((d) => Math.abs(d.desvio_pct) > tolerancia * 2) ? 'alta' : 'media', titulo: `Consumo fuera de receta en ${orden.lote}: ${desvios.map((d) => `${d.insumo} ${d.desvio_pct > 0 ? '+' : ''}${d.desvio_pct}%`).join(', ')}`, entidad: 'orden_produccion', entidadId: orden.id, detalle: { lote: orden.lote, tolerancia_pct: tolerancia, desvios } });
  }
  if (faltantes.length) {
    await crearAlerta(req, { tipo: 'produccion.insumo_insuficiente', severidad: 'alta', titulo: `Producción ${orden.lote} registrada sin insumos suficientes en el sistema: ${faltantes.map((f) => f.insumo).join(', ')}`, entidad: 'orden_produccion', entidadId: orden.id, detalle: { lote: orden.lote, faltantes, nota: 'Falta cargar compras de insumos, o el consumo fue mayor al registrado.' } });
  }
  return { orden: actualizada, desvios, faltantes, consumido };
}

// Pasa a inventario: el producto terminado entra al inventario y se calcula el costo real.
export async function terminarOrden(req, orden, { bueno, segunda = 0, merma = 0, motivoAnticipado = '', automatica = false }) {
  const { data: receta } = orden.receta_id ? await db.from('recetas').select('mano_obra_m2, indirectos_m2').eq('id', orden.receta_id).maybeSingle() : { data: null };
  const { data: controles } = await db.from('controles_calidad').select('resultado').eq('orden_id', orden.id);
  bueno = round3(bueno); segunda = round3(segunda); merma = round3(merma);
  const producido = round3(bueno + segunda);
  const costoMo = round2(Number(receta?.mano_obra_m2 ?? 0) * producido);
  const costoInd = round2(Number(receta?.indirectos_m2 ?? 0) * producido);
  const costoTotal = round2(Number(orden.costo_mp ?? 0) + costoMo + costoInd);
  const costoM2 = producido > 0 ? round2(costoTotal / producido) : 0;
  const uid = req.perfil?.id ?? null;

  if (bueno > 0) {
    const { error } = await db.rpc('pt_registrar_movimiento', { p_producto: orden.producto_id, p_lote: orden.lote, p_calidad: 'primera', p_tipo: 'produccion', p_m2: bueno, p_costo: costoM2, p_motivo: `Lote ${orden.lote}`, p_orden: orden.id, p_usuario: uid });
    if (error) throw new Error(error.message);
  }
  if (segunda > 0) {
    const { error } = await db.rpc('pt_registrar_movimiento', { p_producto: orden.producto_id, p_lote: orden.lote, p_calidad: 'segunda', p_tipo: 'produccion', p_m2: segunda, p_costo: costoM2, p_motivo: `Segunda calidad ${orden.lote}`, p_orden: orden.id, p_usuario: uid });
    if (error) throw new Error(error.message);
  }
  const { data: actualizada, error } = await db.from('ordenes_produccion').update({ estado: 'terminada', fecha_terminada: new Date().toISOString(), m2_bueno: bueno, m2_segunda: segunda, m2_merma: merma, costo_mano_obra: costoMo, costo_indirectos: costoInd, costo_total: costoTotal, costo_m2: costoM2 }).eq('id', orden.id).select().single();
  if (error) throw new Error(error.message);
  // Sin receta el costo real no se conoce: no se pisa el costo estándar cargado.
  if (costoM2 > 0) await db.from('productos').update({ costo_estandar: costoM2 }).eq('id', orden.producto_id);

  const total = producido + merma;
  const mermaPct = total > 0 ? round2((merma / total) * 100) : 0;
  const rendimiento = Number(orden.m2_planificado) > 0 ? round2((producido / Number(orden.m2_planificado)) * 100) : 0;
  const params = await obtenerParametros();
  const mermaMax = numero(params.merma_maxima_pct, 8);
  await registrarAuditoria(req, { accion: 'produccion.terminar', entidad: 'orden_produccion', entidadId: orden.id, detalle: { lote: orden.lote, bueno, segunda, merma, merma_pct: mermaPct, costo_m2: costoM2, automatica: automatica || undefined, liberada_antes: motivoAnticipado || undefined, sin_control_calidad: !(controles ?? []).length } });
  if (mermaPct > mermaMax) {
    await crearAlerta(req, { tipo: 'produccion.merma_alta', severidad: mermaPct > mermaMax * 1.5 ? 'alta' : 'media', titulo: `Merma alta en ${orden.lote}: ${mermaPct}% (normal hasta ${mermaMax}%)`, entidad: 'orden_produccion', entidadId: orden.id, detalle: { lote: orden.lote, merma_m2: merma, merma_pct: mermaPct, rendimiento_pct: rendimiento } });
  }
  let reserva = null;
  if (orden.cotizacion_id) {
    const { data: cot } = await db.from('cotizaciones').select('*').eq('id', orden.cotizacion_id).single();
    const { data: lineas } = await db.from('cotizacion_lineas').select('*').eq('cotizacion_id', orden.cotizacion_id);
    if (cot && ['aprobada', 'facturada'].includes(cot.estado)) reserva = await reservarCotizacion(req, cot, lineas ?? []);
  }
  return { orden: actualizada, merma_pct: mermaPct, rendimiento_pct: rendimiento, sin_control_calidad: !(controles ?? []).length, reserva };
}

// Pasa solas a inventario las producciones que cumplieron sus días (entran con
// lo registrado por el operario). Si hay un control de calidad rechazado se deja
// para revisión de gerencia. Se llama con un temporizador y al abrir pantallas.
let corriendo = false;
export async function liberarCuradosVencidos() {
  if (corriendo) return 0;
  corriendo = true;
  try {
    const { data: ordenes } = await db.from('ordenes_produccion').select('*').eq('estado', 'curando').lte('fecha_disponible', hoyHn());
    let liberadas = 0;
    for (const o of ordenes ?? []) {
      const { data: rechazos } = await db.from('controles_calidad').select('id').eq('orden_id', o.id).eq('resultado', 'rechazado').limit(1);
      if (rechazos?.length) continue;
      try {
        await terminarOrden(reqSistema, o, { bueno: Number(o.m2_planificado), segunda: 0, merma: 0, automatica: true });
        liberadas++;
      } catch (e) {
        console.error('[produccion] no se pudo liberar', o.lote, e.message);
      }
    }
    return liberadas;
  } finally {
    corriendo = false;
  }
}

export function iniciarLiberacionAutomatica() {
  const ciclo = () => liberarCuradosVencidos().catch((e) => console.error('[produccion] liberación', e.message));
  setTimeout(ciclo, 45 * 1000);
  setInterval(ciclo, 30 * 60 * 1000);
}
