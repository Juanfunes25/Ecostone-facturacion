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

// Cotización en PDF de marca EcoStone. SIEMPRE una sola página (carta): si hay
// muchas líneas, las filas y la letra se reducen para que todo quepa.
export function generarPdfCotizacionBuffer(cot, lineas, cliente = null) {
  return new Promise((resolve, reject) => {
    // Márgenes verticales en 0: todo se posiciona a mano y nunca se abre otra hoja.
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 0, bottom: 0, left: 44, right: 44 }, info: { Title: `Cotización ${cot.numero} — ${EMPRESA.marca}`, Author: EMPRESA.razonSocial } });
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
    const W = doc.page.width;
    const H = doc.page.height;
    const ancho = W - 88;

    // ── Encabezado ──
    doc.rect(0, 0, W, 92).fill(MARCA.grafito);
    doc.rect(0, 92, W, 4).fill(MARCA.musgo);
    doc.fillColor('#fff').font('B').fontSize(26).text('ECOSTONE', 44, 26, { characterSpacing: 3, lineBreak: false });
    doc.fillColor(MARCA.arena).font('M').fontSize(9).text('PIEDRA DE ENCHAPE', 46, 58, { characterSpacing: 4, lineBreak: false });
    doc.fillColor('#fff').font('B').fontSize(14).text(`COTIZACIÓN #${cot.numero}`, 44, 28, { align: 'right', width: ancho, lineBreak: false });
    doc.font('R').fontSize(9).fillColor(MARCA.arena).text(`Emitida: ${fecha(cot.created_at)}`, 44, 50, { align: 'right', width: ancho, lineBreak: false }).text(`Vigencia: ${fecha(cot.fecha_vigencia)}`, 44, 63, { align: 'right', width: ancho, lineBreak: false });

    // ── Cliente (y proyecto, si lo hay) ──
    let y = 112;
    doc.fillColor(MARCA.grafito).font('B').fontSize(10).text('CLIENTE', 44, y, { lineBreak: false });
    doc.font('R').fontSize(10);
    let yc = y + 14;
    for (const t of [cot.nombre_cliente, cot.rtn_cliente && `RTN: ${cot.rtn_cliente}`, cot.telefono && `Tel: ${cot.telefono}`, cot.email]) {
      if (!t) continue;
      doc.text(String(t), 44, yc, { width: 260, height: 13, ellipsis: true });
      yc += 13;
    }
    let yp = y;
    if (cot.proyecto || cot.direccion_obra || cot.fecha_entrega) {
      doc.font('B').fontSize(10).text('PROYECTO', 320, y, { lineBreak: false });
      yp = y + 14;
      doc.font('R');
      for (const t of [cot.proyecto, cot.direccion_obra, cot.fecha_entrega && `Entrega estimada: ${fecha(cot.fecha_entrega)}`]) {
        if (!t) continue;
        doc.text(String(t), 320, yp, { width: 248, height: 13, ellipsis: true });
        yp += 13;
      }
    }
    y = Math.max(yc, yp, y + 40) + 12;

    // ── Espacio disponible para tabla + totales + condiciones ──
    const tieneAnticipo = Number(cot.anticipo_pct) > 0;
    const filasTotales = 2 + (calc.descuento_total > 0 ? 1 : 0) + (tieneAnticipo ? 2 : 0);
    const altoTotales = filasTotales * 15 + 34;
    const condiciones = EMPRESA.condicionesCotizacion;
    const altoCond = 22 + condiciones.length * 12 + (cot.notas ? 24 : 0);
    const pie = 44; // franja del pie de página
    // Con muchas líneas se compacta: sin el renglón de cajas y con letra más chica.
    let compacto = false;
    const detalleDe = (l) => (!compacto && l.m2_neto && l.cajas ? `${num(l.m2_neto, 2)} m² → ${num(l.cajas, 0)} cajas completas` : null);
    const altoFilasBase = () => lineas.reduce((s, l) => s + (detalleDe(l) ? 35 : 24), 0);
    const disponible = H - pie - y - 24 /* encabezado de tabla */;
    let mostrarCond = true;
    let ratio = (disponible - altoTotales - altoCond) / Math.max(1, altoFilasBase());
    if (ratio < 0.6) {
      compacto = true;
      ratio = (disponible - altoTotales - altoCond) / Math.max(1, altoFilasBase());
    }
    if (ratio < 0.5) {
      mostrarCond = false; // muchísimas líneas: se sacrifican las condiciones antes que abrir otra hoja
      ratio = (disponible - altoTotales) / Math.max(1, altoFilasBase());
    }
    const escala = Math.min(1, Math.max(0.3, ratio));
    const fs = (n) => Math.max(6, n * escala);
    const limiteFilas = H - pie - altoTotales - 4;

    // ── Tabla ──
    const cols = [44, 250, 318, 372, 452];
    doc.rect(44, y, ancho, 20).fill(MARCA.grafito);
    doc.fillColor('#fff').font('M').fontSize(8.5);
    doc.text('DESCRIPCIÓN', cols[0] + 6, y + 6, { lineBreak: false });
    doc.text('CANT.', cols[1], y + 6, { width: 60, align: 'right', lineBreak: false });
    doc.text('UNIDAD', cols[2] + 8, y + 6, { lineBreak: false });
    doc.text(cot.isv_incluido ? 'PRECIO (c/ISV)' : 'PRECIO (s/ISV)', cols[3], y + 6, { width: 76, align: 'right', lineBreak: false });
    doc.text('IMPORTE', cols[4], y + 6, { width: 116, align: 'right', lineBreak: false });
    y += 24;

    let omitidas = 0;
    lineas.forEach((l, i) => {
      const detalle = detalleDe(l);
      const alto = (detalle ? 35 : 24) * escala;
      if (y + alto > limiteFilas) { omitidas++; return; } // nunca se abre una segunda hoja
      if (i % 2 === 0) doc.rect(44, y - 3, ancho, alto).fill(MARCA.crema);
      doc.fillColor(MARCA.grafito).font('M').fontSize(fs(9)).text(String(l.descripcion), cols[0] + 6, y, { width: 196, height: fs(11), ellipsis: true });
      if (detalle) doc.font('R').fontSize(fs(7.5)).fillColor(MARCA.gris).text(detalle, cols[0] + 6, y + fs(11), { width: 196, height: fs(9), ellipsis: true });
      doc.fillColor(MARCA.grafito).font('R').fontSize(fs(9));
      const c = calc.lineas[i];
      doc.text(num(l.cantidad, 3), cols[1], y, { width: 60, align: 'right', lineBreak: false });
      doc.text(String(l.unidad), cols[2] + 8, y, { lineBreak: false });
      doc.text(L(l.precio_unitario) + (Number(l.descuento_pct) ? ` (-${num(l.descuento_pct, 1)}%)` : ''), cols[3] - 10, y, { width: 86, align: 'right', lineBreak: false });
      doc.font('M').text(L(cot.isv_incluido ? c.monto : c.base), cols[4], y, { width: 116, align: 'right', lineBreak: false });
      y += alto;
    });

    if (omitidas) {
      doc.fillColor(MARCA.gris).font('R').fontSize(7.5).text(`… y ${omitidas} línea(s) más (ver el detalle completo en el sistema)`, 50, y, { width: ancho, lineBreak: false });
      y += 10;
    }

    // ── Totales ──
    y += 8;
    const fila = (t, v, fuerte = false) => {
      doc.font(fuerte ? 'B' : 'R').fontSize(fuerte ? 12 : 9.5).fillColor(MARCA.grafito).text(t, 330, y, { width: 110, lineBreak: false }).text(v, 440, y, { width: 128, align: 'right', lineBreak: false });
      y += fuerte ? 20 : 15;
    };
    if (calc.descuento_total > 0) fila(Number(cot.descuento_pct) > 0 ? `Descuento ${num(cot.descuento_pct, 2)}%` : 'Descuento', `- ${L(calc.descuento_total)}`);
    fila('Subtotal', L(calc.subtotal));
    fila('ISV 15%', L(calc.isv));
    doc.moveTo(330, y).lineTo(568, y).strokeColor(MARCA.musgo).lineWidth(1.2).stroke();
    y += 5;
    fila('TOTAL', L(calc.total), true);
    if (tieneAnticipo) {
      const { anticipo, saldo } = calcularAnticipo(calc.total, cot.anticipo_pct);
      fila(`Anticipo ${num(cot.anticipo_pct, 0)}%`, L(anticipo));
      fila('Saldo contra entrega', L(saldo));
    }

    // ── Condiciones ──
    if (mostrarCond) {
      let yy = Math.max(y + 8, 0);
      doc.fillColor(MARCA.grafito).font('B').fontSize(9).text('CONDICIONES', 44, yy, { lineBreak: false });
      yy += 13;
      doc.font('R').fontSize(8).fillColor(MARCA.gris);
      for (const c of condiciones) {
        doc.text(`• ${c}`, 44, yy, { width: 300, lineBreak: false });
        yy += 12;
      }
      if (cot.notas) doc.text(`Notas: ${cot.notas}`, 44, yy + 2, { width: 300, height: 22, ellipsis: true });
    }

    // ── Pie ──
    doc.fontSize(8).fillColor(MARCA.gris).font('R').text(`${EMPRESA.razonSocial} · RTN ${EMPRESA.rtn} · ${EMPRESA.ciudad}`, 44, H - 30, { width: ancho, align: 'center', lineBreak: false });
    doc.end();
  });
}
