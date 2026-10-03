import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import AvisoSinStock from '../components/AvisoSinStock.jsx';
import { L, num, fechaCorta } from '../lib/fmt.js';

const sinTildes = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Busca por palabras en cualquier orden y sin tildes: "epox ivory" encuentra "Epóxico Quarzo … Ivory".
function coincide(p, texto) {
  const palabras = sinTildes(texto).split(/\s+/).filter(Boolean);
  const pajar = sinTildes(`${p.nombre} ${p.codigo ?? ''} ${p.presentacion ?? ''} ${p.categorias?.nombre ?? ''}`);
  return palabras.every((w) => pajar.includes(w));
}

// Elegir productos de la bodega: buscador, categorías y una lista compacta con una casilla de cantidad.
function SelectorProductos({ productos, items, onCambiar }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const categorias = useMemo(() => [...new Set(productos.map((p) => p.categorias?.nombre).filter(Boolean))], [productos]);
  const resultados = useMemo(() => productos.filter((p) => (!cat || p.categorias?.nombre === cat) && (!q.trim() || coincide(p, q))), [productos, q, cat]);
  const buscando = Boolean(q.trim() || cat);
  const cantidadDe = (id) => items.find((i) => i.producto_id === id)?.cantidad ?? '';
  const poner = (id, texto) => {
    const c = Math.max(0, Math.round(Number(texto)) || 0);
    if (c === 0) return onCambiar(items.filter((i) => i.producto_id !== id));
    onCambiar(items.some((i) => i.producto_id === id) ? items.map((i) => (i.producto_id === id ? { ...i, cantidad: c } : i)) : [...items, { producto_id: id, cantidad: c }]);
  };

  return (
    <div>
      <input type="search" placeholder="🔍 Buscar producto (escribe parte del nombre)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ fontSize: '1.05rem', padding: '12px' }} />
      {categorias.length > 1 && (
        <div style={{ margin: '8px 0 4px' }}>
          <small style={{ color: 'var(--text-dim)', fontWeight: 700 }}>Categorías:</small>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <button className={cat ? 'boton-sm boton-secundario' : 'boton-sm'} onClick={() => setCat('')}>Todas</button>
            {categorias.map((c) => <button key={c} className={cat === c ? 'boton-sm' : 'boton-sm boton-secundario'} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>)}
          </div>
        </div>
      )}
      {buscando && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 4px 2px', color: 'var(--text-dim)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
            <span>Resultados</span><span>Cantidad</span>
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
            {resultados.map((p) => <Fila key={p.id} p={p} n={cantidadDe(p.id)} onCambiar={(t) => poner(p.id, t)} />)}
            {resultados.length === 0 && <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>No encontré ese producto. Prueba con otra palabra.</p>}
          </div>
        </>
      )}
      {!buscando && <p style={{ color: 'var(--text-dim)', margin: '8px 0' }}>{productos.length === 0 ? 'No hay productos con control de inventario.' : 'Escribe el nombre o elige una categoría para encontrar el producto.'}</p>}

      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', padding: '0 4px 2px' }}>
          <span>Material seleccionado ({items.reduce((s, i) => s + i.cantidad, 0)})</span><span>Cantidad</span>
        </div>
        <div style={{ borderTop: '2px solid var(--color-sucursal)' }}>
          {items.map((i) => { const p = productos.find((x) => x.id === i.producto_id); return p ? <Fila key={i.producto_id} p={p} n={i.cantidad} onCambiar={(t) => poner(p.id, t)} quitar /> : null; })}
          {items.length === 0 && <p style={{ color: 'var(--text-dim)', textAlign: 'center', margin: '10px 0' }}>Todavía no has agregado productos.</p>}
        </div>
      </div>
    </div>
  );
}

// Fila compacta: nombre, existencia y casilla de cantidad (0 o vacío la quita).
function Fila({ p, n, onCambiar, quitar = false }) {
  const falta = n !== '' && n > p.existencia;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderBottom: '1px solid var(--border)', background: n !== '' ? 'color-mix(in srgb, var(--color-sucursal) 12%, transparent)' : undefined }}>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
        <span style={{ fontSize: '0.92rem', fontWeight: n !== '' ? 700 : 500 }}>{p.nombre}</span>
        <small style={{ display: 'block', color: falta || p.existencia <= 0 ? 'var(--peligro)' : 'var(--text-dim)' }}>Hay {num(p.existencia, 0)}{falta ? ' · no alcanza' : ''}</small>
      </div>
      <input type="number" inputMode="numeric" min="0" step="1" placeholder="0" value={n} onChange={(e) => onCambiar(e.target.value)} aria-label={`Cantidad de ${p.nombre}`} style={{ width: 64, textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, padding: '8px 4px' }} />
      {quitar && <button className="boton-sm boton-secundario" aria-label="Quitar" onClick={() => onCambiar(0)}>✕</button>}
    </div>
  );
}

export default function SalidasD({ session, perfil }) {
  const admin = perfil.rol === 'admin';
  const [vista, setVista] = useState({ tipo: admin ? 'lista' : 'menu' });
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const [hecha, setHecha] = useState(null); // confirmación para quien no es administrador
  const [intento, setIntento] = useState(0);
  const inicio = () => setVista({ tipo: admin ? 'lista' : 'menu' });

  if (!admin && hecha) {
    return (
      <div className="panel" style={{ textAlign: 'center' }}>
        <h2 style={{ color: 'var(--ok)', fontSize: '1.6rem' }}>✔ Salida registrada</h2>
        <p style={{ fontSize: '1.15rem', margin: '4px 0' }}><strong>{hecha.proyecto}</strong></p>
        <p style={{ color: 'var(--text-dim)' }}>{hecha.unidades} unidades quedaron registradas{hecha.sumada ? ' (se sumaron al material del proyecto)' : ''}.</p>
        <button className="boton" style={{ width: '100%', padding: '18px', fontSize: '1.2rem', fontWeight: 800 }} onClick={() => { setHecha(null); setIntento((n) => n + 1); setVista({ tipo: 'nueva' }); }}>SACAR MÁS MATERIAL</button>
        <button className="boton-md boton-secundario" style={{ width: '100%', marginTop: 8 }} onClick={() => { setHecha(null); inicio(); }}>Volver al inicio</button>
      </div>
    );
  }
  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {aviso && <div className="aviso-ok" onClick={() => setAviso('')}>{aviso}</div>}
      {vista.tipo === 'menu' && (
        <div className="panel" style={{ display: 'grid', gap: 12 }}>
          <button className="boton" style={{ padding: '26px 16px', fontSize: '1.3rem', fontWeight: 800 }} onClick={() => setVista({ tipo: 'nueva' })}>📦 SACAR MATERIAL A UN PROYECTO</button>
          <button className="boton-secundario" style={{ padding: '26px 16px', fontSize: '1.3rem', fontWeight: 800 }} onClick={() => setVista({ tipo: 'recibir' })}>📥 RECIBIR MATERIAL Y TERMINAR PROYECTO</button>
        </div>
      )}
      {vista.tipo === 'lista' && <Lista session={session} perfil={perfil} onAbrir={(id) => setVista({ tipo: 'detalle', id })} onNueva={() => setVista({ tipo: 'nueva' })} onRecibir={() => setVista({ tipo: 'recibir' })} onError={setError} />}
      {vista.tipo === 'nueva' && <Nueva key={intento} session={session} onCancelar={inicio} onCreada={(s) => { if (admin) { setAviso(s.sumada ? `Material sumado al proyecto: ${s.proyecto}` : `Salida registrada: ${s.proyecto}`); setVista({ tipo: 'detalle', id: s.id }); } else setHecha(s); }} />}
      {vista.tipo === 'recibir' && <PorCerrar session={session} onElegir={(id) => setVista({ tipo: 'recepcion', id })} onVolver={inicio} />}
      {vista.tipo === 'recepcion' && <Recepcion id={vista.id} session={session} admin={admin} onVolver={() => setVista({ tipo: 'recibir' })} onFin={inicio} />}
      {vista.tipo === 'detalle' && <Detalle id={vista.id} session={session} perfil={perfil} onVolver={() => setVista({ tipo: 'lista' })} onAviso={setAviso} onTerminar={() => setVista({ tipo: 'recepcion', id: vista.id })} />}
    </div>
  );
}

const resumenItems = (items) => items.filter((i) => i.pendiente > 0).map((i) => `${num(i.pendiente, 0)} × ${i.productos?.nombre}`).join(' · ');

function Lista({ session, perfil, onAbrir, onNueva, onRecibir, onError }) {
  const [filas, setFilas] = useState([]);
  const [cerrados, setCerrados] = useState(false);
  const mueve = ['admin', 'gerente', 'bodega', 'gestor'].includes(perfil.rol);
  useEffect(() => { api.get(`/diserco/salidas?estado=${cerrados ? 'cerrada' : 'abierta'}`, session).then(setFilas).catch((e) => onError(e.message)); }, [cerrados]);
  return (
    <div className="panel">
      {mueve && <button className="boton" style={{ width: '100%', padding: '22px 16px', fontSize: '1.35rem', fontWeight: 800 }} onClick={onNueva}>📦 SACAR MATERIAL A UN PROYECTO</button>}
      {mueve && <button className="boton-md boton-secundario" style={{ width: '100%', marginTop: 8 }} onClick={onRecibir}>📥 Recibir material y terminar un proyecto</button>}
      <h3 style={{ marginBottom: 6 }}>{cerrados ? 'Proyectos cerrados' : 'Material que está en proyectos'}</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        {filas.map((s) => (
          <button key={s.id} className="boton-secundario" style={{ textAlign: 'left', padding: 14 }} onClick={() => onAbrir(s.id)}>
            <strong style={{ fontSize: '1.15rem', display: 'block' }}>{s.proyecto}</strong>
            <small style={{ display: 'block', margin: '4px 0' }}>{resumenItems(s.items) || 'Sin material pendiente'}</small>
            <small style={{ color: 'var(--text-dim)' }}>{num(s.unidades, 0)} unidades · desde {fechaCorta(s.created_at)}{perfil.rol !== 'gestor' && s.costo_total != null ? ` · ${L(s.costo_total)}` : ''}</small>
          </button>
        ))}
        {filas.length === 0 && <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>{cerrados ? 'Aún no hay proyectos cerrados.' : 'No hay material fuera en este momento.'}</p>}
      </div>
      <button className="boton-sm boton-secundario" style={{ marginTop: 14 }} onClick={() => setCerrados(!cerrados)}>{cerrados ? '← Ver proyectos en curso' : 'Ver proyectos cerrados'}</button>
    </div>
  );
}

function Nueva({ session, onCancelar, onCreada }) {
  const [productos, setProductos] = useState([]);
  const [abiertos, setAbiertos] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [proyecto, setProyecto] = useState(null); // { nombre, cotizacion_id }
  const [otro, setOtro] = useState(false);
  const [texto, setTexto] = useState('');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [faltantes, setFaltantes] = useState(null);

  useEffect(() => {
    api.get('/diserco/inventario', session).then(setProductos).catch((e) => setError(e.message));
    api.get('/diserco/salidas/proyectos', session).then((r) => { setAbiertos(r.en_curso); setCotizaciones(r.cotizaciones); }).catch(() => {});
  }, []);
  const deCotizacion = cotizaciones;

  async function guardar(confirmar) {
    if (!proyecto || items.length === 0) return;
    setError('');
    setGuardando(true);
    try {
      onCreada(await api.post('/diserco/salidas', session, { proyecto: proyecto.nombre.trim(), cotizacion_id: proyecto.cotizacion_id || '', items, confirmar_sin_stock: confirmar }));
    } catch (e) {
      if (e.codigo === 'SIN_STOCK') setFaltantes(e.faltantes ?? []);
      else setError(e.message);
    } finally {
      setGuardando(false);
    }
  }
  const fila = { textAlign: 'left', padding: '12px 14px', borderRadius: 10 };

  // Paso 1: ¿a qué proyecto va?
  if (!proyecto) {
    return (
      <div className="panel">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>¿A qué proyecto va?</h2>
          {onCancelar && <button className="boton-sm boton-secundario" onClick={onCancelar}>← Volver</button>}
        </div>
        {error && <div className="error" onClick={() => setError('')}>{error}</div>}
        <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
          {abiertos.length > 0 && <small style={{ color: 'var(--text-dim)', fontWeight: 700 }}>PROYECTOS EN CURSO</small>}
          {abiertos.map((a) => <button key={a.nombre} className="boton-secundario" style={fila} onClick={() => setProyecto({ nombre: a.nombre, cotizacion_id: a.cotizacion_id })}>{a.nombre}</button>)}
          {deCotizacion.length > 0 && <small style={{ color: 'var(--text-dim)', fontWeight: 700, marginTop: 6 }}>COTIZACIONES DE PROYECTO APROBADAS</small>}
          {deCotizacion.slice(0, 10).map((c) => <button key={c.cotizacion_id} className="boton-secundario" style={fila} onClick={() => setProyecto({ nombre: c.nombre, cotizacion_id: c.cotizacion_id })}>{c.proyecto} <small style={{ opacity: 0.75 }}>— {c.cliente}</small></button>)}
          <small style={{ color: 'var(--text-dim)', fontWeight: 700, marginTop: 6 }}>OTRO PROYECTO</small>
          <div style={{ display: 'flex', gap: 6 }}>
            <input placeholder="Escribe el nombre del proyecto" value={texto} onChange={(e) => setTexto(e.target.value)} />
            <button className="boton" style={{ minWidth: 90, fontWeight: 800 }} disabled={texto.trim().length < 3} onClick={() => setProyecto({ nombre: texto.trim(), cotizacion_id: '' })}>Seguir →</button>
          </div>
        </div>
      </div>
    );
  }

  // Paso 2: sacar el material
  return (
    <div className="panel">
      {faltantes && <AvisoSinStock faltantes={faltantes} accion="registrar la salida" onCancelar={() => setFaltantes(null)} onContinuar={() => { setFaltantes(null); guardar(true); }} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, background: 'color-mix(in srgb, var(--color-sucursal) 18%, transparent)' }}>
        <div style={{ minWidth: 0 }}><small style={{ color: 'var(--text-dim)' }}>Proyecto</small><strong style={{ display: 'block' }}>{proyecto.nombre}</strong></div>
        <button className="boton-sm boton-secundario" onClick={() => { setProyecto(null); setItems([]); }}>Cambiar</button>
      </div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <h3 style={{ margin: '12px 0 6px' }}>Sacar material</h3>
      <SelectorProductos productos={productos} items={items} onCambiar={setItems} />
      <button className="boton" style={{ width: '100%', marginTop: 14, padding: '16px 20px', fontSize: '1.15rem', fontWeight: 800 }} disabled={guardando || items.length === 0} onClick={() => guardar(false)}>
        {guardando ? 'Registrando…' : items.length ? `REGISTRAR SALIDA (${items.reduce((s, i) => s + i.cantidad, 0)})` : 'Escribe la cantidad de lo que sacas'}
      </button>
    </div>
  );
}

function ResumenCierre({ r, admin }) {
  const consumibles = r.lineas.filter((l) => l.consumible);
  const noConsumibles = r.lineas.filter((l) => !l.consumible);
  const th = { textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700 };
  return (
    <div style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 6px' }}>Resumen del proyecto</h3>
      {consumibles.length > 0 && (
        <>
          <strong style={{ fontSize: '0.9rem' }}>Material que se consumió</strong>
          <table className="tabla" style={{ fontSize: '0.88rem' }}>
            <thead><tr><th style={{ ...th, textAlign: 'left' }}>Producto</th><th style={th}>Salió</th><th style={th}>Regresó</th><th style={{ ...th, color: 'var(--aviso)' }}>Consumido</th>{admin && <th style={th}>Costo</th>}</tr></thead>
            <tbody>{consumibles.map((l) => <tr key={l.producto_id}><td>{l.producto}</td><td style={{ textAlign: 'right' }}>{l.salio}</td><td style={{ textAlign: 'right' }}>{l.regreso}</td><td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--aviso)' }}>{l.consumido}</td>{admin && <td style={{ textAlign: 'right' }}>{L(l.costo)}</td>}</tr>)}</tbody>
          </table>
          {admin && <p style={{ margin: '4px 0' }}><strong>Costo del material consumido: {L(r.costo_consumido)}</strong></p>}
        </>
      )}
      {noConsumibles.length > 0 && (
        <>
          <strong style={{ fontSize: '0.9rem' }}>Herramientas y moldes (deben regresar)</strong>
          <table className="tabla" style={{ fontSize: '0.88rem' }}>
            <thead><tr><th style={{ ...th, textAlign: 'left' }}>Producto</th><th style={th}>Salió</th><th style={th}>Regresó</th><th style={th}>Estado</th></tr></thead>
            <tbody>{noConsumibles.map((l) => <tr key={l.producto_id}><td>{l.producto}</td><td style={{ textAlign: 'right' }}>{l.salio}</td><td style={{ textAlign: 'right' }}>{l.regreso}</td><td style={{ textAlign: 'right', fontWeight: 700, color: l.consumido > 0 ? 'var(--peligro)' : 'var(--ok)' }}>{l.consumido > 0 ? `faltan ${l.consumido}` : '✔ completo'}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  );
}

function PorCerrar({ session, onElegir, onVolver }) {
  const [filas, setFilas] = useState(null);
  useEffect(() => { api.get('/diserco/salidas/por-cerrar', session).then(setFilas).catch(() => setFilas([])); }, []);
  return (
    <div className="panel">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>¿Qué proyecto terminó?</h2>
        <button className="boton-sm boton-secundario" onClick={onVolver}>← Volver</button>
      </div>
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        {(filas ?? []).map((f) => (
          <button key={f.id} className="boton-secundario" style={{ textAlign: 'left', padding: '12px 14px' }} onClick={() => onElegir(f.id)}>
            <strong>{f.proyecto}</strong>
            <small style={{ display: 'block', color: 'var(--text-dim)' }}>{f.productos} producto{f.productos === 1 ? '' : 's'} · {f.unidades} unidades fuera · desde {fechaCorta(f.desde)}</small>
          </button>
        ))}
        {filas && filas.length === 0 && <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>No hay proyectos con material fuera.</p>}
        {!filas && <p style={{ color: 'var(--text-dim)' }}>Cargando…</p>}
      </div>
    </div>
  );
}

// Conteo físico al terminar: se ve lo que salió, se escribe lo que regresó, y el sistema cuadra.
function Recepcion({ id, session, admin, onVolver, onFin }) {
  const [d, setD] = useState(null);
  const [conteo, setConteo] = useState({});
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [intento, setIntento] = useState(false);
  useEffect(() => { api.get(`/diserco/salidas/${id}/recepcion`, session).then(setD).catch((e) => setError(e.message)); }, [id]);

  if (resultado) {
    return (
      <div className="panel">
        <h2 style={{ color: 'var(--ok)' }}>✔ Proyecto terminado</h2>
        <p style={{ margin: '0 0 4px' }}><strong>{resultado.proyecto}</strong></p>
        <ResumenCierre r={{ lineas: resultado.lineas, costo_consumido: resultado.costo_consumido }} admin={admin} />
        <button className="boton" style={{ width: '100%', marginTop: 14, padding: 16, fontWeight: 800 }} onClick={onFin}>LISTO</button>
      </div>
    );
  }
  if (!d) return <div className="panel">{error ? <div className="error">{error}</div> : 'Cargando…'}<button className="boton-sm boton-secundario" onClick={onVolver}>← Volver</button></div>;

  const falta = d.items.filter((i) => conteo[i.producto_id] === undefined || conteo[i.producto_id] === '');
  const pone = (pid, t) => setConteo({ ...conteo, [pid]: t === '' ? '' : String(Math.max(0, Math.round(Number(t)) || 0)) });
  const grupos = [['Se consumen al usarse', d.items.filter((i) => i.consumible)], ['Herramientas y moldes (deben regresar)', d.items.filter((i) => !i.consumible)]];

  async function terminar() {
    setIntento(true);
    if (falta.length) return;
    const gastado = d.items.filter((i) => Number(conteo[i.producto_id]) < i.salio).map((i) => `${i.nombre}: ${i.salio - Number(conteo[i.producto_id])} ${i.consumible ? 'consumidas' : 'NO regresan'}`);
    if (!window.confirm(`¿Terminar “${d.proyecto}”?\n\n${gastado.length ? gastado.join('\n') : 'Todo regresó completo.'}\n\nEsto no se puede deshacer.`)) return;
    setEnviando(true);
    setError('');
    try {
      setResultado(await api.post(`/diserco/salidas/${id}/cerrar`, session, { conteo: d.items.map((i) => ({ producto_id: i.producto_id, regreso: Number(conteo[i.producto_id]) })) }));
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="panel">
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Contar lo que regresó</h2>
        <button className="boton-sm boton-secundario" onClick={onVolver}>← Volver</button>
      </div>
      <p style={{ margin: '4px 0 8px' }}><strong>{d.proyecto}</strong><small style={{ display: 'block', color: 'var(--text-dim)' }}>Cuenta lo que físicamente regresó de cada producto (escribe 0 si no regresó nada).</small></p>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {grupos.map(([titulo, items]) => items.length > 0 && (
        <div key={titulo} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-dim)', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', padding: '4px 4px 2px' }}><span>{titulo}</span><span>Salió · Regresó</span></div>
          {items.map((i) => {
            const v = conteo[i.producto_id] ?? '';
            const sinContar = intento && v === '';
            return (
              <div key={i.producto_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', borderTop: '1px solid var(--border)', ...(sinContar ? { background: 'color-mix(in srgb, var(--peligro) 12%, transparent)' } : {}) }}>
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
                  <span style={{ fontSize: '0.92rem', fontWeight: 600 }}>{i.nombre}</span>
                  {Number(v) < i.salio && v !== '' && <small style={{ display: 'block', color: i.consumible ? 'var(--aviso)' : 'var(--peligro)' }}>{i.consumible ? `${i.salio - Number(v)} consumidas` : `faltan ${i.salio - Number(v)} por regresar`}</small>}
                </div>
                <strong style={{ fontSize: '1.2rem', minWidth: 30, textAlign: 'center' }}>{i.salio}</strong>
                <input type="number" inputMode="numeric" min="0" max={i.salio} step="1" placeholder="?" value={v} onChange={(e) => pone(i.producto_id, e.target.value)} aria-label={`Regresó de ${i.nombre}`} style={{ width: 62, textAlign: 'center', fontSize: '1.15rem', fontWeight: 800, padding: '8px 4px' }} />
                <button className="boton-sm boton-secundario" title="Regresó todo" onClick={() => pone(i.producto_id, i.salio)}>todo</button>
              </div>
            );
          })}
        </div>
      ))}
      <button className="boton" style={{ width: '100%', marginTop: 8, padding: '16px', fontSize: '1.15rem', fontWeight: 800 }} disabled={enviando} onClick={terminar}>
        {enviando ? 'Guardando…' : falta.length ? `TERMINAR PROYECTO (faltan ${falta.length} por contar)` : 'TERMINAR PROYECTO'}
      </button>
    </div>
  );
}

function Historial({ id, session, refrescar }) {
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState(null);
  useEffect(() => { if (abierto) api.get(`/diserco/salidas/${id}/historial`, session).then(setFilas).catch(() => setFilas([])); }, [abierto, id, refrescar]);
  return (
    <div style={{ marginTop: 10 }}>
      <button className="boton-sm boton-secundario" onClick={() => setAbierto(!abierto)}>{abierto ? '▾' : '▸'} Historial de movimientos</button>
      {abierto && (
        <div style={{ marginTop: 6, maxHeight: 260, overflowY: 'auto' }}>
          {(filas ?? []).map((h) => (
            <div key={h.clave} style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-dim)', minWidth: 118 }}>{new Date(h.fecha).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' })}</span>
              <span style={{ flex: 1, color: h.tipo === 'salida' ? 'var(--aviso)' : h.tipo === 'retorno' ? 'var(--ok)' : undefined }}>{h.texto}</span>
              <span style={{ color: 'var(--text-dim)' }}>{h.usuario}</span>
            </div>
          ))}
          {filas && filas.length === 0 && <small style={{ color: 'var(--text-dim)' }}>Sin movimientos.</small>}
        </div>
      )}
    </div>
  );
}

function Detalle({ id, session, perfil, onVolver, onAviso, onTerminar }) {
  const [s, setS] = useState(null);
  const [productos, setProductos] = useState([]);
  const [cant, setCant] = useState({});
  const [agregando, setAgregando] = useState(false);
  const [nuevos, setNuevos] = useState([]);
  const [faltantes, setFaltantes] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const mueve = perfil.rol === 'admin';
  const gerencia = perfil.rol === 'admin';

  async function cargar() {
    setS(await api.get(`/diserco/salidas/${id}`, session));
    api.get('/diserco/inventario', session).then(setProductos).catch(() => {});
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, [id]);

  async function mover(items, confirmar = false) {
    setError('');
    setOcupado(true);
    try {
      setS(await api.post(`/diserco/salidas/${id}/movimiento`, session, { items, confirmar_sin_stock: confirmar }));
      api.get('/diserco/inventario', session).then(setProductos).catch(() => {});
      return true;
    } catch (e) {
      if (e.codigo === 'SIN_STOCK') setFaltantes({ faltantes: e.faltantes ?? [], items });
      else setError(e.message);
      return false;
    } finally {
      setOcupado(false);
    }
  }
  if (!s) return <div className="panel">{error ? <div className="error">{error}</div> : 'Cargando…'}</div>;
  const abierta = s.estado === 'abierta';
  const hayEnBodega = new Map(productos.map((p) => [p.id, p.existencia]));
  const filas = s.items.filter((i) => i.pendiente > 0 || i.cantidad_salida > 0);

  return (
    <div className="panel">
      {faltantes && <AvisoSinStock faltantes={faltantes.faltantes} accion="sacar el material" onCancelar={() => setFaltantes(null)} onContinuar={() => { const it = faltantes.items; setFaltantes(null); mover(it, true); }} />}
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{s.proyecto}</h2>
        <button className="boton-sm boton-secundario" onClick={onVolver}>← Volver</button>
      </div>
      <p style={{ margin: '4px 0 10px', color: 'var(--text-dim)' }}>{abierta ? 'Material que está en este proyecto' : 'Proyecto terminado · material usado'} · desde {fechaCorta(s.created_at)}{s.cotizacion?.codigo ? ` · Cot. ${s.cotizacion.codigo}` : ''}</p>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {filas.map((i) => {
        const c = Math.max(1, Number(cant[i.producto_id]) || 1);
        const chico = { minWidth: 34, minHeight: 34, padding: 0, fontSize: '1.1rem', fontWeight: 800, lineHeight: 1 };
        return (
          <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
              <span style={{ fontSize: '0.93rem', fontWeight: 600 }}>{i.productos?.nombre}</span>
              {abierta && <small style={{ display: 'block', color: 'var(--text-dim)' }}>Bodega: {num(hayEnBodega.get(i.producto_id) ?? 0, 0)}</small>}
            </div>
            <div style={{ textAlign: 'center', minWidth: 44 }}>
              <strong style={{ fontSize: '1.35rem', lineHeight: 1, color: 'var(--aviso)' }}>{num(i.pendiente, 0)}</strong>
              <small style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.68rem' }}>{abierta ? 'en proyecto' : 'usadas'}</small>
            </div>
            {abierta && mueve && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button className="boton-secundario" style={chico} disabled={ocupado || c > i.pendiente} title="Devolver a bodega" aria-label="Devolver" onClick={() => mover([{ producto_id: i.producto_id, cantidad: -c }])}>−</button>
                <input type="number" inputMode="numeric" min="1" step="1" value={cant[i.producto_id] ?? 1} onChange={(e) => setCant({ ...cant, [i.producto_id]: e.target.value })} style={{ width: 44, minHeight: 34, textAlign: 'center', fontWeight: 700, padding: '0 2px' }} />
                <button className="boton" style={chico} disabled={ocupado} title="Sacar más de la bodega" aria-label="Sacar más" onClick={() => mover([{ producto_id: i.producto_id, cantidad: c }])}>+</button>
              </div>
            )}
          </div>
        );
      })}
      {filas.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Sin material.</p>}
      {s.costo_total != null && <p><strong>Costo del material: {L(s.costo_total)}</strong></p>}
      {!abierta && s.resumen && <ResumenCierre r={s.resumen} admin />}
      <Historial id={id} session={session} refrescar={s.items.length + s.unidades + (s.estado === 'abierta' ? 1 : 0)} />

      {abierta && mueve && (
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          <button className="boton" style={{ padding: '16px', fontWeight: 800, fontSize: '1.1rem' }} onClick={() => { setNuevos([]); setAgregando(true); }}>+ AGREGAR OTRO PRODUCTO</button>
          <button className="boton-md boton-secundario" onClick={onTerminar}>✔ Recibir material y terminar proyecto</button>
        </div>
      )}
      {!abierta && gerencia && <button className="boton-md boton-secundario" onClick={async () => { try { setS(await api.post(`/diserco/salidas/${id}/reabrir`, session, {})); } catch (e) { setError(e.message); } }}>Reabrir proyecto</button>}
      {agregando && (
        <Modal titulo="Agregar material" onCerrar={() => setAgregando(false)} pie={<><button className="boton" style={{ padding: '14px 20px', fontWeight: 800 }} disabled={!nuevos.length || ocupado} onClick={async () => { if (await mover(nuevos)) setAgregando(false); }}>SACAR DE BODEGA</button><button className="boton-md boton-secundario" onClick={() => setAgregando(false)}>Cancelar</button></>}>
          <SelectorProductos productos={productos} items={nuevos} onCambiar={setNuevos} />
        </Modal>
      )}
    </div>
  );
}
