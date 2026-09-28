import test from 'node:test';
import assert from 'node:assert/strict';
import * as be from '../lib/cotizacion.js';
import * as fe from '../../frontend/src/lib/cotizacion.js';

const piedra = { tipo: 'piedra', unidad_venta: 'm2', m2_por_caja: 0.5 };

test('con m² por caja se factura por cajas completas (nunca media caja)', () => {
  const r = be.dimensionarLinea(piedra, 10, 0); // 10 m² / 0.5 = 20 cajas
  assert.equal(r.cajas, 20);
  assert.equal(r.cantidad, 20);
  assert.equal(r.unidad_linea, 'caja');
  assert.equal(r.factor_precio, 0.5); // el precio por m² se convierte a precio por caja
  assert.equal(r.m2_entregado, 10);
  const otra = be.dimensionarLinea({ ...piedra, m2_por_caja: 0.37 }, 10, 0); // 27.03 → 28 cajas
  assert.equal(otra.cantidad, 28);
  assert.equal(Number.isInteger(otra.cantidad), true);
});

test('sin m² por caja los m² se redondean a enteros hacia arriba', () => {
  const r = be.dimensionarLinea({ tipo: 'piedra', unidad_venta: 'm2' }, 25.4, 0);
  assert.equal(r.cantidad, 26);
  assert.equal(r.unidad_linea, 'm2');
  assert.equal(r.factor_precio, 1);
});

test('venta por caja y accesorios por rendimiento siempre enteros', () => {
  const caja = { ...piedra, unidad_venta: 'caja' };
  const r = be.dimensionarLinea(caja, 3, 0);
  assert.equal(r.cantidad, 6);
  assert.equal(r.factor_precio, 1);
  const acc = be.sugerirAccesorios(11, [{ id: 'a', nombre: 'Pegamento', unidad_venta: 'saco', rendimiento_m2: 4 }]);
  assert.equal(acc[0].cantidad, 3);
});

test('la cantidad de una línea siempre es un entero (5 000 casos)', () => {
  for (let i = 0; i < 5000; i++) {
    const p = { unidad_venta: ['m2', 'caja', 'pieza', 'saco', 'galon'][i % 5], m2_por_caja: i % 3 ? Math.round(Math.random() * 100) / 100 + 0.05 : 0, piezas_por_m2: 22, rendimiento_m2: 3.5 };
    const r = be.dimensionarLinea(p, Math.random() * 500, [0, 5, 8][i % 3]);
    assert.equal(Number.isInteger(r.cantidad), true, JSON.stringify({ p, r }));
  }
});

test('ISV separado suma 15% encima', () => {
  const r = be.calcularCotizacion([{ cantidad: 10, precio_unitario: 100, descuento_pct: 0, isv_tasa: 0.15 }], { isv_incluido: false });
  assert.equal(r.subtotal, 1000);
  assert.equal(r.isv, 150);
  assert.equal(r.total, 1150);
});

test('ISV incluido separa base e impuesto', () => {
  const r = be.calcularCotizacion([{ cantidad: 1, precio_unitario: 115, descuento_pct: 0, isv_tasa: 0.15 }], { isv_incluido: true });
  assert.equal(r.subtotal, 100);
  assert.equal(r.isv, 15);
  assert.equal(r.total, 115);
});

test('descuento global reduce base e ISV proporcionalmente', () => {
  const r = be.calcularCotizacion(
    [
      { cantidad: 10, precio_unitario: 100, descuento_pct: 0, isv_tasa: 0.15 },
      { cantidad: 5, precio_unitario: 40, descuento_pct: 0, isv_tasa: 0.15 },
    ],
    { isv_incluido: false, descuento: 120 }
  );
  assert.equal(r.subtotal, 1080);
  assert.equal(r.total, round(1080 * 1.15));
  assert.equal(r.descuento_total, 120);
});

test('descuento negociado en % sobre el total', () => {
  const r = be.calcularCotizacion([{ cantidad: 10, precio_unitario: 100, descuento_pct: 0, isv_tasa: 0.15 }], { isv_incluido: false, descuento_pct: 10 });
  assert.equal(r.descuento_global, 100);
  assert.equal(r.subtotal, 900);
  assert.equal(r.total, 1035);
  assert.equal(r.descuento_pct, 10);
});

test('sin descuento no cambia nada', () => {
  const a = be.calcularCotizacion([{ cantidad: 3, precio_unitario: 33.33, isv_tasa: 0.15 }], { isv_incluido: true });
  const b = be.calcularCotizacion([{ cantidad: 3, precio_unitario: 33.33, isv_tasa: 0.15 }], { isv_incluido: true, descuento_pct: 0 });
  assert.deepEqual(a, b);
});

test('cliente exento no paga ISV', () => {
  const r = be.calcularCotizacion([{ cantidad: 2, precio_unitario: 50, isv_tasa: 0.15 }], { cliente_exento: true });
  assert.equal(r.isv, 0);
  assert.equal(r.total, 100);
});

test('anticipo', () => {
  assert.deepEqual(be.calcularAnticipo(1000, 50), { anticipo: 500, saldo: 500 });
});

function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

test('frontend y backend dan lo mismo (5 000 casos aleatorios)', () => {
  let diferencias = 0;
  for (let i = 0; i < 5000; i++) {
    const n = 1 + Math.floor(Math.random() * 6);
    const lineas = Array.from({ length: n }, () => ({
      cantidad: Math.round(Math.random() * 5000) / 100 + 0.01,
      precio_unitario: Math.round(Math.random() * 100000) / 100,
      descuento_pct: [0, 0, 5, 10, 15][Math.floor(Math.random() * 5)],
      isv_tasa: Math.random() < 0.9 ? 0.15 : 0,
      costo_unitario: Math.random() * 50,
    }));
    const op = { isv_incluido: Math.random() < 0.5, descuento: Math.random() < 0.5 ? Math.round(Math.random() * 30000) / 100 : 0, descuento_pct: Math.random() < 0.5 ? [0, 5, 10, 12.5][Math.floor(Math.random() * 4)] : 0, cliente_exento: Math.random() < 0.1 };
    const a = JSON.stringify(be.calcularCotizacion(lineas, op));
    const b = JSON.stringify(fe.calcularCotizacion(lineas, op));
    if (a !== b) diferencias++;
    const p = { unidad_venta: ['m2', 'caja', 'pieza', 'saco'][i % 4], m2_por_caja: 0.37, piezas_por_m2: 22, rendimiento_m2: 3.5 };
    const m2 = Math.random() * 300;
    if (JSON.stringify(be.dimensionarLinea(p, m2, 7)) !== JSON.stringify(fe.dimensionarLinea(p, m2, 7))) diferencias++;
  }
  assert.equal(diferencias, 0);
});

test('los totales siempre cuadran: total = subtotal + isv', () => {
  for (let i = 0; i < 3000; i++) {
    const lineas = [{ cantidad: Math.random() * 100 + 0.1, precio_unitario: Math.random() * 999, descuento_pct: 5, isv_tasa: 0.15 }, { cantidad: 3, precio_unitario: 12.34, descuento_pct: 0, isv_tasa: 0.15 }];
    for (const isv_incluido of [true, false]) {
      const r = be.calcularCotizacion(lineas, { isv_incluido, descuento: Math.random() * 50 });
      assert.equal(round(r.subtotal + r.isv), r.total);
      assert.equal(round(r.lineas.reduce((s, l) => s + l.monto, 0)), r.total);
    }
  }
});
