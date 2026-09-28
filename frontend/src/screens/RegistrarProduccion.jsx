import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { num } from '../lib/fmt.js';

const hora = (iso) => new Date(iso).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Tegucigalpa' });
const dia = (iso) => new Date(iso).toLocaleDateString('es-HN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'America/Tegucigalpa' });
const ESTADO = { curando: ['En secado', 'var(--aviso)'], terminada: ['Lista para vender', 'var(--ok)'], planificada: ['Por iniciar', 'var(--info)'], cancelada: ['Cancelada', 'var(--text-dim)'] };

const boton = (activo) => ({
  minHeight: 56, padding: '10px 14px', borderRadius: 14, fontSize: '1.05rem', fontWeight: 600, cursor: 'pointer',
  border: `2px solid ${activo ? 'var(--primario)' : 'var(--border)'}`, background: activo ? 'var(--primario)' : 'var(--navy-panel)', color: activo ? '#fff' : 'var(--text)',
});

// Pantalla pensada para el celular del operario: modelo → color → cantidad → enviar.
export default function RegistrarProduccion({ session, perfil }) {
  const [catalogo, setCatalogo] = useState([]);
  const [recientes, setRecientes] = useState([]);
  const [modelo, setModelo] = useState('');
  const [color, setColor] = useState('');
  const [tipo, setTipo] = useState('plana');
  const [cantidad, setCantidad] = useState('');
  const [nota, setNota] = useState('');
  const [verNota, setVerNota] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');

  async function cargar() {
    const [c, r] = await Promise.all([api.get('/registro-produccion/catalogo', session), api.get('/registro-produccion/recientes', session)]);
    setCatalogo(c);
    setRecientes(r);
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, []);

  const modelos = useMemo(() => [...new Set(catalogo.map((p) => p.modelo))], [catalogo]);
  const colores = useMemo(() => [...new Set(catalogo.filter((p) => p.modelo === modelo).map((p) => p.color))], [catalogo, modelo]);
  const variantes = useMemo(() => catalogo.filter((p) => p.modelo === modelo && p.color === color), [catalogo, modelo, color]);
  const tieneEsquina = variantes.some((p) => p.esquina);
  const tienePlana = variantes.some((p) => !p.esquina);
  const producto = variantes.find((p) => (tipo === 'esquina') === p.esquina) ?? (variantes.length === 1 ? variantes[0] : null);
  const valida = producto && Number(cantidad) > 0;

  function elegirModelo(m) { setModelo(m); setColor(''); setTipo('plana'); setResultado(null); setError(''); }
  function elegirColor(c) {
    setColor(c); setResultado(null); setError('');
    const v = catalogo.filter((p) => p.modelo === modelo && p.color === c);
    setTipo(v.some((p) => !p.esquina) ? 'plana' : 'esquina');
  }

  async function enviar() {
    setEnviando(true);
    setError('');
    try {
      const r = await api.post('/registro-produccion', session, { producto_id: producto.id, cantidad: Number(cantidad), nota });
      setResultado(r);
      setCantidad(''); setNota(''); setVerNota(false); setConfirmando(false); setModelo(''); setColor('');
      cargar().catch(() => {});
    } catch (e) {
      setError(e.message);
      setConfirmando(false);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Registrar producción</h2>
        <p style={{ color: 'var(--text-dim)', margin: 0 }}>Hola {perfil.nombre}. Elige lo que produjiste y envíalo; la fecha y la hora se guardan solas.</p>
      </div>

      {resultado && (
        <div className="panel" style={{ borderLeft: '6px solid var(--ok)' }}>
          <h2 style={{ marginTop: 0, color: 'var(--ok)' }}>✔ Producción registrada</h2>
          <p style={{ fontSize: '1.2rem', margin: '4px 0' }}><strong>{num(resultado.cantidad, 2)} {resultado.unidad}</strong> de {resultado.producto}</p>
          <p style={{ margin: '4px 0', color: 'var(--text-dim)' }}>Lote {resultado.lote} · {dia(resultado.registrado_at)} {hora(resultado.registrado_at)} · queda lista para vender el {resultado.disponible_desde}</p>
          {resultado.avisos.map((a) => <div key={a} className="error" style={{ marginTop: 8 }}>{a}</div>)}
          <button style={{ ...boton(true), width: '100%', marginTop: 12 }} onClick={() => setResultado(null)}>Registrar otra</button>
        </div>
      )}

      {!resultado && (
        <div className="panel">
          {error && <div className="error" onClick={() => setError('')}>{error}</div>}
          <h3 style={{ margin: '0 0 8px' }}>1. Modelo</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {modelos.map((m) => <button key={m} style={boton(modelo === m)} onClick={() => elegirModelo(m)}>{m}</button>)}
          </div>

          {modelo && (
            <>
              <h3 style={{ margin: '18px 0 8px' }}>2. Color</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                {colores.map((c) => <button key={c} style={boton(color === c)} onClick={() => elegirColor(c)}>{c}</button>)}
              </div>
            </>
          )}

          {color && tieneEsquina && tienePlana && (
            <>
              <h3 style={{ margin: '18px 0 8px' }}>Tipo de pieza</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <button style={boton(tipo === 'plana')} onClick={() => setTipo('plana')}>Piedra plana</button>
                <button style={boton(tipo === 'esquina')} onClick={() => setTipo('esquina')}>Caja de esquina</button>
              </div>
            </>
          )}

          {producto && (
            <>
              <h3 style={{ margin: '18px 0 8px' }}>3. Cantidad producida ({producto.unidad})</h3>
              <input type="number" inputMode="decimal" min="0" step="any" placeholder={`0 ${producto.unidad}`} value={cantidad} onChange={(e) => setCantidad(e.target.value)}
                style={{ width: '100%', minHeight: 72, fontSize: '2rem', textAlign: 'center', fontWeight: 700, borderRadius: 14 }} />
              {!verNota
                ? <button className="boton-sm boton-secundario" style={{ marginTop: 10 }} onClick={() => setVerNota(true)}>+ Agregar nota</button>
                : <input style={{ marginTop: 10, width: '100%', minHeight: 48 }} placeholder="Nota (opcional)" maxLength={200} value={nota} onChange={(e) => setNota(e.target.value)} />}
              {!producto.con_receta && <p style={{ color: 'var(--aviso)', fontSize: '0.9rem' }}>Este modelo aún no tiene receta: se guardará la producción, pero no se descontará materia prima.</p>}
              <button disabled={!valida || enviando} onClick={() => setConfirmando(true)}
                style={{ ...boton(true), width: '100%', marginTop: 16, minHeight: 68, fontSize: '1.3rem', background: valida ? 'var(--ok)' : undefined, borderColor: valida ? 'var(--ok)' : undefined, opacity: valida ? 1 : 0.5 }}>
                ENVIAR
              </button>
            </>
          )}
        </div>
      )}

      {confirmando && producto && (
        <div className="overlay">
          <div className="tarjeta" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <h2 style={{ marginTop: 0 }}>¿Confirmas?</h2>
            <p style={{ fontSize: '1.6rem', margin: '8px 0' }}><strong>{num(cantidad, 2)} {producto.unidad}</strong></p>
            <p style={{ fontSize: '1.1rem', margin: '0 0 16px' }}>{producto.nombre}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button style={boton(false)} disabled={enviando} onClick={() => setConfirmando(false)}>Corregir</button>
              <button style={{ ...boton(true), background: 'var(--ok)', borderColor: 'var(--ok)' }} disabled={enviando} onClick={enviar}>{enviando ? 'Enviando…' : 'Sí, enviar'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>{perfil.rol === 'produccion' ? 'Mis registros recientes' : 'Registros recientes'}</h3>
        {recientes.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Todavía no hay registros.</p>}
        {recientes.map((r) => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ minWidth: 0 }}>
              <strong>{r.producto}</strong>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{dia(r.registrado_at)} {hora(r.registrado_at)} · {r.lote}{perfil.rol !== 'produccion' && r.operario ? ` · ${r.operario}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <strong>{num(r.cantidad, 2)} {r.unidad}</strong>
              <div style={{ fontSize: '0.8rem', color: (ESTADO[r.estado] ?? ESTADO.planificada)[1] }}>{(ESTADO[r.estado] ?? ESTADO.planificada)[0]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
