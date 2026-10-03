import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import AvisoSinStock from '../components/AvisoSinStock.jsx';
import { L, num, fechaCorta } from '../lib/fmt.js';

const paso = { fontSize: '1.5rem', minWidth: 56, minHeight: 52, fontWeight: 800 };
const sinTildes = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Busca por palabras en cualquier orden y sin tildes: "epox ivory" encuentra "Epóxico Quarzo … Ivory".
function coincide(p, texto) {
  const palabras = sinTildes(texto).split(/\s+/).filter(Boolean);
  const pajar = sinTildes(`${p.nombre} ${p.codigo ?? ''} ${p.presentacion ?? ''} ${p.categorias?.nombre ?? ''}`);
  return palabras.every((w) => pajar.includes(w));
}

// Elegir productos de la bodega: buscador grande, categorías, los más usados y +/− por producto.
function SelectorProductos({ productos, items, onCambiar, frecuentes = [] }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const categorias = useMemo(() => [...new Set(productos.map((p) => p.categorias?.nombre).filter(Boolean))], [productos]);
  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const resultados = useMemo(() => productos.filter((p) => (!cat || p.categorias?.nombre === cat) && (!q.trim() || coincide(p, q))), [productos, q, cat]);
  const cantidadDe = (id) => items.find((i) => i.producto_id === id)?.cantidad ?? 0;
  const poner = (id, cantidad) => {
    const c = Math.round(Number(cantidad)) || 0;
    if (c <= 0) return onCambiar(items.filter((i) => i.producto_id !== id));
    onCambiar(items.some((i) => i.producto_id === id) ? items.map((i) => (i.producto_id === id ? { ...i, cantidad: c } : i)) : [...items, { producto_id: id, cantidad: c }]);
  };

  return (
    <div>
      {items.length > 0 && (
        <div style={{ marginBottom: 12, border: '2px solid var(--color-sucursal)', borderRadius: 12, padding: 8 }}>
          <strong>Lo que se lleva ({items.reduce((s, i) => s + i.cantidad, 0)})</strong>
          {items.map((i) => {
            const p = porId.get(i.producto_id);
            const falta = p && i.cantidad > p.existencia;
            return (
              <div key={i.producto_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <strong>{p?.nombre ?? '—'}</strong>
                  <small style={{ display: 'block', color: falta ? 'var(--peligro)' : 'var(--text-dim)' }}>En bodega: {num(p?.existencia ?? 0, 0)}{falta ? ' · no alcanza' : ''}</small>
                </div>
                <button className="boton-secundario" style={paso} onClick={() => poner(i.producto_id, i.cantidad - 1)}>−</button>
                <input type="number" inputMode="numeric" min="0" step="1" value={i.cantidad} onChange={(e) => poner(i.producto_id, e.target.value)} style={{ width: 76, textAlign: 'center', fontSize: '1.3rem', fontWeight: 800 }} />
                <button className="boton" style={paso} onClick={() => poner(i.producto_id, i.cantidad + 1)}>+</button>
              </div>
            );
          })}
        </div>
      )}

      <input type="search" placeholder="🔍 Buscar producto (escribe parte del nombre)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ fontSize: '1.1rem', padding: '14px 12px' }} />
      {categorias.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
          <button className={cat ? 'boton-sm boton-secundario' : 'boton-sm'} onClick={() => setCat('')}>Todos</button>
          {categorias.map((c) => <button key={c} className={cat === c ? 'boton-sm' : 'boton-sm boton-secundario'} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>)}
        </div>
      )}
      {!q.trim() && !cat && frecuentes.length > 0 && (
        <div style={{ margin: '8px 0' }}>
          <small style={{ color: 'var(--text-dim)' }}>Los que más sacan:</small>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            {frecuentes.map((id) => porId.get(id)).filter(Boolean).map((p) => <button key={p.id} className="boton-sm boton-secundario" onClick={() => poner(p.id, cantidadDe(p.id) + 1)}>{p.nombre}{cantidadDe(p.id) ? ` · ${cantidadDe(p.id)}` : ''}</button>)}
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gap: 6, marginTop: 8, maxHeight: 360, overflowY: 'auto' }}>
        {resultados.map((p) => {
          const n = cantidadDe(p.id);
          return (
            <button key={p.id} className={n ? 'boton' : 'boton-secundario'} style={{ textAlign: 'left', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', minHeight: 52 }} onClick={() => poner(p.id, n + 1)}>
              <span>{p.nombre}{p.presentacion ? <small style={{ display: 'block', opacity: 0.75 }}>{p.presentacion}</small> : null}</span>
              <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong style={{ fontSize: '1.2rem', color: n ? 'inherit' : p.existencia > 0 ? 'var(--ok)' : 'var(--peligro)' }}>{num(p.existencia, 0)}</strong>{n > 0 && <small style={{ display: 'block' }}>llevas {n}</small>}</span>
            </button>
          );
        })}
        {resultados.length === 0 && <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>{productos.length === 0 ? 'No hay productos con control de inventario.' : 'No encontré ese producto. Prueba con otra palabra.'}</p>}
      </div>
      <small style={{ color: 'var(--text-dim)' }}>Toca un producto para agregarlo; vuelve a tocarlo para sumar uno más. El número verde es lo que hay en bodega.</small>
    </div>
  );
}

export default function SalidasD({ session, perfil }) {
  const [vista, setVista] = useState({ tipo: 'lista' });
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {aviso && <div className="aviso-ok" onClick={() => setAviso('')}>{aviso}</div>}
      {vista.tipo === 'lista' && <Lista session={session} perfil={perfil} onAbrir={(id) => setVista({ tipo: 'detalle', id })} onNueva={() => setVista({ tipo: 'nueva' })} onError={setError} />}
      {vista.tipo === 'nueva' && <Nueva session={session} onCancelar={() => setVista({ tipo: 'lista' })} onCreada={(s) => { setAviso(s.sumada ? `Material sumado al proyecto: ${s.proyecto}` : `Salida registrada: ${s.proyecto}`); setVista({ tipo: 'detalle', id: s.id }); }} />}
      {vista.tipo === 'detalle' && <Detalle id={vista.id} session={session} perfil={perfil} onVolver={() => setVista({ tipo: 'lista' })} onAviso={setAviso} />}
    </div>
  );
}

const resumenItems = (items) => items.filter((i) => i.pendiente > 0).map((i) => `${num(i.pendiente, 0)} × ${i.productos?.nombre}`).join(' · ');

function Lista({ session, perfil, onAbrir, onNueva, onError }) {
  const [filas, setFilas] = useState([]);
  const [cerrados, setCerrados] = useState(false);
  const mueve = ['admin', 'gerente', 'bodega', 'gestor'].includes(perfil.rol);
  useEffect(() => { api.get(`/diserco/salidas?estado=${cerrados ? 'cerrada' : 'abierta'}`, session).then(setFilas).catch((e) => onError(e.message)); }, [cerrados]);
  return (
    <div className="panel">
      {mueve && <button className="boton" style={{ width: '100%', padding: '22px 16px', fontSize: '1.35rem', fontWeight: 800 }} onClick={onNueva}>📦 SACAR MATERIAL A UN PROYECTO</button>}
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
  const [previas, setPrevias] = useState([]);
  const [proyecto, setProyecto] = useState(null); // { nombre, cotizacion_id }
  const [otro, setOtro] = useState(false);
  const [texto, setTexto] = useState('');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [faltantes, setFaltantes] = useState(null);
  const [intento, setIntento] = useState(false);

  useEffect(() => {
    api.get('/diserco/inventario', session).then(setProductos).catch((e) => setError(e.message));
    api.get('/diserco/salidas?estado=abierta', session).then((r) => { setAbiertos(r); setPrevias(r); }).catch(() => {});
    api.get('/diserco/salidas/proyectos', session).then(setCotizaciones).catch(() => {});
    api.get('/diserco/salidas?estado=cerrada', session).then((r) => setPrevias((p) => [...p, ...r])).catch(() => {});
  }, []);
  const frecuentes = useMemo(() => {
    const cuenta = new Map();
    for (const s of previas) for (const i of s.items) cuenta.set(i.producto_id, (cuenta.get(i.producto_id) ?? 0) + 1);
    return [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  }, [previas]);
  const nombresAbiertos = new Set(abiertos.map((a) => a.proyecto));
  const deCotizacion = cotizaciones.filter((c) => !nombresAbiertos.has(`${c.proyecto} — ${c.nombre_cliente}`));

  const sinProyecto = !proyecto || proyecto.nombre.trim().length < 3;
  async function guardar(confirmar) {
    setIntento(true);
    if (sinProyecto || items.length === 0) return;
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
  const tarjeta = (activo) => ({ textAlign: 'left', padding: '12px 14px', borderRadius: 10, ...(activo ? { outline: '3px solid var(--color-sucursal)' } : {}) });

  return (
    <div className="panel">
      {faltantes && <AvisoSinStock faltantes={faltantes} accion="registrar la salida" onCancelar={() => setFaltantes(null)} onContinuar={() => { setFaltantes(null); guardar(true); }} />}
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Sacar material</h2>
        <button className="boton-sm boton-secundario" onClick={onCancelar}>← Volver</button>
      </div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      <h3 style={{ marginBottom: 6 }}>1 · ¿A qué proyecto va? {intento && sinProyecto && <span style={{ color: 'var(--peligro)', fontSize: '0.8em' }}>⚠ elige un proyecto</span>}</h3>
      {proyecto && !otro ? (
        <div className="boton" style={{ padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <strong>✓ {proyecto.nombre}</strong>
          <button className="boton-sm boton-secundario" onClick={() => setProyecto(null)}>Cambiar</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, ...(intento && sinProyecto ? { outline: '2px solid var(--peligro)', padding: 6, borderRadius: 10 } : {}) }}>
          {abiertos.length > 0 && <small style={{ color: 'var(--text-dim)' }}>Proyectos en curso (se suma al mismo registro):</small>}
          {abiertos.map((a) => <button key={a.id} className="boton-secundario" style={tarjeta(proyecto?.nombre === a.proyecto)} onClick={() => { setProyecto({ nombre: a.proyecto, cotizacion_id: a.cotizacion_id }); setOtro(false); }}>{a.proyecto}</button>)}
          {deCotizacion.length > 0 && <small style={{ color: 'var(--text-dim)' }}>Cotizaciones de proyecto aprobadas:</small>}
          {deCotizacion.slice(0, 8).map((c) => <button key={c.id} className="boton-secundario" style={tarjeta(false)} onClick={() => { setProyecto({ nombre: `${c.proyecto} — ${c.nombre_cliente}`, cotizacion_id: c.id }); setOtro(false); }}>{c.proyecto} <small style={{ opacity: 0.75 }}>— {c.nombre_cliente} ({c.codigo})</small></button>)}
          {!otro
            ? <button className="boton-sm boton-secundario" onClick={() => setOtro(true)}>+ Escribir otro proyecto</button>
            : (
              <div style={{ display: 'flex', gap: 6 }}>
                <input autoFocus placeholder="Nombre del proyecto" value={texto} onChange={(e) => setTexto(e.target.value)} />
                <button className="boton-md" disabled={texto.trim().length < 3} onClick={() => { setProyecto({ nombre: texto.trim(), cotizacion_id: '' }); setOtro(false); }}>OK</button>
              </div>
            )}
        </div>
      )}

      <h3 style={{ marginBottom: 6 }}>2 · ¿Qué material? {intento && items.length === 0 && <span style={{ color: 'var(--peligro)', fontSize: '0.8em' }}>⚠ agrega al menos un producto</span>}</h3>
      <SelectorProductos productos={productos} items={items} onCambiar={setItems} frecuentes={frecuentes} />

      <button className="boton" style={{ width: '100%', marginTop: 16, padding: '18px 22px', fontSize: '1.2rem', fontWeight: 800 }} disabled={guardando} onClick={() => guardar(false)}>
        {guardando ? 'Registrando…' : `REGISTRAR SALIDA${items.length ? ` (${items.reduce((s, i) => s + i.cantidad, 0)})` : ''}`}
      </button>
    </div>
  );
}

function Detalle({ id, session, perfil, onVolver, onAviso }) {
  const [s, setS] = useState(null);
  const [productos, setProductos] = useState([]);
  const [cant, setCant] = useState({});
  const [agregando, setAgregando] = useState(false);
  const [nuevos, setNuevos] = useState([]);
  const [cerrando, setCerrando] = useState(false);
  const [faltantes, setFaltantes] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const mueve = ['admin', 'gerente', 'bodega', 'gestor'].includes(perfil.rol);
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

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
  async function cerrar(sobrante) {
    setOcupado(true);
    try {
      setS(await api.post(`/diserco/salidas/${id}/cerrar`, session, { sobrante }));
      setCerrando(false);
      onAviso(sobrante === 'devolver' ? 'Proyecto terminado: lo que sobró regresó a la bodega' : 'Proyecto terminado: todo el material se usó');
    } catch (e) {
      setError(e.message);
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
        return (
          <div key={i.id} style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <strong>{i.productos?.nombre}</strong>
                {abierta && <small style={{ display: 'block', color: 'var(--text-dim)' }}>En bodega: {num(hayEnBodega.get(i.producto_id) ?? 0, 0)}</small>}
              </div>
              <div style={{ textAlign: 'center' }}>
                <strong style={{ fontSize: '2.2rem', lineHeight: 1, color: 'var(--aviso)' }}>{num(i.pendiente, 0)}</strong>
                <small style={{ display: 'block', color: 'var(--text-dim)' }}>{abierta ? 'en el proyecto' : 'usadas'}</small>
              </div>
            </div>
            {abierta && mueve && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginTop: 8 }}>
                <button className="boton-secundario" style={{ flex: 1, minHeight: 52, fontWeight: 700 }} disabled={ocupado || c > i.pendiente} onClick={() => mover([{ producto_id: i.producto_id, cantidad: -c }])}>− Devolver</button>
                <input type="number" inputMode="numeric" min="1" step="1" value={cant[i.producto_id] ?? 1} onChange={(e) => setCant({ ...cant, [i.producto_id]: e.target.value })} style={{ width: 70, textAlign: 'center', fontWeight: 800, fontSize: '1.3rem' }} />
                <button className="boton" style={{ flex: 1, minHeight: 52, fontWeight: 700 }} disabled={ocupado} onClick={() => mover([{ producto_id: i.producto_id, cantidad: c }])}>+ Sacar más</button>
              </div>
            )}
          </div>
        );
      })}
      {filas.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Sin material.</p>}
      {perfil.rol !== 'gestor' && s.costo_total != null && <p><strong>Costo del material: {L(s.costo_total)}</strong></p>}

      {abierta && mueve && (
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          <button className="boton" style={{ padding: '16px', fontWeight: 800, fontSize: '1.1rem' }} onClick={() => { setNuevos([]); setAgregando(true); }}>+ AGREGAR OTRO PRODUCTO</button>
          <button className="boton-md boton-secundario" onClick={() => setCerrando(true)}>✔ Terminar proyecto</button>
        </div>
      )}
      {!abierta && gerencia && <button className="boton-md boton-secundario" onClick={async () => { try { setS(await api.post(`/diserco/salidas/${id}/reabrir`, session, {})); } catch (e) { setError(e.message); } }}>Reabrir proyecto</button>}
      {agregando && (
        <Modal titulo="Agregar material" onCerrar={() => setAgregando(false)} pie={<><button className="boton" style={{ padding: '14px 20px', fontWeight: 800 }} disabled={!nuevos.length || ocupado} onClick={async () => { if (await mover(nuevos)) setAgregando(false); }}>SACAR DE BODEGA</button><button className="boton-md boton-secundario" onClick={() => setAgregando(false)}>Cancelar</button></>}>
          <SelectorProductos productos={productos} items={nuevos} onCambiar={setNuevos} />
        </Modal>
      )}
      {cerrando && (
        <Modal titulo="Terminar proyecto" onCerrar={() => setCerrando(false)} ancho={520}>
          <p>Todavía hay <strong>{num(s.unidades, 0)} unidades</strong> en el proyecto. ¿Qué pasó con ellas?</p>
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="boton-md" disabled={ocupado} onClick={() => cerrar('devolver')}>Sobró material → REGRESA a la bodega</button>
            <button className="boton-md boton-secundario" disabled={ocupado} onClick={() => cerrar('consumido')}>Todo se USÓ en el proyecto</button>
          </div>
          <small style={{ color: 'var(--text-dim)' }}>Si volvió solo una parte, primero usa “− Devolver” en cada producto y luego termina el proyecto.</small>
        </Modal>
      )}
    </div>
  );
}
