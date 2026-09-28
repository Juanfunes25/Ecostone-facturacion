import { db } from '../db.js';

function ipDe(req) {
  const reenviada = req.headers['x-forwarded-for'];
  if (reenviada) return String(reenviada).split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

// Registra un evento en la bitácora inalterable (tabla auditoria: sin
// UPDATE/DELETE y con cadena de hashes — ver migración 0007). La fecha y el
// hash los pone la base de datos, no este código.
//
// Nunca hace fallar la operación de negocio: si la bitácora no pudiera
// escribirse, se deja constancia en el log del servidor y la venta sigue.
export async function registrarAuditoria(req, { accion, entidad, entidadId = null, sucursalId = null, detalle = {} }) {
  try {
    const { error } = await db.from('auditoria').insert({
      usuario_id: req.perfil?.id ?? null,
      usuario_nombre: req.perfil?.nombre ?? null,
      accion,
      entidad,
      entidad_id: entidadId != null ? String(entidadId) : null,
      sucursal_id: sucursalId,
      detalle,
      ip: ipDe(req),
    });
    if (error) console.error('[auditoria] no se pudo registrar', accion, error.message);
  } catch (e) {
    console.error('[auditoria] no se pudo registrar', accion, e.message);
  }
}
