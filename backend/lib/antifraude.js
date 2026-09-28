import { crearAlerta } from './alertas.js';
import { db } from '../db.js';
import { fechaHn, horaHn, inicioDelDia, finDelDia, hoyHn } from './fechas.js';
import { obtenerReglas } from './reglas.js';
import { registrarAuditoria } from './auditoria.js';

// Una alerta por usuario y tipo cada 30 min como máximo: si alguien prueba
// 20 pantallas seguidas no se llena la bandeja (la bitácora sí guarda todo).
const ultimaAlerta = new Map();
function throttled(clave, minutos = 30) {
  const ahora = Date.now();
  const previa = ultimaAlerta.get(clave) ?? 0;
  if (ahora - previa < minutos * 60 * 1000) return true;
  ultimaAlerta.set(clave, ahora);
  return false;
}

export function alertaAccesoDenegado(req, detalle) {
  if (throttled(`denegado:${req.perfil?.id}`)) return;
  crearAlerta(req, {
    tipo: 'acceso.denegado',
    severidad: 'media',
    titulo: `${req.perfil?.nombre ?? 'Un usuario'} intentó entrar a una función sin permiso`,
    sucursalId: req.perfil?.sucursal_id ?? null,
    detalle: { ruta: detalle.ruta, metodo: detalle.metodo, rol: detalle.rol },
  });
}

// Horario en que normalmente hay operación (las sucursales abren 11 a. m.
// y la última cierra 11 p. m.; se deja margen para apertura y cierre).
export const HORA_APERTURA = 9;
export const HORA_CIERRE = 24;

export function fueraDeHorario(iso = new Date().toISOString()) {
  const h = horaHn(iso);
  return h < HORA_APERTURA || h >= HORA_CIERRE;
}

export async function alertaFueraDeHorario(req, accion) {
  if (req.perfil?.sin_horario || req.perfil?.rol === 'admin') return;
  const reglas = await obtenerReglas();
  const h = horaHn(new Date().toISOString());
  if (h >= reglas.hora_apertura && h < reglas.hora_cierre) return;
  if (throttled(`horario:${req.perfil?.id}`, 120)) return;
  crearAlerta(req, {
    tipo: 'horario.fuera',
    severidad: 'media',
    titulo: `${req.perfil?.nombre ?? 'Un usuario'} usó el sistema fuera de horario`,
    sucursalId: req.perfil?.sucursal_id ?? null,
    detalle: { accion, hora: new Date().toLocaleTimeString('es-HN', { timeZone: 'America/Tegucigalpa' }) },
  });
}

export { throttled };

// ── Dispositivos: cada navegador tiene un identificador propio ─────────
// (lo genera la app y lo manda en X-Dispositivo). Primer uso de un
// dispositivo nuevo y uso simultáneo desde dos dispositivos → alerta.
const dispositivosConocidos = new Set();
const ultimoDispositivo = new Map();

export async function vigilarDispositivo(req) {
  const perfil = req.perfil;
  const dispositivo = String(req.headers['x-dispositivo'] ?? '').slice(0, 64);
  if (!perfil || !dispositivo) return;
  const clave = `${perfil.id}|${dispositivo}`;

  // Uso simultáneo: otro dispositivo activo hace menos de 3 minutos.
  const previo = ultimoDispositivo.get(perfil.id);
  const ahora = Date.now();
  if (previo && previo.dispositivo !== dispositivo && ahora - previo.ts < 3 * 60 * 1000 && !throttled(`simultaneo:${perfil.id}`, 60)) {
    crearAlerta(req, {
      tipo: 'sesion.simultanea',
      severidad: 'alta',
      titulo: `${perfil.nombre} está usando el sistema en dos dispositivos a la vez`,
      sucursalId: perfil.sucursal_id ?? null,
      detalle: { dispositivo_actual: dispositivo.slice(0, 8), otro_dispositivo: previo.dispositivo.slice(0, 8), nota: '¿Alguien más conoce su contraseña?' },
    });
  }
  ultimoDispositivo.set(perfil.id, { dispositivo, ts: ahora });

  if (dispositivosConocidos.has(clave)) return;
  dispositivosConocidos.add(clave);
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();
  const navegador = String(req.headers['user-agent'] ?? '').slice(0, 200);
  const { data: existente } = await db
    .from('dispositivos_usuario')
    .select('dispositivo_id')
    .eq('usuario_id', perfil.id)
    .eq('dispositivo_id', dispositivo)
    .maybeSingle();
  if (existente) {
    await db.from('dispositivos_usuario').update({ ultima_vez: new Date().toISOString(), ip }).eq('usuario_id', perfil.id).eq('dispositivo_id', dispositivo);
    return;
  }
  const { count } = await db.from('dispositivos_usuario').select('dispositivo_id', { count: 'exact', head: true }).eq('usuario_id', perfil.id);
  await db.from('dispositivos_usuario').insert({ usuario_id: perfil.id, dispositivo_id: dispositivo, navegador, ip });
  registrarAuditoria(req, { accion: 'sesion.dispositivo_nuevo', entidad: 'sesion', sucursalId: perfil.sucursal_id ?? null, detalle: { dispositivo: dispositivo.slice(0, 8), navegador: navegador.slice(0, 120) } });
  if ((count ?? 0) > 0) {
    crearAlerta(req, {
      tipo: 'sesion.dispositivo_nuevo',
      severidad: perfil.rol === 'admin' ? 'alta' : 'media',
      titulo: `${perfil.nombre} entró desde un dispositivo nuevo`,
      sucursalId: perfil.sucursal_id ?? null,
      correo: perfil.rol === 'admin',
      detalle: { dispositivo: dispositivo.slice(0, 8), navegador: navegador.slice(0, 120), ip, dispositivos_previos: count },
    });
  }
}

// ── Intentos fallidos de inicio de sesión ──────────────────────────────
const fallidos = new Map();

export async function registrarLoginFallido(req, acceso) {
  const reglas = await obtenerReglas();
  const clave = String(acceso ?? '').trim().toLowerCase().slice(0, 80) || '(vacío)';
  const ventana = 15 * 60 * 1000;
  const ahora = Date.now();
  const lista = (fallidos.get(clave) ?? []).filter((t) => ahora - t < ventana);
  lista.push(ahora);
  fallidos.set(clave, lista);
  if (fallidos.size > 2000) fallidos.clear();
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();
  await registrarAuditoria(req, { accion: 'sesion.login_fallido', entidad: 'sesion', detalle: { acceso: clave, intentos_15min: lista.length, ip } });
  if (lista.length >= reglas.intentos_login && !throttled(`fallido:${clave}`, 30)) {
    await crearAlerta(req, {
      tipo: 'sesion.login_fallido',
      severidad: 'alta',
      titulo: `${lista.length} intentos fallidos de entrar como "${clave}" en 15 minutos`,
      correo: true,
      detalle: { usuario_intentado: clave, intentos: lista.length, ip },
    });
  }
}

// ── Revisión periódica (cada 10 min mientras el servidor está activo) ──
// Órdenes estacionadas: una orden abierta mucho tiempo puede estarse
// usando como "cuenta" para cobrar en efectivo y luego descartarla.
async function revisarOrdenesEstacionadas() {
  const reglas = await obtenerReglas();
  const limite = new Date(Date.now() - reglas.minutos_orden_estacionada * 60 * 1000).toISOString();
  const { data: ordenes } = await db
    .from('ventas')
    .select('id, numero_orden, total, created_at, sucursal_id, perfiles(nombre)')
    .eq('estado', 'abierta')
    .lt('created_at', limite)
    .gt('total', 0)
    .limit(50);
  for (const o of ordenes ?? []) {
    const { count } = await db.from('alertas').select('id', { count: 'exact', head: true }).eq('tipo', 'orden.estacionada').eq('entidad_id', o.id);
    if (count) continue;
    const minutos = Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000);
    await crearAlerta(null, {
      tipo: 'orden.estacionada',
      severidad: 'media',
      titulo: `Orden #${o.numero_orden} abierta hace ${minutos} min sin cobrar (L ${Number(o.total).toFixed(2)})`,
      sucursalId: o.sucursal_id,
      entidad: 'venta',
      entidadId: o.id,
      detalle: { orden: o.numero_orden, total: Number(o.total), cajero: o.perfiles?.nombre ?? '', minutos_abierta: minutos },
    });
  }
}

// La bitácora es inalterable por diseño; si alguien con acceso directo a la
// base la manipulara, la cadena de hashes se rompe y esto lo detecta.
let ultimaVerificacion = 0;
async function verificarIntegridadBitacora() {
  if (Date.now() - ultimaVerificacion < 6 * 60 * 60 * 1000) return;
  ultimaVerificacion = Date.now();
  const { data } = await db.rpc('verificar_auditoria');
  const r = Array.isArray(data) ? data[0] : data;
  if (r && r.integra === false) {
    await crearAlerta(null, {
      tipo: 'bitacora.alterada',
      severidad: 'alta',
      titulo: 'La bitácora de auditoría fue alterada directamente en la base de datos',
      correo: true,
      detalle: { primer_registro_alterado: r.primer_id_alterado, total_registros: Number(r.total) },
    });
  }
}

export function iniciarVigilancia() {
  const ciclo = () => {
    revisarOrdenesEstacionadas().catch((e) => console.error('[vigilancia] ordenes', e.message));
    verificarIntegridadBitacora().catch((e) => console.error('[vigilancia] bitacora', e.message));
  };
  setTimeout(ciclo, 30 * 1000);
  setInterval(ciclo, 10 * 60 * 1000);
}

// ── Doble factura: mismos productos y total en la misma sucursal, en
// pocos minutos. Clásico: se cobra dos veces, o se entrega a un cliente
// la factura de otro.
export async function revisarDobleFactura(req, venta) {
  const reglas = await obtenerReglas();
  const desde = new Date(Date.now() - reglas.minutos_doble_factura * 60 * 1000).toISOString();
  const { data: parecidas } = await db
    .from('ventas')
    .select('id, numero_factura, fecha_emision, detalle_venta(producto_id, cantidad)')
    .eq('sucursal_id', venta.sucursal_id)
    .eq('estado', 'pagada')
    .eq('total', venta.total)
    .neq('id', venta.id)
    .gte('fecha_emision', desde);
  if (!parecidas?.length) return;
  const firma = (lineas) => (lineas ?? []).map((d) => `${d.producto_id}:${Number(d.cantidad)}`).sort().join('|');
  const { data: propia } = await db.from('detalle_venta').select('producto_id, cantidad').eq('venta_id', venta.id);
  const miFirma = firma(propia);
  const gemela = parecidas.find((p) => firma(p.detalle_venta) === miFirma);
  if (!gemela) return;
  await crearAlerta(req, {
    tipo: 'venta.doble_factura',
    severidad: 'media',
    titulo: `Posible doble factura: ${venta.numero_factura} y ${gemela.numero_factura} son idénticas`,
    sucursalId: venta.sucursal_id,
    entidad: 'venta',
    entidadId: venta.id,
    detalle: { factura: venta.numero_factura, gemela: gemela.numero_factura, total: Number(venta.total), cajero: req.perfil?.nombre ?? '' },
  });
}

// ── Tercera edad: carné reutilizado y exceso de descuentos por cajero ──
export async function revisarTerceraEdad(req, venta) {
  const reglas = await obtenerReglas();
  const hoy = hoyHn();
  if (venta.tercera_edad_identidad) {
    const { count } = await db
      .from('ventas')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'pagada')
      .eq('tercera_edad_identidad', venta.tercera_edad_identidad)
      .gte('fecha_emision', inicioDelDia(hoy))
      .lte('fecha_emision', finDelDia(hoy));
    if ((count ?? 0) > reglas.max_usos_carne_dia && !throttled(`carne:${venta.tercera_edad_identidad}:${hoy}`, 24 * 60)) {
      await crearAlerta(req, {
        tipo: 'tercera_edad.carne_repetido',
        severidad: 'alta',
        titulo: `El carné ${venta.tercera_edad_identidad} se usó ${count} veces hoy para el descuento de tercera edad`,
        sucursalId: venta.sucursal_id,
        entidad: 'venta',
        entidadId: venta.id,
        detalle: { identidad: venta.tercera_edad_identidad, nombre: venta.tercera_edad_nombre ?? '', usos_hoy: count, cajero: req.perfil?.nombre ?? '' },
      });
    }
  }
  const { count: delCajero } = await db
    .from('ventas')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'pagada')
    .eq('cajero_id', req.perfil.id)
    .not('tercera_edad_identidad', 'is', null)
    .gte('fecha_emision', inicioDelDia(hoy))
    .lte('fecha_emision', finDelDia(hoy));
  if ((delCajero ?? 0) > reglas.max_tercera_edad_dia && !throttled(`te-cajero:${req.perfil.id}:${hoy}`, 24 * 60)) {
    await crearAlerta(req, {
      tipo: 'tercera_edad.exceso',
      severidad: 'media',
      titulo: `${req.perfil.nombre} lleva ${delCajero} facturas con descuento de tercera edad hoy`,
      sucursalId: venta.sucursal_id,
      detalle: { facturas_hoy: delCajero, limite: reglas.max_tercera_edad_dia },
    });
  }
}

export function normalizarIdentidad(valor) {
  return String(valor ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 20);
}

export { fechaHn };
