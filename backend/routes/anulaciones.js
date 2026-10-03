import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { fechaHn, hoyHn } from '../lib/fechas.js';
import { reponerInventarioVenta } from '../lib/inventarioVenta.js';

export const anulaciones = Router();

// Una factura emitida no se modifica: solo se reimprime o se anula (solo admin).
// Conserva su número; la piedra facturada regresa al inventario.
anulaciones.post('/', requireRole('admin'), async (req, res) => {
  const { venta_id } = req.body;
  const motivo = String(req.body.motivo ?? '').trim().slice(0, 300);
  if (!venta_id || !motivo) return res.status(400).json({ error: 'venta_id y motivo son obligatorios' });

  const { data: venta } = await db.from('ventas').select('*').eq('id', venta_id).single();
  if (!venta) return res.status(404).json({ error: 'Factura no encontrada' });
  if (venta.estado !== 'pagada') return res.status(409).json({ error: 'Sólo se anulan facturas ya emitidas' });
  if (venta.anulada) return res.status(409).json({ error: 'Esta factura ya está anulada' });

  const { error } = await db.from('ventas').update({ anulada: true }).eq('id', venta_id).eq('anulada', false);
  if (error) return res.status(500).json({ error: error.message });

  let repuestos = 0;
  try {
    repuestos = await reponerInventarioVenta(req, venta);
  } catch (e) {
    console.error('anulación: reponer inventario', venta_id, e.message);
  }
  // Cobro de una cotización DISERCO: el cobro queda anulado y la cotización vuelve a "aprobada".
  const { data: cobros } = await db.from('d_cotizacion_pagos').select('id, cotizacion_id').eq('venta_id', venta_id);
  for (const c of cobros ?? []) {
    await db.from('d_cotizacion_pagos').update({ anulado: true }).eq('id', c.id);
    await db.from('d_cotizaciones').update({ estado: 'aprobada', updated_at: new Date().toISOString() }).eq('id', c.cotizacion_id).eq('estado', 'facturada');
  }
  if (venta.cotizacion_id) {
    await db.from('cotizaciones').update({ estado: 'anulada', motivo_cierre: `Factura ${venta.numero_factura} anulada: ${motivo}`, updated_at: new Date().toISOString() }).eq('id', venta.cotizacion_id);
  }

  await registrarAuditoria(req, {
    accion: 'venta.anular', entidad: 'venta', entidadId: venta_id, sucursalId: venta.sucursal_id,
    detalle: { numero_factura: venta.numero_factura, total_factura: Number(venta.total), motivo, lotes_repuestos: repuestos },
  });
  const diaFactura = fechaHn(venta.fecha_emision);
  const deOtroDia = diaFactura !== hoyHn();
  await crearAlerta(req, {
    tipo: 'venta.anular', severidad: 'alta',
    titulo: `Factura anulada: ${venta.numero_factura} por L ${Number(venta.total).toFixed(2)}${deOtroDia ? ` (emitida el ${diaFactura})` : ''}`,
    sucursalId: venta.sucursal_id, entidad: 'venta', entidadId: venta_id, correo: true,
    detalle: { factura: venta.numero_factura, emitida: diaFactura, de_otro_dia: deOtroDia ? 'SÍ' : 'no', total_factura: Number(venta.total), motivo, autorizo: req.perfil.nombre },
  });
  res.json({ ok: true });
});
