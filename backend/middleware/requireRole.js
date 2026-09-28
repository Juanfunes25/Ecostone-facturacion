import { registrarAuditoria } from '../lib/auditoria.js';
import { alertaAccesoDenegado } from '../lib/antifraude.js';

// Uso: requireRole('admin', 'gerente')
//
// Cada intento de entrar a algo que no le corresponde queda en la bitácora
// (acceso.denegado) y genera una alerta: es exactamente el rastro que deja
// alguien "curioseando" el sistema para buscar huecos.
export function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.perfil) return res.status(401).json({ error: 'No autenticado' });
    if (!rolesPermitidos.includes(req.perfil.rol)) {
      const detalle = { metodo: req.method, ruta: req.originalUrl.split('?')[0], rol: req.perfil.rol, requiere: rolesPermitidos };
      registrarAuditoria(req, { accion: 'acceso.denegado', entidad: 'sistema', sucursalId: req.perfil.sucursal_id ?? null, detalle });
      alertaAccesoDenegado(req, detalle);
      return res.status(403).json({ error: 'No tiene permiso para esta acción' });
    }
    next();
  };
}
