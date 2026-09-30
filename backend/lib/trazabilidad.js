import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { db } from '../db.js';
import { EMPRESA, MARCA } from './empresa.js';
import { fechaHn } from './fechas.js';

const fuentes = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const ORDEN_SELECT =
  '*, productos(id, nombre, modelo, color, unidad_venta, m2_por_caja), moldes(codigo, nombre), recetas(nombre), cotizaciones(numero, nombre_cliente, proyecto, estado), operario:perfiles!ordenes_produccion_responsable_id_fkey(nombre), creador:perfiles!ordenes_produccion_creada_por_fkey(nombre)';

const horaHn = (iso) => new Date(iso).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Tegucigalpa' });
const fechaLarga = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('es-HN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const num = (n, d = 2) => Number(n ?? 0).toLocaleString('es-HN', { minimumFractionDigits: 0, maximumFractionDigits: d });

// Texto de cantidad: piedra plana = cajas de m² por caja (1 m²); esquina = cajas de esquina.
export function textoCantidad(orden) {
  const p = orden.productos ?? {};
  const n = Number(orden.m2_bueno ?? orden.m2_planificado);
  if (p.unidad_venta === 'caja') return `${num(n, 0)} cajas de esquina`;
  const porCaja = Number(p.m2_por_caja) || 1;
  return `${num(n, 0)} cajas · ${num(n * porCaja, 2)} m²`;
}

export async function buscarOrden({ id = null, lote = null }) {
  let q = db.from('ordenes_produccion').select(ORDEN_SELECT);
  q = id ? q.eq('id', id) : q.eq('lote', lote);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

export function urlDeLote(req, lote, extra = '') {
  const base = process.env.APP_URL || `${req.headers['x-forwarded-proto'] ?? (req.protocol || 'https')}://${req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'}`;
  return `${base.replace(/\/$/, '')}/?lote=${encodeURIComponent(lote)}${extra}`;
}

// Trazabilidad completa de un lote: hacia atrás (materia prima, operario, calidad)
// y hacia adelante (inventario, reservas, cotizaciones y facturas).
export async function trazarLote(lote) {
  const orden = await buscarOrden({ lote });
  const [{ data: movs }, consumosRes, calidadRes] = await Promise.all([
    db.from('movimientos_pt').select('id, created_at, tipo, calidad, m2, motivo, productos(nombre), perfiles(nombre), cotizaciones(numero, nombre_cliente, estado), ventas(numero_factura)').eq('lote', lote).order('id'),
    orden ? db.from('orden_consumos').select('teorico, real, costo_unitario, mp_id, materias_primas(nombre, unidad, categoria)').eq('orden_id', orden.id) : { data: [] },
    orden ? db.from('controles_calidad').select('prueba, resultado, valor, unidad, notas, created_at, perfiles(nombre)').eq('orden_id', orden.id).order('created_at') : { data: [] },
  ]);
  const consumos = consumosRes.data ?? [];

  // Última compra de cada insumo antes de la colada (proveedor y factura) para rastrear su origen.
  const hasta = orden?.fecha_colado ?? new Date().toISOString();
  const compras = [];
  for (const c of consumos) {
    const { data } = await db.from('movimientos_mp').select('created_at, cantidad, documento, proveedores(nombre)').eq('mp_id', c.mp_id).eq('tipo', 'compra').lte('created_at', hasta).order('created_at', { ascending: false }).limit(1);
    compras.push({ mp_id: c.mp_id, insumo: c.materias_primas?.nombre, ultima_compra: data?.[0] ? { fecha: data[0].created_at, proveedor: data[0].proveedores?.nombre ?? null, factura: data[0].documento ?? null, cantidad: Number(data[0].cantidad) } : null });
  }

  const destinos = new Map();
  for (const m of movs ?? []) {
    if (!m.cotizaciones) continue;
    const k = m.cotizaciones.numero;
    const d = destinos.get(k) ?? { cotizacion: k, cliente: m.cotizaciones.nombre_cliente, estado: m.cotizaciones.estado, reservado: 0, facturas: new Set() };
    if (m.tipo === 'reserva' || m.tipo === 'liberacion') d.reservado += -Number(m.m2);
    if (m.ventas?.numero_factura) d.facturas.add(m.ventas.numero_factura);
    destinos.set(k, d);
  }
  const fisico = (movs ?? []).filter((m) => !['reserva', 'liberacion'].includes(m.tipo)).reduce((s, m) => s + Number(m.m2), 0);
  const reservado = (movs ?? []).filter((m) => ['reserva', 'liberacion'].includes(m.tipo)).reduce((s, m) => s + -Number(m.m2), 0);

  return {
    lote,
    existe_orden: !!orden,
    orden: orden ? {
      id: orden.id, numero: orden.numero, estado: orden.estado, producto: orden.productos?.nombre, modelo: orden.productos?.modelo, color: orden.productos?.color,
      cantidad_registrada: Number(orden.m2_planificado), cantidad_lista: orden.m2_bueno != null ? Number(orden.m2_bueno) : null, segunda: Number(orden.m2_segunda ?? 0), merma: Number(orden.m2_merma ?? 0),
      registrado_at: orden.fecha_colado, disponible_desde: orden.fecha_disponible, lista_at: orden.fecha_terminada, etiqueta_at: orden.etiqueta_at, etiquetas_impresas: orden.etiquetas_impresas,
      operario: orden.operario?.nombre ?? orden.creador?.nombre ?? null, molde: orden.moldes ? `${orden.moldes.codigo} · ${orden.moldes.nombre}` : null, receta: orden.recetas?.nombre ?? null,
      cotizacion_origen: orden.cotizaciones ? { numero: orden.cotizaciones.numero, cliente: orden.cotizaciones.nombre_cliente } : null, notas: orden.notas,
      costo_m2: orden.costo_m2 != null ? Number(orden.costo_m2) : null, costo_mp: orden.costo_mp != null ? Number(orden.costo_mp) : null,
    } : null,
    consumos: consumos.map((c) => ({ insumo: c.materias_primas?.nombre, categoria: c.materias_primas?.categoria, unidad: c.materias_primas?.unidad, teorico: Number(c.teorico), real: c.real != null ? Number(c.real) : null, costo_unitario: Number(c.costo_unitario) })),
    compras,
    calidad: (calidadRes.data ?? []).map((c) => ({ prueba: c.prueba, resultado: c.resultado, valor: c.valor != null ? Number(c.valor) : null, unidad: c.unidad, notas: c.notas, fecha: c.created_at, por: c.perfiles?.nombre ?? null })),
    inventario: { fisico, reservado, disponible: fisico - reservado },
    movimientos: (movs ?? []).map((m) => ({ fecha: m.created_at, tipo: m.tipo, calidad: m.calidad, cantidad: Number(m.m2), detalle: m.motivo, por: m.perfiles?.nombre ?? null, cotizacion: m.cotizaciones?.numero ?? null, cliente: m.cotizaciones?.nombre_cliente ?? null, factura: m.ventas?.numero_factura ?? null })),
    destinos: [...destinos.values()].map((d) => ({ ...d, facturas: [...d.facturas] })),
  };
}

// Etiqueta de lote (o una por caja) — 4 × 6 pulgadas, apta para impresora térmica.
export function generarPdfEtiquetas(orden, { url, modo = 'lote' }) {
  return new Promise(async (resolve, reject) => {
    try {
      const W = 288, H = 432;
      const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Etiqueta ${orden.lote}`, Author: EMPRESA.razonSocial } });
      doc.registerFont('R', path.join(fuentes, 'Poppins-Regular.ttf'));
      doc.registerFont('M', path.join(fuentes, 'Poppins-Medium.ttf'));
      doc.registerFont('B', path.join(fuentes, 'Poppins-Bold.ttf'));
      const salida = new PassThrough();
      const partes = [];
      salida.on('data', (c) => partes.push(c));
      salida.on('end', () => resolve(Buffer.concat(partes)));
      salida.on('error', reject);
      doc.pipe(salida);

      const p = orden.productos ?? {};
      const cantidad = Number(orden.m2_planificado);
      const total = modo === 'cajas' ? Math.min(Math.max(1, Math.round(cantidad)), 500) : 1;
      const registrado = orden.fecha_colado ?? orden.created_at;
      const filas = [
        ['Producto', p.nombre ?? '—'],
        ['Cantidad del lote', textoCantidad({ ...orden, m2_bueno: null })],
        ['Producido', `${fechaLarga(fechaHn(registrado))}  ${horaHn(registrado)}`],
        ['Lista para vender', fechaLarga(orden.fecha_terminada ? fechaHn(orden.fecha_terminada) : orden.fecha_disponible)],
        ['Operario', orden.operario?.nombre ?? orden.creador?.nombre ?? '—'],
        ...(orden.moldes ? [['Molde', orden.moldes.codigo]] : []),
        ...(orden.recetas ? [['Mezcla / receta', orden.recetas.nombre]] : []),
        ['Orden de producción', `#${orden.numero}`],
      ];

      for (let i = 1; i <= total; i++) {
        if (i > 1) doc.addPage({ size: [W, H], margin: 0 });
        doc.rect(0, 0, W, 50).fill(MARCA.grafito);
        doc.rect(0, 50, W, 3).fill(MARCA.musgo);
        doc.fillColor('#fff').font('B').fontSize(19).text('ECOSTONE', 16, 13, { characterSpacing: 2, lineBreak: false });
        doc.fillColor(MARCA.arena).font('M').fontSize(7).text('TRAZABILIDAD DE LOTE', 16, 36, { characterSpacing: 2, lineBreak: false });
        if (modo === 'cajas') doc.fillColor('#fff').font('B').fontSize(12).text(`CAJA ${i} / ${total}`, 0, 19, { width: W - 16, align: 'right', lineBreak: false });

        doc.fillColor(MARCA.gris).font('M').fontSize(7.5).text('LOTE', 16, 62, { lineBreak: false });
        doc.fillColor(MARCA.grafito).font('B').fontSize(25).text(orden.lote, 16, 70, { width: W - 32, lineBreak: false });

        const qr = await QRCode.toBuffer(modo === 'cajas' ? `${url}&caja=${i}` : url, { type: 'png', margin: 1, width: 360, errorCorrectionLevel: 'M' });
        doc.image(qr, W - 16 - 118, 104, { width: 118 });
        doc.fillColor(MARCA.grafito).font('B').fontSize(12).text(p.modelo ?? p.nombre ?? '', 16, 108, { width: W - 32 - 128, height: 32, ellipsis: true });
        doc.fillColor(MARCA.musgoProfundo).font('B').fontSize(15).text(p.color ?? '', 16, 128, { width: W - 32 - 128, height: 22, ellipsis: true });
        doc.fillColor(MARCA.gris).font('R').fontSize(6.5).text('Escanea el código para ver\nla trazabilidad completa', 16, 200, { width: W - 32 - 128, lineGap: 1 });

        let y = 232;
        doc.moveTo(16, y - 6).lineTo(W - 16, y - 6).strokeColor(MARCA.arena).lineWidth(1).stroke();
        for (const [k, v] of filas) {
          doc.fillColor(MARCA.gris).font('M').fontSize(6.8).text(k.toUpperCase(), 16, y, { width: 90, lineBreak: false });
          doc.fillColor(MARCA.grafito).font('M').fontSize(9).text(String(v), 108, y - 1, { width: W - 124, height: 12, ellipsis: true });
          y += 22;
        }
        doc.fillColor(MARCA.gris).font('R').fontSize(6.5).text(`${EMPRESA.razonSocial} · RTN ${EMPRESA.rtn}`, 16, H - 20, { width: W - 32, align: 'center', lineBreak: false });
      }
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
