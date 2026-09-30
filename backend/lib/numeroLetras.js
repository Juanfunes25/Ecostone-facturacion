const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function menorMil(n) {
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (r < 30) { if (r) partes.push(UNIDADES[r]); }
  else partes.push(DECENAS[Math.floor(r / 10)] + (r % 10 ? ` Y ${UNIDADES[r % 10]}` : ''));
  return partes.join(' ');
}

function entero(n) {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1e6);
  const miles = Math.floor((n % 1e6) / 1e3);
  const resto = n % 1e3;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${entero(millones)} MILLONES`);
  if (miles) partes.push(miles === 1 ? 'MIL' : `${menorMil(miles)} MIL`);
  if (resto) partes.push(menorMil(resto));
  return partes.join(' ');
}

// 3402.84 → "TRES MIL CUATROCIENTOS DOS LEMPIRAS CON 84/100"
export function montoEnLetras(monto) {
  const total = Math.round(Number(monto) * 100);
  const lempiras = Math.floor(total / 100);
  const centavos = String(total % 100).padStart(2, '0');
  const moneda = lempiras === 1 ? 'LEMPIRA' : lempiras !== 0 && lempiras % 1e6 === 0 ? 'DE LEMPIRAS' : 'LEMPIRAS';
  return `${entero(lempiras)} ${moneda} CON ${centavos}/100`;
}
