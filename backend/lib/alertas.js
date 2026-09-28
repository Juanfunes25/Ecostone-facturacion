import { db } from '../db.js';
import { enviarAlertaAdmins } from './correo.js';

// Crea una alerta para el dueño (pantalla Antifraude) y, si es seria, la
// manda por correo a todos los administradores. Nunca hace fallar la
// operación que la origina.
export async function crearAlerta(req, { tipo, severidad = 'media', titulo, detalle = {}, sucursalId = null, entidad = null, entidadId = null, correo = false }) {
  try {
    const { data, error } = await db
      .from('alertas')
      .insert({
        tipo,
        severidad,
        titulo,
        detalle,
        sucursal_id: sucursalId,
        usuario_id: req?.perfil?.id ?? null,
        usuario_nombre: req?.perfil?.nombre ?? null,
        entidad,
        entidad_id: entidadId != null ? String(entidadId) : null,
      })
      .select('*, sucursales(nombre)')
      .single();
    if (error) throw new Error(error.message);
    if (correo) enviarAlertaAdmins(data).catch((e) => console.error('[alertas] correo', e.message));
    return data;
  } catch (e) {
    console.error('[alertas] no se pudo crear', tipo, e.message);
    return null;
  }
}
