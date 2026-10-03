import { db } from '../db.js';

const conteo = async (tabla, columna, id, extra) => {
  let q = db.from(tabla).select('*', { count: 'exact', head: true }).eq(columna, id);
  if (extra) q = extra(q);
  const { count, error } = await q;
  return error ? 0 : (count ?? 0);
};

// ¿Tiene historia (facturas, cotizaciones, salidas, producción…)? Si la tiene no se borra: se desactiva.
export async function historialDeProducto(id) {
  const cuentas = await Promise.all([
    conteo('detalle_venta', 'producto_id', id),
    conteo('cotizacion_lineas', 'producto_id', id),
    conteo('d_cotizacion_lineas', 'producto_id', id),
    conteo('d_salida_items', 'producto_id', id),
    conteo('movimientos_pt', 'producto_id', id),
    conteo('ordenes_produccion', 'producto_id', id),
    conteo('recetas', 'producto_id', id),
    conteo('inv_movimientos', 'producto_id', id, (q) => q.neq('tipo', 'inicial')),
  ]);
  return cuentas.reduce((s, n) => s + n, 0);
}

export async function historialDeCliente(id) {
  const cuentas = await Promise.all([
    conteo('ventas', 'cliente_id', id),
    conteo('cotizaciones', 'cliente_id', id),
    conteo('d_cotizaciones', 'cliente_id', id),
  ]);
  return cuentas.reduce((s, n) => s + n, 0);
}

// Borra el producto de verdad (solo si no tiene historia). Devuelve { ok } o { conHistorial }.
export async function eliminarProducto(id) {
  if ((await historialDeProducto(id)) > 0) return { conHistorial: true };
  await db.from('inv_movimientos').delete().eq('producto_id', id).eq('tipo', 'inicial');
  await db.from('precios_producto').delete().eq('producto_id', id);
  const { error } = await db.from('productos').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') return { conHistorial: true };
    throw new Error(error.message);
  }
  return { ok: true };
}
