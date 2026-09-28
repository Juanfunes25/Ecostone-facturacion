import { Router } from 'express';
import { db } from '../db.js';

export const clientes = Router();

// Mismo criterio que el RTN hondureño en el POS: 13-14 dígitos, ignorando
// guiones/espacios. No bloquea si viene vacío (el RTN es opcional acá).
function rtnLuceValido(rtn) {
  if (!rtn) return true;
  return /^\d{13,14}$/.test(String(rtn).replace(/[-\s]/g, ''));
}

clientes.get('/', async (req, res) => {
  const busqueda = req.query.q?.trim();
  let query = db.from('clientes').select('*').order('nombre');
  if (busqueda) {
    query = query.or(
      `nombre.ilike.%${busqueda}%,rtn.ilike.%${busqueda}%,telefono.ilike.%${busqueda}%,email.ilike.%${busqueda}%`
    );
  }
  const { data, error } = await query.limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

clientes.post('/', async (req, res) => {
  const { nombre, rtn, direccion, telefono, email, exento_impuestos } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
  if (!rtnLuceValido(rtn)) {
    return res.status(400).json({ error: 'El RTN hondureño debe tener 13-14 dígitos — revísalo.' });
  }
  const { data, error } = await db
    .from('clientes')
    .insert({ nombre, rtn, direccion, telefono, email, exento_impuestos: !!exento_impuestos })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

clientes.put('/:id', async (req, res) => {
  const { nombre, rtn, direccion, telefono, email, exento_impuestos } = req.body;
  if (!rtnLuceValido(rtn)) {
    return res.status(400).json({ error: 'El RTN hondureño debe tener 13-14 dígitos — revísalo.' });
  }
  const { data, error } = await db
    .from('clientes')
    .update({ nombre, rtn, direccion, telefono, email, exento_impuestos })
    .eq('id', req.params.id)
    .eq('es_consumidor_final', false)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
