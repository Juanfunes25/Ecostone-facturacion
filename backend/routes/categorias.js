import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';

export const categorias = Router();

categorias.get('/', async (req, res) => {
  const { data, error } = await db.from('categorias').select('*').order('orden');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

categorias.post('/', requireRole('admin', 'gerente'), async (req, res) => {
  const { nombre, orden } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
  const { data, error } = await db
    .from('categorias')
    .insert({ nombre, orden: orden ?? 0 })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

categorias.put('/:id', requireRole('admin', 'gerente'), async (req, res) => {
  const { nombre, orden, activo } = req.body;
  const { data, error } = await db
    .from('categorias')
    .update({ nombre, orden, activo })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
