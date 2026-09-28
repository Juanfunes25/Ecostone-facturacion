import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';

export const sucursales = Router();

const COLOR_VALIDO = /^#[0-9a-fA-F]{6}$/;

// El color existe justamente para no confundir sucursales: dos sucursales
// activas nunca pueden compartirlo.
async function colorEnUso(color, excepto) {
  let query = db.from('sucursales').select('id, nombre').eq('activo', true).ilike('color', color);
  if (excepto) query = query.neq('id', excepto);
  const { data } = await query.limit(1);
  return data?.[0] ?? null;
}

sucursales.get('/', async (req, res) => {
  const { data, error } = await db.from('sucursales').select('*').eq('activo', true).order('nombre');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Alta de una sucursal nueva: crea también su punto de emisión en modo
// borrador (sin CAI todavía) con un código de punto de emisión sugerido
// (siguiente disponible). El esquema no tiene límite de sucursales — esto
// es lo único que hace falta para agregar la número 5, 6, etc.
sucursales.post('/', requireRole('admin'), async (req, res) => {
  const { nombre, alias, direccion, color } = req.body;
  if (!nombre || !alias || !direccion) {
    return res.status(400).json({ error: 'nombre, alias y dirección son obligatorios' });
  }
  if (color && !COLOR_VALIDO.test(color)) return res.status(400).json({ error: 'Color inválido' });
  if (color) {
    const otra = await colorEnUso(color);
    if (otra) return res.status(409).json({ error: `Ese color ya lo usa "${otra.nombre}" — elige otro.` });
  }

  const { data: sucursal, error } = await db
    .from('sucursales')
    .insert({ nombre, alias, direccion, color: color ?? null })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: `Ya existe una sucursal con el alias "${alias}" — usa uno distinto.` });
    }
    return res.status(400).json({ error: error.message });
  }

  const { count } = await db.from('puntos_emision').select('id', { count: 'exact', head: true });
  const siguienteCodigo = String((count ?? 0) + 1).padStart(3, '0');

  const { data: puntoEmision, error: errPunto } = await db
    .from('puntos_emision')
    .insert({
      sucursal_id: sucursal.id,
      punto_emision_codigo: siguienteCodigo,
      punto_venta_codigo: '001',
      tipo_documento_codigo: '01',
      cai: null,
      correlativo_desde: 1,
      correlativo_hasta: 99999999,
      correlativo_actual: 1,
      fecha_limite_emision: null,
      es_borrador: true,
    })
    .select()
    .single();
  if (errPunto) return res.status(500).json({ error: errPunto.message });

  res.status(201).json({ ...sucursal, punto_emision: puntoEmision });
});

sucursales.put('/:id', requireRole('admin'), async (req, res) => {
  const { nombre, direccion, activo, color } = req.body;
  if (color !== undefined && !COLOR_VALIDO.test(color)) return res.status(400).json({ error: 'Color inválido' });
  if (color) {
    const otra = await colorEnUso(color, req.params.id);
    if (otra) return res.status(409).json({ error: `Ese color ya lo usa "${otra.nombre}" — elige otro.` });
  }
  const { data: anterior } = await db.from('sucursales').select('*').eq('id', req.params.id).maybeSingle();
  const { data, error } = await db
    .from('sucursales')
    .update({ nombre, direccion, activo, color })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  if (anterior) {
    const cambios = {};
    for (const campo of ['nombre', 'direccion', 'activo', 'color']) {
      if (String(anterior[campo]) !== String(data[campo])) cambios[campo] = { antes: anterior[campo], despues: data[campo] };
    }
    if (Object.keys(cambios).length > 0) {
      await registrarAuditoria(req, {
        accion: 'sucursal.editar',
        entidad: 'sucursal',
        entidadId: data.id,
        sucursalId: data.id,
        detalle: { nombre: data.nombre, cambios },
      });
    }
  }
  res.json(data);
});
