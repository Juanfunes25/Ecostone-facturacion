import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta, Pestanas } from '../components/Modal.jsx';
import AvisoSinStock from '../components/AvisoSinStock.jsx';
import { L, num, fechaCorta } from '../lib/fmt.js';

const paso = { fontSize: '1.3rem', minWidth: 52, minHeight: 48, fontWeight: 800 };

// Elige productos del inventario DISERCO y la cantidad de cada uno (con + / −).
function SelectorProductos({ productos, items, onCambiar }) {
  const [q, setQ] = useState('');
  const sugeridos = useMemo(() => {
    const t = q.trim().toLowerCase();
    return productos.filter((p) => !items.some((i) => i.producto_id === p.id) && (!t || [p.nombre, p.codigo].some((v) => String(v ?? '').toLowerCase().includes(t)))).slice(0, 8);
  }, [productos, items, q]);
  const porId = new Map(productos.map((p) => [p.id, p]));
  const poner = (id, cantidad) => onCambiar(items.map((i) => (i.producto_id === id ? { ...i, cantidad: Math.max(1, Math.round(Number(cantidad)) || 1) } : i)));

  return (
    <div>
      {items.map((i) => {
        const p = porId.get(i.producto_id);
        const falta = p && i.cantidad > p.existencia;
        return (
          <div key={i.producto_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <strong>{p?.nombre ?? '—'}</strong>
              <small style={{ display: 'block', color: falta ? 'var(--peligro)' : 'var(--text-dim)' }}>Hay en bodega: {num(p?.existencia ?? 0, 0)}{falta ? ' · no alcanza' : ''}</small>
            </div>
            <button className="boton-secundario" style={paso} onClick={() => poner(i.producto_id, i.cantidad - 1)}>−</button>
            <input type="number" inputMode="numeric" min="1" step="1" value={i.cantidad} onChange={(e) => poner(i.producto_id, e.target.value)} style={{ width: 80, textAlign: 'center', fontSize: '1.2rem', fontWeight: 700 }} />
            <button className="boton-secundario" style={paso} onClick={() => poner(i.producto_id, i.cantidad + 1)}>+</button>
            <button className="boton-sm boton-secundario" onClick={() => onCambiar(items.filter((x) => x.producto_id !== i.producto_id))}>✕</button>
          </div>
        );
      })}
      <input placeholder="Buscar producto para agregar…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginTop: 10 }} />
      <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
        {sugeridos.map((p) => (
          <button key={p.id} className="boton-secundario" style={{ textAlign: 'left', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: 8 }} onClick={() => { onCambiar([...items, { producto_id: p.id, cantidad: 1 }]); setQ(''); }}>
            <span>{p.nombre}</span><strong style={{ color: p.existencia > 0 ? 'var(--ok)' : 'var(--peligro)' }}>{num(p.existencia, 0)}</strong>
          </button>
        ))}
        {sugeridos.length === 0 && <small style={{ color: 'var(--text-dim)' }}>{productos.length === 0 ? 'No hay productos con control de inventario.' : 'Sin más resultados.'}</small>}
      </div>
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
  const mueve = ['admin', 'gerente', 'bodega'].includes(perfil.rol);
  useEffect(() => { api.get(`/diserco/salidas?estado=${estado}&q=${encodeURIComponent(q)}`, session).then(setFilas).catch((e) => onError(e.message)); }, [estado, q]);
  return (
    <div className="panel">
      <h2>Salidas de material a proyecto</h2>
      <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>Lo que sale a un proyecto se descuenta de la bodega y queda registrado con el proyecto y quién se lo lleva. Lo que sobra se devuelve y vuelve a estar disponible para vender.</p>
      {mueve && <button className="boton" style={{ width: '100%', padding: '16px', fontSize: '1.2rem', fontWeight: 800, marginBottom: 12 }} onClick={onNueva}>+ NUEVA SALIDA A PROYECTO</button>}
      <Pestanas activa={estado} onCambiar={setEstado} items={[{ id: 'abierta', etiqueta: 'Proyectos en curso' }, { id: 'cerrada', etiqueta: 'Cerrados' }]} />
      <input placeholder="Buscar proyecto o responsable…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {filas.map((s) => (
          <button key={s.id} className="boton-secundario" style={{ textAlign: 'left', padding: 14 }} onClick={() => onAbrir(s.id)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '1.1rem' }}>{s.proyecto}</strong>
              <span>#{s.numero} · {fechaCorta(s.created_at)}</span>
            </div>
            <small style={{ display: 'block', color: 'var(--text-dim)' }}>Responsable: {s.responsable}{s.cotizacion?.codigo ? ` · Cot. ${s.cotizacion.codigo}` : ''}</small>
            <small style={{ display: 'block' }}>{s.items.length} producto{s.items.length === 1 ? '' : 's'} · {num(s.unidades, 0)} {estado === 'abierta' ? 'fuera de bodega' : 'consumidas'} · costo {L(s.costo_total)}</small>
          </button>
        ))}
        {filas.length === 0 && <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>{estado === 'abierta' ? 'No hay material fuera en este momento.' : 'Aún no hay proyectos cerrados.'}</p>}
      </div>
    </div>
  );
}

function Nueva({ session, onCancelar, onCreada }) {
  const [productos, setProductos] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [previas, setPrevias] = useState([]);
  const [f, setF] = useState({ proyecto: '', cotizacion_id: '', responsable: '', notas: '' });
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [faltantes, setFaltantes] = useState(null);

  useEffect(() => {
    api.get('/diserco/inventario', session).then(setProductos).catch((e) => setError(e.message));
    api.get('/diserco/cotizaciones?estado=aprobada,facturada&tipo=proyecto', session).then(setCotizaciones).catch(() => {});
    api.get('/diserco/salidas', session).then(setPrevias).catch(() => {});
  }, []);
  const responsables = useMemo(() => [...new Set(previas.map((s) => s.responsable))], [previas]);

  async function guardar(confirmar) {
    setError('');
    setGuardando(true);
    try {
      const s = await api.post('/diserco/salidas', session, { ...f, items, confirmar_sin_stock: confirmar });
      onCreada(s);
    } catch (e) {
      if (e.codigo === 'SIN_STOCK') setFaltantes(e.faltantes ?? []);
      else setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel">
      {faltantes && <AvisoSinStock faltantes={faltantes} accion="registrar la salida" onCancelar={() => setFaltantes(null)} onContinuar={() => { setFaltantes(null); guardar(true); }} />}
      <h2>Nueva salida a proyecto</h2>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Campo etiqueta="¿A qué proyecto va?" ayuda="Elige una cotización de proyecto o escribe el nombre">
          <input list="proyectos-d" value={f.proyecto} placeholder="Ej.: Nave #7 Honduras Kitting" onChange={(e) => {
            const c = cotizaciones.find((x) => `${x.proyecto} — ${x.nombre_cliente} (${x.codigo})` === e.target.value);
            setF(c ? { ...f, proyecto: `${c.proyecto} — ${c.nombre_cliente}`, cotizacion_id: c.id } : { ...f, proyecto: e.target.value, cotizacion_id: '' });
          }} />
          <datalist id="proyectos-d">{cotizaciones.map((c) => <option key={c.id} value={`${c.proyecto} — ${c.nombre_cliente} (${c.codigo})`} />)}</datalist>
        </Campo>
        <Campo etiqueta="¿Quién se lo lleva?" ancho={220}>
          <input list="responsables-d" value={f.responsable} placeholder="Nombre del empleado" onChange={(e) => setF({ ...f, responsable: e.target.value })} />
          <datalist id="responsables-d">{responsables.map((r) => <option key={r} value={r} />)}</datalist>
        </Campo>
      </div>
      <h3>Material</h3>
      <SelectorProductos productos={productos} items={items} onCambiar={setItems} />
      <Campo etiqueta="Notas (opcional)"><input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} /></Campo>
      <div className="toolbar" style={{ marginTop: 14 }}>
        <button className="boton" style={{ padding: '14px 22px', fontSize: '1.15rem', fontWeight: 800 }} disabled={guardando || !f.proyecto.trim() || !f.responsable.trim() || items.length === 0} onClick={() => guardar(false)}>{guardando ? 'Registrando…' : `REGISTRAR SALIDA (${items.reduce((s, i) => s + i.cantidad, 0)} unidades)`}</button>
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
  const mueve = ['admin', 'gerente', 'bodega'].includes(perfil.rol);
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
      <p style={{ margin: '6px 0' }}>Salida #{s.numero} · {fechaCorta(s.created_at)} · Responsable: <strong>{s.responsable}</strong>{s.cotizacion?.codigo && ` · Cotización ${s.cotizacion.codigo}`}{s.notas && ` · ${s.notas}`}</p>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="tabla" style={{ minWidth: 560 }}>
          <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Salió</th><th style={{ textAlign: 'right' }}>Devuelto</th><th style={{ textAlign: 'right', fontSize: '1.05rem', color: 'var(--aviso)' }}>{abierta ? 'EN EL PROYECTO' : 'CONSUMIDO'}</th>{abierta && mueve && <th>Sumar / restar</th>}</tr></thead>
          <tbody>
            {s.items.map((i) => {
              const c = Math.max(1, Number(cant[i.producto_id]) || 1);
              return (
                <tr key={i.id}>
                  <td><strong>{i.productos?.nombre}</strong><small style={{ display: 'block', color: 'var(--text-dim)' }}>{L(i.costo_unitario)} c/u · en bodega {num(hayEnBodega.get(i.producto_id) ?? 0, 0)}</small></td>
                  <td style={{ textAlign: 'right' }}>{num(i.cantidad_salida, 0)}</td>
                  <td style={{ textAlign: 'right' }}>{num(i.cantidad_retorno, 0)}</td>
                  <td style={{ textAlign: 'right' }}><strong style={{ fontSize: '1.6rem', color: 'var(--aviso)' }}>{num(i.pendiente, 0)}</strong></td>
                  {abierta && mueve && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="boton-secundario" style={paso} disabled={ocupado || c > i.pendiente} title="Devolver a bodega" onClick={() => mover([{ producto_id: i.producto_id, cantidad: -c }])}>−</button>{' '}
                      <input type="number" inputMode="numeric" min="1" step="1" value={cant[i.producto_id] ?? 1} onChange={(e) => setCant({ ...cant, [i.producto_id]: e.target.value })} style={{ width: 64, textAlign: 'center', fontWeight: 700 }} />{' '}
                      <button className="boton" style={paso} disabled={ocupado} title="Sacar más de la bodega" onClick={() => mover([{ producto_id: i.producto_id, cantidad: c }])}>+</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p><strong>Costo del material {abierta ? 'en el proyecto' : 'consumido'}: {L(s.costo_total)}</strong> <small style={{ color: 'var(--text-dim)' }}>(al costo promedio de bodega)</small></p>
      {abierta && mueve && (
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <button className="boton-md" onClick={() => { setNuevos([]); setAgregando(true); }}>+ Agregar otro producto</button>
          <button className="boton-md boton-secundario" onClick={() => setCerrando(true)}>Cerrar proyecto</button>
        </div>
      )}
      {!abierta && gerencia && <button className="boton-md boton-secundario" onClick={async () => { try { setS(await api.post(`/diserco/salidas/${id}/reabrir`, session, {})); } catch (e) { setError(e.message); } }}>Reabrir</button>}
      {agregando && (
        <Modal titulo="Agregar material al proyecto" onCerrar={() => setAgregando(false)} pie={<><button className="boton-md" disabled={!nuevos.length || ocupado} onClick={async () => { if (await mover(nuevos)) setAgregando(false); }}>Sacar de bodega</button><button className="boton-md boton-secundario" onClick={() => setAgregando(false)}>Cancelar</button></>}>
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
