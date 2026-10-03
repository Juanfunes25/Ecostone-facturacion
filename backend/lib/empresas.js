import { db } from '../db.js';

// EcoStone y DISERCO comparten el sistema. La separación se hace por
// sucursal (cada una pertenece a una empresa): facturas, CAI, cierres y
// reportes quedan separados porque cuelgan de la sucursal.
let cacheEmpresas = { ts: 0, datos: new Map() };
let cacheSucursales = { ts: 0, porEmpresa: new Map() };
const VIGENCIA = 60 * 1000;

export const olvidarEmpresas = () => {
  cacheEmpresas = { ts: 0, datos: new Map() };
  cacheSucursales = { ts: 0, porEmpresa: new Map() };
};

export async function datosEmpresa(codigo = 'ecostone') {
  if (Date.now() - cacheEmpresas.ts > VIGENCIA) {
    const { data } = await db.from('empresas').select('*');
    cacheEmpresas = { ts: Date.now(), datos: new Map((data ?? []).map((e) => [e.codigo, e])) };
  }
  return cacheEmpresas.datos.get(codigo) ?? cacheEmpresas.datos.get('ecostone') ?? null;
}

export async function todasLasEmpresas() {
  await datosEmpresa();
  return [...cacheEmpresas.datos.values()].sort((a, b) => a.orden - b.orden);
}

// ids de las sucursales de una empresa
export async function sucursalesDe(empresa) {
  if (Date.now() - cacheSucursales.ts > VIGENCIA) {
    const { data } = await db.from('sucursales').select('id, empresa');
    const porEmpresa = new Map();
    for (const s of data ?? []) porEmpresa.set(s.empresa, [...(porEmpresa.get(s.empresa) ?? []), s.id]);
    cacheSucursales = { ts: Date.now(), porEmpresa };
  }
  return cacheSucursales.porEmpresa.get(empresa) ?? [];
}

// Limita una consulta a las sucursales de la empresa activa.
export async function porEmpresa(req, query, columna = 'sucursal_id') {
  const ids = await sucursalesDe(req.empresa);
  return query.in(columna, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
}

// Empresa activa de la petición: la que manda el navegador (X-Empresa) si el
// usuario tiene acceso; si no, la primera suya.
export function empresaDeLaPeticion(req) {
  const permitidas = req.perfil?.empresas?.length ? req.perfil.empresas : ['ecostone'];
  const pedida = String(req.headers['x-empresa'] ?? '').toLowerCase();
  return permitidas.includes(pedida) ? pedida : permitidas[0];
}
