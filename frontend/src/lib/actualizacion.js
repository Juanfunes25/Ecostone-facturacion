import { useEffect, useRef, useState } from 'react';

// Versiones nuevas de la app: el service worker nuevo se activa solo
// (skipWaiting) y aquí se recarga la página para usarlo:
//  - revisa cada 2 minutos y cada vez que la pestaña vuelve a primer plano;
//  - si no hay una venta en curso, recarga de inmediato;
//  - si hay una venta en curso, espera a que termine y mientras muestra un aviso.
let hayVersionNueva = false;
let avisar = () => {};

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  const teniaControlador = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // La primera instalación también dispara este evento: ahí no hay nada que recargar.
    if (!teniaControlador) return;
    hayVersionNueva = true;
    avisar();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registro) => {
        const revisar = () => registro.update().catch(() => {});
        setInterval(revisar, 2 * 60 * 1000);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') revisar();
        });
      })
      .catch(() => {});
  });
}

export function useActualizacion(ventaEnCurso) {
  const [hayNueva, setHayNueva] = useState(hayVersionNueva);
  const ventaRef = useRef(ventaEnCurso);
  ventaRef.current = ventaEnCurso;

  useEffect(() => {
    avisar = () => setHayNueva(true);
    if (hayVersionNueva) setHayNueva(true);
    return () => {
      avisar = () => {};
    };
  }, []);

  useEffect(() => {
    if (hayNueva && !ventaEnCurso) {
      const t = setTimeout(() => window.location.reload(), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [hayNueva, ventaEnCurso]);

  return { hayNueva, actualizarAhora: () => window.location.reload() };
}
