import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { obtenerParametros, invalidarParametros, numero } from '../lib/parametros.js';
import { traerTodo } from '../lib/consultas.js';

export const insumos = Router();
const LEE = ['admin', 'gerente', 'bodega', 'produccion'];
const ESCRIBE = ['admin', 'gerente', 'bodega'];
const CATEGORIAS = ['cemento', 'arena', 'agregado', 'aditivo', 'pigmento', 'desmoldante', 'sellador', 'fibra', 'empaque', 'molde', 'otro'];

const fallo = (res, e, status = 400) => res.status(e.status ?? status).json({ error: e.message ?? String(e) });

// ── Proveedores ─────────────────────────────────────────────────────────────
insumos.get('/proveedores', requireRole(...LEE), async (req, res) => {
  const { data, error } = await db.from('proveedores').select('*').order('nombre');
  if (error) return fallo(res, error, 500);
  res.json(data);
});

insumos.post('/proveedores', requireRole(...ESCRIBE), async (req, res) => {
  const { nombre, rtn, contacto, telefono, email, dias_credito, notas } = req.body;
  if (!String(nombre ?? '').trim()) return res.status(400).json({ error: 'El nombre del proveedor es obligatorio' });
  const { data, error } = await db.from('proveedores').insert({ nombre: nombre.trim(), rtn, contacto, telefono, email, dias_credito: numero(dias_credito), notas }).select().single();
  if (error) return fallo(res, error);
  await registrarAuditoria(req, { accion: 'proveedor.crear', entidad: 'proveedor', entidadId: data.id, detalle: { nombre: data.nombre } });
  res.status(201).json(data);
});

insumos.put('/proveedores/:id', requireRole(...ESCRIBE), async (req, res) => {
  const { nombre, rtn, contacto, telefono, email, dias_credito, notas, activo } = req.body;
  const { data, error } = await db.from('proveedores').update({ nombre, rtn, contacto, telefono, email, dias_credito, notas, activo }).eq('id', req.params.id).select().single();
  if (error) return fallo(res, error);
  res.json(data);
});

// ── Materias primas ─────────────────────────────────────────────────────────
async function stockPorMp() {
  const filas = await traerTodo(() => db.from('stock_mp').select('mp_id, stock').order('mp_id'));
  return new Map(filas.map((f) => [f.mp_id, Number(f.stock)]));
}

insumos.get('/materias-primas', requireRole(...LEE), async (req, res) => {
  try {
    const { data, error } = await db.from('materias_primas').select('*, proveedores(nombre)').order('categoria').order('nombre');
    if (error) throw error;
    const stock = await stockPorMp();
    const params = await obtenerParametros();
    const tc = numero(params.tipo_cambio_usd, 1);
    res.json(
      data.map((m) => {
        const s = stock.get(m.id) ?? 0;
        return { ...m, stock: s, valor_inventario: Math.round(s * Number(m.costo_promedio) * 100) / 100, bajo_minimo: Number(m.stock_minimo) > 0 && s < Number(m.stock_minimo), costo_usd: m.moneda === 'USD' && tc ? Math.round((Number(m.costo_promedio) / tc) * 10000) / 10000 : null };
      })
    );
  } catch (e) {
    fallo(res, e, 500);
  }
});

insumos.post('/materias-primas', requireRole(...ESCRIBE), async (req, res) => {
  const { codigo, nombre, categoria, unidad, moneda, stock_minimo, proveedor_id, notas } = req.body;
  if (!String(nombre ?? '').trim()) return res.status(400).json({ error: 'El nombre del insumo es obligatorio' });
  if (categoria && !CATEGORIAS.includes(categoria)) return res.status(400).json({ error: 'Categoría inválida' });
  const { data, error } = await db
    .from('materias_primas')
    .insert({ codigo: codigo || null, nombre: nombre.trim(), categoria: categoria ?? 'otro', unidad: unidad || 'kg', moneda: moneda === 'USD' ? 'USD' : 'HNL', stock_minimo: numero(stock_minimo), proveedor_id: proveedor_id || null, notas })
    .select()
    .single();
  if (error) return fallo(res, error.code === '23505' ? { message: 'Ya existe un insumo con ese código' } : error);
  await registrarAuditoria(req, { accion: 'insumo.crear', entidad: 'insumo', entidadId: data.id, detalle: { nombre: data.nombre } });
  res.status(201).json(data);
});

insumos.put('/materias-primas/:id', requireRole(...ESCRIBE), async (req, res) => {
  const { codigo, nombre, categoria, unidad, moneda, stock_minimo, proveedor_id, notas, activo } = req.body;
  const { data, error } = await db
    .from('materias_primas')
    .update({ codigo: codigo || null, nombre, categoria, unidad, moneda, stock_minimo, proveedor_id: proveedor_id || null, notas, activo })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return fallo(res, error);
  res.json(data);
});

// Compra, ajuste, merma o devolución. Todo cambio de stock deja kardex.
insumos.post('/materias-primas/:id/movimiento', requireRole(...LEE), async (req, res) => {
  try {
    const { tipo, cantidad, costo_unitario, moneda, proveedor_id, documento, motivo } = req.body;
    if (!['compra', 'ajuste', 'merma', 'devolucion', 'inicial'].includes(tipo)) throw new Error('Tipo de movimiento inválido');
    if (['compra', 'ajuste', 'inicial'].includes(tipo) && !ESCRIBE.includes(req.perfil.rol)) {
      return res.status(403).json({ error: 'No tiene permiso para esta acción' });
    }
    let cant = numero(cantidad);
    if (!(cant !== 0)) throw new Error('Indica la cantidad');
    if (['compra', 'inicial'].includes(tipo)) {
      cant = Math.abs(cant);
      if (!(numero(costo_unitario, -1) >= 0)) throw new Error('Indica el costo unitario de la compra');
    }
    if (['merma', 'devolucion'].includes(tipo)) cant = -Math.abs(cant);
    if (['ajuste', 'merma', 'devolucion'].includes(tipo) && !String(motivo ?? '').trim()) throw new Error('El motivo es obligatorio');
    const params = await obtenerParametros();
    const tc = numero(params.tipo_cambio_usd, 1);
    const { data, error } = await db.rpc('mp_registrar_movimiento', {
      p_mp: req.params.id, p_tipo: tipo, p_cantidad: cant,
      p_costo: costo_unitario ?? null, p_moneda: moneda === 'USD' ? 'USD' : 'HNL', p_tc: moneda === 'USD' ? tc : 1,
      p_proveedor: proveedor_id || null, p_documento: documento || null, p_motivo: motivo || null, p_usuario: req.perfil.id,
    });
    if (error) throw new Error(error.message);
    const { data: mp } = await db.from('materias_primas').select('nombre, unidad, costo_promedio').eq('id', req.params.id).single();
    await registrarAuditoria(req, { accion: `insumo.${tipo}`, entidad: 'insumo', entidadId: req.params.id, detalle: { insumo: mp?.nombre, cantidad: cant, unidad: mp?.unidad, costo_unitario: data.costo_unitario, documento, motivo } });

    if (['ajuste', 'merma'].includes(tipo)) {
      const desde = new Date(Date.now() - 7 * 86400_000).toISOString();
      const { count } = await db.from('movimientos_mp').select('id', { count: 'exact', head: true }).eq('usuario_id', req.perfil.id).in('tipo', ['ajuste', 'merma']).gte('created_at', desde);
      if ((count ?? 0) >= 3) {
        await crearAlerta(req, { tipo: 'inventario.ajustes_repetidos', severidad: 'media', titulo: `${req.perfil.nombre} lleva ${count} ajustes/mermas de insumos en 7 días`, entidad: 'insumo', entidadId: req.params.id, detalle: { insumo: mp?.nombre, ultimo_motivo: motivo } });
      }
    }
    res.status(201).json(data);
  } catch (e) {
    fallo(res, e);
  }
});

insumos.get('/materias-primas/:id/kardex', requireRole(...LEE), async (req, res) => {
  const { data, error } = await db
    .from('movimientos_mp')
    .select('*, proveedores(nombre), perfiles(nombre)')
    .eq('mp_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return fallo(res, error, 500);
  res.json(data);
});

// ── Parámetros de negocio ───────────────────────────────────────────────────
insumos.get('/parametros', requireRole('admin', 'gerente', 'vendedor', 'produccion', 'bodega', 'cajero', 'ventas'), async (req, res) => {
  const { data, error } = await db.from('parametros').select('*').order('clave');
  if (error) return fallo(res, error, 500);
  res.json(data);
});

insumos.put('/parametros/:clave', requireRole('admin', 'gerente'), async (req, res) => {
  const valor = Number(req.body.valor);
  if (!Number.isFinite(valor) || valor < 0) return res.status(400).json({ error: 'Valor inválido' });
  const { data: antes } = await db.from('parametros').select('valor').eq('clave', req.params.clave).maybeSingle();
  if (!antes) return res.status(404).json({ error: 'Parámetro no encontrado' });
  const { data, error } = await db.from('parametros').update({ valor, updated_at: new Date().toISOString() }).eq('clave', req.params.clave).select().single();
  if (error) return fallo(res, error);
  invalidarParametros();
  await registrarAuditoria(req, { accion: 'parametro.editar', entidad: 'parametro', entidadId: req.params.clave, detalle: { antes: antes.valor, despues: valor } });
  res.json(data);
});
