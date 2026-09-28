import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient.js';
import { api } from '../api.js';
import { claveInterna } from '../lib/acceso.js';
import { registrarEvento } from '../lib/eventos.js';
import { IsotipoEcoStone } from './Icono.jsx';

// Pantalla bloqueada tras X minutos sin uso: evita que otra persona use la
// sesión abierta de un compañero (y que las ventas queden a su nombre).
// Para seguir hay que volver a escribir la contraseña; la orden en curso
// no se pierde.
export default function BloqueoInactividad({ session, perfil }) {
  const [bloqueada, setBloqueada] = useState(false);
  const [minutos, setMinutos] = useState(['cajero', 'ventas'].includes(perfil.rol) ? 10 : perfil.rol === 'produccion' ? 120 : 20);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [intentos, setIntentos] = useState(0);
  const ultimaActividad = useRef(Date.now());

  useEffect(() => {
    api
      .get('/antifraude/reglas', session)
      .then((r) => setMinutos(['cajero', 'ventas'].includes(perfil.rol) ? r.minutos_bloqueo_cajero : r.minutos_bloqueo_otros))
      .catch(() => {});
  }, [session, perfil.rol]);

  useEffect(() => {
    if (!minutos) return undefined;
    const marcar = () => {
      ultimaActividad.current = Date.now();
    };
    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    const t = setInterval(() => {
      if (!bloqueada && Date.now() - ultimaActividad.current > minutos * 60 * 1000) {
        setBloqueada(true);
        registrarEvento('sesion.bloqueo', { minutos_inactivo: minutos });
      }
    }, 15 * 1000);
    return () => {
      eventos.forEach((e) => window.removeEventListener(e, marcar));
      clearInterval(t);
    };
  }, [minutos, bloqueada]);

  async function desbloquear(e) {
    e.preventDefault();
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: claveInterna(password),
    });
    if (err) {
      const n = intentos + 1;
      setIntentos(n);
      registrarEvento('sesion.desbloqueo_fallido', { intento: n });
      setError('Contraseña incorrecta');
      if (n >= 5) supabase.auth.signOut();
      return;
    }
    registrarEvento('sesion.desbloqueo', {});
    setPassword('');
    setIntentos(0);
    ultimaActividad.current = Date.now();
    setBloqueada(false);
  }

  if (!bloqueada) return null;
  return (
    <div className="bloqueo">
      <form className="bloqueo-tarjeta" onSubmit={desbloquear}>
        <span className="bloqueo-logo">
          <IsotipoEcoStone tam={40} color="#d8ccb0" />
        </span>
        <h2>Pantalla bloqueada</h2>
        <p>
          Sesión de <strong>{perfil.nombre}</strong>. Se bloqueó por {minutos} minutos sin uso.
        </p>
        {error && <div className="error">{error}</div>}
        <input type="password" autoFocus placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit">Desbloquear</button>
        <button type="button" className="boton-secundario" onClick={() => supabase.auth.signOut()}>
          Cambiar de usuario
        </button>
      </form>
    </div>
  );
}
