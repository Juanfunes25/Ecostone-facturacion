import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta } from '../components/Modal.jsx';
import { L, num } from '../lib/fmt.js';

const UNIDADES = ['unidad', 'kit', 'galon', 'cubeta', 'saco', 'litro', 'm2', 'ml'];
const VACIO = { nombre: '', codigo: '', categoria_id: '', presentacion: 'Kit', unidad_venta: 'kit', precio: '', costo_estandar: '', rendimiento_texto: '', controla_inventario: true, stock_minimo: '0', activo: true };

// Catálogo de productos de DISERCO. Los precios van SIN ISV (el ISV se suma en la cotización).
export default function CatalogoD({ session, perfil }) {
  const [filas, setFilas] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  async function cargar() {
    const [p, c] = await Promise.all([api.get('/diserco/productos?incluirInactivos=true', session), api.get('/categorias', session)]);
    setFilas(p);
    setCategorias(c);
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, []);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filas.filter((p) => !t || [p.nombre, p.codigo, p.presentacion].some((v) => String(v ?? '').toLowerCase().includes(t)));
  }, [filas, q]);

  async function guardar() {
    setError('');
    try {
      const f = modal.form;
      const cuerpo = { ...f, precio: Number(f.precio), costo_estandar: Number(f.costo_estandar) || 0, stock_minimo: Number(f.stock_minimo) || 0 };
      if (modal.id) await api.put(`/diserco/productos/${modal.id}`, session, cuerpo);
      else await api.post('/diserco/productos', session, cuerpo);
      setModal(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }
  const set = (k, v) => setModal((m) => ({ ...m, form: { ...m.form, [k]: v } }));

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <div className="panel">
        <h2>Productos DISERCO</h2>
        <div className="toolbar">
          <input placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
          {gerencia && <button className="boton-md" onClick={() => setModal({ id: null, form: { ...VACIO } })}>+ Nuevo producto</button>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tabla" style={{ minWidth: 700 }}>
            <thead><tr><th>Producto</th><th>Presentación</th><th style={{ textAlign: 'right' }}>Precio (sin ISV)</th><th style={{ textAlign: 'right' }}>Costo</th><th style={{ textAlign: 'right' }}>Existencia</th><th></th></tr></thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id} style={p.activo ? undefined : { opacity: 0.5 }}>
                  <td><strong>{p.nombre}</strong>{p.codigo && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{p.codigo}</small>}{p.rendimiento_texto && <small style={{ display: 'block', color: 'var(--text-dim)' }}>Rendimiento: {p.rendimiento_texto}</small>}</td>
                  <td>{p.presentacion ?? p.unidad_venta}</td>
                  <td style={{ textAlign: 'right' }}>{L(p.precio)}</td>
                  <td style={{ textAlign: 'right' }}>{Number(p.costo_estandar) > 0 ? L(p.costo_estandar) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{p.controla_inventario ? <>{num(p.existencia, 0)} {p.bajo_minimo && <Etiqueta tono="peligro">bajo mínimo</Etiqueta>}</> : <small style={{ color: 'var(--text-dim)' }}>sin control</small>}</td>
                  <td>{gerencia && <button className="boton-sm boton-secundario" onClick={() => setModal({ id: p.id, form: { ...VACIO, ...p, categoria_id: p.categoria_id ?? '', precio: String(Number(p.precio)), costo_estandar: String(Number(p.costo_estandar) || ''), stock_minimo: String(Number(p.stock_minimo) || 0), codigo: p.codigo ?? '', presentacion: p.presentacion ?? '', rendimiento_texto: p.rendimiento_texto ?? '' } })}>Editar</button>}</td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin productos. Crea el primero con “+ Nuevo producto”.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {modal && (
        <Modal titulo={modal.id ? 'Editar producto' : 'Nuevo producto'} onCerrar={() => setModal(null)} pie={<><button className="boton-md" disabled={!modal.form.nombre.trim() || modal.form.precio === ''} onClick={guardar}>Guardar</button><button className="boton-md boton-secundario" onClick={() => setModal(null)}>Cancelar</button></>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta="Nombre"><input value={modal.form.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Ej.: Epóxico Quarzo Autonivelante Top - Ivory" /></Campo>
            <Campo etiqueta="Código" ancho={120}><input value={modal.form.codigo} onChange={(e) => set('codigo', e.target.value)} /></Campo>
            <Campo etiqueta="Categoría" ancho={200}><select value={modal.form.categoria_id} onChange={(e) => set('categoria_id', e.target.value)}><option value="">—</option>{categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Presentación" ancho={140}><input value={modal.form.presentacion} onChange={(e) => set('presentacion', e.target.value)} placeholder="Kit, galón…" /></Campo>
            <Campo etiqueta="Unidad de venta" ancho={140}><select value={modal.form.unidad_venta} onChange={(e) => set('unidad_venta', e.target.value)}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select></Campo>
            <Campo etiqueta="Precio de venta (sin ISV)" ancho={170}><input type="number" step="0.01" min="0" value={modal.form.precio} onChange={(e) => set('precio', e.target.value)} /></Campo>
            <Campo etiqueta="Costo (sin ISV)" ancho={150} ayuda="Se actualiza solo con las compras"><input type="number" step="0.01" min="0" value={modal.form.costo_estandar} onChange={(e) => set('costo_estandar', e.target.value)} /></Campo>
            <Campo etiqueta="Rendimiento aproximado" ayuda="Sale en la cotización de productos"><input value={modal.form.rendimiento_texto} onChange={(e) => set('rendimiento_texto', e.target.value)} placeholder="Ej.: 15 m2 aproximadamente" /></Campo>
            <Campo etiqueta="Mínimo en inventario" ancho={150}><input type="number" step="1" min="0" value={modal.form.stock_minimo} onChange={(e) => set('stock_minimo', e.target.value)} /></Campo>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={modal.form.controla_inventario} onChange={(e) => set('controla_inventario', e.target.checked)} /> Controlar inventario (descuenta al facturar)</label>
          {modal.id && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={modal.form.activo} onChange={(e) => set('activo', e.target.checked)} /> Activo</label>}
        </Modal>
      )}
    </div>
  );
}
