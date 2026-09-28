import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { crearOrdenProduccion, hoyHn } from '../lib/produccion.js';
import { colarOrden, liberarCuradosVencidos } from '../lib/colada.js';
import { round3 } from '../lib/cotizacion.js';
import { inicioDelDia } from '../lib/fechas.js';

// Registro de producción desde el celular del operario: elige el modelo y la
// cantidad, envía, y el sistema guarda fecha/hora/usuario, descuenta la materia
// prima según la receta y deja el lote en producción hasta que pase a inventario (5 días por defecto).
export const registroProduccion = Router();
const ROLES = ['produccion', 'admin', 'gerente'];
const unidadDe = (p) => (p.unidad_venta === 'caja' ? 'cajas' : 'm²');

registroProduccion.get('/catalogo', requireRole(...ROLES), async (req, res) => {
  const [{ data: productos, error }, { data: recetas }] = await Promise.all([
    db.from('productos').select('id, nombre, modelo, color, unidad_venta').eq('tipo', 'piedra').eq('activo', true).order('modelo').order('color'),
    db.from('recetas').select('producto_id').eq('activa', true),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  const conReceta = new Set((recetas ?? []).map((r) => r.producto_id));
  res.json(productos.map((p) => ({ id: p.id, nombre: p.nombre, modelo: p.modelo ?? p.nombre, color: p.color ?? '', unidad: unidadDe(p), esquina: p.unidad_venta === 'caja', con_receta: conReceta.has(p.id) })));
});

registroProduccion.post('/', requireRole(...ROLES), async (req, res) => {
  try {
    const cantidad = Number(req.body.cantidad);
    if (!req.body.producto_id) throw new Error('Elige el modelo de piedra');
    if (!(cantidad > 0)) throw new Error('Escribe la cantidad producida');
    if (!Number.isInteger(cantidad)) throw new Error('La cantidad debe ser un número entero');
    if (cantidad > 5000) throw new Error('Esa cantidad es demasiado grande; revísala');
    const { data: producto } = await db.from('productos').select('id, nombre, tipo, activo, unidad_venta').eq('id', req.body.producto_id).maybeSingle();
    if (!producto || producto.tipo !== 'piedra' || !producto.activo) throw new Error('Producto no válido');

    // Anti doble toque: mismo usuario, mismo producto y cantidad en los últimos 90 segundos.
    const hace = new Date(Date.now() - 90_000).toISOString();
    const { data: repetido } = await db.from('ordenes_produccion').select('lote, created_at').eq('creada_por', req.perfil.id).eq('producto_id', producto.id).eq('m2_planificado', cantidad).gte('created_at', hace).limit(1);
    if (repetido?.length) throw Object.assign(new Error(`Ya enviaste ${cantidad} de ${producto.nombre} hace un momento (lote ${repetido[0].lote}). No se registró de nuevo.`), { status: 409 });

    const orden = await crearOrdenProduccion(req, { producto_id: producto.id, m2: cantidad, fecha_programada: hoyHn(), responsable_id: req.perfil.id, permitirSinReceta: true, notas: String(req.body.nota ?? '').slice(0, 200) || null });
    const r = await colarOrden(req, orden, { forzar: true });
    const sinReceta = !orden.receta_id;
    if (sinReceta) {
      const { data: hoy } = await db.from('alertas').select('id').eq('tipo', 'produccion.sin_receta').eq('entidad_id', producto.id).gte('created_at', inicioDelDia(hoyHn())).limit(1);
      if (!hoy?.length) await crearAlerta(req, { tipo: 'produccion.sin_receta', severidad: 'media', titulo: `Se produjo ${producto.nombre} pero no tiene receta: no se descontaron insumos`, entidad: 'producto', entidadId: producto.id, detalle: { producto: producto.nombre, lote: orden.lote, por: req.perfil.nombre } });
    }
    await registrarAuditoria(req, { accion: 'produccion.registro', entidad: 'orden_produccion', entidadId: orden.id, detalle: { lote: orden.lote, producto: producto.nombre, cantidad, unidad: unidadDe(producto), sin_receta: sinReceta || undefined } });
    const avisos = [];
    if (sinReceta) avisos.push('Este modelo aún no tiene receta: se guardó la producción pero no se descontó materia prima. Avisa al administrador.');
    if (r.faltantes.length) avisos.push('El sistema tenía menos materia prima que la usada. Ya se avisó al administrador.');
    res.status(201).json({
      lote: orden.lote, producto: producto.nombre, cantidad, unidad: unidadDe(producto),
      registrado_at: r.orden.fecha_colado, disponible_desde: r.orden.fecha_disponible,
      insumos: r.consumido, avisos,
    });
  } catch (e) {
    res.status(e.status ?? 400).json({ error: e.message });
  }
});

// Lo que registró este usuario (los admins ven todo el día).
registroProduccion.get('/recientes', requireRole(...ROLES), async (req, res) => {
  await liberarCuradosVencidos().catch(() => {});
  let q = db.from('ordenes_produccion').select('id, lote, m2_planificado, estado, fecha_colado, fecha_disponible, productos(nombre, unidad_venta), perfiles!ordenes_produccion_responsable_id_fkey(nombre)').not('fecha_colado', 'is', null).gte('fecha_colado', new Date(Date.now() - 7 * 86400_000).toISOString()).order('fecha_colado', { ascending: false }).limit(40);
  if (req.perfil.rol === 'produccion') q = q.eq('responsable_id', req.perfil.id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map((o) => ({ id: o.id, lote: o.lote, producto: o.productos?.nombre, cantidad: Number(o.m2_planificado), unidad: o.productos?.unidad_venta === 'caja' ? 'cajas' : 'm²', estado: o.estado, registrado_at: o.fecha_colado, disponible_desde: o.fecha_disponible, operario: o.perfiles?.nombre })));
});
