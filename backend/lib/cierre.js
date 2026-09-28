import { round2 } from './facturacion.js';

// Totales del turno según el sistema, por forma de pago.
//
// El efectivo es NETO del cambio: si el cliente paga L500 por una venta de
// L206.25, en venta_pagos queda "Efectivo L500" pero en la gaveta sólo se
// quedaron L206.25 (los L293.75 salieron como cambio). Sumar el pago bruto
// inflaba el efectivo esperado del cierre.
//
// Las facturas anuladas conservan su número (cuentan en el rango) pero no
// suman dinero.
export function totalesPorForma(ventas) {
  const t = { efectivo: 0, tarjeta: 0, transferencia: 0, otros: 0, total_ventas: 0, anuladas: 0, monto_anulado: 0 };
  for (const v of ventas) {
    if (v.anulada) {
      t.anuladas += 1;
      t.monto_anulado += Number(v.total);
      continue;
    }
    t.total_ventas += Number(v.total);
    let efectivoVenta = 0;
    for (const p of v.venta_pagos ?? []) {
      const nombre = (p.formas_pago?.nombre ?? '').toLowerCase();
      const monto = Number(p.monto);
      if (nombre === 'efectivo') efectivoVenta += monto;
      else if (nombre === 'tarjeta') t.tarjeta += monto;
      else if (nombre === 'transferencia') t.transferencia += monto;
      else t.otros += monto;
    }
    // El cambio siempre sale de la gaveta, aunque el sobrepago haya sido con tarjeta.
    t.efectivo += efectivoVenta - Number(v.cambio ?? 0);
  }
  for (const k of Object.keys(t)) if (k !== 'anuladas') t[k] = round2(t[k]);
  return t;
}

// Cuadre: lo que reportan los POS y el efectivo contado contra el sistema.
//   Tarjeta:  (POS BAC + POS Ficohsa) − tarjeta según sistema
//   Efectivo: contado en gaveta − (fondo + ventas en efectivo − salidas)
// Diferencia positiva = sobrante; negativa = faltante.
export function calcularCuadre(sistema, entradas) {
  const n = (v) => round2(Number(v || 0));
  const posBac = n(entradas.pos_bac);
  const posFicohsa = n(entradas.pos_ficohsa);
  const fondo = n(entradas.fondo_caja);
  const salidas = n(entradas.salidas);
  const contado = n(entradas.efectivo_contado);

  const tarjetaReportada = round2(posBac + posFicohsa);
  const diferenciaTarjeta = round2(tarjetaReportada - sistema.tarjeta);
  const efectivoEsperado = round2(fondo + sistema.efectivo - salidas);
  const diferenciaEfectivo = round2(contado - efectivoEsperado);

  return {
    pos_bac: posBac,
    pos_ficohsa: posFicohsa,
    tarjeta_reportada: tarjetaReportada,
    diferencia_tarjeta: diferenciaTarjeta,
    fondo_caja: fondo,
    salidas,
    efectivo_contado: contado,
    efectivo_esperado: efectivoEsperado,
    diferencia_efectivo: diferenciaEfectivo,
    diferencia_total: round2(diferenciaTarjeta + diferenciaEfectivo),
  };
}

// Desglose del turno para el ticket del cierre: cuántas facturas y cuánto
// por forma de pago, las de tarjeta/transferencia una por una (para
// cotejarlas con los vouchers del POS y la banca), anuladas y descuentos.
export function desgloseTurno(ventas) {
  const formas = {};
  const tarjeta = [];
  const transferencia = [];
  const anuladas = [];
  const descuentos = {};
  for (const v of ventas) {
    if (v.anulada) {
      anuladas.push({ numero: v.numero_factura, total: Number(v.total) });
      continue;
    }
    const porForma = {};
    for (const p of v.venta_pagos ?? []) {
      const nombre = p.formas_pago?.nombre ?? 'Otro';
      porForma[nombre] = (porForma[nombre] ?? 0) + Number(p.monto);
    }
    if (porForma.Efectivo !== undefined) porForma.Efectivo -= Number(v.cambio ?? 0);
    for (const [nombre, monto] of Object.entries(porForma)) {
      formas[nombre] = formas[nombre] ?? { facturas: 0, monto: 0 };
      formas[nombre].facturas += 1;
      formas[nombre].monto = round2(formas[nombre].monto + monto);
      if (nombre === 'Tarjeta') tarjeta.push({ numero: v.numero_factura, monto: round2(monto) });
      if (nombre === 'Transferencia') transferencia.push({ numero: v.numero_factura, monto: round2(monto) });
    }
    for (const d of v.detalle_venta ?? []) {
      if (Number(d.descuento) <= 0) continue;
      const pct = Number(d.descuento_porcentaje ?? 0);
      descuentos[pct] = descuentos[pct] ?? { lineas: 0, monto: 0 };
      descuentos[pct].lineas += 1;
      descuentos[pct].monto = round2(descuentos[pct].monto + Number(d.descuento));
    }
  }
  return { formas, tarjeta, transferencia, anuladas, descuentos };
}
