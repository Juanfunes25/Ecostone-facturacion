import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta, Pestanas } from '../components/Modal.jsx';
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
      {vista.tipo === 'nueva' && <Nueva session={session} onCancelar={() => setVista({ tipo: 'lista' })} onCreada={(s) => { setAviso(`Salida #${s.numero} registrada: ${s.proyecto}`); setVista({ tipo: 'detalle', id: s.id }); }} />}
      {vista.tipo === 'detalle' && <Detalle id={vista.id} session={session} perfil={perfil} onVolver={() => setVista({ tipo: 'lista' })} onAviso={setAviso} />}
    </div>
  );
}

function Lista({ session, perfil, onAbrir, onNueva, onError }) {
  const [estado, setEstado] = useState('abierta');
  const [q, setQ] = useState('');
  const [filas, setFilas] = useState([]);
  const mueve = ['admin', 'gerente', 'bodega', 'gestor'].includes(perfil.rol);
  const verCostos = perfil.rol !== 'gestor';
  useEffect(() => { api.get(`/diserco/salidas?estado=${estado}&q=${encodeURIComponent(q)}`, session).then(setFilas).catch((e) => onError(e.message)); }, [estado, q]);
  return (
    <div className="panel">
      <h2>Salidas de material a proyecto</h2>
      {mueve && <button className="boton" style={{ width: '100%', padding: '20px 16px', fontSize: '1.3rem', fontWeight: 800, marginBottom: 12 }} onClick={onNueva}>+ SACAR MATERIAL A PROYECTO</button>}
      <Pestanas activa={estado} onCambiar={setEstado} items={[{ id: 'abierta', etiqueta: 'En curso' }, { id: 'cerrada', etiqueta: 'Cerrados' }]} />
      <input placeholder="Buscar proyecto o responsable…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {filas.map((s) => (
          <button key={s.id} className="boton-secundario" style={{ textAlign: 'left', padding: 14 }} onClick={() => onAbrir(s.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '1.1rem' }}>{s.proyecto}</strong>
              <span>#{s.numero} · {fechaCorta(s.created_at)}</span>
            </div>
            <small style={{ display: 'block', color: 'var(--text-dim)' }}>Se lo llevó: {s.responsable}{s.cotizacion?.codigo ? ` · Cot. ${s.cotizacion.codigo}` : ''}</small>
            <small style={{ display: 'block' }}>{s.items.length} producto{s.items.length === 1 ? '' : 's'} · {num(s.unidades, 0)} {estado === 'abierta' ? 'en el proyecto' : 'consumidas'}{verCostos && s.costo_total != null ? ` · costo ${L(s.costo_total)}` : ''}</small>
          </button>
        ))}
        {filas.length === 0 && <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>{estado === 'abierta' ? 'No hay material fuera en este momento.' : 'Aún no hay proyectos cerrados.'}</p>}
      </div>
    </div>
  );
}

function Nueva({ session, onCancelar, onCreada }) {
  const [productos, setProductos] = useState([]);
  const [proyectos, setProyectos] = useState([]);
  const [previas, setPrevias] = useState([]);
  const [f, setF] = useState({ proyecto: '', cotizacion_id: '', responsable: '', notas: '' });
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [faltantes, setFaltantes] = useState(null);
  const [intento, setIntento] = useState(false);

  useEffect(() => {
    api.get('/diserco/inventario', session).then(setProductos).catch((e) => setError(e.message));
    api.get('/diserco/salidas/proyectos', session).then(setProyectos).catch(() => {});
    api.get('/diserco/salidas', session).then(setPrevias).catch(() => {});
  }, []);
  const responsables = useMemo(() => [...new Set(previas.map((s) => s.responsable))], [previas]);
  const frecuentes = useMemo(() => {
    const cuenta = new Map();
    for (const s of previas) for (const i of s.items) cuenta.set(i.producto_id, (cuenta.get(i.producto_id) ?? 0) + 1);
    return [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  }, [previas]);

  const faltaProyecto = f.proyecto.trim().length < 3;
  const faltaResponsable = f.responsable.trim().length < 3;
  const incompleto = faltaProyecto || faltaResponsable || items.length === 0;

  async function guardar(confirmar) {
    setIntento(true);
    if (incompleto) return;
    setError('');
    setGuardando(true);
    try {
      onCreada(await api.post('/diserco/salidas', session, { ...f, items, confirmar_sin_stock: confirmar }));
    } catch (e) {
      if (e.codigo === 'SIN_STOCK') setFaltantes(e.faltantes ?? []);
      else setError(e.message);
    } finally {
      setGuardando(false);
    }
  }
  const rojo = (malo) => (intento && malo ? { borderColor: 'var(--peligro)', borderWidth: 2 } : undefined);

  return (
    <div className="panel">
      {faltantes && <AvisoSinStock faltantes={faltantes} accion="registrar la salida" onCancelar={() => setFaltantes(null)} onContinuar={() => { setFaltantes(null); guardar(true); }} />}
      <h2>Sacar material a proyecto</h2>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <Campo etiqueta="1 · Proyecto (obligatorio)" ayuda={intento && faltaProyecto ? '⚠ Indica a qué proyecto va' : 'Elige uno de la lista o escribe el nombre'}>
        <input list="proyectos-d" value={f.proyecto} placeholder="Ej.: Nave #7 Honduras Kitting" style={rojo(faltaProyecto)} onChange={(e) => {
          const c = proyectos.find((x) => `${x.proyecto} — ${x.nombre_cliente} (${x.codigo})` === e.target.value);
          setF(c ? { ...f, proyecto: `${c.proyecto} — ${c.nombre_cliente}`, cotizacion_id: c.id } : { ...f, proyecto: e.target.value, cotizacion_id: '' });
        }} />
        <datalist id="proyectos-d">{proyectos.map((c) => <option key={c.id} value={`${c.proyecto} — ${c.nombre_cliente} (${c.codigo})`} />)}</datalist>
      </Campo>
      <div style={{ height: 8 }} />
      <Campo etiqueta="2 · ¿Quién se lleva el material? (obligatorio)" ayuda={intento && faltaResponsable ? '⚠ Escribe el nombre de quien se lo lleva' : undefined}>
        <input list="responsables-d" value={f.responsable} placeholder="Nombre del empleado" style={rojo(faltaResponsable)} onChange={(e) => setF({ ...f, responsable: e.target.value })} />
        <datalist id="responsables-d">{responsables.map((r) => <option key={r} value={r} />)}</datalist>
      </Campo>
      <h3 style={{ marginBottom: 6 }}>3 · Material {intento && items.length === 0 && <span style={{ color: 'var(--peligro)', fontSize: '0.8em' }}>⚠ agrega al menos un producto</span>}</h3>
      <SelectorProductos productos={productos} items={items} onCambiar={setItems} frecuentes={frecuentes} />
      <div style={{ height: 8 }} />
      <Campo etiqueta="Notas (opcional)"><input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></Campo>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <button className="boton" style={{ flex: 1, padding: '18px 22px', fontSize: '1.2rem', fontWeight: 800 }} disabled={guardando} onClick={() => guardar(false)}>{guardando ? 'Registrando…' : `REGISTRAR SALIDA${items.length ? ` (${items.reduce((s, i) => s + i.cantidad, 0)} unidades)` : ''}`}</button>
        <button className="boton-md boton-secundario" onClick={onCancelar}>Cancelar</button>
      </div>
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
      onAviso(sobrante === 'devolver' ? 'Proyecto cerrado; el sobrante regresó a bodega' : 'Proyecto cerrado; el material se dio por consumido');
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!s) return <div className="panel">{error ? <div className="error">{error}</div> : 'Cargando…'}</div>;
  const abierta = s.estado === 'abierta';
  const hayEnBodega = new Map(productos.map((p) => [p.id, p.existencia]));

  return (
    <div className="panel">
      {faltantes && <AvisoSinStock faltantes={faltantes.faltantes} accion="sacar el material" onCancelar={() => setFaltantes(null)} onContinuar={() => { const it = faltantes.items; setFaltantes(null); mover(it, true); }} />}
      <div className="toolbar" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{s.proyecto} <Etiqueta tono={abierta ? 'aviso' : 'gris'}>{abierta ? 'en curso' : 'cerrado'}</Etiqueta></h2>
        <button className="boton-sm boton-secundario" onClick={onVolver}>← Volver</button>
      </div>
      <p style={{ margin: '6px 0' }}>Salida #{s.numero} · {fechaCorta(s.created_at)} · Se lo llevó: <strong>{s.responsable}</strong>{s.cotizacion?.codigo && ` · Cotización ${s.cotizacion.codigo}`}{s.notas && ` · ${s.notas}`}</p>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {abierta && mueve && <p style={{ color: 'var(--text-dim)', margin: '4px 0' }}>Usa <strong>+</strong> para sacar más de la bodega y <strong>−</strong> para devolver a la bodega.</p>}

      {s.items.map((i) => {
        const c = Math.max(1, Number(cant[i.producto_id]) || 1);
        return (
          <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
              <strong>{i.productos?.nombre}</strong>
              <small style={{ display: 'block', color: 'var(--text-dim)' }}>Salió {num(i.cantidad_salida, 0)} · devuelto {num(i.cantidad_retorno, 0)} · en bodega {num(hayEnBodega.get(i.producto_id) ?? 0, 0)}</small>
            </div>
            <div style={{ textAlign: 'center', minWidth: 70 }}>
              <strong style={{ fontSize: '2rem', color: 'var(--aviso)', lineHeight: 1 }}>{num(i.pendiente, 0)}</strong>
              <small style={{ display: 'block', color: 'var(--text-dim)' }}>{abierta ? 'en el proyecto' : 'consumido'}</small>
            </div>
            {abierta && mueve && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="boton-secundario" style={paso} disabled={ocupado || c > i.pendiente} title="Devolver a bodega" onClick={() => mover([{ producto_id: i.producto_id, cantidad: -c }])}>−</button>
                <input type="number" inputMode="numeric" min="1" step="1" value={cant[i.producto_id] ?? 1} onChange={(e) => setCant({ ...cant, [i.producto_id]: e.target.value })} style={{ width: 64, textAlign: 'center', fontWeight: 800, fontSize: '1.2rem' }} />
                <button className="boton" style={paso} disabled={ocupado} title="Sacar más de la bodega" onClick={() => mover([{ producto_id: i.producto_id, cantidad: c }])}>+</button>
              </div>
            )}
          </div>
        );
      })}
      {s.costo_total != null && <p><strong>Costo del material {abierta ? 'en el proyecto' : 'consumido'}: {L(s.costo_total)}</strong> <small style={{ color: 'var(--text-dim)' }}>(al costo promedio de bodega)</small></p>}
      {abierta && mueve && (
        <div className="toolbar" style={{ flexWrap: 'wrap', marginTop: 10 }}>
          <button className="boton" style={{ padding: '14px 20px', fontWeight: 800 }} onClick={() => { setNuevos([]); setAgregando(true); }}>+ AGREGAR OTRO PRODUCTO</button>
          <button className="boton-md boton-secundario" onClick={() => setCerrando(true)}>Cerrar proyecto</button>
        </div>
      )}
      {!abierta && gerencia && <button className="boton-md boton-secundario" onClick={async () => { try { setS(await api.post(`/diserco/salidas/${id}/reabrir`, session, {})); } catch (e) { setError(e.message); } }}>Reabrir</button>}
      {agregando && (
        <Modal titulo="Agregar material al proyecto" onCerrar={() => setAgregando(false)} pie={<><button className="boton" style={{ padding: '14px 20px', fontWeight: 800 }} disabled={!nuevos.length || ocupado} onClick={async () => { if (await mover(nuevos)) setAgregando(false); }}>SACAR DE BODEGA</button><button className="boton-md boton-secundario" onClick={() => setAgregando(false)}>Cancelar</button></>}>
          <SelectorProductos productos={productos} items={nuevos} onCambiar={setNuevos} />
        </Modal>
      )}
      {cerrando && (
        <Modal titulo="Cerrar proyecto" onCerrar={() => setCerrando(false)} ancho={520}>
          <p>Material que sigue en el proyecto: <strong>{num(s.unidades, 0)} unidades</strong>.</p>
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="boton-md" disabled={ocupado} onClick={() => cerrar('devolver')}>Lo que sobró REGRESA a bodega (queda disponible para vender)</button>
            <button className="boton-md boton-secundario" disabled={ocupado} onClick={() => cerrar('consumido')}>Todo se CONSUMIÓ en el proyecto</button>
          </div>
          <small style={{ color: 'var(--text-dim)' }}>Si solo regresó una parte, primero resta con el botón − lo que volvió a bodega y luego cierra como “consumido”.</small>
        </Modal>
      )}
    </div>
  );
}
