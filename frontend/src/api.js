import { idDispositivo } from './lib/dispositivo.js';

async function llamar(method, path, session, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        'X-Dispositivo': idDispositivo(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch falla por completo (sin internet, servidor caído) antes de
    // llegar a responder — sin esto se veía "Failed to fetch" en inglés.
    throw new Error('Sin conexión con el servidor. Revisa el internet e intenta de nuevo.');
  }
  const texto = await res.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!res.ok) throw new Error(datos?.error || `Error ${res.status}`);
  return datos;
}

// Catálogos que casi no cambian (clientes, productos, listas de precio…): se
// guardan en memoria unos minutos, se comparten entre pantallas y las
// peticiones iguales que van en vuelo se juntan en una sola. Cualquier
// escritura (POST/PUT/DELETE) vacía la memoria para no mostrar datos viejos.
const memoria = new Map();
const TTL = 5 * 60 * 1000;

function enMemoria(path, session) {
  const hit = memoria.get(path);
  if (hit && Date.now() - hit.ts < TTL) return hit.promesa;
  const promesa = llamar('GET', path, session);
  memoria.set(path, { ts: Date.now(), promesa });
  promesa.catch(() => memoria.delete(path));
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
  // Calienta la memoria apenas se entra, para que cotizar/vender abra al instante.
  precargar(session, rol) {
    if (rol === 'produccion') return;
    for (const r of ['/clientes?todos=1', '/productos', '/listas-precio', '/listas-precio/precios', '/insumos/parametros', '/formas-pago', '/categorias']) enMemoria(r, session).catch(() => {});
  },
};
