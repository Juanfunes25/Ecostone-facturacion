import { Router } from 'express';
import { db } from '../db.js';
import { requireRole } from '../middleware/requireRole.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { crearAlerta } from '../lib/alertas.js';
import { numero } from '../lib/parametros.js';
import { round3 } from '../lib/cotizacion.js';
import { traerTodo } from '../lib/consultas.js';

export const inventario = Router();
const LEE = ['admin', 'gerente', 'bodega', 'produccion', 'vendedor', 'cajero'];
const ESCRIBE = ['admin', 'gerente', 'bodega'];
const fallo = (res, e, status = 400) => res.status(e.status ?? status).json({ error: e.message ?? String(e) });

// Producto terminado: existencias por producto → lote → calidad.
inventario.get('/pt', requireRole(...LEE), async (req, res) => {
  try {
    const [filas, { data: productos }] = await Promise.all([
      traerTodo(() => db.from('stock_pt').select('*').order('producto_id')),
      db.from('productos').select('id, nombre, modelo, color, m2_por_caja, stock_minimo_m2, costo_estandar, tipo').eq('tipo', 'piedra').eq('activo', true).order('nombre'),
    ]);
    const verCostos = ['admin', 'gerente'].includes(req.perfil.rol);
    res.json(
      (productos ?? []).map((p) => {
        const lotes = filas.filter((f) => f.producto_id === p.id && (Number(f.fisico) !== 0 || Number(f.disponible) !== 0));
        const suma = (calidad, campo) => round3(lotes.filter((l) => l.calidad === calidad).reduce((s, l) => s + Number(l[campo]), 0));
        const disponible = suma('primera', 'disponible');
        return {
          ...p,
          costo_estandar: verCostos ? p.costo_estandar : undefined,
          fisico_primera: suma('primera', 'fisico'),
          disponible_primera: disponible,
          reservado: round3(suma('primera', 'fisico') - disponible),
          fisico_segunda: suma('segunda', 'fisico'),
          cajas_disponibles: Number(p.m2_por_caja) > 0 ? Math.floor(disponible / Number(p.m2_por_caja) + 1e-9) : null,
          bajo_minimo: Number(p.stock_minimo_m2) > 0 && disponible < Number(p.stock_minimo_m2),
          lotes: lotes.map((l) => ({ lote: l.lote, calidad: l.calidad, fisico: Number(l.fisico), disponible: Number(l.disponible), ultimo_movimiento: l.ultimo_movimiento })),
        };
      })
    );
  } catch (e) {
    fallo(res, e, 500);
  }
});

inventario.get('/pt/kardex', requireRole(...LEE), async (req, res) => {
  let q = db.from('movimientos_pt').select('*, productos(nombre), perfiles(nombre), cotizaciones(numero)').order('created_at', { ascending: false }).limit(300);
  if (req.query.producto_id) q = q.eq('producto_id', req.query.producto_id);
  const { data, error } = await q;
  if (error) return fallo(res, error, 500);
  res.json(data);
});

// Ajuste manual (+/-) o carga de existencia inicial. Motivo obligatorio.
inventario.post('/pt/ajuste', requireRole(...ESCRIBE), async (req, res) => {
  try {
    const { producto_id, lote, calidad, m2, motivo, tipo } = req.body;
    const tipoMov = tipo === 'inicial' ? 'inicial' : 'ajuste';
    const cantidad = round3(numero(m2));
    if (!producto_id || !String(lote ?? '').trim()) throw new Error('Indica el producto y el lote');
    if (!cantidad) throw new Error('Indica los m² del ajuste');
    if (!String(motivo ?? '').trim()) throw new Error('El motivo del ajuste es obligatorio');
    if (tipoMov === 'inicial' && cantidad < 0) throw new Error('La existencia inicial debe ser positiva');
    const { data, error } = await db.rpc('pt_registrar_movimiento', { p_producto: producto_id, p_lote: String(lote).trim(), p_calidad: calidad === 'segunda' ? 'segunda' : 'primera', p_tipo: tipoMov, p_m2: cantidad, p_costo: numero(req.body.costo_m2), p_motivo: motivo.trim(), p_usuario: req.perfil.id });
    if (error) throw new Error(error.message);
    const { data: prod } = await db.from('productos').select('nombre').eq('id', producto_id).single();
    await registrarAuditoria(req, { accion: `inventario.${tipoMov}`, entidad: 'producto', entidadId: producto_id, detalle: { producto: prod?.nombre, lote, m2: cantidad, motivo } });
    if (tipoMov === 'ajuste') {
      await crearAlerta(req, { tipo: 'inventario.ajuste_pt', severidad: Math.abs(cantidad) >= 50 ? 'alta' : 'media', titulo: `Ajuste de inventario: ${cantidad > 0 ? '+' : ''}${cantidad} m² de ${prod?.nombre} (${lote})`, entidad: 'producto', entidadId: producto_id, detalle: { producto: prod?.nombre, lote, m2: cantidad, motivo, por: req.perfil.nombre } });
    }
    res.status(201).json(data);
  } catch (e) {
    fallo(res, e);
  }
});

// Conteo físico (también el sorpresa): compara lo contado con el sistema y ajusta.
inventario.post('/pt/conteo', requireRole('admin', 'gerente', 'bodega'), async (req, res) => {
  try {
    const { producto_id, lote, calidad, contado } = req.body;
    if (!producto_id || !lote) throw new Error('Indica producto y lote');
    const cal = calidad === 'segunda' ? 'segunda' : 'primera';
    const { data: fila } = await db.from('stock_pt').select('fisico').eq('producto_id', producto_id).eq('lote', lote).eq('calidad', cal).maybeSingle();
    const sistema = round3(Number(fila?.fisico ?? 0));
    const cont = round3(numero(contado, NaN));
    if (!Number.isFinite(cont) || cont < 0) throw new Error('Indica los m² contados');
    const diferencia = round3(cont - sistema);
    const { data: prod } = await db.from('productos').select('nombre').eq('id', producto_id).single();
    if (diferencia !== 0) {
      const { error } = await db.rpc('pt_registrar_movimiento', { p_producto: producto_id, p_lote: lote, p_calidad: cal, p_tipo: 'ajuste', p_m2: diferencia, p_motivo: `Conteo físico: sistema ${sistema}, contado ${cont}`, p_usuario: req.perfil.id });
      if (error) throw new Error(error.message);
      await crearAlerta(req, { tipo: 'inventario.conteo_diferencia', severidad: Math.abs(diferencia) >= 20 ? 'alta' : 'media', titulo: `Conteo con diferencia: ${prod?.nombre} ${lote} (${diferencia > 0 ? 'sobra' : 'falta'} ${Math.abs(diferencia)} m²)`, entidad: 'producto', entidadId: producto_id, detalle: { producto: prod?.nombre, lote, sistema, contado: cont, diferencia, por: req.perfil.nombre } });
    }
    await registrarAuditoria(req, { accion: 'inventario.conteo', entidad: 'producto', entidadId: producto_id, detalle: { producto: prod?.nombre, lote, sistema, contado: cont, diferencia } });
    res.json({ sistema, contado: cont, diferencia });
  } catch (e) {
    fallo(res, e);
  }
});
