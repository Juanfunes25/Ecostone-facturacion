import { idDispositivo } from './lib/dispositivo.js';
import { empresaActiva } from './lib/empresa.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function llamar(method, path, session, body, intento = 0) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        'X-Dispositivo': idDispositivo(),
        'X-Empresa': empresaActiva(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch falla por completo (sin internet, servidor caído) antes de
    // llegar a responder — sin esto se veía "Failed to fetch" en inglés.
    throw new Error('Sin conexión con el servidor. Revisa el internet e intenta de nuevo.');
  }
  // 502/503/504: el servidor se está reiniciando o despertando. Las consultas (GET) se reintentan solas.
  if ([502, 503, 504].includes(res.status) && method === 'GET' && intento < 3) {
    await esperar(1500 * (intento + 1));
    return llamar(method, path, session, body, intento + 1);
  }
  const texto = await res.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { /* respuesta que no es JSON (página de error del servidor) */ }
  if (!res.ok && datos === null && [502, 503, 504].includes(res.status)) throw new Error('El servidor se está reiniciando o despertando. Espera unos segundos y vuelve a intentar.');
  if (!res.ok) {
    const e = new Error(datos?.error || `Error ${res.status}`);
    e.codigo = datos?.codigo;
    e.faltantes = datos?.faltantes;
    throw e;
  }
  return datos;
}

// Catálogos que casi no cambian (clientes, productos, listas de precio…): se
// guardan en memoria unos minutos, se comparten entre pantallas y las
// peticiones iguales que van en vuelo se juntan en una sola. Cualquier
// escritura (POST/PUT/DELETE) vacía la memoria para no mostrar datos viejos.
const memoria = new Map();
const TTL = 5 * 60 * 1000;

function enMemoria(path, session) {
  const clave = `${empresaActiva()}|${path}`;
  const hit = memoria.get(clave);
  if (hit && Date.now() - hit.ts < TTL) return hit.promesa;
  const promesa = llamar('GET', path, session);
  memoria.set(clave, { ts: Date.now(), promesa });
  promesa.catch(() => memoria.delete(clave));
  return promesa;
}

const escribir = (method) => (path, session, body) => {
  memoria.clear();
  return llamar(method, path, session, body);
};

export const api = {
  get: (path, session) => llamar('GET', path, session),
  // Igual que get, pero con memoria (solo para catálogos).
  cache: enMemoria,
  post: escribir('POST'),
  put: escribir('PUT'),
  del: (path, session) => { memoria.clear(); return llamar('DELETE', path, session); },
  limpiarCache: () => memoria.clear(),
  // Calienta la memoria apenas se entra, para que cotizar/vender abra al instante.
  precargar(session, rol) {
    if (['produccion', 'gestor'].includes(rol)) return;
    const comunes = ['/clientes?todos=1', '/formas-pago', '/categorias'];
    const propias = empresaActiva() === 'diserco' ? ['/diserco/productos'] : ['/productos', '/listas-precio', '/listas-precio/precios', '/insumos/parametros'];
    for (const r of [...comunes, ...propias]) enMemoria(r, session).catch(() => {});
  },
};
