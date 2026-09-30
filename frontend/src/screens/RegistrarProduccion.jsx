import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { num } from '../lib/fmt.js';
import { pdfEnVentana, verPdf } from '../lib/documentos.js';

const hora = (iso) => new Date(iso).toLocaleTimeString('es-HN', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Tegucigalpa' });
const dia = (iso) => new Date(iso).toLocaleDateString('es-HN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'America/Tegucigalpa' });
const ESTADO = { curando: ['En secado', 'var(--aviso)'], terminada: ['Lista para vender', 'var(--ok)'], planificada: ['Por iniciar', 'var(--info)'], cancelada: ['Cancelada', 'var(--text-dim)'] };

const boton = (activo) => ({
  minHeight: 60, padding: '10px 12px', borderRadius: 16, fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer', width: '100%',
  border: `3px solid ${activo ? 'var(--primario)' : 'var(--border)'}`, background: activo ? 'var(--primario)' : 'var(--navy-panel)', color: activo ? '#fff' : 'var(--text)',
});
const paso = { margin: '20px 0 8px', fontSize: '1.05rem', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 };

// Pantalla del operario (celular): 1) modelo 2) color 3) cuántas cajas 4) ENVIAR.
// La etiqueta del lote se abre sola; la fecha, la hora y el usuario se guardan solos.
export default function RegistrarProduccion({ session, perfil }) {
  const [catalogo, setCatalogo] = useState([]);
  const [recientes, setRecientes] = useState([]);
  const [modelo, setModelo] = useState('');
  const [color, setColor] = useState('');
  const [tipo, setTipo] = useState('plana');
  const [cantidad, setCantidad] = useState(0);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');
  const [verRecientes, setVerRecientes] = useState(false);

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
  const valida = producto && cantidad > 0;

  function elegirProducto(p) {
    setModelo(p.modelo); setColor(p.color); setTipo(p.esquina ? 'esquina' : 'plana'); setResultado(null); setError('');
  }
  function elegirModelo(m) { setModelo(m); setColor(''); setTipo('plana'); setResultado(null); setError(''); }
  function elegirColor(c) {
    setColor(c); setResultado(null); setError('');
    setTipo(catalogo.some((p) => p.modelo === modelo && p.color === c && !p.esquina) ? 'plana' : 'esquina');
  }
  const sumar = (n) => setCantidad((c) => Math.max(0, Math.min(9999, c + n)));

  async function enviar() {
    // La ventana de la etiqueta se abre en el mismo toque (si no, el navegador la bloquea).
    const ventana = window.open('', '_blank');
    if (ventana) ventana.document.body.textContent = 'Generando etiqueta…';
    setEnviando(true);
    setError('');
    try {
      const r = await api.post('/registro-produccion', session, { producto_id: producto.id, cantidad });
      setResultado({ ...r, producto_id: producto.id });
      if (ventana) pdfEnVentana(ventana, `/registro-produccion/${r.orden_id}/etiqueta`, session).catch((e) => setError(e.message));
      setCantidad(0); setConfirmando(false); setModelo(''); setColor('');
      cargar().catch(() => {});
    } catch (e) {
      ventana?.close();
      setError(e.message);
      setConfirmando(false);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 110 }}>
      {error && <div className="error" style={{ fontSize: '1rem' }} onClick={() => setError('')}>{error}</div>}

      {resultado && (
        <div className="panel" style={{ borderLeft: '8px solid var(--ok)' }}>
          <h2 style={{ marginTop: 0, color: 'var(--ok)', fontSize: '1.6rem' }}>✔ Listo, registrado</h2>
          <p style={{ fontSize: '1.4rem', margin: '4px 0' }}><strong>{num(resultado.cantidad, 0)} {resultado.unidad === 'm²' ? 'cajas' : resultado.unidad}</strong></p>
          <p style={{ fontSize: '1.1rem', margin: '0 0 4px' }}>{resultado.producto}</p>
          <p style={{ margin: '4px 0', color: 'var(--text-dim)' }}>Lote {resultado.lote} · {dia(resultado.registrado_at)} {hora(resultado.registrado_at)}</p>
          {resultado.avisos.map((a) => <div key={a} className="error" style={{ marginTop: 8 }}>{a}</div>)}
          <button style={{ ...boton(false), marginTop: 12 }} onClick={() => verPdf(`/registro-produccion/${resultado.orden_id}/etiqueta`, session).catch((e) => setError(e.message))}>🏷 Imprimir etiqueta</button>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <button style={boton(true)} onClick={() => { const p = catalogo.find((x) => x.id === resultado.producto_id); if (p) elegirProducto(p); setResultado(null); }}>Otra igual</button>
            <button style={boton(false)} onClick={() => setResultado(null)}>Nueva</button>
          </div>
        </div>
      )}

      {!resultado && (
        <>
          <h3 style={paso}>1 · Modelo</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {modelos.map((m) => <button key={m} style={boton(modelo === m)} onClick={() => elegirModelo(m)}>{m}</button>)}
          </div>

          {modelo && (
            <>
              <h3 style={paso}>2 · Color</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                {colores.map((c) => <button key={c} style={boton(color === c)} onClick={() => elegirColor(c)}>{c}</button>)}
              </div>
            </>
          )}

          {color && tieneEsquina && tienePlana && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <button style={boton(tipo === 'plana')} onClick={() => setTipo('plana')}>Piedra plana</button>
              <button style={boton(tipo === 'esquina')} onClick={() => setTipo('esquina')}>Caja de esquina</button>
            </div>
          )}

          {producto && (
            <>
              <h3 style={paso}>3 · Cuántas cajas</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr 84px', gap: 10, alignItems: 'center' }}>
                <button style={{ ...boton(false), minHeight: 84, fontSize: '2.4rem' }} onClick={() => sumar(-1)} aria-label="Menos">−</button>
                <input type="number" inputMode="numeric" min="0" step="1" value={cantidad || ''} placeholder="0"
                  onChange={(e) => setCantidad(Math.max(0, Math.min(9999, Math.floor(Number(e.target.value) || 0))))}
                  style={{ width: '100%', minHeight: 84, fontSize: '2.6rem', textAlign: 'center', fontWeight: 800, borderRadius: 16 }} />
                <button style={{ ...boton(true), minHeight: 84, fontSize: '2.4rem' }} onClick={() => sumar(1)} aria-label="Más">+</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 10 }}>
                {[5, 10, 20, 50].map((n) => <button key={n} style={{ ...boton(false), minHeight: 52, fontSize: '1rem' }} onClick={() => sumar(n)}>+{n}</button>)}
              </div>
              {cantidad > 0 && <button style={{ ...boton(false), minHeight: 44, fontSize: '0.95rem', marginTop: 8, opacity: 0.8 }} onClick={() => setCantidad(0)}>Borrar cantidad</button>}
              {!producto.con_receta && <p style={{ color: 'var(--aviso)', fontSize: '0.95rem' }}>Este modelo aún no tiene receta: se guarda la producción sin descontar materia prima.</p>}
            </>
          )}
        </>
      )}

      {/* Barra de envío siempre a la vista */}
      {!resultado && producto && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 14px calc(10px + env(safe-area-inset-bottom))', background: 'var(--navy-panel)', borderTop: '1px solid var(--border)', zIndex: 20 }}>
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <button disabled={!valida || enviando} onClick={() => setConfirmando(true)}
              style={{ ...boton(true), minHeight: 72, fontSize: '1.4rem', background: valida ? 'var(--ok)' : undefined, borderColor: valida ? 'var(--ok)' : undefined, opacity: valida ? 1 : 0.45 }}>
              {valida ? `ENVIAR · ${num(cantidad, 0)} cajas` : 'ENVIAR'}
            </button>
          </div>
        </div>
      )}

      {confirmando && producto && (
        <div className="overlay">
          <div className="tarjeta" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <h2 style={{ marginTop: 0 }}>¿Está bien?</h2>
            <p style={{ fontSize: '2.2rem', margin: '8px 0', fontWeight: 800 }}>{num(cantidad, 0)} {producto.unidad === 'm²' ? 'cajas' : producto.unidad}</p>
            <p style={{ fontSize: '1.2rem', margin: '0 0 16px' }}>{producto.nombre}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button style={boton(false)} disabled={enviando} onClick={() => setConfirmando(false)}>Corregir</button>
              <button style={{ ...boton(true), background: 'var(--ok)', borderColor: 'var(--ok)' }} disabled={enviando} onClick={enviar}>{enviando ? 'Enviando…' : 'Sí, enviar'}</button>
            </div>
          </div>
        </div>
      )}

      {!resultado && recientes.length > 0 && (
        <div className="panel" style={{ marginTop: 24 }}>
          <button
            type="button"
            onClick={() => setVerRecientes((v) => !v)}
            aria-expanded={verRecientes}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', fontWeight: 700 }}
          >
            <span>{perfil.rol === 'produccion' ? 'Lo que registré' : 'Registros recientes'} ({Math.min(recientes.length, 8)})</span>
            <span aria-hidden="true">{verRecientes ? '▲' : '▼'}</span>
          </button>
          {verRecientes && recientes.slice(0, 8).map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0 }}>
                <strong>{r.producto}</strong>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{dia(r.registrado_at)} {hora(r.registrado_at)} · {r.lote}{perfil.rol !== 'produccion' && r.operario ? ` · ${r.operario}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <strong>{num(r.cantidad, 0)}</strong>
                <div style={{ fontSize: '0.8rem', color: (ESTADO[r.estado] ?? ESTADO.planificada)[1] }}>{(ESTADO[r.estado] ?? ESTADO.planificada)[0]}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
