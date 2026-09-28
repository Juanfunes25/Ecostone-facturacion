import { db } from '../db.js';
import { vigilarDispositivo } from '../lib/antifraude.js';

// Verifica el JWT de Supabase Auth (enviado por el frontend en Authorization:
// Bearer <token>) y adjunta el perfil (sucursal, rol, flags) a req.perfil.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Falta el token de autenticación' });

  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const { data: perfil, error: perfilError } = await db
    .from('perfiles')
    .select('*')
    .eq('id', userData.user.id)
    .single();

  if (perfilError || !perfil) {
    return res.status(403).json({ error: 'Usuario sin perfil asignado' });
  }
  if (!perfil.activo) {
    return res.status(403).json({ error: 'Usuario inactivo' });
  }

  req.perfil = perfil;
  // Dispositivo nuevo / uso simultáneo: nunca frena la petición.
  vigilarDispositivo(req).catch(() => {});
  next();
}
