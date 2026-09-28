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

export const api = {
  get: (path, session) => llamar('GET', path, session),
  post: (path, session, body) => llamar('POST', path, session, body),
  put: (path, session, body) => llamar('PUT', path, session, body),
  del: (path, session) => llamar('DELETE', path, session),
};
