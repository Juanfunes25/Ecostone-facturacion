import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient.js';

// Sincronización en tiempo real con Supabase Realtime (WebSockets sobre
// los cambios de Postgres): cuando una sucursal factura, cambia un precio
// o se abre/cierra una orden, las demás pantallas se enteran al instante,
// sin recargar. Respeta RLS: un cajero sólo recibe eventos de su sucursal.
//
// Las ráfagas (ej. 5 productos agregados seguidos) se agrupan en una sola
// recarga para no martillar al servidor.
export function useCambiosEnVivo(tablas, alCambiar, { filtro, retrasoMs = 300, activo = true } = {}) {
  const callbackRef = useRef(alCambiar);
  callbackRef.current = alCambiar;
  const clave = `${tablas.join(',')}|${filtro ?? ''}`;

  useEffect(() => {
    if (!activo) return undefined;
    let temporizador;
    const canal = supabase.channel(`vivo:${clave}:${Math.random().toString(36).slice(2, 8)}`);
    for (const tabla of tablas) {
      canal.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabla, ...(filtro ? { filter: filtro } : {}) },
        (payload) => {
          clearTimeout(temporizador);
          temporizador = setTimeout(() => callbackRef.current(payload), retrasoMs);
        }
      );
    }
    canal.subscribe();
    return () => {
      clearTimeout(temporizador);
      supabase.removeChannel(canal);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, activo]);
}

// Estado de la conexión en vivo, para el indicador de la barra superior.
export function useConexionEnVivo() {
  const [conectado, setConectado] = useState(false);
  useEffect(() => {
    const canal = supabase
      .channel(`estado-vivo:${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ventas' }, () => {})
      .subscribe((estado) => setConectado(estado === 'SUBSCRIBED'));
    return () => {
      supabase.removeChannel(canal);
    };
  }, []);
  return conectado;
}
