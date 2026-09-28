// Espejo de backend/lib/cierre.js (calcularCuadre) para mostrar las
// diferencias en vivo mientras se llenan los montos. El cierre definitivo
// lo recalcula el servidor con las facturas reales del turno.
import { round2 } from './facturacion.js';

export function calcularCuadre(sistema, entradas) {
  const n = (v) => round2(Number(v || 0));
  const tarjetaReportada = round2(n(entradas.pos_bac) + n(entradas.pos_ficohsa));
  const diferenciaTarjeta = round2(tarjetaReportada - n(sistema.tarjeta));
  const efectivoEsperado = round2(n(entradas.fondo_caja) + n(sistema.efectivo) - n(entradas.salidas));
  const diferenciaEfectivo = round2(n(entradas.efectivo_contado) - efectivoEsperado);
  return {
    tarjeta_reportada: tarjetaReportada,
    diferencia_tarjeta: diferenciaTarjeta,
    efectivo_esperado: efectivoEsperado,
    diferencia_efectivo: diferenciaEfectivo,
    diferencia_total: round2(diferenciaTarjeta + diferenciaEfectivo),
  };
}

export function estadoDiferencia(dif) {
  const d = Number(dif ?? 0);
  if (Math.abs(d) < 0.005) return { clase: 'cuadra', texto: 'Cuadra' };
  if (Math.abs(d) < 1) return { clase: 'centavos', texto: d < 0 ? 'Faltan centavos' : 'Sobran centavos' };
  return d < 0 ? { clase: 'faltante', texto: 'Faltante' } : { clase: 'sobrante', texto: 'Sobrante' };
}

// <input type="datetime-local"> trabaja en hora local sin zona; el servidor
// guarda timestamptz. Convertir explícitamente evita el desfase de 6 horas
// (UTC vs. Honduras) al filtrar las facturas del turno.
export function isoAInputLocal(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function inputLocalAIso(valor) {
  return new Date(valor).toISOString();
}

export function inicioDeHoyIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
