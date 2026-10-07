import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { numero } from '../lib/parametros.js';
import { calcularCotizacion, round2 } from '../lib/cotizacion.js';
import { generarPdfDCotizacion } from '../lib/dCotizacionPdf.js';
import { enviarCotizacionDiserco } from '../lib/correo.js';
import { codigoCotizacion } from '../lib/disercoConfig.js';
import { hoyHn, sumarDias } from '../lib/produccion.js';
import { sucursalesDe } from '../lib/empresas.js';
import { textoSeguroFiltro } from '../lib/consultas.js';
import { leerCotizacionExcel, generarExcelCotizacion } from '../lib/cotizacionExcel.js';
import { facturarVenta, guardarDetalle, obtenerPuntoEmisionActivo } from './ventas.js';

export const disercoCotizaciones = Router();
const VENDE = ['admin', 'gerente', 'vendedor', 'ventas'];
const COBRA = ['admin', 'gerente', 'cajero', 'ventas'];
const LEE = ['admin', 'gerente', 'vendedor', 'cajero', 'ventas'];
const GERENCIA = ['admin', 'gerente'];
const TASA = 0.15;
const fallo = (res, e, status = 400) => res.status(e.status ?? status).json({ error: e.message ?? String(e), codigo: e.codigo, faltantes: e.faltantes });
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

const SEL_COT = '*, clientes(nombre, rtn, email, telefono, exento_impuestos), vendedor:perfiles!d_cotizaciones_vendedor_id_fkey(nombre)';

async function cargar(id) {
  const [{ data: cot }, { data: lineas }, { data: pagos }] = await Promise.all([
    db.from('d_cotizaciones').select(SEL_COT).eq('id', id).maybeSingle(),
    db.from('d_cotizacion_lineas').select('*, productos(nombre, controla_inventario)').eq('cotizacion_id', id).order('orden'),
    db.from('d_cotizacion_pagos').select('*, formas_pago(nombre), perfiles(nombre), venta:ventas(numero_factura, anulada)').eq('cotizacion_id', id).order('created_at'),
  ]);
  if (!cot) return null;
  const validos = (pagos ?? []).filter((p) => !p.anulado);
  const pagado = round2(validos.reduce((s, p) => s + Number(p.monto), 0));
  const vencida = ['borrador', 'enviada'].includes(cot.estado) && cot.fecha_vigencia && cot.fecha_vigencia < hoyHn();
  return { ...cot, lineas: lineas ?? [], pagos: pagos ?? [], pagado, pendiente: round2(Number(cot.total) - pagado), vencida: !!vencida };
}

const esAjena = (perfil, cot) => perfil.rol === 'vendedor' && cot.vendedor_id !== perfil.id;

async function resolverCliente(b) {
  if (b.cliente_id) {
    const { data } = await db.from('clientes').select('*').eq('id', b.cliente_id).maybeSingle();
    if (data) return data;
  }
  const rtn = String(b.rtn_cliente ?? '').replace(/[-\s]/g, '');
  if (rtn && !/^\d{13,14}$/.test(rtn)) throw err('El RTN debe tener 13 o 14 dígitos');
  if (rtn) {
    const { data } = await db.from('clientes').select('*').eq('rtn', rtn).maybeSingle();
    if (data) return data;
  }
  const nombre = String(b.nombre_cliente ?? '').trim();
  if (!nombre) throw err('Indica el nombre del cliente');
  const { data, error } = await db.from('clientes').insert({ nombre, rtn: rtn || null, telefono: b.telefono || null, email: b.email || null, direccion: b.ubicacion || null }).select().single();
  if (error) throw err(error.message);
  return data;
}

async function sucursalDiserco(req, pedida) {
  const ids = await sucursalesDe('diserco');
  if (pedida && ids.includes(pedida)) return pedida;
  if (req.perfil.sucursal_id && ids.includes(req.perfil.sucursal_id)) return req.perfil.sucursal_id;
  if (!ids.length) throw err('DISERCO no tiene una sucursal configurada', 500);
  return ids[0];
}

async function armarLineas(b, tipo, perfil) {
  if (!Array.isArray(b.lineas) || !b.lineas.length) throw err('La cotización necesita al menos una línea');
  const ids = [...new Set(b.lineas.map((l) => l.producto_id).filter(Boolean))];
  const { data: prods } = ids.length ? await db.from('productos').select('*').in('id', ids) : { data: [] };
  const porId = new Map((prods ?? []).map((p) => [p.id, p]));
  return b.lineas.map((l, i) => {
    const p = l.producto_id ? porId.get(l.producto_id) : null;
    if (l.producto_id && !p) throw err(`Producto no encontrado en la línea ${i + 1}`);
    const descripcion = String(l.descripcion ?? p?.nombre ?? '').trim();
    const cantidad = numero(l.cantidad);
    if (!descripcion) throw err(`Escribe la descripción de la línea ${i + 1}`);
    if (!(cantidad > 0)) throw err(`Indica la cantidad de la línea ${i + 1}`);
    // Productos: unidades enteras (no se venden medios kits). Proyectos: el área puede llevar decimales.
    if (tipo === 'productos' && !Number.isInteger(cantidad)) throw err(`La cantidad de la línea ${i + 1} debe ser un número entero`);
    const precio = l.precio_unitario === '' || l.precio_unitario == null ? numero(p?.precio, NaN) : numero(l.precio_unitario, NaN);
    if (!Number.isFinite(precio) || precio < 0) throw err(`Indica el precio de la línea ${i + 1}`);
    if (p && ['vendedor', 'ventas'].includes(perfil.rol) && precio < Number(p.precio) * 0.995) throw err(`El precio de ${p.nombre} (L ${precio}) está por debajo del catálogo (L ${Number(p.precio)}). Requiere autorización de gerente.`, 403);
    return {
      orden: i, producto_id: p?.id ?? null, descripcion, presentacion: String(l.presentacion ?? p?.presentacion ?? '').trim() || null,
      cantidad, unidad: String(l.unidad ?? (tipo === 'proyecto' ? 'm2' : p?.unidad_venta ?? 'unidad')).trim() || 'unidad',
      precio_unitario: precio, isv_tasa: TASA, costo_unitario: numero(l.costo_unitario, Number(p?.costo_estandar ?? 0)),
    };
  });
}

function totales(lineas, cliente, descuentoPct) {
  return calcularCotizacion(lineas.map((l) => ({ ...l, descuento_pct: 0 })), { isv_incluido: false, descuento_pct: descuentoPct, cliente_exento: !!cliente.exento_impuestos });
}

const limpiarSecciones = (s) => (Array.isArray(s) ? s.map((x) => ({ titulo: String(x.titulo ?? '').slice(0, 120), texto: String(x.texto ?? '').slice(0, 6000) })).filter((x) => x.titulo.trim() || x.texto.trim()) : []);

async function guardar(req, res, id = null) {
  try {
    const b = req.body;
    let previa = null;
    if (id) {
      previa = await cargar(id);
      if (!previa) return res.status(404).json({ error: 'Cotización no encontrada' });
      if (esAjena(req.perfil, previa)) throw err('Esa cotización es de otro vendedor', 403);
      if (!['borrador', 'enviada'].includes(previa.estado)) throw err(`Una cotización ${previa.estado} ya no se puede editar`, 409);
    }
    const tipo = id ? previa.tipo : b.tipo;
    if (!['proyecto', 'productos'].includes(tipo)) throw err('Elige si es cotización de Proyecto o de Productos');
    const cliente = await resolverCliente(b);
    const lineas = await armarLineas(b, tipo, req.perfil);
    const descPct = Math.min(100, Math.max(0, numero(b.descuento_pct)));
    if (descPct > 0 && !GERENCIA.includes(req.perfil.rol)) throw err('Solo gerencia puede aplicar descuentos', 403);
    const calc = totales(lineas, cliente, descPct);
    const vigencia = Math.max(1, Math.round(numero(b.vigencia_dias, 30)));
    const anticipo = Math.min(100, Math.max(0, numero(b.anticipo_pct, 0)));

    const fila = {
      cliente_id: cliente.id, nombre_cliente: cliente.nombre, rtn_cliente: cliente.rtn ?? null,
      telefono: b.telefono || cliente.telefono || null, email: b.email || cliente.email || null,
      contacto: String(b.contacto ?? '').trim() || null, proyecto: String(b.proyecto ?? '').trim() || null, ubicacion: String(b.ubicacion ?? '').trim() || null,
      vigencia_dias: vigencia, fecha_vigencia: sumarDias(hoyHn(), vigencia),
      descuento_pct: descPct, subtotal: calc.subtotal, isv: calc.isv, total: calc.total, anticipo_pct: anticipo,
      secciones: limpiarSecciones(b.secciones), mostrar_bancos: !!b.mostrar_bancos,
      firma_nombre: String(b.firma_nombre ?? '').trim() || null, firma_cargo: String(b.firma_cargo ?? '').trim() || null,
      notas_internas: b.notas_internas || null, updated_at: new Date().toISOString(),
    };
    if (tipo === 'proyecto' && !fila.proyecto) throw err('Escribe el nombre del proyecto');

    let cot;
    if (id) {
      const { data, error } = await db.from('d_cotizaciones').update(fila).eq('id', id).select().single();
      if (error) throw err(error.message);
      cot = data;
      await db.from('d_cotizacion_lineas').delete().eq('cotizacion_id', id);
    } else {
      const anio = Number(hoyHn().slice(0, 4));
      const { data: n, error: errN } = await db.rpc('d_siguiente_numero', { p_anio: anio });
      if (errN) throw err(errN.message, 500);
      const sucursal_id = await sucursalDiserco(req, b.sucursal_id);
      const { data, error } = await db.from('d_cotizaciones').insert({ ...fila, tipo, numero: n, anio, codigo: codigoCotizacion(tipo, n, anio), vendedor_id: req.perfil.id, sucursal_id }).select().single();
      if (error) throw err(error.message);
      cot = data;
    }
    const { error: errLin } = await db.from('d_cotizacion_lineas').insert(lineas.map((l, i) => ({ ...l, cotizacion_id: cot.id, monto: calc.lineas[i].monto })));
    if (errLin) {
      if (!id) await db.from('d_cotizaciones').delete().eq('id', cot.id);
      throw err(errLin.message);
    }
    await registrarAuditoria(req, { accion: id ? 'dcotizacion.editar' : 'dcotizacion.crear', entidad: 'd_cotizacion', entidadId: cot.id, sucursalId: cot.sucursal_id, detalle: { codigo: cot.codigo, tipo, cliente: cot.nombre_cliente, total: calc.total } });
    res.status(id ? 200 : 201).json({ ...(await cargar(cot.id)), margen: calc.margen, margen_pct: calc.margen_pct });
  } catch (e) {
    fallo(res, e);
  }
}

disercoCotizaciones.get('/', requireRole(...LEE), async (req, res) => {
  const q = textoSeguroFiltro(req.query.q);
  let query = db.from('d_cotizaciones').select('id, codigo, tipo, estado, nombre_cliente, proyecto, total, fecha_vigencia, created_at, vendedor_id').order('created_at', { ascending: false }).limit(300);
  if (req.query.estado) query = query.in('estado', String(req.query.estado).split(','));
  if (req.query.tipo) query = query.eq('tipo', req.query.tipo);
  if (req.perfil.rol === 'vendedor') query = query.eq('vendedor_id', req.perfil.id);
  if (q) query = query.or(`nombre_cliente.ilike.%${q}%,proyecto.ilike.%${q}%,codigo.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return fallo(res, error, 500);
  const ids = data.map((c) => c.id);
  const pagado = new Map();
  if (ids.length) {
    const { data: pagos } = await db.from('d_cotizacion_pagos').select('cotizacion_id, monto, anulado').in('cotizacion_id', ids);
    for (const p of pagos ?? []) if (!p.anulado) pagado.set(p.cotizacion_id, round2((pagado.get(p.cotizacion_id) ?? 0) + Number(p.monto)));
  }
  const hoy = hoyHn();
  res.json(data.map((c) => ({ ...c, pagado: pagado.get(c.id) ?? 0, vencida: ['borrador', 'enviada'].includes(c.estado) && c.fecha_vigencia < hoy })));
});


const normNombre = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Importa una cotización desde un Excel: la lee, la guarda como borrador con número nuevo del
// sistema y conserva el archivo original. Body: { nombre, contenido (base64) }.
disercoCotizaciones.post('/importar-excel', requireRole(...VENDE), async (req, res) => {
  try {
    const nombre = String(req.body?.nombre ?? 'cotizacion.xlsx').slice(0, 200);
    const base64 = String(req.body?.contenido ?? '').replace(/^data:[^,]*,/, '');
    if (!base64) throw err('No llegó el archivo');
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) throw err('El archivo es demasiado grande (máximo 8 MB)');
    let leida;
    try {
      leida = await leerCotizacionExcel(buffer);
    } catch (e) {
      throw err(/zip|central directory|corrupt|Can't find end/i.test(e.message) ? 'El archivo no es un Excel (.xlsx) válido. Si es .xls, ábrelo y guárdalo como .xlsx.' : e.message);
    }
    const { tipo, meta, lineas, secciones, anticipo, firma, codigoOriginal, fechaTexto, fecha, avisos } = leida;

    // Cliente: si ya existe uno con el mismo nombre (o RTN) se usa; si no, se crea.
    let clienteId = null;
    const rtn = String(meta.rtn ?? '').replace(/[-\s]/g, '');
    if (/^\d{13,14}$/.test(rtn)) clienteId = (await db.from('clientes').select('id').eq('rtn', rtn).maybeSingle()).data?.id ?? null;
    if (!clienteId) {
      const clave = textoSeguroFiltro(meta.cliente).split(' ').slice(0, 2).join('%');
      const { data: cands } = await db.from('clientes').select('id, nombre').ilike('nombre', `%${clave}%`).limit(40);
      clienteId = (cands ?? []).find((c) => normNombre(c.nombre) === normNombre(meta.cliente))?.id ?? null;
    }
    if (!clienteId) avisos.push(`Cliente nuevo creado: ${meta.cliente}`);

    // Productos: se enlaza al catálogo solo si el nombre coincide exacto.
    let catalogo = new Map();
    if (tipo === 'productos') {
      const { data: prods } = await db.from('productos').select('id, nombre').eq('empresa', 'diserco').eq('activo', true).limit(2000);
      catalogo = new Map((prods ?? []).map((p) => [normNombre(p.nombre), p.id]));
    }
    const body = {
      tipo, cliente_id: clienteId, nombre_cliente: meta.cliente, rtn_cliente: rtn || null, telefono: meta.telefono, email: meta.email, contacto: meta.contacto,
      proyecto: meta.proyecto, ubicacion: meta.ubicacion, secciones, anticipo_pct: tipo === 'proyecto' ? anticipo : 0, mostrar_bancos: true,
      firma_nombre: firma.nombre, firma_cargo: firma.cargo, vigencia_dias: 30,
      notas_internas: `Importada desde Excel (${nombre})${codigoOriginal ? ` · número original ${codigoOriginal}` : ''}${fechaTexto ? ` · ${fechaTexto}` : ''}`,
      lineas: lineas.map((l) => ({ producto_id: catalogo.get(normNombre(l.descripcion)) ?? null, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad || (tipo === 'proyecto' ? 'm2' : 'unidad'), precio_unitario: l.precio_unitario })),
    };
    // Reutiliza el guardado normal (numeración, totales, auditoría) capturando su respuesta.
    const resultado = await new Promise((resolve, reject) => {
      const falsa = { status(c) { this.codigo = c; return this; }, json(d) { (this.codigo >= 400 ? reject : resolve)(Object.assign(new Error(d.error ?? 'Error'), { status: this.codigo })); } };
      guardar(Object.assign(Object.create(req), { body }), falsa).catch(reject);
    });
    // Conserva la fecha original de la cotización (para que el historial y la vigencia tengan sentido).
    if (fecha && fecha <= hoyHn()) {
      const vig = sumarDias(fecha, 30);
      await db.from('d_cotizaciones').update({ created_at: `${fecha}T12:00:00-06:00`, fecha_vigencia: vig }).eq('id', resultado.id);
      resultado.created_at = `${fecha}T12:00:00-06:00`;
      resultado.fecha_vigencia = vig;
    }
    await db.from('d_cotizacion_archivos').insert({ cotizacion_id: resultado.id, nombre, contenido: base64 });
    await registrarAuditoria(req, { accion: 'dcotizacion.importar_excel', entidad: 'd_cotizacion', entidadId: resultado.id, sucursalId: resultado.sucursal_id, detalle: { codigo: resultado.codigo, archivo: nombre, original: codigoOriginal } });
    res.status(201).json({ cotizacion: resultado, avisos });
  } catch (e) {
    fallo(res, e);
  }
});

disercoCotizaciones.get('/:id/excel', requireRole(...LEE), async (req, res) => {
  const cot = await cargar(req.params.id);
  if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
  const buf = await generarExcelCotizacion(cot);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="cotizacion-${cot.codigo}.xlsx"`);
  res.send(buf);
});

disercoCotizaciones.get('/:id/excel-original', requireRole(...LEE), async (req, res) => {
  const cot = await cargar(req.params.id);
  if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
  const { data } = await db.from('d_cotizacion_archivos').select('nombre, contenido').eq('cotizacion_id', cot.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return res.status(404).json({ error: 'Esta cotización no tiene un Excel original guardado' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${data.nombre.replace(/[^\w.\- ]/g, '_')}"`);
  res.send(Buffer.from(data.contenido, 'base64'));
});

disercoCotizaciones.get('/:id', requireRole(...LEE), async (req, res) => {
  const cot = await cargar(req.params.id);
  if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
  res.json(cot);
});

disercoCotizaciones.post('/', requireRole(...VENDE), (req, res) => guardar(req, res));
disercoCotizaciones.put('/:id', requireRole(...VENDE), (req, res) => guardar(req, res, req.params.id));

disercoCotizaciones.get('/:id/pdf', requireRole(...LEE), async (req, res) => {
  const cot = await cargar(req.params.id);
  if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
  const pdf = await generarPdfDCotizacion(cot);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="cotizacion-${cot.codigo}.pdf"`);
  res.send(pdf);
});

disercoCotizaciones.post('/:id/correo', requireRole(...VENDE), async (req, res) => {
  try {
    const cot = await cargar(req.params.id);
    if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
    const destino = String(req.body.email ?? cot.email ?? cot.clientes?.email ?? '').trim();
    const r = await enviarCotizacionDiserco(cot, await generarPdfDCotizacion(cot), destino);
    if (!r.enviado) throw err(r.motivo ?? 'No se pudo enviar el correo');
    if (cot.estado === 'borrador') await db.from('d_cotizaciones').update({ estado: 'enviada', updated_at: new Date().toISOString() }).eq('id', cot.id);
    await registrarAuditoria(req, { accion: 'dcotizacion.correo', entidad: 'd_cotizacion', entidadId: cot.id, sucursalId: cot.sucursal_id, detalle: { codigo: cot.codigo, a: destino } });
    res.json({ ok: true, a: destino });
  } catch (e) {
    fallo(res, e);
  }
});

async function cambiarEstado(req, res, { desde, hacia, accion, extra = () => ({}), requiereMotivo = false }) {
  try {
    const motivo = String(req.body?.motivo ?? '').trim();
    if (requiereMotivo && !motivo) throw err('Indica el motivo');
    const cot = await cargar(req.params.id);
    if (!cot || esAjena(req.perfil, cot)) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (!desde.includes(cot.estado)) throw err(`La cotización está ${cot.estado}: no se puede ${accion}`, 409);
    if (hacia === 'anulada' && cot.pagado > 0.004) throw err(`Ya tiene L ${cot.pagado.toFixed(2)} cobrados y facturados: anula primero esas facturas`, 409);
    await db.from('d_cotizaciones').update({ estado: hacia, motivo_cierre: motivo || null, updated_at: new Date().toISOString(), ...extra(req) }).eq('id', cot.id);
    await registrarAuditoria(req, { accion: `dcotizacion.${accion}`, entidad: 'd_cotizacion', entidadId: cot.id, sucursalId: cot.sucursal_id, detalle: { codigo: cot.codigo, motivo } });
    res.json(await cargar(cot.id));
  } catch (e) {
    fallo(res, e);
  }
}

disercoCotizaciones.post('/:id/aprobar', requireRole(...VENDE), (req, res) => cambiarEstado(req, res, { desde: ['borrador', 'enviada'], hacia: 'aprobada', accion: 'aprobar', extra: (r) => ({ aprobada_at: new Date().toISOString(), aprobada_por: r.perfil.id }) }));
disercoCotizaciones.post('/:id/rechazar', requireRole(...VENDE), (req, res) => cambiarEstado(req, res, { desde: ['borrador', 'enviada'], hacia: 'rechazada', accion: 'rechazar', requiereMotivo: true }));
disercoCotizaciones.post('/:id/anular', requireRole(...GERENCIA), (req, res) => cambiarEstado(req, res, { desde: ['aprobada', 'facturada'], hacia: 'anulada', accion: 'anular', requiereMotivo: true }));
disercoCotizaciones.post('/:id/reabrir', requireRole(...GERENCIA), (req, res) => cambiarEstado(req, res, { desde: ['rechazada', 'anulada'], hacia: 'borrador', accion: 'reabrir' }));

// Cobro: registra el pago Y emite su factura (una factura por cada cobro).
//  - Proyecto: anticipo / avance / saldo → cada cobro sale con una factura de ese concepto.
//  - Productos: se cobra completo y la factura lleva el detalle real (descuenta inventario).
disercoCotizaciones.post('/:id/cobros', requireRole(...COBRA), async (req, res) => {
  let ventaId = null;
  try {
    const cot = await cargar(req.params.id);
    if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
    if (cot.estado !== 'aprobada') throw err(cot.estado === 'facturada' ? 'Esta cotización ya está cobrada y facturada completa' : 'Solo se cobra una cotización aprobada', 409);
    const monto = round2(numero(req.body.monto));
    if (!(monto > 0)) throw err('El monto debe ser mayor que 0');
    if (monto > cot.pendiente + 0.004) throw err(`El monto supera el saldo pendiente (L ${cot.pendiente.toFixed(2)})`);
    if (cot.tipo === 'productos' && monto < cot.pendiente - 0.004) throw err(`Una cotización de productos se cobra completa (L ${cot.pendiente.toFixed(2)})`);
    const { data: forma } = await db.from('formas_pago').select('id, nombre').eq('id', req.body.forma_pago_id).maybeSingle();
    if (!forma) throw err('Elige la forma de pago');

    const cliente = cot.clientes ?? {};
    const exento = !!cliente.exento_impuestos;
    const punto = await obtenerPuntoEmisionActivo(cot.sucursal_id);
    const completa = monto >= cot.pendiente - 0.004;
    const previos = cot.pagos.filter((p) => !p.anulado).length;
    let concepto = String(req.body.concepto ?? '').trim();
    if (!concepto) {
      if (cot.tipo === 'productos') concepto = 'Pago total';
      else if (previos === 0 && completa) concepto = 'Pago total';
      else if (completa) concepto = 'Saldo final';
      else if (previos === 0) concepto = `Anticipo ${Math.round((monto / Number(cot.total)) * 100)}%`;
      else concepto = 'Avance de obra';
    }

    let lineasVenta;
    let cabecera;
    if (cot.tipo === 'productos') {
      const calc = totales(cot.lineas, cliente, Number(cot.descuento_pct));
      let exentoSub = 0, gravado = 0;
      calc.lineas.forEach((l) => (l.isv_tasa > 0 ? (gravado += l.base) : (exentoSub += l.base)));
      lineasVenta = cot.lineas.map((l, i) => ({
        producto_id: l.producto_id, nombre_producto: l.descripcion, cantidad: Number(l.cantidad),
        precio_unitario: calc.lineas[i].precio_unitario_con_isv, descuento: calc.lineas[i].descuento_con_isv, descuento_porcentaje: 0,
        impuesto_tasa: calc.lineas[i].isv_tasa, monto: calc.lineas[i].monto,
      }));
      cabecera = { subtotal_exento: round2(exentoSub), subtotal_exonerado: 0, subtotal_gravado_15: round2(gravado), descuento: round2(calc.lineas.reduce((s, l) => s + l.descuento_con_isv, 0)), isv_total: calc.isv, total: calc.total };
      if (Math.abs(calc.total - monto) > 0.01) throw err('El monto no coincide con el total recalculado de la cotización: guárdala de nuevo antes de cobrar', 409);
    } else {
      const tasa = exento ? 0 : TASA;
      const base = tasa > 0 ? round2(monto / (1 + tasa)) : monto;
      lineasVenta = [{ producto_id: null, nombre_producto: `${concepto} — ${cot.proyecto || 'Proyecto'} (Cot. ${cot.codigo})`, cantidad: 1, precio_unitario: monto, descuento: 0, descuento_porcentaje: 0, impuesto_tasa: tasa, monto }];
      cabecera = { subtotal_exento: tasa > 0 ? 0 : monto, subtotal_exonerado: 0, subtotal_gravado_15: tasa > 0 ? base : 0, descuento: 0, isv_total: round2(monto - base), total: monto };
    }

    const { data: venta, error } = await db.from('ventas').insert({
      sucursal_id: cot.sucursal_id, punto_emision_id: punto.id, cliente_id: cot.cliente_id, cajero_id: req.perfil.id, estado: 'abierta', descuento_porcentaje: 0,
      ...cabecera, nota_interna: `Cotización DISERCO ${cot.codigo}${cot.proyecto ? ` · ${cot.proyecto}` : ''} · ${concepto}`,
    }).select().single();
    if (error) throw err(error.message);
    ventaId = venta.id;
    await guardarDetalle(venta.id, lineasVenta);

    const efectivo = forma.nombre === 'Efectivo' ? monto : 0;
    const factura = await facturarVenta(req, venta.id, { pagos: [{ forma_pago_id: forma.id, monto }], efectivo_recibido: efectivo, origen: 'diserco', confirmar_sin_stock: !!req.body.confirmar_sin_stock });

    const { error: errPago } = await db.from('d_cotizacion_pagos').insert({ cotizacion_id: cot.id, concepto, forma_pago_id: forma.id, monto, referencia: req.body.referencia || null, venta_id: venta.id, usuario_id: req.perfil.id });
    if (errPago) console.error('d_cotizacion_pagos', cot.id, errPago.message);
    const nuevoPagado = round2(cot.pagado + monto);
    if (nuevoPagado >= Number(cot.total) - 0.004) await db.from('d_cotizaciones').update({ estado: 'facturada', updated_at: new Date().toISOString() }).eq('id', cot.id);
    await registrarAuditoria(req, { accion: 'dcotizacion.cobro', entidad: 'd_cotizacion', entidadId: cot.id, sucursalId: cot.sucursal_id, detalle: { codigo: cot.codigo, concepto, monto, factura: factura.numero_factura, forma: forma.nombre } });
    res.status(201).json({ factura, cotizacion: await cargar(cot.id) });
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
