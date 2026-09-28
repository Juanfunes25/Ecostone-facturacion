import { Router } from 'express';
import { db } from '../db.js';
import { round2 } from '../lib/facturacion.js';
import { traerPorIds, traerTodo } from '../lib/consultas.js';
import { diaSemanaHn, fechaHn, filtrarRango, finDelDia, horaHn, inicioDelDia } from '../lib/fechas.js';

export const reportes = Router();

const SELECT_VENTA = [
  'id, sucursal_id, numero_factura, correlativo, cliente_id, cajero_id',
  'subtotal_exento, subtotal_exonerado, subtotal_gravado_15, descuento, descuento_porcentaje',
  'isv_total, total, cambio, fecha_emision, anulada',
  'sucursales(nombre), clientes(nombre, rtn, es_consumidor_final), perfiles(nombre), puntos_emision(es_borrador)',
  'venta_pagos(monto, formas_pago(nombre))',
  'detalle_venta(producto_id, nombre_producto, cantidad, monto, descuento, descuento_porcentaje)',
].join(', ');

const n = (v) => Number(v ?? 0);
const pct = (parte, total) => (total > 0 ? round2((parte / total) * 100) : 0);

function sumar(mapa, clave, inicial, fn) {
  const acc = mapa.get(clave) ?? inicial();
  fn(acc);
  mapa.set(clave, acc);
}

function redondearTodo(obj) {
  for (const k of Object.keys(obj)) if (typeof obj[k] === 'number' && !Number.isInteger(obj[k])) obj[k] = round2(obj[k]);
  return obj;
}

async function ventasDelRango({ sucursal_id, fechaInicio, fechaFin }) {
  return traerTodo(() => {
    let q = db.from('ventas').select(SELECT_VENTA).eq('estado', 'pagada');
    if (sucursal_id) q = q.eq('sucursal_id', sucursal_id);
    q = filtrarRango(q, 'fecha_emision', fechaInicio, fechaFin);
    return q.order('fecha_emision', { ascending: true }).order('id', { ascending: true });
  });
}

// Notas de crédito del período (cuentan en el mes en que se emiten, que es
// como se declaran). Las de anulación total ya salen del reporte porque la
// factura queda "anulada"; aquí interesan sobre todo las parciales.
async function notasDelRango({ sucursal_id, fechaInicio, fechaFin }) {
  const notas = await traerTodo(() => {
    let q = db
      .from('notas_credito')
      .select('id, venta_id, numero_nota, motivo, monto, estado, created_at, usuario:usuario_id(nombre), ventas(numero_factura, sucursal_id, total, isv_total, anulada, sucursales(nombre), puntos_emision(es_borrador))')
      .neq('estado', 'anulada');
    q = filtrarRango(q, 'created_at', fechaInicio, fechaFin);
    return q.order('created_at', { ascending: true }).order('id', { ascending: true });
  });
  return sucursal_id ? notas.filter((nc) => nc.ventas?.sucursal_id === sucursal_id) : notas;
}

async function categoriasPorProducto(ids) {
  if (ids.length === 0) return new Map();
  const productos = await traerPorIds(
    () => db.from('productos').select('id, categorias(nombre)').order('id'),
    'id',
    ids
  );
  return new Map(productos.map((p) => [p.id, p.categorias?.nombre ?? 'Sin categoría']));
}

async function gastosDelRango({ sucursal_id, fechaInicio, fechaFin }) {
  return traerTodo(() => {
    let q = db.from('caja_chica').select('id, sucursal_id, tipo, monto, fecha');
    if (sucursal_id) q = q.eq('sucursal_id', sucursal_id);
    if (fechaInicio) q = q.gte('fecha', fechaInicio.slice(0, 10));
    if (fechaFin) q = q.lte('fecha', fechaFin.slice(0, 10));
    return q.order('fecha').order('id');
  });
}

function formaDePago(nombre) {
  const t = String(nombre ?? '').toLowerCase();
  if (t === 'efectivo') return 'Efectivo';
  if (t === 'tarjeta') return 'Tarjeta';
  if (t === 'transferencia') return 'Transferencia';
  return nombre || 'Otro';
}

function kpis(validas, anuladas, notasParciales) {
  const ventas = validas.reduce((s, v) => s + n(v.total), 0);
  const descuentos = validas.reduce((s, v) => s + n(v.descuento), 0);
  const nc = notasParciales.reduce((s, x) => s + n(x.monto), 0);
  const unidades = validas.reduce((s, v) => s + (v.detalle_venta ?? []).reduce((a, d) => a + n(d.cantidad), 0), 0);
  return redondearTodo({
    ventas_brutas: ventas + descuentos,
    descuentos,
    ventas,
    notas_credito: nc,
    ventas_netas: ventas - nc,
    isv: validas.reduce((s, v) => s + n(v.isv_total), 0),
    facturas: validas.length,
    ticket_promedio: validas.length > 0 ? ventas / validas.length : 0,
    unidades,
    anuladas: anuladas.length,
    monto_anulado: anuladas.reduce((s, v) => s + n(v.total), 0),
  });
}

// Resumen fiscal de un grupo de facturas (fiscales o borrador) con el rango
// de numeración emitido por sucursal — lo que pide el contador para la
// declaración.
function resumenFiscal(lista, notas) {
  const validas = lista.filter((v) => !v.anulada);
  const ncIsv = notas.reduce((s, nc) => {
    const total = n(nc.ventas?.total);
    return s + (total > 0 ? (n(nc.monto) * n(nc.ventas?.isv_total)) / total : 0);
  }, 0);
  // Rango por sucursal y serie (prefijo sin los 8 dígitos del correlativo),
  // comparando el correlativo como número y no como texto.
  const rangos = new Map();
  for (const v of lista) {
    if (!v.numero_factura) continue;
    const serie = v.numero_factura.slice(0, -8);
    const correlativo = n(v.correlativo) || Number(v.numero_factura.slice(-8));
    sumar(rangos, `${v.sucursal_id}|${serie}`, () => ({ sucursal: v.sucursales?.nombre ?? '', serie, min: correlativo, max: correlativo, emitidas: 0, anuladas: 0 }), (r) => {
      r.min = Math.min(r.min, correlativo);
      r.max = Math.max(r.max, correlativo);
      r.emitidas += 1;
      if (v.anulada) r.anuladas += 1;
    });
  }
  const listaRangos = [...rangos.values()].map(({ serie, min, max, ...r }) => ({
    ...r,
    desde: `${serie}${String(min).padStart(8, '0')}`,
    hasta: `${serie}${String(max).padStart(8, '0')}`,
    // Si emitidas < (hasta − desde + 1) hay números del rango que no aparecen
    // en el período (p. ej. se emitieron fuera de las fechas filtradas).
    huecos: Math.max(0, max - min + 1 - r.emitidas),
  }));
  const porMes = new Map();
  for (const v of validas) {
    const mes = fechaHn(v.fecha_emision).slice(0, 7);
    sumar(porMes, mes, () => ({ mes, exento: 0, exonerado: 0, gravado_15: 0, isv: 0, total: 0, facturas: 0 }), (m) => {
      m.exento += n(v.subtotal_exento);
      m.exonerado += n(v.subtotal_exonerado);
      m.gravado_15 += n(v.subtotal_gravado_15);
      m.isv += n(v.isv_total);
      m.total += n(v.total);
      m.facturas += 1;
    });
  }
  return {
    ...redondearTodo({
      exento: validas.reduce((s, v) => s + n(v.subtotal_exento), 0),
      exonerado: validas.reduce((s, v) => s + n(v.subtotal_exonerado), 0),
      gravado_15: validas.reduce((s, v) => s + n(v.subtotal_gravado_15), 0),
      isv: validas.reduce((s, v) => s + n(v.isv_total), 0),
      total: validas.reduce((s, v) => s + n(v.total), 0),
      notas_credito: notas.reduce((s, nc) => s + n(nc.monto), 0),
      isv_notas_credito: ncIsv,
    }),
    isv_neto: round2(validas.reduce((s, v) => s + n(v.isv_total), 0) - ncIsv),
    facturas: validas.length,
    anuladas: lista.length - validas.length,
    rangos: listaRangos.sort((a, b) => a.sucursal.localeCompare(b.sucursal) || a.desde.localeCompare(b.desde)),
    por_mes: [...porMes.values()].map(redondearTodo).sort((a, b) => a.mes.localeCompare(b.mes)),
  };
}

async function construirReporte(filtros) {
  const [ventas, notas, gastos] = await Promise.all([ventasDelRango(filtros), notasDelRango(filtros), gastosDelRango(filtros)]);
  const validas = ventas.filter((v) => !v.anulada);
  const anuladas = ventas.filter((v) => v.anulada);
  const notasParciales = notas.filter((nc) => !nc.ventas?.anulada);

  const idsProducto = validas.flatMap((v) => (v.detalle_venta ?? []).map((d) => d.producto_id));
  const categoriaDe = await categoriasPorProducto(idsProducto);

  const total = validas.reduce((s, v) => s + n(v.total), 0);

  const porDia = new Map();
  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, facturas: 0, total: 0 }));
  const calor = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const porDiaSemana = Array.from({ length: 7 }, (_, dia) => ({ dia, facturas: 0, total: 0, fechas: new Set() }));
  const porSucursal = new Map();
  const porForma = new Map();
  const porCajero = new Map();
  const porProducto = new Map();
  const porCategoria = new Map();
  const porCliente = new Map();
  const descuentos = new Map();

  for (const v of ventas) {
    const sucursal = v.sucursales?.nombre ?? 'Sin sucursal';
    const cajero = v.perfiles?.nombre ?? 'Sin cajero';
    sumar(porSucursal, v.sucursal_id, () => ({ sucursal_id: v.sucursal_id, nombre: sucursal, facturas: 0, total: 0, descuentos: 0, anuladas: 0, monto_anulado: 0 }), (s) => {
      if (v.anulada) {
        s.anuladas += 1;
        s.monto_anulado += n(v.total);
      } else {
        s.facturas += 1;
        s.total += n(v.total);
        s.descuentos += n(v.descuento);
      }
    });
    sumar(porCajero, v.cajero_id ?? 'x', () => ({ nombre: cajero, facturas: 0, total: 0, con_descuento: 0, descuentos: 0, anuladas: 0 }), (c) => {
      if (v.anulada) c.anuladas += 1;
      else {
        c.facturas += 1;
        c.total += n(v.total);
        if (n(v.descuento) > 0) {
          c.con_descuento += 1;
          c.descuentos += n(v.descuento);
        }
      }
    });
    if (v.anulada) continue;

    const fecha = fechaHn(v.fecha_emision);
    const hora = horaHn(v.fecha_emision);
    const dia = diaSemanaHn(v.fecha_emision);
    sumar(porDia, fecha, () => ({ fecha, dia_semana: dia, facturas: 0, total: 0, descuentos: 0 }), (d) => {
      d.facturas += 1;
      d.total += n(v.total);
      d.descuentos += n(v.descuento);
    });
    porHora[hora].facturas += 1;
    porHora[hora].total += n(v.total);
    calor[dia][hora] += n(v.total);
    porDiaSemana[dia].facturas += 1;
    porDiaSemana[dia].total += n(v.total);
    porDiaSemana[dia].fechas.add(fecha);

    // Efectivo neto del cambio (el cambio sale de la gaveta).
    let efectivoVenta = 0;
    for (const p of v.venta_pagos ?? []) {
      const forma = formaDePago(p.formas_pago?.nombre);
      if (forma === 'Efectivo') {
        efectivoVenta += n(p.monto);
        continue;
      }
      sumar(porForma, forma, () => ({ nombre: forma, monto: 0, facturas: 0 }), (f) => {
        f.monto += n(p.monto);
        f.facturas += 1;
      });
    }
    if (efectivoVenta > 0 || n(v.cambio) > 0) {
      sumar(porForma, 'Efectivo', () => ({ nombre: 'Efectivo', monto: 0, facturas: 0 }), (f) => {
        f.monto += efectivoVenta - n(v.cambio);
        f.facturas += 1;
      });
    }

    for (const d of v.detalle_venta ?? []) {
      const clave = d.producto_id ?? d.nombre_producto;
      const categoria = categoriaDe.get(d.producto_id) ?? 'Sin categoría';
      sumar(porProducto, clave, () => ({ nombre: d.nombre_producto, categoria, cantidad: 0, total: 0, facturas: 0 }), (p) => {
        p.cantidad += n(d.cantidad);
        p.total += n(d.monto);
        p.facturas += 1;
      });
      sumar(porCategoria, categoria, () => ({ nombre: categoria, cantidad: 0, total: 0 }), (c) => {
        c.cantidad += n(d.cantidad);
        c.total += n(d.monto);
      });
    }

    if (v.clientes && !v.clientes.es_consumidor_final) {
      sumar(porCliente, v.cliente_id, () => ({ nombre: v.clientes.nombre, rtn: v.clientes.rtn ?? '', facturas: 0, total: 0, ultima: v.fecha_emision }), (c) => {
        c.facturas += 1;
        c.total += n(v.total);
        c.ultima = v.fecha_emision;
      });
    }

    // Descuento por producto: se agrupa por el porcentaje de cada línea
    // (una misma factura puede tener 10% y 25% de tercera edad).
    const lineasConDescuento = (v.detalle_venta ?? []).filter((d) => n(d.descuento) > 0);
    const porcentajesVenta = new Set();
    for (const d of lineasConDescuento) {
      const pctDesc = n(d.descuento_porcentaje) || n(v.descuento_porcentaje);
      sumar(descuentos, pctDesc, () => ({ porcentaje: pctDesc, facturas: 0, monto: 0, ventas: 0, unidades: 0 }), (x) => {
        if (!porcentajesVenta.has(pctDesc)) x.facturas += 1;
        x.monto += n(d.descuento);
        x.ventas += n(d.monto);
        x.unidades += n(d.cantidad);
      });
      porcentajesVenta.add(pctDesc);
    }
    if (lineasConDescuento.length === 0 && n(v.descuento) > 0) {
      const pctDesc = n(v.descuento_porcentaje);
      sumar(descuentos, pctDesc, () => ({ porcentaje: pctDesc, facturas: 0, monto: 0, ventas: 0, unidades: 0 }), (x) => {
        x.facturas += 1;
        x.monto += n(v.descuento);
        x.ventas += n(v.total);
      });
    }
  }

  const totalFormas = [...porForma.values()].reduce((s, f) => s + f.monto, 0);
  const gastosTotal = gastos.reduce((s, g) => s + n(g.monto), 0);
  const gastosPorTipo = new Map();
  for (const g of gastos) sumar(gastosPorTipo, g.tipo ?? 'Otros', () => ({ tipo: g.tipo ?? 'Otros', monto: 0, movimientos: 0 }), (t) => {
    t.monto += n(g.monto);
    t.movimientos += 1;
  });

  const esBorrador = (v) => v.puntos_emision?.es_borrador ?? true;
  const fiscales = ventas.filter((v) => !esBorrador(v));
  const borrador = ventas.filter(esBorrador);
  const ncFiscales = notasParciales.filter((nc) => !(nc.ventas?.puntos_emision?.es_borrador ?? true));
  const ncBorrador = notasParciales.filter((nc) => nc.ventas?.puntos_emision?.es_borrador ?? true);

  return {
    kpis: kpis(validas, anuladas, notasParciales),
    por_dia: [...porDia.values()].map((d) => redondearTodo({ ...d, ticket_promedio: d.facturas ? d.total / d.facturas : 0 })).sort((a, b) => a.fecha.localeCompare(b.fecha)),
    por_hora: porHora.map(redondearTodo),
    calor: calor.map((fila) => fila.map(round2)),
    por_dia_semana: porDiaSemana.map(({ fechas, ...d }) =>
      redondearTodo({ ...d, dias: fechas.size, promedio_dia: fechas.size ? d.total / fechas.size : 0 })
    ),
    por_sucursal: [...porSucursal.values()]
      .map((s) => redondearTodo({ ...s, ticket_promedio: s.facturas ? s.total / s.facturas : 0, participacion: pct(s.total, total) }))
      .sort((a, b) => b.total - a.total),
    por_forma_pago: [...porForma.values()]
      .map((f) => redondearTodo({ ...f, participacion: pct(f.monto, totalFormas) }))
      .sort((a, b) => b.monto - a.monto),
    por_cajero: [...porCajero.values()]
      .map((c) => redondearTodo({ ...c, ticket_promedio: c.facturas ? c.total / c.facturas : 0 }))
      .sort((a, b) => b.total - a.total),
    productos: [...porProducto.values()]
      .map((p) => redondearTodo({ ...p, precio_promedio: p.cantidad ? p.total / p.cantidad : 0, participacion: pct(p.total, total) }))
      .sort((a, b) => b.total - a.total),
    por_categoria: [...porCategoria.values()]
      .map((c) => redondearTodo({ ...c, participacion: pct(c.total, total) }))
      .sort((a, b) => b.total - a.total),
    clientes: [...porCliente.values()].map(redondearTodo).sort((a, b) => b.total - a.total).slice(0, 50),
    descuentos: [...descuentos.values()].map(redondearTodo).sort((a, b) => a.porcentaje - b.porcentaje),
    anuladas: anuladas.map((v) => ({
      numero_factura: v.numero_factura,
      fecha: v.fecha_emision,
      sucursal: v.sucursales?.nombre ?? '',
      cliente: v.clientes?.nombre ?? 'Consumidor Final',
      cajero: v.perfiles?.nombre ?? '',
      total: n(v.total),
    })),
    notas_credito: notas.map((nc) => ({
      numero_nota: nc.numero_nota,
      numero_factura: nc.ventas?.numero_factura ?? '',
      sucursal: nc.ventas?.sucursales?.nombre ?? '',
      fecha: nc.created_at,
      monto: n(nc.monto),
      motivo: nc.motivo,
      usuario: nc.usuario?.nombre ?? '',
      tipo: nc.ventas?.anulada ? 'Anulación total' : 'Parcial',
    })),
    isv: { fiscal: resumenFiscal(fiscales, ncFiscales), borrador: resumenFiscal(borrador, ncBorrador) },
    gastos: redondearTodo({ total: gastosTotal, movimientos: gastos.length }),
    gastos_por_tipo: [...gastosPorTipo.values()].map(redondearTodo).sort((a, b) => b.monto - a.monto),
    libro_ventas: ventas.map((v) => ({
      fecha: v.fecha_emision,
      numero_factura: v.numero_factura,
      sucursal: v.sucursales?.nombre ?? '',
      cliente: v.clientes?.nombre ?? 'Consumidor Final',
      rtn: v.clientes?.rtn ?? '',
      cajero: v.perfiles?.nombre ?? '',
      exento: n(v.subtotal_exento),
      exonerado: n(v.subtotal_exonerado),
      gravado_15: n(v.subtotal_gravado_15),
      isv: n(v.isv_total),
      descuento: n(v.descuento),
      total: n(v.total),
      anulada: v.anulada,
      borrador: esBorrador(v),
    })),
  };
}

// Mismo número de días inmediatamente antes (ej. 1–27 sep → 5–31 ago).
function rangoAnterior(fechaInicio, fechaFin) {
  const DIA = 86400000;
  const inicio = new Date(inicioDelDia(fechaInicio));
  const fin = new Date(finDelDia(fechaFin));
  const dias = Math.max(1, Math.round((fin - inicio) / DIA));
  const finAnterior = new Date(inicio.getTime() - 1);
  const inicioAnterior = new Date(inicio.getTime() - dias * DIA);
  return { fechaInicio: inicioAnterior.toISOString(), fechaFin: finAnterior.toISOString(), dias };
}

reportes.get('/completo', async (req, res) => {
  try {
    const { sucursal_id, fechaInicio, fechaFin } = req.query;
    if (!fechaInicio || !fechaFin) return res.status(400).json({ error: 'Elige el rango de fechas' });
    if (fechaFin < fechaInicio) return res.status(400).json({ error: 'La fecha final es anterior a la inicial' });
    const filtros = { sucursal_id: sucursal_id || null, fechaInicio, fechaFin };
    const anterior = rangoAnterior(fechaInicio, fechaFin);

    const [reporte, previo] = await Promise.all([
      construirReporte(filtros),
      Promise.all([ventasDelRango({ ...filtros, ...anterior }), notasDelRango({ ...filtros, ...anterior })]),
    ]);
    const [ventasPrevias, notasPrevias] = previo;
    reporte.kpis_anterior = kpis(
      ventasPrevias.filter((v) => !v.anulada),
      ventasPrevias.filter((v) => v.anulada),
      notasPrevias.filter((nc) => !nc.ventas?.anulada)
    );
    reporte.rango_anterior = { desde: fechaHn(anterior.fechaInicio), hasta: fechaHn(anterior.fechaFin) };
    res.json(reporte);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
