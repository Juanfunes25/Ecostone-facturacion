// Rangos de fechas en días de calendario de HONDURAS. Antes se usaba
// toISOString() (UTC): después de las 6 p. m. "Hoy" ya era mañana y el
// reporte de "hoy" salía vacío.
const ZONA = 'America/Tegucigalpa';
const formato = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' });

export function fechaHn(d = new Date()) {
  return formato.format(d);
}

// Suma días a una fecha "YYYY-MM-DD" sin pasar por la zona del navegador.
export function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diaSemana(fecha) {
  return (new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
}

export function hoyHn() {
  return fechaHn();
}

export function primerDiaMesHn() {
  return `${hoyHn().slice(0, 7)}-01`;
}

export function rangoHoy() {
  const hoy = hoyHn();
  return { fechaInicio: hoy, fechaFin: hoy };
}

export function rangoAyer() {
  const ayer = sumarDias(hoyHn(), -1);
  return { fechaInicio: ayer, fechaFin: ayer };
}

export function rangoEstaSemana() {
  const hoy = hoyHn();
  return { fechaInicio: sumarDias(hoy, -diaSemana(hoy)), fechaFin: hoy };
}

export function rangoSemanaPasada() {
  const lunes = sumarDias(hoyHn(), -diaSemana(hoyHn()) - 7);
  return { fechaInicio: lunes, fechaFin: sumarDias(lunes, 6) };
}

export function rangoEsteMes() {
  return { fechaInicio: primerDiaMesHn(), fechaFin: hoyHn() };
}

export function rangoMesPasado() {
  const finMesPasado = sumarDias(primerDiaMesHn(), -1);
  return { fechaInicio: `${finMesPasado.slice(0, 7)}-01`, fechaFin: finMesPasado };
}

export function rangoUltimos30() {
  const hoy = hoyHn();
  return { fechaInicio: sumarDias(hoy, -29), fechaFin: hoy };
}

export function rangoEsteAno() {
  return { fechaInicio: `${hoyHn().slice(0, 4)}-01-01`, fechaFin: hoyHn() };
}

export const ATAJOS_FECHA = [
  { etiqueta: 'Hoy', calcular: rangoHoy },
  { etiqueta: 'Esta semana', calcular: rangoEstaSemana },
  { etiqueta: 'Este mes', calcular: rangoEsteMes },
];

export const ATAJOS_REPORTES = [
  { etiqueta: 'Hoy', calcular: rangoHoy },
  { etiqueta: 'Ayer', calcular: rangoAyer },
  { etiqueta: 'Esta semana', calcular: rangoEstaSemana },
  { etiqueta: 'Semana pasada', calcular: rangoSemanaPasada },
  { etiqueta: 'Este mes', calcular: rangoEsteMes },
  { etiqueta: 'Mes pasado', calcular: rangoMesPasado },
  { etiqueta: 'Últimos 30 días', calcular: rangoUltimos30 },
  { etiqueta: 'Este año', calcular: rangoEsteAno },
];
