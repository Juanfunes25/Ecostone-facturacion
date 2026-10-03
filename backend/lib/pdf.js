import PDFDocument from 'pdfkit';
import { PassThrough } from 'node:stream';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { montoEnLetras } from './numeroLetras.js';
import { EMPRESA } from './empresa.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const logoDe = (codigo) => fileURLToPath(new URL(`../assets/${codigo}-logo.png`, import.meta.url));
const lempiras = (n) => `L ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fechaLarga = (iso) => {
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date(iso)).split('-');
  return `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`;
};
const fechaCorta = (f) => (f ? String(f).slice(0, 10).split('-').reverse().join('/') : '');

// Factura grande tamaño carta (la que se entrega al cliente), en lempiras.
export function generarPdfFactura(venta, res) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 40, info: { Title: `Factura ${venta.numero_factura ?? ''}`, Author: EMPRESA.razonSocial } });
  doc.pipe(res);
  const izq = 40;
  const der = 572;
  const pe = venta.puntos_emision;
  const borrador = !!pe?.es_borrador;

  // Datos de la empresa que emite (EcoStone o DISERCO, según la sucursal de la factura).
  const emp = venta.empresa_datos ?? { codigo: 'ecostone', nombre: EMPRESA.marca, razon_social: EMPRESA.razonSocial, rtn: EMPRESA.rtn, direccion: EMPRESA.direccion, ciudad: EMPRESA.ciudad, telefono: EMPRESA.telefono, correo: EMPRESA.correo, color: '#3f5433' };
  const logo = logoDe(emp.codigo);
  if (existsSync(logo)) doc.image(logo, izq, 34, { fit: [90, 90] });
  else doc.font('Helvetica-Bold').fontSize(20).fillColor(emp.color || '#3f5433').text(String(emp.nombre).toUpperCase(), izq, 48, { width: 150 }).fillColor('black');

  // Datos del emisor (centro)
  doc.font('Helvetica-Bold').fontSize(13).text(String(emp.razon_social).toUpperCase(), 140, 34, { width: 290, align: 'center' });
  doc.font('Helvetica').fontSize(8);
  doc.text(`${emp.direccion ?? ''} ${emp.ciudad ?? ''}`, 140, doc.y + 2, { width: 290, align: 'center' });
  if (emp.telefono) doc.text(`Teléfono: ${emp.telefono}`, { width: 290, align: 'center' });
  doc.text(`RTN: ${emp.rtn || '[PENDIENTE]'}`, { width: 290, align: 'center' });
  if (emp.correo) doc.text(emp.correo, { width: 290, align: 'center' });
  if (!borrador && pe?.cai) doc.text(`CAI: ${pe.cai}`, { width: 290, align: 'center' });

  // Número, fecha y rango autorizado (derecha)
  doc.font('Helvetica-Bold').fontSize(9).text('Número de Factura #', 430, 34, { width: 142 });
  doc.fontSize((venta.numero_factura ?? '').length > 22 ? 7.5 : 9.5).text(venta.numero_factura ?? '', { width: 142 });
  doc.font('Helvetica').fontSize(8.5).text(`Fecha: ${fechaLarga(venta.fecha_emision)}`, 430, 66, { width: 142 });
  if (!borrador && pe) {
    const prefijo = `${pe.punto_emision_codigo}-${pe.punto_venta_codigo}-${pe.tipo_documento_codigo}-`;
    const num8 = (n) => String(n).padStart(8, '0');
    doc.fontSize(8);
    if (pe.fecha_limite_emision) doc.text(`Fecha máxima de emisión: ${fechaCorta(pe.fecha_limite_emision)}`, 430, 82, { width: 142 });
    doc.text(`Rango autorizado: ${prefijo}${num8(pe.correlativo_desde)} a ${num8(pe.correlativo_hasta)}`, 430, doc.y + 2, { width: 142 });
  }

  const rotulo = emp.codigo === 'diserco' ? 'Importe' : 'Total';
  let y = 128;
  if (borrador) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('red').text('DOCUMENTO SIN VALIDEZ FISCAL — CAI pendiente de confirmar con el SAR', izq, y, { width: der - izq, align: 'center' }).fillColor('black');
    y += 22;
  }

  // Cliente
  doc.font('Helvetica').fontSize(9.5);
  doc.text(`Nombre del Cliente: ${venta.clientes?.nombre || 'Consumidor Final'}`, izq, y, { width: der - izq });
  doc.text(`Dirección del Cliente: ${venta.clientes?.direccion || '--------------------'}`, izq, doc.y + 4, { width: der - izq });
  doc.text(`RTN del Cliente: ${venta.clientes?.rtn || '--------------------'}`, izq, doc.y + 4, { width: der - izq });
  y = doc.y + 14;

  // Tabla de productos
  const colCant = { x: izq, w: 55 };
  const colDesc = { x: izq + 65, w: 280 };
  const colPrecio = { x: 400, w: 80 };
  const colTotal = { x: 485, w: der - 485 };
  const encabezado = () => {
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Cantidad', colCant.x, y, { width: colCant.w });
    doc.text('Descripción', colDesc.x, y, { width: colDesc.w });
    doc.text('Precio', colPrecio.x, y, { width: colPrecio.w, align: 'right' });
    doc.text('Total', colTotal.x, y, { width: colTotal.w, align: 'right' });
    y += 16;
    doc.moveTo(izq, y).lineTo(der, y).lineWidth(0.6).stroke();
    y += 6;
    doc.font('Helvetica').fontSize(9.5);
  };
  encabezado();

  let descuentos = 0;
  for (const item of venta.detalle ?? []) {
    const tasa = Number(item.impuesto_tasa) || 0;
    const sinIsv = (n) => (tasa > 0 ? Number(n) / (1 + tasa) : Number(n));
    const precio = sinIsv(item.precio_unitario);
    const total = precio * Number(item.cantidad);
    descuentos += sinIsv(item.descuento || 0);
    if (y > 650) { doc.addPage(); y = 50; encabezado(); }
    const nombre = `${item.nombre_producto}${tasa > 0 ? ' (ISV - 15%)' : ''}`;
    const alto = doc.heightOfString(nombre, { width: colDesc.w });
    doc.text(String(Number(item.cantidad)), colCant.x, y, { width: colCant.w, align: 'center' });
    doc.text(nombre, colDesc.x, y, { width: colDesc.w });
    doc.text(lempiras(precio), colPrecio.x, y, { width: colPrecio.w, align: 'right' });
    doc.text(lempiras(total), colTotal.x, y, { width: colTotal.w, align: 'right' });
    y += Math.max(alto, 12) + 6;
  }
  doc.moveTo(izq, y).lineTo(der, y).lineWidth(0.6).stroke();
  y += 14;

  // Totales (a la derecha) y agradecimiento (a la izquierda)
  if (y > 560) { doc.addPage(); y = 50; }
  const yTotales = y;
  doc.font('Helvetica').fontSize(8.5).text('Agradecemos su preferencia. Esperamos seguir colaborando con usted en el futuro.\nLa factura es beneficio de todos, exíjala.', izq, yTotales, { width: 230 });
  const fila = (etiqueta, monto, negrita = false) => {
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5);
    doc.text(etiqueta, 300, y, { width: 175, align: 'right' });
    doc.text(lempiras(monto), colTotal.x - 10, y, { width: colTotal.w + 10, align: 'right' });
    y += 16;
  };
  fila(`${rotulo} Venta Exento`, venta.subtotal_exento);
  fila(`${rotulo} Venta Exonerada`, venta.subtotal_exonerado);
  fila(`${rotulo} Venta ISV - 15%`, venta.subtotal_gravado_15);
  fila('ISV - 15%', venta.isv_total);
  fila('Descuentos y Rebajas', descuentos);
  y += 2;
  fila('Total Número de Factura', venta.total, true);
  doc.font('Helvetica').fontSize(8.5).text(montoEnLetras(venta.total), 300, y, { width: der - 300, align: 'right' });
  if (venta.anulada) {
    doc.font('Helvetica-Bold').fontSize(26).fillColor('red').text('ANULADA', izq, yTotales + 60, { width: 230, align: 'center' }).fillColor('black');
  }

  doc.end();
}

// Igual que generarPdfFactura pero devuelve el PDF como Buffer en memoria
// (para adjuntarlo a un correo) en vez de escribirlo directo a una
// respuesta HTTP.
export function generarPdfFacturaBuffer(venta) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const partes = [];
    stream.on('data', (chunk) => partes.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(partes)));
    stream.on('error', reject);
    generarPdfFactura(venta, stream);
  });
}
