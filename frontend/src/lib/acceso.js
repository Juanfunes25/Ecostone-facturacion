// Espejo de backend/lib/acceso.js: traduce el usuario libre (con espacios,
// tildes, etc.) y la contraseña de cualquier largo a lo que pide Supabase
// Auth. Tiene que dar EXACTAMENTE el mismo resultado que el backend, si no
// el usuario creado no podría entrar.
const DOMINIO_USUARIOS = 'ecostone.local';
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

export async function accesoAEmail(acceso) {
  const texto = normalizarUsuario(acceso);
  if (CORREO_VALIDO.test(texto)) return texto;
  if (USUARIO_SIMPLE.test(texto) && texto.length <= 60) return `${texto}@${DOMINIO_USUARIOS}`;
  const bytes = new TextEncoder().encode(texto);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  return `u-${hash}@${DOMINIO_USUARIOS}`;
}

export function claveInterna(password) {
  const p = String(password ?? '');
  return p.length >= 6 ? p : p + SUFIJO_CLAVE;
}
