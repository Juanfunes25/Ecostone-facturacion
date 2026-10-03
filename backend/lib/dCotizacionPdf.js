import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { DISERCO } from './disercoConfig.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const fuentes = path.join(aqui, '..', 'assets', 'fonts');
const LOGO = path.join(aqui, '..', 'assets', 'diserco-logo.png');
const NARANJA = DISERCO.naranja;
const GRIS = '#555555';
const L = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cant = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 3 });
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function partesFecha(iso) {
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(new Date(iso)).split('-').map(Number);
  const dia = DIAS[new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()];
  return { a, m: MESES[m - 1], d, dia };
}
const fechaProyecto = (iso) => { const f = partesFecha(iso); return `San Pedro Sula, ${f.d} de ${f.m[0].toUpperCase()}${f.m.slice(1)} del ${f.a}`; };
const fechaProductos = (iso) => { const f = partesFecha(iso); return `${f.dia} ${f.d} de ${f.m} de ${f.a}`; };

// Cotización DISERCO en PDF. Dos formatos (los de sus ejemplos):
//  - proyecto: tabla Área × Valor por m², secciones de texto y firma.
//  - productos: Cantidad / Presentación / P. unitario, rendimientos e información bancaria.
export function generarPdfDCotizacion(cot) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 0, bottom: 0, left: 52, right: 52 }, bufferPages: true, info: { Title: `Cotización ${cot.codigo} — DISERCO`, Author: 'DISERCO' } });
    doc.registerFont('R', path.join(fuentes, 'Poppins-Regular.ttf'));
    doc.registerFont('M', path.join(fuentes, 'Poppins-Medium.ttf'));
    doc.registerFont('B', path.join(fuentes, 'Poppins-Bold.ttf'));
    const salida = new PassThrough();
    const partes = [];
    salida.on('data', (c) => partes.push(c));
    salida.on('end', () => resolve(Buffer.concat(partes)));
    salida.on('error', reject);
    doc.pipe(salida);

    const izq = 52;
    const ancho = 508;
    const LIMITE = 735;
    const esProyecto = cot.tipo === 'proyecto';
    let y = 38;
    const nuevaPagina = () => { doc.addPage(); y = 50; };
    const asegurar = (alto) => { if (y + alto > LIMITE) nuevaPagina(); };

    // Encabezado
    doc.font('B').fontSize(17).fillColor('#111').text('COTIZACIÓN', izq, y, { lineBreak: false });
    doc.font('B').fontSize(11).fillColor(NARANJA).text(`No. ${cot.codigo}`, izq, y + 22, { lineBreak: false });
    try { doc.image(LOGO, izq + ancho - 92, 30, { fit: [92, 92] }); } catch { /* sin logo */ }
    y = 112;
    doc.font('R').fontSize(9.5).fillColor('#111');
    const creada = cot.created_at ?? new Date().toISOString();

    if (esProyecto) {
      doc.text(fechaProyecto(creada), izq, y, { lineBreak: false });
      y += 28;
      for (const [k, v] of [['Proyecto:', cot.proyecto], ['Cliente:', cot.nombre_cliente], ['Ubicación :', cot.ubicacion]]) {
        if (!v) continue;
        doc.font('R').text(k, izq, y, { lineBreak: false });
        doc.font('R').text(v, izq + 66, y, { width: 330, lineBreak: false });
        y += 14;
      }
      y += 14;
    } else {
      doc.text('San Pedro Sula,', izq, y, { lineBreak: false });
      doc.text(fechaProductos(creada), izq + 90, y, { lineBreak: false });
      y += 24;
      doc.text('Para:', izq, y, { lineBreak: false });
      doc.text(cot.contacto || cot.nombre_cliente, izq + 90, y, { lineBreak: false });
      y += 14;
      if (cot.contacto && cot.nombre_cliente && cot.contacto !== cot.nombre_cliente) { doc.text('Empresa:', izq, y, { lineBreak: false }); doc.text(cot.nombre_cliente, izq + 90, y, { lineBreak: false }); y += 14; }
      if (cot.rtn_cliente) { doc.text('RTN:', izq, y, { lineBreak: false }); doc.text(cot.rtn_cliente, izq + 90, y, { lineBreak: false }); y += 14; }
      if (cot.telefono) { doc.text('Cel:', izq, y, { lineBreak: false }); doc.text(cot.telefono, izq + 90, y, { lineBreak: false }); y += 14; }
      y += 16;
    }

    // Tabla
    const cols = esProyecto
      ? [{ k: 'n', w: 20, t: '', a: 'center' }, { k: 'desc', w: 250, t: 'DESCRIPCIÓN', a: 'left' }, { k: 'cant', w: 50, t: 'Área', a: 'center' }, { k: 'uni', w: 42, t: 'Unidad', a: 'center' }, { k: 'precio', w: 70, t: 'Valor x m2', a: 'right' }, { k: 'total', w: 76, t: 'TOTAL', a: 'right' }]
      : [{ k: 'desc', w: 238, t: 'DESCRIPCIÓN', a: 'left' }, { k: 'cant', w: 62, t: 'CANTIDAD', a: 'center' }, { k: 'uni', w: 66, t: 'PRESENTACIÓN', a: 'center' }, { k: 'precio', w: 70, t: 'P/ UNITARIO', a: 'right' }, { k: 'total', w: 72, t: 'SUBTOTAL', a: 'right' }];
    const xCol = [];
    let acc = izq;
    for (const c of cols) { xCol.push(acc); acc += c.w; }
    const pie = ancho - cols.reduce((s, c) => s + c.w, 0);
    if (pie) cols[cols.findIndex((c) => c.k === 'desc')].w += pie, xCol.forEach((_, i) => { if (i > cols.findIndex((c) => c.k === 'desc')) xCol[i] += pie; });

    const encabezado = () => {
      if (esProyecto) {
        doc.rect(izq + cols[0].w, y, ancho - cols[0].w, 15).fill(NARANJA);
        doc.fillColor('#fff').font('B').fontSize(8.5);
      } else {
        doc.fillColor('#111').font('R').fontSize(8);
      }
      cols.forEach((c, i) => { if (c.t) doc.text(c.t, xCol[i] + 3, y + (esProyecto ? 3.5 : 3), { width: c.w - 6, align: c.a === 'left' && esProyecto ? 'center' : c.a, lineBreak: false }); });
      y += 15;
      if (!esProyecto) { doc.moveTo(izq, y).lineTo(izq + ancho, y).lineWidth(1.3).strokeColor(NARANJA).stroke(); y += 3; }
      doc.fillColor('#111');
    };
    encabezado();

    cot.lineas.forEach((l, i) => {
      const desc = String(l.descripcion);
      doc.font('R').fontSize(esProyecto ? 9 : 9.5);
      const alto = Math.max(doc.heightOfString(desc, { width: cols[esProyecto ? 1 : 0].w - 8 }) + 10, 22);
      if (y + alto > LIMITE) { nuevaPagina(); encabezado(); }
      const valores = { n: String(i + 1), cant: cant(l.cantidad), uni: esProyecto ? l.unidad : (l.presentacion || l.unidad), precio: `L ${L(l.precio_unitario)}`, total: `L ${L(Number(l.cantidad) * Number(l.precio_unitario))}` };
      if (esProyecto) {
        doc.lineWidth(0.6).strokeColor('#333');
        cols.forEach((c, ci) => doc.rect(xCol[ci], y, c.w, alto).stroke());
        const ocupada = /^[^.]{4,90}\.\s/.exec(desc);
        const dx = xCol[1] + 4;
        if (ocupada) {
          doc.font('B').fontSize(9).text(ocupada[0].trimEnd() + ' ', dx, y + 5, { width: cols[1].w - 8, continued: true }).font('R').text(desc.slice(ocupada[0].length));
        } else doc.font('R').fontSize(9).text(desc, dx, y + 5, { width: cols[1].w - 8 });
        doc.font('R').fontSize(9);
        cols.forEach((c, ci) => { if (c.k !== 'desc') doc.text(valores[c.k], xCol[ci] + 3, y + alto / 2 - 5, { width: c.w - 6, align: c.a, lineBreak: false }); });
      } else {
        doc.font('R').fontSize(9.5);
        cols.forEach((c, ci) => { doc.text(c.k === 'desc' ? desc : valores[c.k], xCol[ci] + (c.k === 'desc' ? 0 : 3), y + 4, c.k === 'desc' ? { width: c.w - 8 } : { width: c.w - 6, align: c.a, lineBreak: false }); });
      }
      y += alto;
    });
    if (!esProyecto) { y += 10; doc.moveTo(izq, y).lineTo(izq + ancho, y).lineWidth(0.8).strokeColor(NARANJA).stroke(); }

    // Totales
    const subtotal = Number(cot.subtotal);
    const bruto = cot.lineas.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario), 0);
    const descuentoMonto = Number(cot.descuento_pct) > 0 ? Math.round(bruto * Number(cot.descuento_pct)) / 100 : 0;
    asegurar(80);
    y += esProyecto ? 0 : 10;
    const filasTot = [[esProyecto ? 'Sub total' : 'SUB TOTAL', subtotal]];
    if (descuentoMonto > 0.004) filasTot.unshift([esProyecto ? 'Descuento' : 'DESCUENTO', -descuentoMonto]);
    filasTot.push([esProyecto ? 'ISV' : 'IMPUESTO', Number(cot.isv)]);
    if (esProyecto) filasTot.push(['Total', Number(cot.total)]);
    const wEt = 74, wVal = 90;
    filasTot.forEach(([et, val], i) => {
      const yy = y + i * 15;
      const x0 = izq + ancho - wEt - wVal;
      if (esProyecto) {
        doc.rect(x0, yy, wEt, 15).fill(NARANJA);
        doc.fillColor('#fff').font('B').fontSize(8.5).text(et, x0, yy + 3.5, { width: wEt, align: 'center', lineBreak: false });
        doc.rect(x0 + wEt, yy, wVal, 15).lineWidth(0.6).strokeColor('#333').stroke();
        doc.fillColor('#111').font('R').fontSize(9).text('L', x0 + wEt + 5, yy + 3.5, { lineBreak: false });
        doc.text(L(val), x0 + wEt, yy + 3.5, { width: wVal - 6, align: 'right', lineBreak: false });
      } else {
        doc.fillColor(NARANJA).font('B').fontSize(8.5).text(et, x0 - 40, yy + 3, { width: wEt + 40, align: 'right', lineBreak: false });
        doc.fillColor('#111').font('R').fontSize(9.5).text('L', x0 + wEt + 12, yy + 3, { lineBreak: false });
        doc.text(L(val), x0 + wEt, yy + 3, { width: wVal, align: 'right', lineBreak: false });
      }
    });
    y += filasTot.length * 15 + 14;

    // Secciones de texto
    for (const s of cot.secciones ?? []) {
      const titulo = String(s.titulo ?? '').trim();
      const texto = String(s.texto ?? '').trim();
      if (!titulo && !texto) continue;
      doc.font('R').fontSize(9);
      const alto = (titulo ? 14 : 0) + doc.heightOfString(texto || ' ', { width: ancho }) + 8;
      if (y + Math.min(alto, 60) > LIMITE) nuevaPagina();
      if (titulo) { doc.font('B').fontSize(9).fillColor('#111').text(titulo.toUpperCase(), izq, y, { width: ancho, lineBreak: false }); y += 14; }
      doc.font('R').fontSize(9).fillColor('#111');
      for (const linea of texto.split('\n')) {
        const h = doc.heightOfString(linea || ' ', { width: ancho });
        if (y + h > LIMITE) nuevaPagina();
        doc.text(linea, izq, y, { width: ancho });
        y += h;
      }
      y += 10;
    }

    if (!esProyecto) {
      asegurar(40);
      doc.font('B').fontSize(9.5).fillColor(NARANJA).text(`Cotización válida por ${cot.vigencia_dias} días`, izq, y, { lineBreak: false });
      y += 22;
      asegurar(110);
      const alto = cot.mostrar_bancos ? 70 : 34;
      doc.moveTo(izq, y).lineTo(izq + 330, y).lineWidth(1.4).strokeColor('#111').stroke();
      doc.moveTo(izq, y + alto).lineTo(izq + 330, y + alto).lineWidth(1.4).strokeColor('#111').stroke();
      if (cot.mostrar_bancos) {
        doc.font('B').fontSize(8).fillColor('#111').text('INFORMACIÓN BANCARIA', izq, y + 6, { lineBreak: false });
        doc.font('R').fontSize(8).text(DISERCO.nombreCheques, izq, y + 20, { lineBreak: false });
        DISERCO.bancos.forEach((b, i) => {
          doc.text(`${b.banco} ${b.cuenta}`, izq, y + 34 + i * 11, { lineBreak: false });
          doc.text('cheque lempiras', izq + 180, y + 34 + i * 11, { lineBreak: false });
        });
      }
      doc.font('B').fontSize(13).fillColor(NARANJA).text('TOTAL', izq + 360, y + 4, { width: 148, align: 'right', lineBreak: false });
      doc.font('B').fontSize(10).fillColor('#111').text('L', izq + 380, y + Math.max(26, alto / 2), { lineBreak: false });
      doc.text(L(cot.total), izq + 380, y + Math.max(26, alto / 2), { width: 128, align: 'right', lineBreak: false });
      y += alto + 18;
    } else if (cot.firma_nombre) {
      asegurar(60);
      y += 14;
      doc.font('B').fontSize(9.5).fillColor('#111').text(cot.firma_nombre, izq, y, { lineBreak: false });
      if (cot.firma_cargo) doc.font('R').text(cot.firma_cargo, izq, y + 13, { lineBreak: false });
    }

    // Pie en todas las hojas
    const rango = doc.bufferedPageRange();
    for (let i = rango.start; i < rango.start + rango.count; i++) {
      doc.switchToPage(i);
      doc.moveTo(izq + 8, 773).lineTo(izq + ancho - 110, 773).lineWidth(1.4).strokeColor(NARANJA).stroke();
      doc.font('M').fontSize(10.5).fillColor(NARANJA).text(DISERCO.web, izq + ancho - 104, 766, { width: 104, align: 'right', lineBreak: false });
      doc.font('R').fontSize(7.5).fillColor(GRIS).text(`${DISERCO.direccion}   Tel: ${DISERCO.telefono}`, izq, 778, { width: ancho, align: 'left', lineBreak: false });
    }
    doc.end();
  });
}
