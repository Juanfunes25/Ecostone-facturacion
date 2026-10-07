import { db } from '../db.js';
import { vigilarDispositivo } from '../lib/antifraude.js';
import { empresaDeLaPeticion } from '../lib/empresas.js';

// Verifica el JWT de Supabase Auth (enviado por el frontend en Authorization:
// Bearer <token>) y adjunta el perfil (sucursal, rol, flags) a req.perfil.
// Validar el token y leer el perfil son dos viajes a Supabase en CADA petición.
// Se recuerdan 30 s por token (y nunca más allá del vencimiento del token); al
// cambiar usuarios se vacía la memoria para que una desactivación sea inmediata.
const sesiones = new Map();
const VIGENCIA_MS = 2 * 60 * 1000;
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

  // Al abrir la app salen 6-8 peticiones a la vez con el mismo token: se valida UNA vez y todas comparten el resultado.
  let pendiente = enCurso.get(token);
  if (!pendiente) {
    pendiente = validar(token).finally(() => enCurso.delete(token));
    enCurso.set(token, pendiente);
  }
  const r = await pendiente;
  if (r.error) return res.status(r.status).json({ error: r.error });

  req.perfil = r.perfil;
  req.empresa = empresaDeLaPeticion(req);
  // Dispositivo nuevo / uso simultáneo: nunca frena la petición.
  vigilarDispositivo(req).catch(() => {});
  next();
}

const enCurso = new Map();

async function validar(token) {
  // El token se verifica con la llave pública cacheada (sin viaje a Supabase); si no se puede, se pregunta a Supabase.
  let userId = null;
  try {
    const { data } = await db.auth.getClaims(token);
    userId = data?.claims?.sub ?? null;
  } catch {
    userId = null;
  }
  if (!userId) {
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData?.user) return { status: 401, error: 'Token inválido o expirado' };
    userId = userData.user.id;
  }
  const { data: perfil, error: perfilError } = await db.from('perfiles').select('*').eq('id', userId).single();
  if (perfilError || !perfil) return { status: 403, error: 'Usuario sin perfil asignado' };
  if (!perfil.activo) return { status: 403, error: 'Usuario inactivo' };
  if (sesiones.size > 500) sesiones.clear();
  sesiones.set(token, { perfil, hasta: Math.min(Date.now() + VIGENCIA_MS, vencimientoToken(token) || 0) });
  return { perfil };
}
