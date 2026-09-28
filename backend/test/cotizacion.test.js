import test from 'node:test';
import assert from 'node:assert/strict';
import * as be from '../lib/cotizacion.js';
import * as fe from '../../frontend/src/lib/cotizacion.js';

const piedra = { tipo: 'piedra', unidad_venta: 'm2', m2_por_caja: 0.5 };

test('m² se redondean a cajas completas y se cobra lo entregado', () => {
  const r = be.dimensionarLinea(piedra, 10, 8); // 10.8 m² → 22 cajas de 0.5 = 11 m²
  assert.equal(r.cajas, 22);
  assert.equal(r.cantidad, 11);
  assert.equal(r.m2_entregado, 11);
});

test('exacto no sobra una caja', () => {
  assert.equal(be.dimensionarLinea(piedra, 5, 0).cajas, 10);
});

test('venta por caja y accesorios por rendimiento', () => {
  const caja = { ...piedra, unidad_venta: 'caja' };
  assert.deepEqual(be.dimensionarLinea(caja, 3, 0), { m2_total: 3, cajas: 6, cantidad: 6, m2_entregado: 3 });
  const acc = be.sugerirAccesorios(11, [{ id: 'a', nombre: 'Pegamento', unidad_venta: 'saco', rendimiento_m2: 4 }]);
  assert.equal(acc[0].cantidad, 3);
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
    const op = { isv_incluido: Math.random() < 0.5, descuento: Math.random() < 0.5 ? Math.round(Math.random() * 30000) / 100 : 0, cliente_exento: Math.random() < 0.1 };
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
