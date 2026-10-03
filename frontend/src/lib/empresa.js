// Empresa con la que se está trabajando (EcoStone o DISERCO). Cada petición al
// servidor la manda en X-Empresa; el servidor además valida que el usuario
// tenga acceso. Se recuerda mientras dure la pestaña.
const CLAVE = 'ecostone-facturacion:empresa';
let activa = '';
try { activa = sessionStorage.getItem(CLAVE) ?? ''; } catch { /* sin almacenamiento */ }

export const empresaActiva = () => activa;

export function fijarEmpresa(codigo) {
  activa = codigo || '';
  try {
    if (activa) sessionStorage.setItem(CLAVE, activa);
    else sessionStorage.removeItem(CLAVE);
  } catch { /* sin almacenamiento */ }
}
