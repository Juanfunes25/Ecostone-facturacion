import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { precioConIsv } from './ventas.js';

export const productos = Router();

// '' → null (para que dos productos sin código no choquen con el índice
// único); undefined se respeta para no pisar el campo en ediciones parciales.
function limpiarCodigo(valor) {
  if (valor === undefined) return undefined;
  const texto = String(valor ?? '').trim();
  return texto === '' ? null : texto;
}

function errorDuplicado(error, { codigo, codigo_barras }) {
  const detalle = `${error.message} ${error.details ?? ''}`;
  if (detalle.includes('codigo_barras')) {
    return `Ya existe un producto con el código de barras "${codigo_barras}".`;
  }
  return `Ya existe un producto con el código "${codigo}" — usa uno distinto.`;
}


const CAMPOS_FABRICA = ['tipo', 'modelo', 'color', 'unidad_venta', 'm2_por_caja', 'piezas_por_m2', 'peso_kg_m2', 'rendimiento_m2', 'stock_minimo_m2', 'descripcion'];
function camposFabrica(body) {
  const o = {};
  for (const c of CAMPOS_FABRICA) {
    if (body[c] === undefined) continue;
    o[c] = body[c] === '' ? null : body[c];
  }
  if (o.tipo && !['piedra', 'accesorio', 'servicio', 'otro'].includes(o.tipo)) throw new Error('Tipo de producto inválido');
  return o;
}

productos.get('/', async (req, res) => {
  let query = db.from('productos').select('*, categorias(id, nombre)').eq('empresa', req.empresa).order('nombre');
  if (req.query.categoria_id) query = query.eq('categoria_id', req.query.categoria_id);
  if (req.query.incluirInactivos !== 'true') query = query.eq('activo', true);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(req.empresa === 'diserco' ? data.map((p) => ({ ...p, precio_sin_isv: p.precio, precio: precioConIsv(p) })) : data);
});

productos.post('/', requireRole('admin', 'gerente'), async (req, res) => {
  const { nombre, categoria_id, precio, impuesto1_tasa, impuesto2_tasa, impuesto3_tasa } = req.body;
  const codigo = limpiarCodigo(req.body.codigo);
  const codigo_barras = limpiarCodigo(req.body.codigo_barras);
  if (!nombre || precio === undefined) {
    return res.status(400).json({ error: 'nombre y precio son obligatorios' });
  }
  let fabrica;
  try {
    fabrica = camposFabrica(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const { data, error } = await db
    .from('productos')
    .insert({
      empresa: req.empresa,
      codigo,
      codigo_barras,
      nombre,
      categoria_id,
      precio,
      impuesto1_tasa: impuesto1_tasa ?? 0.15,
      impuesto2_tasa: impuesto2_tasa ?? 0,
      impuesto3_tasa: impuesto3_tasa ?? 0,
      ...fabrica,
    })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return res.status(400).json({ error: errorDuplicado(error, { codigo, codigo_barras }) });
    return res.status(500).json({ error: error.message });
  }
  await registrarAuditoria(req, {
    accion: 'producto.crear',
    entidad: 'producto',
    entidadId: data.id,
    detalle: { nombre: data.nombre, precio: Number(data.precio), codigo_barras: data.codigo_barras },
  });
  res.status(201).json(data);
});

productos.put('/:id', requireRole('admin', 'gerente'), async (req, res) => {
  const { nombre, categoria_id, precio, impuesto1_tasa, activo } = req.body;
  const codigo = limpiarCodigo(req.body.codigo);
  const codigo_barras = limpiarCodigo(req.body.codigo_barras);
  let fabrica;
  try {
    fabrica = camposFabrica(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const { data: anterior } = await db.from('productos').select('*').eq('id', req.params.id).maybeSingle();

  const { data, error } = await db
    .from('productos')
    .update({ codigo, codigo_barras, nombre, categoria_id, precio, impuesto1_tasa, activo, ...fabrica })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return res.status(400).json({ error: errorDuplicado(error, { codigo, codigo_barras }) });
    return res.status(500).json({ error: error.message });
  }

  // Un cambio de precio es de los primeros datos que pide una auditoría.
  if (anterior) {
    const cambios = {};
    for (const campo of ['nombre', 'precio', 'impuesto1_tasa', 'activo', 'codigo', 'codigo_barras']) {
      if (String(anterior[campo]) !== String(data[campo])) cambios[campo] = { antes: anterior[campo], despues: data[campo] };
    }
    if (Object.keys(cambios).length > 0) {
      await registrarAuditoria(req, {
        accion: 'producto.editar',
        entidad: 'producto',
        entidadId: data.id,
        detalle: { nombre: data.nombre, cambios },
      });
    }
    // Bajar un precio es una forma silenciosa de "regalar" producto (o de
    // cobrar el precio real y facturar el rebajado): siempre genera alerta.
    const antes = Number(anterior.precio);
    const despues = Number(data.precio);
    if (Number.isFinite(antes) && despues < antes) {
      await crearAlerta(req, {
        tipo: 'producto.baja_precio',
        severidad: despues < antes * 0.8 ? 'alta' : 'media',
        titulo: `Bajó el precio de ${data.nombre}: L ${antes.toFixed(2)} → L ${despues.toFixed(2)}`,
        entidad: 'producto',
        entidadId: data.id,
        detalle: { producto: data.nombre, antes, despues, rebaja_pct: Math.round((1 - despues / antes) * 100), por: req.perfil.nombre },
      });
    }
  }
  res.json(data);
});

// Sin borrado físico: WizPOS lo permite, pero acá alcanza con desactivar
// (una factura ya emitida no debe perder la referencia al producto).
productos.delete('/:id', requireRole('admin', 'gerente'), async (req, res) => {
  const { data, error } = await db
    .from('productos')
    .update({ activo: false })
    .eq('id', req.params.id)
    .select('id, nombre')
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  await registrarAuditoria(req, {
    accion: 'producto.desactivar',
    entidad: 'producto',
    entidadId: req.params.id,
    detalle: { nombre: data?.nombre },
  });
  res.status(204).end();
});
