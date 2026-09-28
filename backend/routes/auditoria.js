import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { filtrarRango } from '../lib/fechas.js';

export const auditoria = Router();

// Sólo lectura: la tabla no admite UPDATE/DELETE (ver migración 0007), y
// este router no expone ninguna forma de escribir en ella.
auditoria.get('/', requireRole('admin'), async (req, res) => {
  const { accion, usuario_id, sucursal_id, entidad_id, desde, hasta } = req.query;
  let query = db
    .from('auditoria')
    .select('id, created_at, usuario_id, usuario_nombre, accion, entidad, entidad_id, sucursal_id, detalle, ip, hash, sucursales(nombre)')
    .order('id', { ascending: false })
    .limit(300);
  if (accion) query = query.like('accion', `${accion}%`);
  if (usuario_id) query = query.eq('usuario_id', usuario_id);
  if (sucursal_id) query = query.eq('sucursal_id', sucursal_id);
  if (entidad_id) query = query.eq('entidad_id', entidad_id);
  query = filtrarRango(query, 'created_at', desde, hasta); // días en hora de Honduras
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Recalcula la cadena de hashes completa: si alguien hubiera alterado o
// borrado un registro directo en la base de datos, lo señala.
auditoria.get('/verificar', requireRole('admin'), async (req, res) => {
  const { data, error } = await db.rpc('verificar_auditoria');
  if (error) return res.status(500).json({ error: error.message });
  const r = Array.isArray(data) ? data[0] : data;
  res.json({ integra: r.integra, total: Number(r.total), primer_id_alterado: r.primer_id_alterado });
});
