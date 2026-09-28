// Registra en la bitácora lo que se hace dentro de la app (pantallas que
// se abren, productos que se quitan de una orden, búsquedas…). Nunca
// bloquea ni muestra errores: si falla, la operación sigue igual.
import { idDispositivo } from './dispositivo.js';

let sesionActual = null;

export function fijarSesionEventos(session) {
  sesionActual = session;
}

export function registrarEvento(accion, detalle = {}, sucursalId = null) {
  if (!sesionActual?.access_token) return;
  fetch('/api/antifraude/evento', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sesionActual.access_token}`,
      'X-Dispositivo': idDispositivo(),
    },
    body: JSON.stringify({ accion, detalle, sucursal_id: sucursalId || undefined }),
    keepalive: true,
  }).catch(() => {});
}

// Intento fallido de inicio de sesión (no hay sesión todavía).
export function reportarLoginFallido(acceso) {
  fetch('/api/sesion/login-fallido', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dispositivo': idDispositivo() },
    body: JSON.stringify({ acceso }),
  }).catch(() => {});
}
