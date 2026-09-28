import { Router } from 'express';
import { db } from '../db.js';
import { hoyHn } from '../lib/fechas.js';

export const cajaChica = Router();

cajaChica.get('/', async (req, res) => {
  const { sucursal_id, fechaInicio, fechaFin } = req.query;
  let query = db.from('caja_chica').select('*, perfiles(nombre)').order('fecha', { ascending: false });
  if (sucursal_id) query = query.eq('sucursal_id', sucursal_id);
  if (fechaInicio) query = query.gte('fecha', fechaInicio);
  if (fechaFin) query = query.lte('fecha', fechaFin);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

cajaChica.post('/', async (req, res) => {
  const { sucursal_id, tipo, monto, concepto, fecha } = req.body;
  if (!sucursal_id || !tipo || monto === undefined) {
    return res.status(400).json({ error: 'sucursal_id, tipo y monto son obligatorios' });
  }
  if (!Number.isFinite(Number(monto)) || Number(monto) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser mayor que 0' });
  }
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Fecha inválida' });
  const { data, error } = await db
    .from('caja_chica')
    .insert({ sucursal_id, tipo, monto: Number(monto), concepto, fecha: fecha || hoyHn(), usuario_id: req.perfil.id })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});
