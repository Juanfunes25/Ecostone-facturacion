import { db } from '../db.js';

// Umbrales del antifraude. El admin los ajusta en Antifraude → Reglas;
// estos son los valores de fábrica.
export const REGLAS_POR_DEFECTO = {
  monto_alerta_descarte: 150,
  max_tercera_edad_dia: 10,
  max_usos_carne_dia: 3,
  minutos_orden_estacionada: 60,
  minutos_doble_factura: 5,
  minutos_hueco: 45,
  umbral_sobrante: 50,
  faltantes_reincidencia: 2,
  minutos_bloqueo_cajero: 10,
  minutos_bloqueo_otros: 20,
  intentos_login: 5,
  hora_apertura: 9,
  hora_cierre: 24,
  exigir_carne_tercera_edad: true,
  exigir_motivo_reimpresion: true,
  exigir_motivo_descarte: true,
  leyenda_factura_gratis: false,
};

let cache = null;
let cacheHasta = 0;

export async function obtenerReglas() {
  if (cache && Date.now() < cacheHasta) return cache;
  const { data } = await db.from('config_antifraude').select('reglas').eq('id', 1).maybeSingle();
  cache = { ...REGLAS_POR_DEFECTO, ...(data?.reglas ?? {}) };
  cacheHasta = Date.now() + 60 * 1000;
  return cache;
}

export async function guardarReglas(nuevas, usuarioId) {
  const limpias = {};
  for (const [k, def] of Object.entries(REGLAS_POR_DEFECTO)) {
    if (nuevas[k] === undefined) continue;
    if (typeof def === 'boolean') limpias[k] = Boolean(nuevas[k]);
    else {
      const n = Number(nuevas[k]);
      if (Number.isFinite(n) && n >= 0) limpias[k] = n;
    }
  }
  const actuales = await obtenerReglas();
  const reglas = { ...actuales, ...limpias };
  const { error } = await db.from('config_antifraude').upsert({ id: 1, reglas, updated_at: new Date().toISOString(), updated_by: usuarioId });
  if (error) throw new Error(error.message);
  cache = reglas;
  cacheHasta = Date.now() + 60 * 1000;
  return reglas;
}
