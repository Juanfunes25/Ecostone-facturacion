import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { EMPRESA, MARCA } from './empresa.js';
import { calcularCotizacion, calcularAnticipo } from './cotizacion.js';

const fuentes = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const L = (n) => `L ${Number(n).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n, d = 2) => Number(n).toLocaleString('es-HN', { minimumFractionDigits: 0, maximumFractionDigits: d });
const fecha = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString('es-HN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');

// Cotización de proyecto en PDF de marca EcoStone (carta).
export function generarPdfCotizacionBuffer(cot, lineas, cliente = null) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 44, info: { Title: `Cotización ${cot.numero} — ${EMPRESA.marca}`, Author: EMPRESA.razonSocial } });
    doc.registerFont('R', path.join(fuentes, 'Poppins-Regular.ttf'));
    doc.registerFont('M', path.join(fuentes, 'Poppins-Medium.ttf'));
    doc.registerFont('B', path.join(fuentes, 'Poppins-Bold.ttf'));
    const salida = new PassThrough();
    const partes = [];
    salida.on('data', (c) => partes.push(c));
    salida.on('end', () => resolve(Buffer.concat(partes)));
    salida.on('error', reject);
    doc.pipe(salida);

    const calc = calcularCotizacion(lineas, { isv_incluido: cot.isv_incluido, descuento: Number(cot.descuento || 0), descuento_pct: Number(cot.descuento_pct || 0), cliente_exento: !!cliente?.exento_impuestos });
    const ancho = doc.page.width - 88;

    // Encabezado
    doc.rect(0, 0, doc.page.width, 92).fill(MARCA.grafito);
    doc.rect(0, 92, doc.page.width, 4).fill(MARCA.musgo);
    doc.fillColor('#fff').font('B').fontSize(26).text('ECOSTONE', 44, 26, { characterSpacing: 3 });
    doc.fillColor(MARCA.arena).font('M').fontSize(9).text('PIEDRA DE ENCHAPE', 46, 58, { characterSpacing: 4 });
    doc.fillColor('#fff').font('B').fontSize(14).text(`COTIZACIÓN #${cot.numero}`, 44, 28, { align: 'right', width: ancho });
    doc.font('R').fontSize(9).fillColor(MARCA.arena).text(`Emitida: ${fecha(cot.created_at)}`, 44, 50, { align: 'right', width: ancho }).text(`Vigencia: ${fecha(cot.fecha_vigencia)}`, 44, 63, { align: 'right', width: ancho });

    // Datos
    let y = 116;
    doc.fillColor(MARCA.grafito).font('B').fontSize(10).text('CLIENTE', 44, y);
    doc.font('R').fontSize(10).text(cot.nombre_cliente, 44, y + 14);
    if (cot.rtn_cliente) doc.text(`RTN: ${cot.rtn_cliente}`);
    if (cot.telefono) doc.text(`Tel: ${cot.telefono}`);
    if (cot.proyecto || cot.direccion_obra || cot.fecha_entrega) {
      doc.font('B').fontSize(10).text('PROYECTO', 320, y);
      doc.font('R').text(cot.proyecto || '—', 320, y + 14, { width: 248 });
      if (cot.direccion_obra) doc.text(cot.direccion_obra, 320, doc.y, { width: 248 });
      if (cot.fecha_entrega) doc.text(`Entrega estimada: ${fecha(cot.fecha_entrega)}`, 320, doc.y, { width: 248 });
    }
    y = Math.max(doc.y, y + 62) + 14;

    // Tabla
    const cols = [44, 250, 318, 372, 452];
    const encabezado = (yy) => {
      doc.rect(44, yy, ancho, 20).fill(MARCA.grafito);
      doc.fillColor('#fff').font('M').fontSize(8.5);
      doc.text('DESCRIPCIÓN', cols[0] + 6, yy + 6);
      doc.text('CANT.', cols[1], yy + 6, { width: 60, align: 'right' });
      doc.text('UNIDAD', cols[2] + 8, yy + 6);
      doc.text(cot.isv_incluido ? 'PRECIO (c/ISV)' : 'PRECIO (s/ISV)', cols[3], yy + 6, { width: 76, align: 'right' });
      doc.text('IMPORTE', cols[4], yy + 6, { width: 116, align: 'right' });
      return yy + 24;
    };
    y = encabezado(y);
    lineas.forEach((l, i) => {
      const detalle = [l.descripcion, l.m2_neto && l.cajas ? `${num(l.m2_neto, 2)} m² → ${num(l.cajas, 0)} cajas completas` : null].filter(Boolean);
      const alto = 16 + (detalle.length - 1) * 11;
      if (y + alto > doc.page.height - 200) { doc.addPage(); y = encabezado(44); }
      if (i % 2 === 0) doc.rect(44, y - 3, ancho, alto + 2).fill(MARCA.crema);
      doc.fillColor(MARCA.grafito).font('M').fontSize(9).text(detalle[0], cols[0] + 6, y, { width: 196 });
      if (detalle[1]) doc.font('R').fontSize(7.5).fillColor(MARCA.gris).text(detalle[1], cols[0] + 6, y + 11, { width: 196 });
      doc.fillColor(MARCA.grafito).font('R').fontSize(9);
      doc.text(num(l.cantidad, 3), cols[1], y, { width: 60, align: 'right' });
      doc.text(l.unidad, cols[2] + 8, y);
      doc.text(L(l.precio_unitario) + (Number(l.descuento_pct) ? ` (-${num(l.descuento_pct, 1)}%)` : ''), cols[3] - 10, y, { width: 86, align: 'right' });
      const c = calc.lineas[i];
      doc.font('M').text(L(cot.isv_incluido ? c.monto : c.base), cols[4], y, { width: 116, align: 'right' });
      y += alto + 6;
    });

    // Totales
    y += 6;
    if (y > doc.page.height - 190) { doc.addPage(); y = 50; }
    const fila = (t, v, fuerte = false) => {
      doc.font(fuerte ? 'B' : 'R').fontSize(fuerte ? 12 : 9.5).fillColor(MARCA.grafito).text(t, 330, y, { width: 110 }).text(v, 440, y, { width: 128, align: 'right' });
      y += fuerte ? 20 : 15;
    };
    if (calc.descuento_total > 0) fila(Number(cot.descuento_pct) > 0 ? `Descuento ${num(cot.descuento_pct, 2)}%` : 'Descuento', `- ${L(calc.descuento_total)}`);
    fila('Subtotal', L(calc.subtotal));
    fila('ISV 15%', L(calc.isv));
    doc.moveTo(330, y).lineTo(568, y).strokeColor(MARCA.musgo).lineWidth(1.2).stroke(); y += 5;
    fila('TOTAL', L(calc.total), true);
    const { anticipo, saldo } = calcularAnticipo(calc.total, cot.anticipo_pct);
    if (Number(cot.anticipo_pct) > 0) {
      fila(`Anticipo ${num(cot.anticipo_pct, 0)}%`, L(anticipo));
      fila('Saldo contra entrega', L(saldo));
    }

    // Condiciones y pie
    y = Math.max(y + 10, doc.y);
    doc.fillColor(MARCA.grafito).font('B').fontSize(9).text('CONDICIONES', 44, y);
    doc.font('R').fontSize(8).fillColor(MARCA.gris);
    for (const c of EMPRESA.condicionesCotizacion) doc.text(`• ${c}`, 44, doc.y + 2, { width: 280 });
    if (cot.notas) doc.text(`Notas: ${cot.notas}`, 44, doc.y + 4, { width: 280 });
    doc.fontSize(8).fillColor(MARCA.gris).text(`${EMPRESA.razonSocial} · RTN ${EMPRESA.rtn} · ${EMPRESA.ciudad}`, 44, doc.page.height - 50, { width: ancho, align: 'center' });
    doc.end();
  });
}
