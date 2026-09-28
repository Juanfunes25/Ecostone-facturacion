import { db } from '../db.js';

// Parámetros de negocio editables (tabla parametros). Caché corta.
let cache = null;
let cargadoEn = 0;

export async function obtenerParametros() {
  if (cache && Date.now() - cargadoEn < 30_000) return cache;
  const { data, error } = await db.from('parametros').select('clave, valor');
  if (error) throw new Error(error.message);
  cache = Object.fromEntries((data ?? []).map((r) => [r.clave, r.valor]));
  cargadoEn = Date.now();
  return cache;
}

export function invalidarParametros() {
  cache = null;
}

export const numero = (v, porDefecto = 0) => (Number.isFinite(Number(v)) ? Number(v) : porDefecto);
