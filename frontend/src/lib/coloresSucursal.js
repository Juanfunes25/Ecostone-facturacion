// Color fijo por sucursal, para que un cajero nunca confunda en cuál está
// facturando. El color se guarda en la base de datos (sucursales.color) y
// se elige en la pantalla Sucursales; App.jsx lo registra acá apenas carga
// la lista, y toda la app lo lee con colorSucursal(id).

// Paleta validada contra el fondo navy: todos >= 4.3:1 como texto sobre el
// panel y >= 4.5:1 sobre navy. Sobre un relleno de estos colores el texto va
// oscuro (--navy), que contrasta mejor que el blanco.
export const PALETA_SUCURSALES = [
  { color: '#c5603c', nombre: 'Terracota' },
  { color: '#2e9e8f', nombre: 'Verde azulado' },
  { color: '#b08d28', nombre: 'Dorado' },
  { color: '#6c7fd6', nombre: 'Azul' },
  { color: '#d2567a', nombre: 'Frambuesa' },
  { color: '#3d9fd6', nombre: 'Celeste' },
  { color: '#7fa83e', nombre: 'Lima' },
  { color: '#a47bd6', nombre: 'Lila' },
];

const registrados = new Map();

export function registrarColoresSucursales(sucursales) {
  registrados.clear();
  for (const s of sucursales) if (s.color) registrados.set(s.id, s.color);
}

// Respaldo si una sucursal todavía no tiene color guardado.
function hashEstable(texto) {
  let h = 0;
  for (let i = 0; i < texto.length; i++) {
    h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function colorSucursal(sucursalId) {
  if (!sucursalId) return 'var(--text-dim)';
  return registrados.get(sucursalId) ?? PALETA_SUCURSALES[hashEstable(sucursalId) % 4].color;
}

// "Inversiones Milano S de R.L. - 10 Calle" → "10 Calle": la parte que
// realmente distingue una sucursal de otra, para mostrarla en grande.
export function nombreCortoSucursal(nombre) {
  if (!nombre) return '';
  const partes = nombre.split(' - ');
  return partes.length > 1 ? partes.slice(1).join(' - ') : nombre;
}

// Primer color de la paleta que ninguna sucursal está usando.
export function colorLibre(sucursales) {
  const usados = new Set(sucursales.map((s) => s.color).filter(Boolean));
  return PALETA_SUCURSALES.find((p) => !usados.has(p.color))?.color ?? PALETA_SUCURSALES[0].color;
}
