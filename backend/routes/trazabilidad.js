import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { buscarOrden, generarPdfEtiquetas, trazarLote, urlDeLote } from '../lib/trazabilidad.js';

// Trazabilidad de lotes: búsqueda, ficha completa y reimpresión de etiquetas.
export const trazabilidad = Router();
const ROLES = ['admin', 'gerente', 'bodega'];

trazabilidad.get('/', requireRole(...ROLES), async (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const { data, error } = await db.from('ordenes_produccion').select('id, lote, estado, m2_planificado, fecha_colado, fecha_disponible, productos(nombre)').not('fecha_colado', 'is', null).order('fecha_colado', { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: error.message });
  const filas = data.filter((o) => !q || `${o.lote} ${o.productos?.nombre ?? ''}`.toLowerCase().includes(q)).slice(0, 60);
  res.json(filas.map((o) => ({ lote: o.lote, producto: o.productos?.nombre, cantidad: Number(o.m2_planificado), estado: o.estado, registrado_at: o.fecha_colado, disponible_desde: o.fecha_disponible })));
});

trazabilidad.get('/lote/:lote', requireRole(...ROLES), async (req, res) => {
  try {
    const t = await trazarLote(req.params.lote);
    if (!t.existe_orden && t.movimientos.length === 0) return res.status(404).json({ error: `No se encontró el lote ${req.params.lote}` });
    const verCostos = ['admin', 'gerente'].includes(req.perfil.rol);
    if (!verCostos) {
      t.consumos = t.consumos.map(({ costo_unitario, ...c }) => c);
      if (t.orden) { t.orden.costo_m2 = null; t.orden.costo_mp = null; }
    }
    res.json(t);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

trazabilidad.get('/lote/:lote/etiqueta', requireRole(...ROLES), async (req, res) => {
  try {
    const orden = await buscarOrden({ lote: req.params.lote });
    if (!orden) return res.status(404).json({ error: 'Ese lote no tiene orden de producción (no genera etiqueta)' });
    const modo = req.query.modo === 'cajas' ? 'cajas' : 'lote';
    const pdf = await generarPdfEtiquetas(orden, { url: urlDeLote(req, orden.lote), modo });
    await db.from('ordenes_produccion').update({ etiquetas_impresas: Number(orden.etiquetas_impresas ?? 0) + 1 }).eq('id', orden.id);
    await registrarAuditoria(req, { accion: 'produccion.etiqueta', entidad: 'orden_produccion', entidadId: orden.id, detalle: { lote: orden.lote, modo } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etiqueta-${orden.lote}${modo === 'cajas' ? '-cajas' : ''}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
