import { db } from '../db.js';
import { round3 } from './cotizacion.js';

// Piedra facturada por producto: cajas × m² por caja (todas son de 1 m²).
async function demandaDeVenta(ventaId) {
  const { data: lineas } = await db.from('detalle_venta').select('producto_id, cantidad, productos(nombre, tipo, m2_por_caja)').eq('venta_id', ventaId);
  const mapa = new Map();
  for (const l of lineas ?? []) {
    if (!l.producto_id || l.productos?.tipo !== 'piedra') continue;
    const m2 = Math.ceil(Number(l.cantidad) * (Number(l.productos.m2_por_caja) || 1) - 1e-9);
    const previo = mapa.get(l.producto_id) ?? { nombre: l.productos.nombre, m2: 0 };
    previo.m2 += m2;
    mapa.set(l.producto_id, previo);
  }
  return mapa;
}

// Lo reservado (por lote) para la cotización de origen, ya neto de liberaciones.
async function reservasDeCotizacion(cotizacionId, productoId) {
  if (!cotizacionId) return [];
  const { data } = await db.from('movimientos_pt').select('lote, calidad, m2').eq('cotizacion_id', cotizacionId).eq('producto_id', productoId).in('tipo', ['reserva', 'liberacion']);
  const neto = new Map();
  for (const m of data ?? []) {
    const k = `${m.lote}|${m.calidad}`;
    neto.set(k, round3((neto.get(k) ?? 0) + Number(m.m2)));
  }
  return [...neto].filter(([, v]) => v < 0).map(([k, v]) => ({ lote: k.split('|')[0], calidad: k.split('|')[1], m2: -v }));
}

async function lotesDisponibles(productoId) {
  const { data } = await db.from('stock_pt').select('lote, calidad, disponible, fisico').eq('producto_id', productoId).eq('calidad', 'primera').gt('disponible', 0).order('ultimo_movimiento');
  return data ?? [];
}

// Antes de emitir la factura: que la piedra exista. No consume nada.
async function verificarPiedra(venta) {
  const demanda = await demandaDeVenta(venta.id);
  for (const [productoId, { nombre, m2 }] of demanda) {
    const reservado = (await reservasDeCotizacion(venta.cotizacion_id, productoId)).reduce((s, r) => s + r.m2, 0);
    const lotes = (await lotesDisponibles(productoId)).reduce((s, l) => s + Number(l.disponible), 0);
    if (reservado + lotes + 1e-9 < m2) {
      throw Object.assign(new Error(`No hay suficiente inventario de ${nombre}: se facturan ${m2} y hay ${Math.floor(reservado + lotes)} disponibles. Produce o ajusta el inventario antes de facturar.`), { status: 409 });
    }
  }
}

// Al emitir la factura: la piedra sale del inventario (primero lo reservado
// para esa cotización, luego FIFO por lote).
async function descontarPiedra(req, venta, numeroFactura) {
  const demanda = await demandaDeVenta(venta.id);
  const usuario = req.perfil?.id ?? null;
  const motivo = `Factura ${numeroFactura}`;
  for (const [productoId, { m2 }] of demanda) {
    let falta = m2;
    for (const r of await reservasDeCotizacion(venta.cotizacion_id, productoId)) {
      if (falta <= 0) break;
      const toma = Math.min(falta, r.m2);
      const a = await db.rpc('pt_registrar_movimiento', { p_producto: productoId, p_lote: r.lote, p_calidad: r.calidad, p_tipo: 'liberacion', p_m2: toma, p_costo: 0, p_motivo: motivo, p_cotizacion: venta.cotizacion_id, p_venta: venta.id, p_usuario: usuario });
      if (a.error) throw new Error(a.error.message);
      const b = await db.rpc('pt_registrar_movimiento', { p_producto: productoId, p_lote: r.lote, p_calidad: r.calidad, p_tipo: 'venta', p_m2: -toma, p_costo: 0, p_motivo: motivo, p_cotizacion: venta.cotizacion_id, p_venta: venta.id, p_usuario: usuario });
      if (b.error) throw new Error(b.error.message);
      falta = round3(falta - toma);
    }
    for (const l of falta > 0 ? await lotesDisponibles(productoId) : []) {
      if (falta <= 0) break;
      const toma = Math.min(falta, Number(l.disponible), Number(l.fisico));
      if (toma <= 0) continue;
      const { error } = await db.rpc('pt_registrar_movimiento', { p_producto: productoId, p_lote: l.lote, p_calidad: 'primera', p_tipo: 'venta', p_m2: -toma, p_costo: 0, p_motivo: motivo, p_cotizacion: null, p_venta: venta.id, p_usuario: usuario });
      if (error) throw new Error(error.message);
      falta = round3(falta - toma);
    }
    if (falta > 0) throw new Error(`Inventario insuficiente al descontar (faltan ${falta})`);
  }
  return demanda.size;
}

// Anulación de la factura: lo descontado regresa a su mismo lote.
async function reponerPiedra(req, venta) {
  const { data } = await db.from('movimientos_pt').select('producto_id, lote, calidad, m2').eq('venta_id', venta.id).eq('tipo', 'venta');
  for (const m of data ?? []) {
    const { error } = await db.rpc('pt_registrar_movimiento', { p_producto: m.producto_id, p_lote: m.lote, p_calidad: m.calidad, p_tipo: 'ajuste', p_m2: -Number(m.m2), p_costo: 0, p_motivo: `Anulación de factura ${venta.numero_factura}`, p_venta: venta.id, p_usuario: req.perfil?.id ?? null });
    if (error) throw new Error(error.message);
  }
  return (data ?? []).length;
}

// ── Inventario general (productos de DISERCO que controlan existencias) ─────
async function demandaGeneral(ventaId) {
  const { data: lineas } = await db.from('detalle_venta').select('producto_id, cantidad, productos(nombre, controla_inventario, empresa)').eq('venta_id', ventaId);
  const mapa = new Map();
  for (const l of lineas ?? []) {
    if (!l.producto_id || !l.productos?.controla_inventario) continue;
    const previo = mapa.get(l.producto_id) ?? { nombre: l.productos.nombre, cantidad: 0 };
    previo.cantidad += Number(l.cantidad);
    mapa.set(l.producto_id, previo);
  }
  return mapa;
}

// Faltantes de inventario general: [{ producto, pedido, hay }]. No bloquea por sí solo.
async function faltantesGeneral(venta) {
  const demanda = await demandaGeneral(venta.id);
  if (!demanda.size) return [];
  const { data: stock } = await db.from('inv_stock').select('producto_id, existencia').in('producto_id', [...demanda.keys()]);
  const hay = new Map((stock ?? []).map((x) => [x.producto_id, Number(x.existencia)]));
  const faltantes = [];
  for (const [id, { nombre, cantidad }] of demanda) {
    const existencia = hay.get(id) ?? 0;
    if (existencia + 1e-9 < cantidad) faltantes.push({ producto: nombre, pedido: cantidad, hay: Math.max(0, Math.floor(existencia)) });
  }
  return faltantes;
}

async function descontarGeneral(req, venta, numeroFactura) {
  const demanda = await demandaGeneral(venta.id);
  for (const [id, { cantidad }] of demanda) {
    // forzar: el faltante ya se avisó y se confirmó antes de emitir la factura.
    const { error } = await db.rpc('inv_mover', { p_producto: id, p_tipo: 'venta', p_cantidad: -cantidad, p_costo: 0, p_motivo: `Factura ${numeroFactura}`, p_venta: venta.id, p_proveedor: null, p_referencia: null, p_usuario: req.perfil?.id ?? null, p_forzar: true, p_salida: null });
    if (error) throw new Error(error.message);
  }
  return demanda.size;
}

async function reponerGeneral(req, venta) {
  const { data } = await db.from('inv_movimientos').select('producto_id, cantidad').eq('venta_id', venta.id).eq('tipo', 'venta');
  for (const m of data ?? []) {
    const { error } = await db.rpc('inv_mover', { p_producto: m.producto_id, p_tipo: 'devolucion', p_cantidad: -Number(m.cantidad), p_costo: 0, p_motivo: `Anulación de factura ${venta.numero_factura}`, p_venta: venta.id, p_proveedor: null, p_referencia: null, p_usuario: req.perfil?.id ?? null, p_forzar: true, p_salida: null });
    if (error) throw new Error(error.message);
  }
  return (data ?? []).length;
}

// Antes de emitir: la piedra debe existir (bloquea). Los productos de DISERCO sí
// se pueden facturar sin existencia, pero solo si el cajero lo confirma.
export async function verificarInventarioVenta(venta, { confirmarSinStock = false } = {}) {
  await verificarPiedra(venta);
  const faltantes = await faltantesGeneral(venta);
  if (faltantes.length && !confirmarSinStock) {
    const detalle = faltantes.map((f) => `${f.producto} (pides ${f.pedido}, hay ${f.hay})`).join('; ');
    throw Object.assign(new Error(`Sin existencia suficiente: ${detalle}`), { status: 409, codigo: 'SIN_STOCK', faltantes });
  }
  return faltantes;
}
export async function descontarInventarioVenta(req, venta, numeroFactura) {
  const a = await descontarPiedra(req, venta, numeroFactura);
  const b = await descontarGeneral(req, venta, numeroFactura);
  return a + b;
}
export async function reponerInventarioVenta(req, venta) {
  const a = await reponerPiedra(req, venta);
  const b = await reponerGeneral(req, venta);
  return a + b;
}
