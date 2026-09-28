import { Router } from 'express';
import { obtenerVentaCompleta } from './ventas.js';
import { formatearTicket, formatearTicketPrueba, envolverTicketHtml, anchoValido } from '../lib/ticket.js';
import { generarPdfFactura } from '../lib/pdf.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { obtenerReglas } from '../lib/reglas.js';
import { db } from '../db.js';

export const facturaImpresion = Router();

// Ticket de prueba para configurar la impresora térmica en cada caja.
// (Va antes de "/:id/..." para que "prueba" no se tome como un id.)
facturaImpresion.get('/impresora/prueba', (req, res) => {
  const ancho = anchoValido(req.query.columnas);
  res.type('text/html').send(envolverTicketHtml(formatearTicketPrueba(ancho, req.query.sucursal ?? ''), ancho));
});

facturaImpresion.get('/:id/ticket', async (req, res) => {
  const venta = await obtenerVentaCompleta(req.params.id);
  if (!venta) return res.status(404).json({ error: 'Factura no encontrada' });
  if (venta.estado !== 'pagada') return res.status(409).json({ error: 'La orden todavía no tiene factura' });

  const ancho = anchoValido(req.query.columnas);
  // La primera impresión es el original. Cualquier otra —aunque la pidan
  // como "primera"— sale marcada COPIA: así una factura reimpresa no se
  // puede entregar como original a otro cliente.
  const esReimpresion = req.query.motivo === 'reimpresion' || Number(venta.impresiones ?? 0) > 0;
  const razon = String(req.query.razon ?? '').trim().slice(0, 200);
  if (req.query.motivo === 'reimpresion') {
    const reglas = await obtenerReglas();
    if (reglas.exigir_motivo_reimpresion && !razon) {
      return res.status(400).json({ error: 'Indica el motivo de la reimpresión' });
    }
  }
  const impresiones = Number(venta.impresiones ?? 0) + 1;
  const reimpresiones = Number(venta.reimpresiones ?? 0) + (esReimpresion ? 1 : 0);
  await db.from('ventas').update({ impresiones, reimpresiones }).eq('id', venta.id);
  const reglasTicket = await obtenerReglas();
  const texto = formatearTicket(venta, ancho, { copia: esReimpresion ? reimpresiones : 0, leyendaGratis: reglasTicket.leyenda_factura_gratis });

  await registrarAuditoria(req, {
    accion: esReimpresion ? 'venta.reimprimir_ticket' : 'venta.imprimir_ticket',
    entidad: 'venta',
    entidadId: venta.id,
    sucursalId: venta.sucursal_id,
    detalle: { numero_factura: venta.numero_factura, total: Number(venta.total), reimpresion_no: esReimpresion ? reimpresiones : 0, motivo: razon || null },
  });
  if (esReimpresion && reimpresiones >= 2) {
    await crearAlerta(req, {
      tipo: 'venta.reimpresion_repetida',
      severidad: reimpresiones >= 3 ? 'alta' : 'media',
      titulo: `Factura ${venta.numero_factura} reimpresa ${reimpresiones} veces`,
      sucursalId: venta.sucursal_id,
      entidad: 'venta',
      entidadId: venta.id,
      detalle: { factura: venta.numero_factura, total: Number(venta.total), reimpresiones, ultimo_motivo: razon || '(sin motivo)', por: req.perfil.nombre },
    });
  }

  // ?formato=texto para integraciones/impresión directa por ESC-POS; por
  // default HTML listo para mandar a la térmica.
  if (req.query.formato === 'texto') return res.type('text/plain').send(texto);
  res.type('text/html').send(envolverTicketHtml(texto, ancho));
});

facturaImpresion.get('/:id/pdf', async (req, res) => {
  const venta = await obtenerVentaCompleta(req.params.id);
  if (!venta) return res.status(404).json({ error: 'Factura no encontrada' });
  if (venta.estado !== 'pagada') return res.status(409).json({ error: 'La orden todavía no tiene factura' });

  await registrarAuditoria(req, {
    accion: 'venta.ver_pdf',
    entidad: 'venta',
    entidadId: venta.id,
    sucursalId: venta.sucursal_id,
    detalle: { numero_factura: venta.numero_factura },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="factura-${venta.numero_factura}.pdf"`);
  generarPdfFactura(venta, res);
});
