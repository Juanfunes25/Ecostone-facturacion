import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { obtenerParametros, numero } from '../lib/parametros.js';
import { calcularCotizacion, dimensionarLinea, round2, round3, calcularAnticipo } from '../lib/cotizacion.js';
import { generarPdfCotizacionBuffer } from '../lib/cotizacionPdf.js';
import { enviarCotizacionCliente } from '../lib/correo.js';
import { hoyHn, liberarReservas, reservarCotizacion, sumarDias } from '../lib/produccion.js';
import { facturarVenta, guardarDetalle, obtenerPuntoEmisionActivo } from './ventas.js';
import { textoSeguroFiltro } from '../lib/consultas.js';

export const cotizaciones = Router();
const VENDE = ['admin', 'gerente', 'vendedor'];
const COBRA = ['admin', 'gerente', 'cajero'];
const LEE = ['admin', 'gerente', 'vendedor', 'cajero'];
const GERENCIA = ['admin', 'gerente'];
const fallo = (res, e, status = 400) => res.status(e.status ?? status).json({ error: e.message ?? String(e) });
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function cargar(id) {
  const [{ data: cot }, { data: lineas }, { data: pagos }] = await Promise.all([
    db.from('cotizaciones').select('*, clientes(nombre, rtn, email, telefono, exento_impuestos, tipo_cliente, limite_credito), listas_precio(nombre, isv_incluido), venta:ventas!cotizaciones_venta_id_fkey(numero_factura, estado), vendedor:perfiles!cotizaciones_vendedor_id_fkey(nombre)').eq('id', id).maybeSingle(),
    db.from('cotizacion_lineas').select('*, productos(nombre, tipo, unidad_venta, m2_por_caja)').eq('cotizacion_id', id).order('orden'),
    db.from('cotizacion_pagos').select('*, formas_pago(nombre), perfiles(nombre)').eq('cotizacion_id', id).order('created_at'),
  ]);
  if (!cot) return null;
  const pagado = round2((pagos ?? []).reduce((s, p) => s + Number(p.monto), 0));
  const vencida = ['borrador', 'enviada'].includes(cot.estado) && cot.fecha_vigencia && cot.fecha_vigencia < hoyHn();
  const { anticipo, saldo } = calcularAnticipo(cot.total, cot.anticipo_pct);
  return { ...cot, lineas: lineas ?? [], pagos: pagos ?? [], pagado, pendiente: round2(Number(cot.total) - pagado), vencida: !!vencida, anticipo_monto: anticipo, saldo_monto: saldo };
}

// Un vendedor solo ve y toca las suyas.
const esAjena = (perfil, cot) => perfil.rol === 'vendedor' && cot.vendedor_id !== perfil.id;

// Asegura un cliente real (para RTN, historial y cuentas por cobrar futuras).
async function resolverCliente(body) {
  if (body.cliente_id) {
    const { data } = await db.from('clientes').select('*').eq('id', body.cliente_id).maybeSingle();
    if (data) return data;
  }
  const rtn = String(body.rtn_cliente ?? '').replace(/[-\s]/g, '');
  if (rtn && !/^\d{13,14}$/.test(rtn)) throw err('El RTN debe tener 13 o 14 dígitos');
  if (rtn) {
    const { data } = await db.from('clientes').select('*').eq('rtn', rtn).maybeSingle();
    if (data) return data;
  }
  const nombre = String(body.nombre_cliente ?? '').trim();
  if (!nombre) throw err('Indica el nombre del cliente');
  const { data, error } = await db.from('clientes').insert({ nombre, rtn: rtn || null, telefono: body.telefono || null, email: body.email || null, direccion: body.direccion_obra || null, tipo_cliente: body.tipo_cliente ?? 'final' }).select().single();
  if (error) throw err(error.message);
  return data;
}

async function armarLineas(lineasIn, { lista, cliente, perfil, params }) {
  if (!Array.isArray(lineasIn) || !lineasIn.length) throw err('La cotización necesita al menos una línea');
  const ids = [...new Set(lineasIn.map((l) => l.producto_id).filter(Boolean))];
  const [{ data: prods }, { data: precios }] = await Promise.all([
    ids.length ? db.from('productos').select('*').in('id', ids) : { data: [] },
    ids.length && lista ? db.from('precios_producto').select('producto_id, precio').eq('lista_id', lista.id).in('producto_id', ids) : { data: [] },
  ]);
  const prodPorId = new Map((prods ?? []).map((p) => [p.id, p]));
  const precioLista = new Map((precios ?? []).map((p) => [p.producto_id, Number(p.precio)]));
  const topeVendedor = numero(params.descuento_max_vendedor_pct, 5);
  const topeGerente = numero(params.descuento_max_gerente_pct, 15);
  const tope = perfil.rol === 'admin' ? 100 : perfil.rol === 'gerente' ? topeGerente : topeVendedor;
  const bajoLista = [];

  const lineas = lineasIn.map((l, i) => {
    const tipo = ['producto', 'accesorio', 'flete', 'instalacion', 'otro'].includes(l.tipo) ? l.tipo : 'producto';
    const desc_pct = numero(l.descuento_pct);
    if (desc_pct < 0 || desc_pct > 100) throw err(`Descuento inválido en la línea ${i + 1}`);
    if (desc_pct > tope) throw err(`El descuento de ${desc_pct}% (línea ${i + 1}) supera tu tope de ${tope}%. Pide a un gerente que lo autorice.`, 403);
    const base = { orden: i, tipo, descuento_pct: desc_pct };

    if (tipo === 'producto' || tipo === 'accesorio') {
      const p = prodPorId.get(l.producto_id);
      if (!p) throw err(`Producto no encontrado en la línea ${i + 1}`);
      const dim = tipo === 'producto' && numero(l.m2_neto) > 0 ? dimensionarLinea(p, numero(l.m2_neto), numero(l.desperdicio_pct)) : null;
      const cantidad = dim ? dim.cantidad : numero(l.cantidad);
      if (!(cantidad > 0)) throw err(`Indica la cantidad en la línea ${i + 1}`);
      // El precio del catálogo es el de la lista Público (con ISV). Si la lista es sin ISV y
      // el producto no tiene precio propio en ella, se deriva quitando el ISV (no se cobra doble).
      const tasa = Number(p.impuesto1_tasa ?? 0.15);
      const lista_p = precioLista.get(p.id) ?? (lista && !lista.isv_incluido ? round2(Number(p.precio) / (1 + tasa)) : Number(p.precio));
      let precio = l.precio_unitario === undefined || l.precio_unitario === '' || l.precio_unitario === null ? lista_p : numero(l.precio_unitario, lista_p);
      if (precio < lista_p * 0.995) {
        if (perfil.rol === 'vendedor') throw err(`El precio de ${p.nombre} (L ${precio}) está por debajo de la lista (L ${lista_p}). Requiere autorización de gerente.`, 403);
        bajoLista.push({ producto: p.nombre, lista: lista_p, precio });
      }
      const costoBase = Number(p.costo_estandar || 0);
      return { ...base, producto_id: p.id, descripcion: p.nombre, unidad: p.unidad_venta, m2_neto: dim ? numero(l.m2_neto) : null, desperdicio_pct: dim ? numero(l.desperdicio_pct) : 0, cajas: dim?.cajas ?? null, cantidad, precio_unitario: precio, isv_tasa: Number(p.impuesto1_tasa ?? 0.15), costo_unitario: p.unidad_venta === 'caja' ? costoBase * Number(p.m2_por_caja || 0) : costoBase };
    }
    const cantidad = numero(l.cantidad);
    if (!String(l.descripcion ?? '').trim() || !(cantidad > 0) || numero(l.precio_unitario, -1) < 0) throw err(`Completa descripción, cantidad y precio de la línea ${i + 1}`);
    return { ...base, producto_id: null, descripcion: String(l.descripcion).trim(), unidad: l.unidad || (tipo === 'instalacion' ? 'm2' : 'viaje'), m2_neto: null, desperdicio_pct: 0, cajas: null, cantidad, precio_unitario: numero(l.precio_unitario), isv_tasa: 0.15, costo_unitario: numero(l.costo_unitario) };
  });
  return { lineas, bajoLista, tope };
}

async function guardar(req, res, id = null) {
  try {
    const b = req.body;
    const params = await obtenerParametros();
    let previa = null;
    if (id) {
      previa = await cargar(id);
      if (!previa) return res.status(404).json({ error: 'Cotización no encontrada' });
      if (esAjena(req.perfil, previa)) throw err('Esa cotización es de otro vendedor', 403);
      if (!['borrador', 'enviada'].includes(previa.estado)) throw err(`Una cotización ${previa.estado} ya no se puede editar`, 409);
    }
    const cliente = await resolverCliente(b);
    const listaId = b.lista_precio_id || cliente.lista_precio_id || null;
    let lista = null;
    if (listaId) ({ data: lista } = await db.from('listas_precio').select('*').eq('id', listaId).maybeSingle());
    else ({ data: lista } = await db.from('listas_precio').select('*').eq('nombre', 'Público').maybeSingle());
    const isv_incluido = lista?.isv_incluido ?? true;

    const { lineas, bajoLista, tope } = await armarLineas(b.lineas, { lista, cliente, perfil: req.perfil, params });
    const descPct = Math.min(100, Math.max(0, numero(b.descuento_pct)));
    const calc = calcularCotizacion(lineas, { isv_incluido, descuento_pct: descPct, cliente_exento: !!cliente.exento_impuestos });
    if (req.perfil.rol === 'vendedor' && calc.descuento_pct > tope) throw err(`El descuento total (${calc.descuento_pct}%) supera tu tope de ${tope}%. Pide autorización a un gerente.`, 403);

    const vigencia = numero(b.vigencia_dias, numero(params.vigencia_cotizacion_dias, 15));
    const { data: planta } = await db.from('sucursales').select('id').eq('activo', true).order('created_at').limit(1).maybeSingle();
    const fila = {
      cliente_id: cliente.id, nombre_cliente: cliente.nombre, rtn_cliente: cliente.rtn ?? null, telefono: b.telefono || cliente.telefono || null, email: b.email || cliente.email || null,
      proyecto: String(b.proyecto ?? '').trim(), direccion_obra: b.direccion_obra || null,
      lista_precio_id: lista?.id ?? null, isv_incluido, vigencia_dias: vigencia, fecha_vigencia: sumarDias(hoyHn(), vigencia),
      descuento: calc.descuento_global, descuento_pct: descPct, subtotal: calc.subtotal, isv: calc.isv, total: calc.total,
      anticipo_pct: numero(b.anticipo_pct, numero(params.anticipo_pct_default, 0)),
      entrega: b.entrega === 'despacho' ? 'despacho' : 'retira', fecha_entrega: b.fecha_entrega || null,
      notas: b.notas || null, sucursal_id: planta?.id ?? null, updated_at: new Date().toISOString(),
    };
    if (fila.anticipo_pct < 0 || fila.anticipo_pct > 100) throw err('El anticipo debe estar entre 0 y 100%');

    let cot;
    if (id) {
      const { data, error } = await db.from('cotizaciones').update(fila).eq('id', id).select().single();
      if (error) throw err(error.message);
      cot = data;
      await db.from('cotizacion_lineas').delete().eq('cotizacion_id', id);
    } else {
      const { data, error } = await db.from('cotizaciones').insert({ ...fila, vendedor_id: req.perfil.id }).select().single();
      if (error) throw err(error.message);
      cot = data;
    }
    const { error: errLin } = await db.from('cotizacion_lineas').insert(lineas.map((l, i) => ({ ...l, cotizacion_id: cot.id, monto: calc.lineas[i].monto })));
    if (errLin) {
      if (!id) await db.from('cotizaciones').delete().eq('id', cot.id);
      throw err(errLin.message);
    }
    await registrarAuditoria(req, { accion: id ? 'cotizacion.editar' : 'cotizacion.crear', entidad: 'cotizacion', entidadId: cot.id, detalle: { numero: cot.numero, cliente: cot.nombre_cliente, proyecto: cot.proyecto, total: calc.total, descuento_pct: calc.descuento_pct } });
    if (bajoLista.length) {
      await crearAlerta(req, { tipo: 'cotizacion.precio_bajo_lista', severidad: 'media', titulo: `Cotización #${cot.numero} con precio bajo la lista (${req.perfil.nombre})`, entidad: 'cotizacion', entidadId: cot.id, detalle: { productos: bajoLista } });
    }
    res.status(id ? 200 : 201).json({ ...(await cargar(cot.id)), margen: calc.margen, margen_pct: calc.margen_pct });
  } catch (e) {
    fallo(res, e);
  }
}

cotizaciones.get('/', requireRole(...LEE), async (req, res) => {
  const q = textoSeguroFiltro(req.query.q);
  let query = db.from('cotizaciones').select('id, numero, estado, nombre_cliente, proyecto, total, fecha_vigencia, fecha_entrega, created_at, vendedor_id, venta_id, venta:ventas!cotizaciones_venta_id_fkey(numero_factura)').order('created_at', { ascending: false }).limit(300);
  if (req.query.estado) query = query.in('estado', String(req.query.estado).split(','));
  if (req.perfil.rol === 'vendedor') query = query.eq('vendedor_id', req.perfil.id);
  if (q) query = query.or(`nombre_cliente.ilike.%${q}%,proyecto.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return fallo(res, error, 500);
  const hoy = hoyHn();
  const ids = data.map((c) => c.id);
  let pagado = new Map();
  if (ids.length) {
    const { data: pagos } = await db.from('cotizacion_pagos').select('cotizacion_id, monto').in('cotizacion_id', ids);
    for (const p of pagos ?? []) pagado.set(p.cotizacion_id, round2((pagado.get(p.cotizacion_id) ?? 0) + Number(p.monto)));
  }
  res.json(data.map((c) => ({ ...c, pagado: pagado.get(c.id) ?? 0, vencida: ['borrador', 'enviada'].includes(c.estado) && c.fecha_vigencia < hoy })));
});

cotizaciones.get('/:id', requireRole(...LEE), async (req, res) => {
  const cot = await cargar(req.params.id);
  if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
  const { data: ordenes } = await db.from('ordenes_produccion').select('id, lote, estado, m2_planificado, fecha_programada, fecha_disponible, productos(nombre)').eq('cotizacion_id', cot.id).neq('estado', 'cancelada');
  const { data: reservas } = await db.from('movimientos_pt').select('producto_id, lote, m2, productos(nombre)').eq('cotizacion_id', cot.id).in('tipo', ['reserva', 'liberacion']);
  const resumen = new Map();
  for (const r of reservas ?? []) {
    const k = `${r.productos?.nombre}|${r.lote}`;
    resumen.set(k, round3((resumen.get(k) ?? 0) + -Number(r.m2)));
  }
  const verCostos = GERENCIA.includes(req.perfil.rol);
  const costo = round2(cot.lineas.reduce((s, l) => s + Number(l.costo_unitario) * Number(l.cantidad), 0));
  res.json({
    ...cot,
    ordenes: ordenes ?? [],
    reservas: [...resumen].filter(([, m2]) => m2 > 0).map(([k, m2]) => ({ producto: k.split('|')[0], lote: k.split('|')[1], m2 })),
    costo: verCostos ? costo : undefined,
    margen_pct: verCostos && Number(cot.subtotal) > 0 ? round2(((Number(cot.subtotal) - costo) / Number(cot.subtotal)) * 100) : undefined,
  });
});

cotizaciones.post('/', requireRole(...VENDE), (req, res) => guardar(req, res));
cotizaciones.put('/:id', requireRole(...VENDE), (req, res) => guardar(req, res, req.params.id));

cotizaciones.get('/:id/pdf', requireRole(...LEE), async (req, res) => {
  const cot = await cargar(req.params.id);
  if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
  const pdf = await generarPdfCotizacionBuffer(cot, cot.lineas, cot.clientes);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="cotizacion-${cot.numero}.pdf"`);
  res.send(pdf);
});

cotizaciones.post('/:id/enviar', requireRole(...VENDE), async (req, res) => {
  try {
    const cot = await cargar(req.params.id);
    if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (!['borrador', 'enviada'].includes(cot.estado)) throw err(`La cotización está ${cot.estado}`, 409);
    const destino = req.body.email || cot.email || cot.clientes?.email;
    const pdf = await generarPdfCotizacionBuffer(cot, cot.lineas, cot.clientes);
    const r = await enviarCotizacionCliente(cot, pdf, destino);
    if (r.enviado || req.body.solo_marcar) await db.from('cotizaciones').update({ estado: 'enviada', updated_at: new Date().toISOString() }).eq('id', cot.id);
    await registrarAuditoria(req, { accion: 'cotizacion.enviar', entidad: 'cotizacion', entidadId: cot.id, detalle: { numero: cot.numero, destino, enviado: r.enviado, motivo: r.motivo } });
    res.json(r);
  } catch (e) {
    fallo(res, e);
  }
});

// Aprobación del cliente: reserva existencias y genera producción por lo que falte.
cotizaciones.post('/:id/aprobar', requireRole(...VENDE), async (req, res) => {
  try {
    const cot = await cargar(req.params.id);
    if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (!['borrador', 'enviada'].includes(cot.estado)) throw err(`La cotización ya está ${cot.estado}`, 409);
    if (cot.vencida) throw err('La cotización está vencida: edítala y guárdala para renovar la vigencia y los precios', 409);
    if (cot.entrega === 'despacho' && !cot.fecha_entrega) throw err('Indica la fecha de entrega comprometida antes de aprobar', 400);
    const { data, error } = await db.from('cotizaciones').update({ estado: 'aprobada', aprobada_at: new Date().toISOString(), aprobada_por: req.perfil.id, updated_at: new Date().toISOString() }).eq('id', cot.id).select().single();
    if (error) throw err(error.message);
    const plan = await reservarCotizacion(req, data, cot.lineas);
    await registrarAuditoria(req, { accion: 'cotizacion.aprobar', entidad: 'cotizacion', entidadId: cot.id, detalle: { numero: cot.numero, total: Number(cot.total), reservado: plan.reservado, ordenes: plan.ordenes, pendientes: plan.pendientes } });
    res.json({ cotizacion: await cargar(cot.id), plan });
  } catch (e) {
    fallo(res, e);
  }
});

cotizaciones.post('/:id/rechazar', requireRole(...VENDE), async (req, res) => {
  const motivo = String(req.body.motivo ?? '').trim();
  if (!motivo) return res.status(400).json({ error: 'Indica el motivo' });
  const cot = await cargar(req.params.id);
  if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
  if (!['borrador', 'enviada'].includes(cot.estado)) return res.status(409).json({ error: `La cotización ya está ${cot.estado}` });
  await db.from('cotizaciones').update({ estado: 'rechazada', motivo_cierre: motivo, updated_at: new Date().toISOString() }).eq('id', cot.id);
  await registrarAuditoria(req, { accion: 'cotizacion.rechazar', entidad: 'cotizacion', entidadId: cot.id, detalle: { numero: cot.numero, motivo } });
  res.json({ ok: true });
});

// Anulación de una cotización aprobada aún sin facturar (solo gerencia).
cotizaciones.post('/:id/anular', requireRole(...GERENCIA), async (req, res) => {
  try {
    const motivo = String(req.body.motivo ?? '').trim();
    if (!motivo) throw err('Indica el motivo de la anulación');
    const cot = await cargar(req.params.id);
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (cot.estado === 'facturada') throw err('Ya está facturada: anula la factura con una nota de crédito', 409);
    if (cot.pagado > 0) throw err(`Ya tiene L ${cot.pagado.toFixed(2)} cobrados: devuelve o aplica el pago antes de anular`, 409);
    await liberarReservas(req, cot.id);
    await db.from('ordenes_produccion').update({ estado: 'cancelada', notas: `Cancelada por anulación de la cotización #${cot.numero}` }).eq('cotizacion_id', cot.id).eq('estado', 'planificada');
    await db.from('cotizaciones').update({ estado: 'anulada', motivo_cierre: motivo, updated_at: new Date().toISOString() }).eq('id', cot.id);
    await registrarAuditoria(req, { accion: 'cotizacion.anular', entidad: 'cotizacion', entidadId: cot.id, detalle: { numero: cot.numero, motivo, estado_anterior: cot.estado } });
    res.json({ ok: true });
  } catch (e) {
    fallo(res, e);
  }
});

// Cobro (anticipo o pago) contra una cotización aprobada.
cotizaciones.post('/:id/pagos', requireRole(...COBRA), async (req, res) => {
  try {
    const cot = await cargar(req.params.id);
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (cot.estado !== 'aprobada') throw err('Solo se cobra una cotización aprobada (y aún no facturada)', 409);
    const monto = round2(numero(req.body.monto));
    if (!(monto > 0)) throw err('El monto debe ser mayor que 0');
    if (monto > cot.pendiente + 0.004) throw err(`El monto supera el saldo pendiente (L ${cot.pendiente.toFixed(2)})`);
    const { data: forma } = await db.from('formas_pago').select('id, nombre').eq('id', req.body.forma_pago_id).maybeSingle();
    if (!forma) throw err('Forma de pago inválida');
    const { data, error } = await db.from('cotizacion_pagos').insert({ cotizacion_id: cot.id, tipo: cot.pagado === 0 && Number(cot.anticipo_pct) > 0 && monto < cot.total ? 'anticipo' : 'pago', forma_pago_id: forma.id, monto, referencia: req.body.referencia || null, usuario_id: req.perfil.id }).select().single();
    if (error) throw err(error.message);
    await registrarAuditoria(req, { accion: 'cotizacion.pago', entidad: 'cotizacion', entidadId: cot.id, detalle: { numero: cot.numero, forma: forma.nombre, monto, referencia: req.body.referencia, pendiente_despues: round2(cot.pendiente - monto) } });
    res.status(201).json({ pago: data, cotizacion: await cargar(cot.id) });
  } catch (e) {
    fallo(res, e);
  }
});

// Factura: aprobada + pagada → factura con correlativo del CAI.
cotizaciones.post('/:id/facturar', requireRole(...COBRA), async (req, res) => {
  let ventaId = null;
  try {
    const cot = await cargar(req.params.id);
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (cot.estado === 'facturada') throw err('Esta cotización ya fue facturada', 409);
    if (cot.estado !== 'aprobada') throw err('Solo se factura una cotización aprobada', 409);
    if (cot.pendiente > 0.004) throw err(`Falta cobrar L ${cot.pendiente.toFixed(2)} para poder facturar`, 409);
    if (!cot.pagos.length) throw err('Registra el pago antes de facturar', 409);

    const cliente = cot.clientes ?? {};
    const calc = calcularCotizacion(cot.lineas, { isv_incluido: cot.isv_incluido, descuento: Number(cot.descuento || 0), descuento_pct: Number(cot.descuento_pct || 0), cliente_exento: !!cliente.exento_impuestos });
    if (calc.total !== Number(cot.total)) throw err('Los precios cambiaron desde que se cotizó; guarda la cotización de nuevo antes de facturar', 409);
    const punto = await obtenerPuntoEmisionActivo(cot.sucursal_id);

    let exento = 0, exonerado = 0, gravado = 0;
    calc.lineas.forEach((l) => {
      if (l.isv_tasa > 0) gravado += l.base;
      else if (cliente.exento_impuestos) exento += l.base;
      else exonerado += l.base;
    });
    const { data: venta, error } = await db.from('ventas').insert({
      sucursal_id: cot.sucursal_id, punto_emision_id: punto.id, cliente_id: cot.cliente_id, cajero_id: req.perfil.id, estado: 'abierta', cotizacion_id: cot.id,
      subtotal_exento: round2(exento), subtotal_exonerado: round2(exonerado), subtotal_gravado_15: round2(gravado),
      descuento: round2(calc.lineas.reduce((s, l) => s + l.descuento_con_isv, 0)), descuento_porcentaje: 0, isv_total: calc.isv, total: calc.total,
      nota_interna: `Cotización #${cot.numero}${cot.proyecto ? ` · ${cot.proyecto}` : ''}`,
    }).select().single();
    if (error) throw err(error.message);
    ventaId = venta.id;
    await guardarDetalle(venta.id, cot.lineas.map((l, i) => ({
      producto_id: l.producto_id, nombre_producto: l.descripcion, cantidad: Number(l.cantidad),
      precio_unitario: calc.lineas[i].precio_unitario_con_isv, descuento: calc.lineas[i].descuento_con_isv, descuento_porcentaje: 0,
      impuesto_tasa: calc.lineas[i].isv_tasa, monto: calc.lineas[i].monto,
    })));

    // Los pagos cobrados (en su momento) se aplican hasta cubrir exactamente el total.
    let restante = Number(cot.total);
    const pagos = [];
    for (const p of cot.pagos) {
      if (restante <= 0) break;
      const m = round2(Math.min(Number(p.monto), restante));
      pagos.push({ forma_pago_id: p.forma_pago_id, monto: m });
      restante = round2(restante - m);
    }
    const efectivoNombre = new Set(cot.pagos.filter((p) => p.formas_pago?.nombre === 'Efectivo').map((p) => p.forma_pago_id));
    const efectivo = pagos.filter((p) => efectivoNombre.has(p.forma_pago_id)).reduce((s, p) => s + p.monto, 0);
    const factura = await facturarVenta(req, venta.id, { pagos, efectivo_recibido: efectivo, origen: 'cotizacion' });
    await db.from('cotizaciones').update({ estado: 'facturada', venta_id: venta.id, updated_at: new Date().toISOString() }).eq('id', cot.id);
    await registrarAuditoria(req, { accion: 'cotizacion.facturar', entidad: 'cotizacion', entidadId: cot.id, detalle: { numero: cot.numero, factura: factura.numero_factura, total: Number(cot.total) } });
    res.json({ factura, cotizacion: await cargar(cot.id) });
  } catch (e) {
    if (ventaId) {
      const { data: v } = await db.from('ventas').select('estado').eq('id', ventaId).maybeSingle();
      if (v?.estado === 'abierta') {
        await db.from('detalle_venta').delete().eq('venta_id', ventaId);
        await db.from('ventas').delete().eq('id', ventaId);
      }
    }
    fallo(res, e);
  }
});
