import { db } from '../db.js';
import { round2, round3 } from './cotizacion.js';
import { obtenerParametros, numero } from './parametros.js';
import { inicioDelDia } from './fechas.js';

export const hoyHn = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date());

export function sumarDias(fechaIso, dias) {
  const d = new Date(`${fechaIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(dias));
  return d.toISOString().slice(0, 10);
}

export async function recetaActiva(productoId) {
  const { data } = await db.from('recetas').select('*, receta_items(mp_id, cantidad_m2, materias_primas(nombre, unidad, costo_promedio))').eq('producto_id', productoId).eq('activa', true).maybeSingle();
  return data ?? null;
}

// Costo por m² terminado de una receta: insumos × (1 + merma) + mano de obra + indirectos.
export function costoDeReceta(receta) {
  const insumos = (receta.receta_items ?? []).reduce((s, i) => s + Number(i.cantidad_m2) * Number(i.materias_primas?.costo_promedio ?? 0), 0);
  const conMerma = insumos * (1 + Number(receta.merma_esperada_pct || 0) / 100);
  const total = conMerma + Number(receta.mano_obra_m2 || 0) + Number(receta.indirectos_m2 || 0);
  return { insumos: round2(insumos), insumos_con_merma: round2(conMerma), mano_obra: round2(receta.mano_obra_m2 || 0), indirectos: round2(receta.indirectos_m2 || 0), total_m2: round2(total) };
}

export async function actualizarCostoEstandar(productoId) {
  const receta = await recetaActiva(productoId);
  if (!receta) return null;
  const c = costoDeReceta(receta);
  await db.from('productos').update({ costo_estandar: c.total_m2 }).eq('id', productoId);
  return c;
}

// Crea una orden de producción con su consumo teórico según la receta activa.
export async function crearOrdenProduccion(req, { producto_id, m2, fecha_programada, cotizacion_id = null, molde_id = null, notas = null, responsable_id = null, permitirSinReceta = false }) {
  const receta = await recetaActiva(producto_id);
  if (!receta && !permitirSinReceta) throw Object.assign(new Error('El producto no tiene una receta activa: créala en Fabricación → Recetas'), { status: 400 });
  const m2Plan = round3(m2);
  if (!(m2Plan > 0)) throw Object.assign(new Error('Los m² a producir deben ser mayores que 0'), { status: 400 });

  let molde = null;
  if (molde_id) {
    const { data } = await db.from('moldes').select('*').eq('id', molde_id).maybeSingle();
    molde = data;
  }
  const coladas = molde && Number(molde.m2_por_colada) > 0 ? Math.ceil(m2Plan / Number(molde.m2_por_colada)) : null;

  const hoy = hoyHn();
  const inicioHoy = inicioDelDia(hoy);
  const { count } = await db.from('ordenes_produccion').select('id', { count: 'exact', head: true }).gte('created_at', inicioHoy);
  const prefijo = `EC-${hoy.slice(2).replace(/-/g, '')}`;
  let orden = null;
  for (let intento = 1; intento <= 8 && !orden; intento++) {
    const lote = `${prefijo}-${String((count ?? 0) + intento).padStart(2, '0')}`;
    const { data, error } = await db
      .from('ordenes_produccion')
      .insert({ lote, producto_id, receta_id: receta?.id ?? null, cotizacion_id, m2_planificado: m2Plan, molde_id, coladas, fecha_programada: fecha_programada || sumarDias(hoy, 1), responsable_id, notas, creada_por: req.perfil?.id ?? null })
      .select()
      .single();
    if (!error) orden = data;
    else if (error.code !== '23505') throw new Error(error.message);
  }
  if (!orden) throw new Error('No se pudo asignar un número de lote; intenta de nuevo');

  const factor = 1 + Number(receta?.merma_esperada_pct || 0) / 100;
  const consumos = (receta?.receta_items ?? []).map((i) => ({
    orden_id: orden.id,
    mp_id: i.mp_id,
    teorico: round3(Number(i.cantidad_m2) * m2Plan * factor),
    costo_unitario: Number(i.materias_primas?.costo_promedio ?? 0),
  }));
  if (consumos.length) {
    const { error } = await db.from('orden_consumos').insert(consumos);
    if (error) throw new Error(error.message);
  }
  return orden;
}

// Necesidad de m² de piedra de una cotización, por producto.
export function demandaPorProducto(lineas, productosPorId) {
  const mapa = new Map();
  for (const l of lineas) {
    if (l.tipo !== 'producto' || !l.producto_id) continue;
    const p = productosPorId.get(l.producto_id);
    if (!p || p.tipo !== 'piedra') continue;
    // Unidad de inventario: m² (o cajas para las cajas de esquina, que no tienen m²).
    let m2 = 0;
    if (l.cajas && Number(p.m2_por_caja) > 0) m2 = Number(l.cajas) * Number(p.m2_por_caja);
    else if (Number(l.m2_neto) > 0) m2 = Number(l.m2_neto) * (1 + Number(l.desperdicio_pct || 0) / 100);
    else if (['m2', 'caja'].includes(p.unidad_venta)) m2 = Number(l.cantidad || 0);
    if (m2 > 0) mapa.set(l.producto_id, round3((mapa.get(l.producto_id) ?? 0) + m2));
  }
  return mapa;
}

// Reserva existencias (FIFO por lote) para una cotización aprobada y genera
// órdenes de producción por lo que falte. Idempotente: se puede volver a
// llamar (por ejemplo al terminar una producción) sin duplicar reservas.
export async function reservarCotizacion(req, cotizacion, lineas) {
  const { data: productos } = await db.from('productos').select('id, nombre, tipo, m2_por_caja, unidad_venta').in('id', [...new Set(lineas.map((l) => l.producto_id).filter(Boolean))]);
  const porId = new Map((productos ?? []).map((p) => [p.id, p]));
  const demanda = demandaPorProducto(lineas, porId);
  const resultado = { reservado: [], ordenes: [], pendientes: [] };

  for (const [productoId, m2Necesarios] of demanda) {
    const nombre = porId.get(productoId).nombre;
    const { data: movs } = await db.from('movimientos_pt').select('m2').eq('cotizacion_id', cotizacion.id).eq('producto_id', productoId).in('tipo', ['reserva', 'liberacion']);
    const yaReservado = round3(-(movs ?? []).reduce((s, m) => s + Number(m.m2), 0));
    let falta = round3(m2Necesarios - yaReservado);

    if (falta > 0) {
      const { data: lotes } = await db.from('stock_pt').select('lote, calidad, disponible, ultimo_movimiento').eq('producto_id', productoId).eq('calidad', 'primera').gt('disponible', 0).order('ultimo_movimiento');
      for (const lote of lotes ?? []) {
        if (falta <= 0) break;
        const toma = round3(Math.min(falta, Number(lote.disponible)));
        const { error } = await db.rpc('pt_registrar_movimiento', { p_producto: productoId, p_lote: lote.lote, p_calidad: 'primera', p_tipo: 'reserva', p_m2: -toma, p_costo: 0, p_motivo: `Reserva cotización #${cotizacion.numero}`, p_cotizacion: cotizacion.id, p_usuario: req.perfil?.id ?? null });
        if (error) throw new Error(error.message);
        resultado.reservado.push({ producto: nombre, lote: lote.lote, m2: toma });
        falta = round3(falta - toma);
      }
    }

    if (falta > 0) {
      // ¿Ya hay producción en camino para esta cotización?
      const { data: enCamino } = await db.from('ordenes_produccion').select('m2_planificado').eq('cotizacion_id', cotizacion.id).eq('producto_id', productoId).in('estado', ['planificada', 'curando']);
      const cubierto = round3((enCamino ?? []).reduce((s, o) => s + Number(o.m2_planificado), 0));
      const porProducir = round3(falta - cubierto);
      if (porProducir > 0) {
        try {
          const receta = await recetaActiva(productoId);
          const params = await obtenerParametros();
          const dias = numero(params.dias_a_inventario, 5);
          const hoy = hoyHn();
          let programada = sumarDias(hoy, 1);
          if (cotizacion.fecha_entrega) {
            const ideal = sumarDias(cotizacion.fecha_entrega, -(dias + 3));
            programada = ideal > programada ? ideal : programada;
          }
          const orden = await crearOrdenProduccion(req, { producto_id: productoId, m2: porProducir, fecha_programada: programada, cotizacion_id: cotizacion.id, notas: `Generada por la cotización #${cotizacion.numero}` });
          resultado.ordenes.push({ producto: nombre, lote: orden.lote, m2: porProducir, fecha_programada: orden.fecha_programada });
        } catch (e) {
          resultado.pendientes.push({ producto: nombre, m2: porProducir, motivo: e.message });
        }
      }
    }
  }
  return resultado;
}

// Libera las reservas de una cotización (anulación o rechazo).
export async function liberarReservas(req, cotizacionId) {
  const { data: movs } = await db.from('movimientos_pt').select('producto_id, lote, calidad, m2').eq('cotizacion_id', cotizacionId).in('tipo', ['reserva', 'liberacion']);
  const neto = new Map();
  for (const m of movs ?? []) {
    const k = `${m.producto_id}|${m.lote}|${m.calidad}`;
    neto.set(k, round3((neto.get(k) ?? 0) + Number(m.m2)));
  }
  for (const [k, m2] of neto) {
    if (m2 >= 0) continue;
    const [producto_id, lote, calidad] = k.split('|');
    await db.rpc('pt_registrar_movimiento', { p_producto: producto_id, p_lote: lote, p_calidad: calidad, p_tipo: 'liberacion', p_m2: -m2, p_costo: 0, p_motivo: 'Liberación de reserva', p_cotizacion: cotizacionId, p_usuario: req.perfil?.id ?? null });
  }
}

export { numero };
