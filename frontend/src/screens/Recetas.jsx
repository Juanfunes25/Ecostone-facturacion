import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta } from '../components/Modal.jsx';
import { L, num } from '../lib/fmt.js';

const VACIA = { producto_id: '', nombre: '', merma_esperada_pct: 5, mano_obra_m2: 0, indirectos_m2: 0, dias_curado: 7, horas_desmolde: 24, notas: '', items: [] };

// Receta = consumo de insumos por m² de producto terminado. De aquí salen el
// consumo teórico de cada colada, el costo por m² y el margen.
export default function Recetas({ session, perfil }) {
  const [recetas, setRecetas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [mps, setMps] = useState([]);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  async function cargar() {
    const [r, p, m] = await Promise.all([api.get('/fabricacion/recetas', session), api.get('/productos', session), api.get('/insumos/materias-primas', session)]);
    setRecetas(r);
    setProductos(p.filter((x) => x.tipo === 'piedra'));
    setMps(m.filter((x) => x.activo));
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, []);

  const abrir = (r) => setModal(r ? { id: r.id, form: { producto_id: r.producto_id, nombre: r.nombre, merma_esperada_pct: r.merma_esperada_pct, mano_obra_m2: r.mano_obra_m2, indirectos_m2: r.indirectos_m2, dias_curado: r.dias_curado, horas_desmolde: r.horas_desmolde, notas: r.notas ?? '', items: r.receta_items.map((i) => ({ mp_id: i.mp_id, cantidad_m2: i.cantidad_m2 })) } } : { form: { ...VACIA, items: [{ mp_id: '', cantidad_m2: '' }] } });
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
          Cada receta indica cuánto de cada insumo lleva <strong>1 m²</strong> de producto terminado (cemento, agregado ligero, pigmento, aditivos, desmoldante, etc.), la merma normal, el curado y la mano de obra. Los costos usan el costo promedio de cada insumo, así que se actualizan solos con cada compra y con el tipo de cambio.
        </p>
        <div className="toolbar">{gerencia && <button className="boton-sm" onClick={() => abrir(null)}>+ Receta</button>}</div>
        <table className="tabla">
          <thead><tr><th>Producto</th><th>Receta</th><th>Insumos</th><th>Curado</th>{gerencia && <><th style={{ textAlign: 'right' }}>Costo/m²</th><th style={{ textAlign: 'right' }}>Margen (Público)</th></>}<th></th></tr></thead>
          <tbody>
            {recetas.map((r) => (
              <tr key={r.id} style={r.activa ? undefined : { opacity: 0.55 }}>
                <td><strong>{r.productos?.nombre}</strong></td>
                <td>{r.nombre} {!r.activa && <Etiqueta>anterior</Etiqueta>}</td>
                <td style={{ fontSize: '0.85em' }}>{r.receta_items.map((i) => `${i.materias_primas.nombre.replace('[EJEMPLO] ', '')}: ${num(i.cantidad_m2, 3)} ${i.materias_primas.unidad}`).join(' · ')}</td>
                <td>{r.dias_curado} días</td>
                {gerencia && <><td style={{ textAlign: 'right' }}>{L(r.costo?.total_m2)}</td><td style={{ textAlign: 'right' }}>{r.margen_pct_publico != null ? `${num(r.margen_pct_publico, 1)}%` : '—'}</td></>}
                <td>{gerencia && <button className="boton-sm boton-secundario" onClick={() => abrir(r)}>Editar</button>}</td>
              </tr>
            ))}
            {recetas.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Aún no hay recetas. Crea primero el producto en el catálogo y luego su receta.</td></tr>}
          </tbody>
        </table>
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
            <Campo etiqueta="Días de curado" ancho={120}><input type="number" value={f.dias_curado} onChange={(e) => set('dias_curado', e.target.value)} /></Campo>
            <Campo etiqueta="Horas a desmolde" ancho={130}><input type="number" value={f.horas_desmolde} onChange={(e) => set('horas_desmolde', e.target.value)} /></Campo>
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
