import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// Aviso inmediato al administrador cuando entra una alerta nueva: tarjeta
// emergente, sonido corto y notificación del navegador (aunque la pestaña
// esté en segundo plano).
function sonar(severidad) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const tonos = severidad === 'alta' ? [880, 660, 880] : [740];
    tonos.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
  } catch {
    // sin audio disponible
  }
}

export default function NotificacionesAlertas({ session, onVer }) {
  const [avisos, setAvisos] = useState([]);
  const ultimoId = useRef(null);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    let activo = true;
    async function revisar() {
      try {
        const nuevas = await api.get(`/antifraude/alertas/nuevas?desde_id=${ultimoId.current ?? 0}`, session);
        if (!activo || nuevas.length === 0) return;
        const maxId = Math.max(...nuevas.map((a) => a.id));
        // La primera consulta sólo fija el punto de partida (no avisa lo viejo).
        if (ultimoId.current === null) {
          ultimoId.current = maxId;
          return;
        }
        ultimoId.current = maxId;
        const relevantes = nuevas.filter((a) => a.severidad !== 'baja');
        if (relevantes.length === 0) return;
        setAvisos((a) => [...relevantes, ...a].slice(0, 4));
        sonar(relevantes.some((a) => a.severidad === 'alta') ? 'alta' : 'media');
        if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
          for (const a of relevantes.slice(0, 3)) new Notification('Alerta Ítalo', { body: a.titulo, tag: `alerta-${a.id}` });
        }
      } catch {
        // se reintenta en el próximo ciclo
      }
    }
    if (ultimoId.current === null) {
      api
        .get('/antifraude/alertas/nuevas', session)
        .then((r) => {
          ultimoId.current = r.length ? Math.max(...r.map((a) => a.id)) : 0;
        })
        .catch(() => {
          ultimoId.current = 0;
        });
    }
    const t = setInterval(revisar, 30 * 1000);
    return () => {
      activo = false;
      clearInterval(t);
    };
  }, [session]);

  if (avisos.length === 0) return null;
  return (
    <div className="notif-pila">
      {avisos.map((a) => (
        <div key={a.id} className={`notif notif-${a.severidad}`}>
          <div>
            <strong>{a.severidad === 'alta' ? '⚠ Alerta alta' : 'Alerta'}</strong>
            <p>{a.titulo}</p>
          </div>
          <div className="notif-acciones">
            <button
              className="boton-sm"
              onClick={() => {
                setAvisos((l) => l.filter((x) => x.id !== a.id));
                onVer();
              }}
            >
              Ver
            </button>
            <button className="boton-sm boton-secundario" onClick={() => setAvisos((l) => l.filter((x) => x.id !== a.id))}>
              Cerrar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
