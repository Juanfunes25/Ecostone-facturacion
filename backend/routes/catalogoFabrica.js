import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { numero } from '../lib/parametros.js';

// Listas de precio y zonas de flete (auxiliares del catálogo de piedra).
export const catalogoFabrica = Router();
const LEE = ['admin', 'gerente', 'vendedor', 'cajero', 'ventas', 'bodega', 'produccion'];
const GERENCIA = ['admin', 'gerente'];
const fallo = (res, e, status = 400) => res.status(status).json({ error: e.message ?? String(e) });

catalogoFabrica.get('/listas-precio', requireRole(...LEE), async (req, res) => {
  const { data, error } = await db.from('listas_precio').select('*').eq('activo', true).order('orden');
  if (error) return fallo(res, error, 500);
  res.json(data);
});

// Todos los precios (una fila por producto+lista), para la pantalla de catálogo y el cotizador.
catalogoFabrica.get('/listas-precio/precios', requireRole(...LEE), async (req, res) => {
  let q = db.from('precios_producto').select('producto_id, lista_id, precio');
  if (req.query.lista_id) q = q.eq('lista_id', req.query.lista_id);
  const { data, error } = await q;
  if (error) return fallo(res, error, 500);
  res.json(data);
});

catalogoFabrica.put('/listas-precio/precios', requireRole(...GERENCIA), async (req, res) => {
  const { producto_id, lista_id } = req.body;
  const precio = numero(req.body.precio, NaN);
  if (!producto_id || !lista_id || !Number.isFinite(precio) || precio < 0) return res.status(400).json({ error: 'Producto, lista y precio (≥ 0) son obligatorios' });
  const { data: antes } = await db.from('precios_producto').select('precio').eq('producto_id', producto_id).eq('lista_id', lista_id).maybeSingle();
  const { data, error } = await db.from('precios_producto').upsert({ producto_id, lista_id, precio }, { onConflict: 'producto_id,lista_id' }).select().single();
  if (error) return fallo(res, error);
  const [{ data: prod }, { data: lista }] = await Promise.all([db.from('productos').select('nombre').eq('id', producto_id).single(), db.from('listas_precio').select('nombre').eq('id', lista_id).single()]);
  await registrarAuditoria(req, { accion: 'precio.editar', entidad: 'producto', entidadId: producto_id, detalle: { producto: prod?.nombre, lista: lista?.nombre, antes: antes?.precio ?? null, despues: precio } });
  if (antes && precio < Number(antes.precio)) {
    await crearAlerta(req, { tipo: 'producto.baja_precio', severidad: precio < Number(antes.precio) * 0.8 ? 'alta' : 'media', titulo: `Bajó el precio de ${prod?.nombre} en lista ${lista?.nombre}: L ${Number(antes.precio).toFixed(2)} → L ${precio.toFixed(2)}`, entidad: 'producto', entidadId: producto_id, detalle: { antes: Number(antes.precio), despues: precio, por: req.perfil.nombre } });
  }
  res.json(data);
});

catalogoFabrica.get('/zonas-flete', requireRole(...LEE), async (req, res) => {
  const { data, error } = await db.from('zonas_flete').select('*').eq('activo', true).order('nombre');
  if (error) return fallo(res, error, 500);
  res.json(data);
});

catalogoFabrica.post('/zonas-flete', requireRole(...GERENCIA), async (req, res) => {
  if (!String(req.body.nombre ?? '').trim()) return res.status(400).json({ error: 'Indica el nombre de la zona' });
  const { data, error } = await db.from('zonas_flete').insert({ nombre: req.body.nombre.trim(), tarifa: numero(req.body.tarifa) }).select().single();
  if (error) return fallo(res, error.code === '23505' ? { message: 'Ya existe esa zona' } : error);
  res.status(201).json(data);
});

catalogoFabrica.put('/zonas-flete/:id', requireRole(...GERENCIA), async (req, res) => {
  const { data, error } = await db.from('zonas_flete').update({ nombre: req.body.nombre, tarifa: req.body.tarifa, activo: req.body.activo }).eq('id', req.params.id).select().single();
  if (error) return fallo(res, error);
  res.json(data);
});
