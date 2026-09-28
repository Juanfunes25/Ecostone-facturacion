// Honduras usa UTC-6 todo el año (sin horario de verano). Las fechas de los
// filtros llegan como "YYYY-MM-DD" (días de calendario en Honduras) y la
// base guarda timestamptz en UTC. Comparar "2026-09-27" directo contra
// fecha_emision tenía dos errores:
//   1. "hasta 2026-09-27" era "hasta 2026-09-27 00:00 UTC": dejaba fuera
//      TODO el último día del rango.
//   2. El día empezaba y terminaba 6 horas antes de lo real, así que las
//      ventas de la noche (después de las 6 p. m.) caían en el día siguiente.
export const ZONA_HN = 'America/Tegucigalpa';
const OFFSET_HN = '-06:00';
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function inicioDelDia(valor) {
  if (!valor) return null;
  return SOLO_FECHA.test(valor) ? new Date(`${valor}T00:00:00${OFFSET_HN}`).toISOString() : valor;
}

export function finDelDia(valor) {
  if (!valor) return null;
  return SOLO_FECHA.test(valor) ? new Date(`${valor}T23:59:59.999${OFFSET_HN}`).toISOString() : valor;
}

// Aplica el rango a una consulta de Supabase sobre una columna timestamptz.
export function filtrarRango(query, columna, fechaInicio, fechaFin) {
  const desde = inicioDelDia(fechaInicio);
  const hasta = finDelDia(fechaFin);
  if (desde) query = query.gte(columna, desde);
  if (hasta) query = query.lte(columna, hasta);
  return query;
}

const formatoFecha = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HN, year: 'numeric', month: '2-digit', day: '2-digit' });
const formatoHora = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HN, hour: '2-digit', hourCycle: 'h23' });
const formatoDiaSemana = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HN, weekday: 'short' });
const DIAS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// Día de calendario en Honduras (YYYY-MM-DD) de un timestamp.
export function fechaHn(iso) {
  return formatoFecha.format(new Date(iso));
}

export function horaHn(iso) {
  return Number(formatoHora.format(new Date(iso))) % 24;
}

// 0 = lunes … 6 = domingo
export function diaSemanaHn(iso) {
  return DIAS[formatoDiaSemana.format(new Date(iso))];
}

export function hoyHn() {
  return fechaHn(new Date().toISOString());
}
