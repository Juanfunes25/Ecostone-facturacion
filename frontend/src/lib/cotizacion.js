// Cálculo de cotizaciones de piedra de enchape. PURO (sin base de datos) y
// duplicado en frontend/src/lib/cotizacion.js: ambos deben dar lo mismo
// (backend/test/cotizacion.test.js lo comprueba con miles de casos).
//
// Reglas [SUPUESTO] (validar con el contador):
//  - La piedra se vende por m² pero se entrega en cajas completas: se redondea
//    hacia arriba y se cobra lo que realmente se entrega.
//  - Precio "incluido": el precio ya trae ISV (mostrador). "Separado": el ISV
//    se suma encima (constructoras y distribuidores).
//  - El descuento global se reparte proporcionalmente entre las líneas ANTES de
//    separar/sumar el ISV (igual que el motor de facturas de Ítalo).
//  - Cliente exento: no se cobra ISV.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const techo = (x) => Math.ceil(Number(x) - 1e-9);

// m² netos + desperdicio → lo que se debe vender/entregar.
export function dimensionarLinea(producto, m2_neto, desperdicio_pct = 0) {
  const neto = Number(m2_neto) || 0;
  const m2_total = round3(neto * (1 + (Number(desperdicio_pct) || 0) / 100));
  const porCaja = Number(producto?.m2_por_caja) || 0;
  const unidad = producto?.unidad_venta ?? 'm2';
  let cajas = null;
  let cantidad = m2_total;
  let m2_entregado = m2_total;

  if (unidad === 'caja' && porCaja > 0) {
    cajas = techo(m2_total / porCaja);
    cantidad = cajas;
    m2_entregado = round3(cajas * porCaja);
  } else if (unidad === 'm2' && porCaja > 0) {
    cajas = techo(m2_total / porCaja);
    cantidad = round3(cajas * porCaja);
    m2_entregado = cantidad;
  } else if (unidad === 'pieza' && Number(producto?.piezas_por_m2) > 0) {
    cantidad = techo(m2_total * Number(producto.piezas_por_m2));
  } else if (['saco', 'galon', 'unidad'].includes(unidad) && Number(producto?.rendimiento_m2) > 0) {
    cantidad = techo(m2_total / Number(producto.rendimiento_m2));
  }
  return { m2_total, cajas, cantidad, m2_entregado };
}

// Accesorios sugeridos según el rendimiento (m² que cubre cada unidad).
export function sugerirAccesorios(m2_total, accesorios) {
  return accesorios
    .filter((a) => Number(a.rendimiento_m2) > 0)
    .map((a) => ({ producto_id: a.id, descripcion: a.nombre, unidad: a.unidad_venta, cantidad: Math.max(1, techo(m2_total / Number(a.rendimiento_m2))) }));
}

// Peso estimado del pedido (para el flete).
export function pesoEstimadoKg(lineas, productosPorId) {
  return round2(
    lineas.reduce((s, l) => {
      const p = productosPorId.get?.(l.producto_id) ?? productosPorId[l.producto_id];
      if (!p || p.tipo !== 'piedra' || !Number(p.peso_kg_m2)) return s;
      return s + Number(p.peso_kg_m2) * Number(l.m2_entregado ?? l.cantidad ?? 0);
    }, 0)
  );
}

// lineas: [{cantidad, precio_unitario, descuento_pct, isv_tasa, costo_unitario?}]
// descuento_pct (opcional, negociado) tiene prioridad sobre descuento (monto en L).
export function calcularCotizacion(lineas, { isv_incluido = false, descuento = 0, descuento_pct = 0, cliente_exento = false } = {}) {
  const base = lineas.map((l) => {
    const cantidad = Number(l.cantidad) || 0;
    const precio = Number(l.precio_unitario) || 0;
    const bruto = round2(cantidad * precio);
    const dLinea = round2((bruto * (Number(l.descuento_pct) || 0)) / 100);
    return { l, cantidad, precio, bruto, dLinea, n1: round2(bruto - dLinea), tasa: cliente_exento ? 0 : Number(l.isv_tasa ?? 0.15) };
  });
  const sumaN1 = round2(base.reduce((s, x) => s + x.n1, 0));
  const pct = Math.min(100, Math.max(0, Number(descuento_pct) || 0));
  const D = Math.min(sumaN1, Math.max(0, pct > 0 ? round2((sumaN1 * pct) / 100) : round2(descuento)));
  let asignado = 0;
  const out = base.map((x, i) => {
    const ultima = i === base.length - 1;
    const dGlob = ultima ? round2(D - asignado) : sumaN1 > 0 ? round2((D * x.n1) / sumaN1) : 0;
    asignado = round2(asignado + dGlob);
    const neto = round2(x.n1 - dGlob);
    const descLinea = round2(x.dLinea + dGlob);
    let baseImp, isv, total;
    if (isv_incluido) {
      total = neto;
      baseImp = x.tasa > 0 ? round2(total / (1 + x.tasa)) : total;
      isv = round2(total - baseImp);
    } else {
      baseImp = neto;
      isv = round2(baseImp * x.tasa);
      total = round2(baseImp + isv);
    }
    const factor = isv_incluido ? 1 : 1 + x.tasa;
    const descConIsv = round2(descLinea * factor);
    const brutoConIsv = round2(total + descConIsv);
    const costo = round2((Number(x.l.costo_unitario) || 0) * x.cantidad);
    return {
      monto: total,
      base: baseImp,
      isv,
      descuento: descLinea,
      descuento_con_isv: descConIsv,
      precio_unitario_con_isv: x.cantidad > 0 ? round4(brutoConIsv / x.cantidad) : 0,
      isv_tasa: x.tasa,
      costo,
    };
  });
  const suma = (k) => round2(out.reduce((s, o) => s + o[k], 0));
  const total = suma('monto');
  const costo = suma('costo');
  const brutoTotal = round2(base.reduce((s, x) => s + x.bruto, 0));
  return {
    lineas: out,
    subtotal: suma('base'),
    isv: suma('isv'),
    total,
    descuento_total: round2(base.reduce((s, x) => s + x.dLinea, 0) + D),
    descuento_global: D,
    descuento_pct: brutoTotal > 0 ? round2(((base.reduce((s, x) => s + x.dLinea, 0) + D) / brutoTotal) * 100) : 0,
    costo,
    margen: round2(suma('base') - costo),
    margen_pct: suma('base') > 0 ? round2(((suma('base') - costo) / suma('base')) * 100) : 0,
  };
}

// Anticipo: monto y saldo.
export function calcularAnticipo(total, anticipo_pct) {
  const anticipo = round2((Number(total) * (Number(anticipo_pct) || 0)) / 100);
  return { anticipo, saldo: round2(Number(total) - anticipo) };
}
