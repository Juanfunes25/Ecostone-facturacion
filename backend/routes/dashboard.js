import { Router } from 'express';
import { db } from '../db.js';
import { round2 } from '../lib/facturacion.js';
import { traerPorIds, traerTodo } from '../lib/consultas.js';
import { fechaHn, filtrarRango } from '../lib/fechas.js';

export const dashboard = Router();

// Un solo endpoint agregado: KPIs + formas de pago + comparativo por
// sucursal + top productos + ventas por categoría (incluye Ristoris) +
// tendencia diaria. Todo calculado en memoria sobre las ventas del rango —
// suficiente para el volumen de una gelatería de 4 sucursales; si el
// negocio crece mucho, esto es lo primero que habría que mover a vistas
// materializadas en Postgres.
dashboard.get('/', async (req, res) => {
  try {
    const { sucursal_id, fechaInicio, fechaFin } = req.query;

    // Fechas en hora de Honduras (fin de día incluido) y por páginas: antes
    // se perdía el último día del rango y todo lo que pasara de 1000 facturas.
    const ventas = await traerTodo(() => {
      let q = db
        .from('ventas')
        .select('id, sucursal_id, total, isv_total, cambio, fecha_emision, sucursales(nombre, alias)')
        .eq('estado', 'pagada')
        .eq('anulada', false);
      if (sucursal_id) q = q.eq('sucursal_id', sucursal_id);
      q = filtrarRango(q, 'fecha_emision', fechaInicio, fechaFin);
      return q.order('fecha_emision').order('id');
    });

    const ventaIds = ventas.map((v) => v.id);
    const total = round2(ventas.reduce((s, v) => s + Number(v.total), 0));
    const cantidadFacturas = ventas.length;
    const isvTotal = round2(ventas.reduce((s, v) => s + Number(v.isv_total), 0));
    const ticketPromedio = cantidadFacturas > 0 ? round2(total / cantidadFacturas) : 0;

    let pagos = [];
    let detalle = [];
    if (ventaIds.length > 0) {
      [pagos, detalle] = await Promise.all([
        traerPorIds(() => db.from('venta_pagos').select('id, venta_id, monto, formas_pago(nombre)').order('id'), 'venta_id', ventaIds),
        traerPorIds(
          () => db.from('detalle_venta').select('id, venta_id, cantidad, monto, productos(nombre, categorias(nombre))').order('id'),
          'venta_id',
          ventaIds
        ),
      ]);
    }

    // Formas de pago
    const porFormaPago = new Map();
    for (const p of pagos) {
      const nombre = p.formas_pago?.nombre ?? 'Otro';
      const acc = porFormaPago.get(nombre) || { nombre, monto: 0 };
      acc.monto = round2(acc.monto + Number(p.monto));
      porFormaPago.set(nombre, acc);
    }
    // El efectivo recibido incluye el billete completo; el cambio devuelto
    // no es venta en efectivo.
    const cambioTotal = ventas.reduce((s, v) => s + Number(v.cambio ?? 0), 0);
    if (cambioTotal > 0 && porFormaPago.has('Efectivo')) {
      const ef = porFormaPago.get('Efectivo');
      ef.monto = round2(ef.monto - cambioTotal);
    }
    const totalPagos = round2([...porFormaPago.values()].reduce((s, f) => s + f.monto, 0));
    const formasPago = [...porFormaPago.values()]
      .map((f) => ({ ...f, porcentaje: totalPagos > 0 ? round2((f.monto / totalPagos) * 100) : 0 }))
      .sort((a, b) => b.monto - a.monto);

    // Por sucursal
    const porSucursal = new Map();
    for (const v of ventas) {
      const nombre = v.sucursales?.nombre ?? 'Sin sucursal';
      const acc = porSucursal.get(v.sucursal_id) || { sucursal_id: v.sucursal_id, nombre, total: 0, facturas: 0 };
      acc.total = round2(acc.total + Number(v.total));
      acc.facturas += 1;
      porSucursal.set(v.sucursal_id, acc);
    }
    const sucursales = [...porSucursal.values()]
      .map((s) => ({ ...s, ticket_promedio: s.facturas > 0 ? round2(s.total / s.facturas) : 0 }))
      .sort((a, b) => b.total - a.total);

    // Top productos y por categoría (misma pasada sobre detalle_venta)
    const porProducto = new Map();
    const porCategoria = new Map();
    for (const d of detalle) {
      const nombreProducto = d.productos?.nombre ?? 'Producto eliminado';
      const accP = porProducto.get(nombreProducto) || { nombre: nombreProducto, cantidad: 0, total: 0 };
      accP.cantidad += Number(d.cantidad);
      accP.total = round2(accP.total + Number(d.monto));
      porProducto.set(nombreProducto, accP);

      const nombreCategoria = d.productos?.categorias?.nombre ?? 'Sin categoría';
      const accC = porCategoria.get(nombreCategoria) || { nombre: nombreCategoria, cantidad: 0, total: 0 };
      accC.cantidad += Number(d.cantidad);
      accC.total = round2(accC.total + Number(d.monto));
      porCategoria.set(nombreCategoria, accC);
    }
    const topProductos = [...porProducto.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
    const porCategoriaArr = [...porCategoria.values()].sort((a, b) => b.total - a.total);

    // Tendencia diaria
    const porDia = new Map();
    for (const v of ventas) {
      const dia = fechaHn(v.fecha_emision);
      const acc = porDia.get(dia) || { fecha: dia, total: 0, facturas: 0 };
      acc.total = round2(acc.total + Number(v.total));
      acc.facturas += 1;
      porDia.set(dia, acc);
    }
    const tendenciaDiaria = [...porDia.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

    res.json({
      total,
      cantidad_facturas: cantidadFacturas,
      ticket_promedio: ticketPromedio,
      isv_total: isvTotal,
      formas_pago: formasPago,
      por_sucursal: sucursales,
      top_productos: topProductos,
      por_categoria: porCategoriaArr,
      tendencia_diaria: tendenciaDiaria,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
