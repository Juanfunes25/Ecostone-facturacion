// Espejo en el frontend de backend/lib/facturacion.js — sólo para mostrar
// el desglose Sub-Total/Impuesto antes de cobrar. El cálculo real y
// definitivo siempre lo hace el backend al guardar/cobrar la venta.
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const OPCIONES_DESCUENTO = [
  { porcentaje: 0, etiqueta: 'Sin descuento', corta: '—' },
  { porcentaje: 10, etiqueta: '10%', corta: '10%' },
  { porcentaje: 25, etiqueta: '25% Tercera edad', corta: '25% 3ª edad' },
];

// Mismo cálculo que backend/lib/facturacion.js descuentoDeLinea().
export function descuentoDeLinea(precioUnitario, cantidad, porcentaje) {
  return round2((round2(Number(precioUnitario) * Number(cantidad)) * Number(porcentaje || 0)) / 100);
}

function calcularLineas(items, cliente) {
  return items.map((item) => {
    const descuento = descuentoDeLinea(item.precio_unitario, item.cantidad, item.descuento_porcentaje);
    const monto = round2(item.precio_unitario * item.cantidad - descuento);
    const tasa = Number(item.impuesto_tasa ?? 0.15);
    let bucket;
    if (tasa > 0) bucket = 'gravado_15';
    else if (cliente?.exento_impuestos) bucket = 'exento';
    else bucket = 'exonerado';
    return { monto, tasa, bucket, descuento, porcentaje: Number(item.descuento_porcentaje || 0) };
  });
}

// Descuento POR PRODUCTO: cada línea trae su porcentaje (0/10/25) y el
// monto se resta antes de separar base/ISV, igual que el backend.
export function calcularTotales(items, cliente) {
  const lineas = calcularLineas(items, cliente);
  const totales = { subtotal_exento: 0, subtotal_exonerado: 0, subtotal_gravado_15: 0, isv_total: 0 };
  let total = 0;
  const porPorcentaje = {};
  for (const l of lineas) {
    const base = l.tasa > 0 ? round2(l.monto / (1 + l.tasa)) : l.monto;
    if (l.bucket === 'exento') totales.subtotal_exento += base;
    else if (l.bucket === 'exonerado') totales.subtotal_exonerado += base;
    else totales.subtotal_gravado_15 += base;
    totales.isv_total += round2(l.monto - base);
    total += l.monto;
    if (l.descuento > 0) porPorcentaje[l.porcentaje] = round2((porPorcentaje[l.porcentaje] ?? 0) + l.descuento);
  }
  const descuento = round2(lineas.reduce((s, l) => s + l.descuento, 0));
  return {
    subtotal_bruto: round2(total + descuento),
    subtotal_exento: round2(totales.subtotal_exento),
    subtotal_exonerado: round2(totales.subtotal_exonerado),
    subtotal_gravado_15: round2(totales.subtotal_gravado_15),
    isv_total: round2(totales.isv_total),
    descuento,
    descuentos_por_porcentaje: porPorcentaje,
    total: round2(total),
  };
}
