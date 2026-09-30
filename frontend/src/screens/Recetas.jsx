import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta } from '../components/Modal.jsx';
import { L, num } from '../lib/fmt.js';
import { descargarCsv } from '../lib/csv.js';

const norm = (t) => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const VACIA = { producto_id: '', nombre: '', merma_esperada_pct: 5, mano_obra_m2: 0, indirectos_m2: 0, notas: '', items: [] };

// Receta = consumo de insumos por m² de producto terminado. De aquí salen el
// consumo teórico de cada colada, el costo por m² y el margen.
export default function Recetas({ session, perfil }) {
  const [recetas, setRecetas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [mps, setMps] = useState([]);
  const [modal, setModal] = useState(null);
  const [q, setQ] = useState('');
  const [modelo, setModelo] = useState('');
  const [abierta, setAbierta] = useState(null);
  const [error, setError] = useState('');
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  async function cargar() {
    const [r, p, m] = await Promise.all([api.get('/fabricacion/recetas', session), api.get('/productos', session), api.get('/insumos/materias-primas', session)]);
    setRecetas(r);
    setProductos(p.filter((x) => x.tipo === 'piedra'));
    setMps(m.filter((x) => x.activo));
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, []);

  const modelos = [...new Set(recetas.map((r) => r.productos?.modelo).filter(Boolean))].sort();
  const visibles = recetas
    .filter((r) => (!modelo || r.productos?.modelo === modelo) && (!q || norm(`${r.productos?.nombre} ${r.receta_items.map((i) => i.materias_primas.nombre).join(' ')}`).includes(norm(q))))
    .sort((a, b) => String(a.productos?.nombre).localeCompare(String(b.productos?.nombre)));

  function exportar() {
    const filas = visibles.flatMap((r) => r.receta_items.map((i) => ({ r, i })));
    descargarCsv(`recetas-${new Date().toISOString().slice(0, 10)}.csv`, filas, [
      { titulo: 'Producto', valor: (f) => f.r.productos?.nombre }, { titulo: 'Ingrediente', valor: (f) => f.i.materias_primas.nombre }, { titulo: 'Unidad', valor: (f) => f.i.materias_primas.unidad },
      { titulo: 'Cantidad por m²', valor: (f) => f.i.cantidad_m2 },
      ...(gerencia ? [{ titulo: 'Costo unitario', valor: (f) => Number(f.i.materias_primas.costo_promedio).toFixed(4) }, { titulo: 'Total', valor: (f) => (Number(f.i.cantidad_m2) * Number(f.i.materias_primas.costo_promedio)).toFixed(4) }] : []),
    ]);
  }

  const abrir = (r) => setModal(r ? { id: r.id, form: { producto_id: r.producto_id, nombre: r.nombre, merma_esperada_pct: r.merma_esperada_pct, mano_obra_m2: r.mano_obra_m2, indirectos_m2: r.indirectos_m2, notas: r.notas ?? '', items: r.receta_items.map((i) => ({ mp_id: i.mp_id, cantidad_m2: i.cantidad_m2 })) } } : { form: { ...VACIA, items: [{ mp_id: '', cantidad_m2: '' }] } });
  const f = modal?.form;
  const set = (k, v) => setModal({ ...modal, form: { ...modal.form, [k]: v } });
  const setItem = (i, k, v) => set('items', f.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  // Costo en vivo mientras se edita
  const costoVivo = f ? (() => {
    const insumos = f.items.reduce((s, i) => s + Number(i.cantidad_m2 || 0) * Number(mps.find((m) => m.id === i.mp_id)?.costo_promedio ?? 0), 0);
    const conMerma = insumos * (1 + Number(f.merma_esperada_pct || 0) / 100);
    return { insumos, conMerma, total: conMerma + Number(f.mano_obra_m2 || 0) + Number(f.indirectos_m2 || 0) };
  })() : null;

  async function guardar() {
    setError('');
    try {
      if (modal.id) await api.put(`/fabricacion/recetas/${modal.id}`, session, f);
      else await api.post('/fabricacion/recetas', session, f);
      setModal(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>Recetas y costo por m²</h2>
        <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>
          Cada receta indica cuánto de cada insumo lleva <strong>1 m²</strong> de producto terminado (cemento, agregado ligero, pigmento, aditivos, desmoldante, etc.), la merma normal y la mano de obra. Los costos usan el costo promedio de cada insumo, así que se actualizan solos con cada compra y con el tipo de cambio.
        </p>
        <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Buscar producto o ingrediente…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 240px' }} />
          <select value={modelo} onChange={(e) => setModelo(e.target.value)}><option value="">Todos los modelos</option>{modelos.map((m) => <option key={m}>{m}</option>)}</select>
          {gerencia && <button className="boton-sm" onClick={() => abrir(null)}>+ Receta</button>}
          <button className="boton-sm boton-secundario" onClick={exportar}>Exportar (CSV)</button>
          <span style={{ color: 'var(--text-dim)' }}>{visibles.length} de {recetas.length} recetas</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tabla" style={{ minWidth: 640 }}>
            <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Ingredientes</th>{gerencia && <><th style={{ textAlign: 'right' }}>Costo por m²</th><th style={{ textAlign: 'right' }}>Precio</th><th style={{ textAlign: 'right' }}>Margen</th></>}<th></th></tr></thead>
            <tbody>
              {visibles.map((r) => {
                const abierto = abierta === r.id;
                const filas = r.receta_items.map((i) => ({ ...i, unit: Number(i.materias_primas.costo_promedio), total: Number(i.cantidad_m2) * Number(i.materias_primas.costo_promedio) }));
                return (
                  <Fragment key={r.id}>
                    <tr style={{ ...(r.activa ? {} : { opacity: 0.55 }), cursor: 'pointer' }} onClick={() => setAbierta(abierto ? null : r.id)}>
                      <td><strong>{r.productos?.nombre}</strong>{!r.activa && <> <Etiqueta>anterior</Etiqueta></>}<small style={{ display: 'block', color: 'var(--text-dim)' }}>{r.nombre}</small></td>
                      <td style={{ textAlign: 'right' }}>{r.receta_items.length}</td>
                      {gerencia && <><td style={{ textAlign: 'right' }}><strong>{L(r.costo?.total_m2)}</strong></td><td style={{ textAlign: 'right' }}>{L(r.productos?.precio)}</td><td style={{ textAlign: 'right' }}>{r.margen_pct_publico != null ? `${num(r.margen_pct_publico, 1)}%` : '—'}</td></>}
                      <td style={{ whiteSpace: 'nowrap' }}><button className="boton-sm boton-secundario" onClick={(e) => { e.stopPropagation(); setAbierta(abierto ? null : r.id); }}>{abierto ? 'Ocultar' : 'Ver receta'}</button>{gerencia && <> <button className="boton-sm boton-secundario" onClick={(e) => { e.stopPropagation(); abrir(r); }}>Editar</button></>}</td>
                    </tr>
                    {abierto && (
                      <tr key={`${r.id}-d`}>
                        <td colSpan={gerencia ? 6 : 3} style={{ background: 'var(--navy-elevada)' }}>
                          <table className="tabla" style={{ margin: 0 }}>
                            <thead><tr><th>Ingrediente</th><th style={{ textAlign: 'right' }}>Cantidad por m²</th>{gerencia && <><th style={{ textAlign: 'right' }}>Costo unitario</th><th style={{ textAlign: 'right' }}>Total</th></>}</tr></thead>
                            <tbody>
                              {filas.map((f) => (
                                <tr key={f.mp_id}><td>{f.materias_primas.nombre.replace('[EJEMPLO] ', '')}</td><td style={{ textAlign: 'right' }}>{num(f.cantidad_m2, 3)} {f.materias_primas.unidad}</td>{gerencia && <><td style={{ textAlign: 'right' }}>{L(f.unit)}</td><td style={{ textAlign: 'right' }}>{L(f.total)}</td></>}</tr>
                              ))}
                              {gerencia && r.costo && (
                                <>
                                  {Number(r.merma_esperada_pct) > 0 && <tr><td colSpan={3} style={{ textAlign: 'right', color: 'var(--text-dim)' }}>Merma esperada {num(r.merma_esperada_pct, 1)}%</td><td style={{ textAlign: 'right' }}>{L(r.costo.insumos_con_merma - r.costo.insumos)}</td></tr>}
                                  {(r.costo.mano_obra > 0 || r.costo.indirectos > 0) && <tr><td colSpan={3} style={{ textAlign: 'right', color: 'var(--text-dim)' }}>Mano de obra + indirectos</td><td style={{ textAlign: 'right' }}>{L(r.costo.mano_obra + r.costo.indirectos)}</td></tr>}
                                  <tr><td colSpan={3} style={{ textAlign: 'right' }}><strong>Costo por m² (1 caja)</strong></td><td style={{ textAlign: 'right' }}><strong>{L(r.costo.total_m2)}</strong></td></tr>
                                </>
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {visibles.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>{recetas.length === 0 ? 'Aún no hay recetas.' : 'Sin resultados con estos filtros.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <Modal titulo={modal.id ? 'Editar receta' : 'Nueva receta'} ancho={820} onCerrar={() => setModal(null)}
          pie={<button className="boton-sm" disabled={!f.producto_id || !f.nombre} onClick={guardar}>Guardar y actualizar costo</button>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta="Producto"><select disabled={!!modal.id} value={f.producto_id} onChange={(e) => set('producto_id', e.target.value)}><option value="">Elige…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Nombre de la receta"><input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Ej.: Mezcla estándar v1" /></Campo>
            <Campo etiqueta="Merma esperada %" ancho={130}><input type="number" step="0.1" value={f.merma_esperada_pct} onChange={(e) => set('merma_esperada_pct', e.target.value)} /></Campo>
            <Campo etiqueta="Mano de obra L/m²" ancho={140}><input type="number" step="0.01" value={f.mano_obra_m2} onChange={(e) => set('mano_obra_m2', e.target.value)} /></Campo>
            <Campo etiqueta="Indirectos L/m²" ancho={130} ayuda="Energía, agua, depreciación de moldes"><input type="number" step="0.01" value={f.indirectos_m2} onChange={(e) => set('indirectos_m2', e.target.value)} /></Campo>
          </div>
          <h3 style={{ margin: '14px 0 6px' }}>Insumos por m² terminado</h3>
          <table className="tabla">
            <thead><tr><th>Insumo</th><th style={{ width: 150 }}>Cantidad por m²</th><th style={{ width: 110, textAlign: 'right' }}>Costo</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {f.items.map((it, i) => {
                const mp = mps.find((m) => m.id === it.mp_id);
                return (
                  <tr key={i}>
                    <td><select value={it.mp_id} onChange={(e) => setItem(i, 'mp_id', e.target.value)}><option value="">Elige insumo…</option>{mps.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.unidad})</option>)}</select></td>
                    <td><input type="number" step="0.0001" value={it.cantidad_m2} onChange={(e) => setItem(i, 'cantidad_m2', e.target.value)} /> {mp?.unidad}</td>
                    <td style={{ textAlign: 'right' }}>{mp ? L(Number(it.cantidad_m2 || 0) * Number(mp.costo_promedio)) : '—'}</td>
                    <td><button className="boton-sm boton-secundario" onClick={() => set('items', f.items.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="boton-sm boton-secundario" style={{ marginTop: 8 }} onClick={() => set('items', [...f.items, { mp_id: '', cantidad_m2: '' }])}>+ Insumo</button>
          {costoVivo && (
            <div className="rep-nota" style={{ marginTop: 12 }}>
              Insumos {L(costoVivo.insumos)} → con merma {L(costoVivo.conMerma)} + mano de obra {L(f.mano_obra_m2)} + indirectos {L(f.indirectos_m2)} = <strong>{L(costoVivo.total)} por m²</strong>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
