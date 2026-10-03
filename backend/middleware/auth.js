import { db } from '../db.js';
import { vigilarDispositivo } from '../lib/antifraude.js';
import { empresaDeLaPeticion } from '../lib/empresas.js';

// Verifica el JWT de Supabase Auth (enviado por el frontend en Authorization:
// Bearer <token>) y adjunta el perfil (sucursal, rol, flags) a req.perfil.
// Validar el token y leer el perfil son dos viajes a Supabase en CADA petición.
// Se recuerdan 30 s por token (y nunca más allá del vencimiento del token); al
// cambiar usuarios se vacía la memoria para que una desactivación sea inmediata.
const sesiones = new Map();
const VIGENCIA_MS = 30 * 1000;
export const olvidarSesiones = () => sesiones.clear();

function vencimientoToken(token) {
  try {
    return Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp) * 1000;
  } catch {
    return 0;
  }
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Falta el token de autenticación' });

  const recordada = sesiones.get(token);
  if (recordada && recordada.hasta > Date.now()) {
    req.perfil = recordada.perfil;
    req.empresa = empresaDeLaPeticion(req);
    vigilarDispositivo(req).catch(() => {});
    return next();
  }

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
  req.empresa = empresaDeLaPeticion(req);
  if (sesiones.size > 500) sesiones.clear();
  sesiones.set(token, { perfil, hasta: Math.min(Date.now() + VIGENCIA_MS, vencimientoToken(token) || 0) });
  // Dispositivo nuevo / uso simultáneo: nunca frena la petición.
  vigilarDispositivo(req).catch(() => {});
  next();
}
