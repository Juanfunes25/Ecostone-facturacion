import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { numero } from '../lib/parametros.js';

// Catálogo e inventario de productos de DISERCO (kits, galones, cubetas…).
export const disercoCatalogo = Router();
const LEE = ['admin', 'gerente', 'vendedor', 'cajero', 'ventas', 'bodega'];
const GERENCIA = ['admin', 'gerente'];
const MUEVE = ['admin', 'gerente', 'bodega'];
const fallo = (res, e, status = 400) => res.status(e.status ?? status).json({ error: e.message ?? String(e) });
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

async function conExistencia(productos, rol = 'admin') {
  if (!productos.length) return [];
  // Sin filtro por lista de ids (con cientos de productos la dirección de la consulta se vuelve enorme):
  // las dos tablas son pequeñas y se leen enteras, en paralelo.
  const verProyectos = rol === 'admin';
  const [{ data }, { data: fuera }] = await Promise.all([
    db.from('inv_stock').select('producto_id, existencia'),
    verProyectos ? db.from('d_salida_items').select('producto_id, cantidad_salida, cantidad_retorno, salida:d_salidas!inner(id, proyecto, estado)').eq('salida.estado', 'abierta') : Promise.resolve({ data: [] }),
  ]);
  const hay = new Map((data ?? []).map((s) => [s.producto_id, Number(s.existencia)]));
  const enProyecto = new Map();
  for (const f of fuera ?? []) {
    const pend = Number(f.cantidad_salida) - Number(f.cantidad_retorno);
    if (pend <= 0) continue;
    enProyecto.set(f.producto_id, [...(enProyecto.get(f.producto_id) ?? []), { salida_id: f.salida.id, proyecto: f.salida.proyecto, cantidad: pend }]);
  }
  return productos.map((p) => {
    const proyectos = enProyecto.get(p.id) ?? [];
    const en_proyectos = proyectos.reduce((s, x) => s + x.cantidad, 0);
    return { ...p, existencia: hay.get(p.id) ?? 0, en_proyectos, proyectos, total: (hay.get(p.id) ?? 0) + en_proyectos, bajo_minimo: p.controla_inventario && Number(p.stock_minimo) > 0 && (hay.get(p.id) ?? 0) <= Number(p.stock_minimo) };
  });
}

disercoCatalogo.get('/productos', requireRole(...LEE), async (req, res) => {
  let q = db.from('productos').select('*, categorias(id, nombre)').eq('empresa', 'diserco').order('nombre');
  if (req.query.incluirInactivos !== 'true') q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) return fallo(res, error, 500);
  res.json(await conExistencia(data, req.perfil.rol));
});

function camposProducto(b) {
  const nombre = String(b.nombre ?? '').trim();
  if (!nombre) throw err('El nombre es obligatorio');
  const precio = numero(b.precio, NaN);
  if (!Number.isFinite(precio) || precio < 0) throw err('Indica el precio de venta (sin ISV)');
  const stockMin = numero(b.stock_minimo, 0);
  if (stockMin < 0 || !Number.isInteger(stockMin)) throw err('El mínimo debe ser un número entero');
  return {
    nombre, codigo: String(b.codigo ?? '').trim() || null, categoria_id: b.categoria_id || null, precio,
    consumible: !(b.consumible === false || b.consumible === 'false'), marca: String(b.marca ?? '').trim() || null, presentacion: String(b.presentacion ?? '').trim() || null, rendimiento_texto: String(b.rendimiento_texto ?? '').trim() || null,
    unidad_venta: String(b.unidad_venta ?? 'unidad').trim() || 'unidad', controla_inventario: b.controla_inventario !== false && b.controla_inventario !== 'false',
    stock_minimo: stockMin, costo_estandar: numero(b.costo_estandar, 0), descripcion: String(b.descripcion ?? '').trim() || null,
    activo: b.activo === undefined ? true : !!b.activo,
  };
}

disercoCatalogo.post('/productos', requireRole(...GERENCIA), async (req, res) => {
  try {
    const { data, error } = await db.from('productos').insert({ ...camposProducto(req.body), empresa: 'diserco', tipo: 'otro', impuesto1_tasa: 0.15, impuesto2_tasa: 0, impuesto3_tasa: 0 }).select().single();
    if (error) throw err(error.code === '23505' ? 'Ya existe un producto con ese código' : error.message);
    await registrarAuditoria(req, { accion: 'producto.crear', entidad: 'producto', entidadId: data.id, detalle: { nombre: data.nombre, empresa: 'diserco', precio: data.precio } });
    res.status(201).json(data);
  } catch (e) { fallo(res, e); }
});

disercoCatalogo.put('/productos/:id', requireRole(...GERENCIA), async (req, res) => {
  try {
    const { data: antes } = await db.from('productos').select('*').eq('id', req.params.id).eq('empresa', 'diserco').maybeSingle();
    if (!antes) throw err('Producto no encontrado', 404);
    const nuevo = camposProducto({ ...antes, ...req.body });
    const { data, error } = await db.from('productos').update(nuevo).eq('id', req.params.id).select().single();
    if (error) throw err(error.code === '23505' ? 'Ya existe un producto con ese código' : error.message);
    const cambios = {};
    for (const k of Object.keys(nuevo)) if (String(antes[k] ?? '') !== String(data[k] ?? '')) cambios[k] = { antes: antes[k], despues: data[k] };
    if (Object.keys(cambios).length) await registrarAuditoria(req, { accion: 'producto.editar', entidad: 'producto', entidadId: data.id, detalle: { nombre: data.nombre, empresa: 'diserco', cambios } });
    res.json(data);
  } catch (e) { fallo(res, e); }
});

// ── Inventario ───────────────────────────────────────────────────────────────
disercoCatalogo.get('/inventario', requireRole(...LEE, 'gestor'), async (req, res) => {
  const { data, error } = await db.from('productos').select('id, codigo, nombre, presentacion, unidad_venta, costo_estandar, precio, stock_minimo, controla_inventario, activo, categorias(nombre)').eq('empresa', 'diserco').eq('controla_inventario', true).eq('activo', true).order('nombre');
  if (error) return fallo(res, error, 500);
  const filas = await conExistencia(data, req.perfil.rol);
  res.json(req.perfil.rol === 'gestor' ? filas.map(({ costo_estandar, precio, ...resto }) => resto) : filas);
});

disercoCatalogo.get('/inventario/kardex', requireRole(...LEE), async (req, res) => {
  let q = db.from('inv_movimientos').select('*, productos!inner(nombre, empresa), perfiles(nombre)').eq('productos.empresa', 'diserco').order('created_at', { ascending: false }).limit(300);
  if (req.query.producto_id) q = q.eq('producto_id', req.query.producto_id);
  const { data, error } = await q;
  if (error) return fallo(res, error, 500);
  res.json(data);
});

// compra / inicial: entran unidades (con costo sin ISV); ajuste: suma o resta con motivo.
disercoCatalogo.post('/inventario/movimiento', requireRole(...MUEVE), async (req, res) => {
  try {
    const { producto_id, tipo } = req.body;
    if (!['compra', 'inicial', 'ajuste'].includes(tipo)) throw err('Tipo de movimiento inválido');
    const cantidad = numero(req.body.cantidad, NaN);
    if (!Number.isInteger(cantidad) || cantidad === 0) throw err('La cantidad debe ser un número entero distinto de cero');
    if (tipo !== 'ajuste' && cantidad < 0) throw err('Una compra o existencia inicial debe ser positiva');
    const costo = numero(req.body.costo, 0);
    if (tipo !== 'ajuste' && !(costo > 0)) throw err('Indica el costo unitario (sin ISV)');
    const motivo = String(req.body.motivo ?? '').trim();
    if (tipo === 'ajuste' && !motivo) throw err('Indica el motivo del ajuste');
    const { data: prod } = await db.from('productos').select('id, nombre, controla_inventario').eq('id', producto_id).eq('empresa', 'diserco').maybeSingle();
    if (!prod) throw err('Producto no encontrado', 404);
    if (!prod.controla_inventario) throw err('Este producto no controla inventario');
    const { data, error } = await db.rpc('inv_mover', { p_producto: producto_id, p_tipo: tipo, p_cantidad: cantidad, p_costo: tipo === 'ajuste' ? 0 : costo, p_motivo: motivo || (tipo === 'compra' ? 'Compra' : 'Existencia inicial'), p_venta: null, p_proveedor: String(req.body.proveedor ?? '').trim() || null, p_referencia: String(req.body.referencia ?? '').trim() || null, p_usuario: req.perfil.id, p_forzar: false, p_salida: null });
    if (error) throw err(error.message);
    await registrarAuditoria(req, { accion: `inventario.${tipo}`, entidad: 'producto', entidadId: producto_id, detalle: { producto: prod.nombre, cantidad, costo, motivo, empresa: 'diserco' } });
    res.status(201).json(data);
  } catch (e) { fallo(res, e); }
});
