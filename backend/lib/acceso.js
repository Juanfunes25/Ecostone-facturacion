import { createHash } from 'node:crypto';

// Supabase Auth siempre pide un correo y una contraseña de 6+ caracteres.
// Los cajeros entran con un nombre de usuario libre (con espacios, tildes,
// lo que sea) y contraseñas de cualquier largo, así que se traducen a lo
// que Supabase acepta. La pantalla de login (frontend/src/lib/acceso.js)
// hace EXACTAMENTE la misma traducción — si se cambia aquí, cambiar allá.
//
//   "cajero1"       → cajero1@ecostone.local        (nombres simples, como antes)
//   "María López"   → u-<hash>@ecostone.local        (cualquier otro nombre)
//   "ana@gmail.com" → ana@gmail.com               (correo real, tal cual)
//
// El nombre tal como se escribió se guarda en user_metadata.usuario para
// mostrarlo en la lista de usuarios (el hash no se puede revertir).
export const DOMINIO_USUARIOS = 'ecostone.local';
const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USUARIO_SIMPLE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
const SUFIJO_CLAVE = '~ecostone~';

export function normalizarUsuario(acceso) {
  // Sin tildes ni mayúsculas: "María López" y "maria lopez" son el mismo usuario.
  return String(acceso ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function accesoAEmail(acceso) {
  const texto = normalizarUsuario(acceso);
  if (!texto) throw new Error('Escribe un usuario o correo');
  if (CORREO_VALIDO.test(texto)) return texto;
  if (USUARIO_SIMPLE.test(texto) && texto.length <= 60) return `${texto}@${DOMINIO_USUARIOS}`;
  const hash = createHash('sha256').update(texto, 'utf8').digest('hex').slice(0, 32);
  return `u-${hash}@${DOMINIO_USUARIOS}`;
}

// Contraseñas cortas se completan con un sufijo fijo sólo para cumplir el
// mínimo de Supabase; el usuario nunca lo ve ni lo escribe.
export function claveInterna(password) {
  const p = String(password ?? '');
  return p.length >= 6 ? p : p + SUFIJO_CLAVE;
}

export function accesoVisible(usuario) {
  if (!usuario?.email) return null;
  if (usuario.user_metadata?.usuario) return usuario.user_metadata.usuario;
  const email = usuario.email;
  return email.endsWith(`@${DOMINIO_USUARIOS}`) ? email.slice(0, -(DOMINIO_USUARIOS.length + 1)) : email;
}
