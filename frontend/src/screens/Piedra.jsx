import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta } from '../components/Modal.jsx';
import { L, num } from '../lib/fmt.js';

const UNIDADES = [
  ['m2', 'm²'], ['caja', 'Caja'], ['pieza', 'Pieza'], ['ml', 'Metro lineal'], ['saco', 'Saco'], ['galon', 'Galón'], ['unidad', 'Unidad'], ['viaje', 'Viaje'], ['global', 'Global'],
];
const VACIO = { tipo: 'piedra', nombre: '', codigo: '', modelo: '', color: '', unidad_venta: 'm2', m2_por_caja: '', piezas_por_m2: '', peso_kg_m2: '', rendimiento_m2: '', stock_minimo_m2: '', descripcion: '', precio: '', impuesto1_tasa: 0.15 };

export default function Piedra({ session, perfil }) {
  const [productos, setProductos] = useState([]);
  const [listas, setListas] = useState([]);
  const [precios, setPrecios] = useState({});
  const [filtro, setFiltro] = useState('');
  const [tipo, setTipo] = useState('');
  const [editando, setEditando] = useState(null); // null | {id?, form, preciosForm}
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  async function cargar() {
    const [p, l, pr] = await Promise.all([
      api.get('/productos?incluirInactivos=true', session),
      api.get('/listas-precio', session),
      api.get('/listas-precio/precios', session),
    ]);
    setProductos(p);
    setListas(l);
    setPrecios(Object.fromEntries(pr.map((x) => [`${x.producto_id}|${x.lista_id}`, Number(x.precio)])));
  }
  useEffect(() => {
    cargar().catch((e) => setError(e.message));
  }, []);

  const visibles = useMemo(
    () => productos.filter((p) => (!tipo || p.tipo === tipo) && (!filtro || `${p.nombre} ${p.modelo ?? ''} ${p.color ?? ''} ${p.codigo ?? ''}`.toLowerCase().includes(filtro.toLowerCase()))),
    [productos, filtro, tipo]
  );

  function nuevo(t = 'piedra') {
    const base = { ...VACIO, tipo: t, unidad_venta: t === 'piedra' ? 'm2' : t === 'accesorio' ? 'saco' : 'viaje', precio: '' };
    setEditando({ form: base, preciosForm: {} });
  }
  function editar(p) {
    setEditando({
      id: p.id,
      form: Object.fromEntries(Object.keys(VACIO).map((k) => [k, p[k] ?? ''])),
      preciosForm: Object.fromEntries(listas.map((l) => [l.id, precios[`${p.id}|${l.id}`] ?? (l.orden === 1 ? Number(p.precio) : '')])),
      precioOriginal: Number(p.precio),
      activo: p.activo,
    });
  }

  async function guardar() {
    setError('');
    setGuardando(true);
    try {
      const f = editando.form;
      if (!f.nombre.trim()) throw new Error('Escribe el nombre del producto');
      const publico = listas.find((l) => l.orden === 1);
      const precioPublico = editando.id ? Number(editando.preciosForm[publico?.id]) || editando.precioOriginal : Number(f.precio || 0);
      const cuerpo = { ...f, nombre: f.nombre.trim(), precio: precioPublico, impuesto1_tasa: Number(f.impuesto1_tasa) };
      let guardado;
      if (editando.id) guardado = await api.put(`/productos/${editando.id}`, session, { ...cuerpo, activo: editando.activo });
      else guardado = await api.post('/productos', session, cuerpo);
      if (gerencia) {
        for (const l of listas.filter((x) => x.orden !== 1)) {
          const v = editando.preciosForm[l.id];
          if (v !== '' && v !== undefined && Number(v) !== precios[`${guardado.id}|${l.id}`]) {
            await api.put('/listas-precio/precios', session, { producto_id: guardado.id, lista_id: l.id, precio: Number(v) });
          }
        }
      }
      setEditando(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!window.confirm(`¿Eliminar “${editando.form.nombre}” definitivamente? No se puede deshacer.`)) return;
    setError('');
    try {
      await api.del(`/productos/${editando.id}?definitivo=1`, session);
      setEditando(null);
      await cargar();
    } catch (e) {
      if (e.codigo === 'CON_HISTORIAL' && window.confirm(`${e.message}\n\n¿Desactivarlo ahora?`)) {
        try { await api.del(`/productos/${editando.id}`, session); setEditando(null); await cargar(); } catch (e2) { setError(e2.message); }
      } else if (e.codigo !== 'CON_HISTORIAL') setError(e.message);
    }
  }

  const f = editando?.form;
  const set = (k, v) => setEditando({ ...editando, form: { ...editando.form, [k]: v } });
  const esPiedra = f?.tipo === 'piedra';
  const esAcc = f?.tipo === 'accesorio';

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>Catálogo de piedra y accesorios</h2>
        <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>
          Producto = modelo + color. Los precios se cargan por lista (Público con ISV incluido; Contratista y Distribuidor + ISV aparte). Los productos marcados [EJEMPLO] son de muestra: edítalos o desactívalos.
        </p>
        <div className="toolbar">
          <input placeholder="Buscar modelo, color o código…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="piedra">Piedra</option>
            <option value="accesorio">Accesorios</option>
            <option value="servicio">Servicios</option>
          </select>
          {gerencia && (
            <>
              <button className="boton-sm" onClick={() => nuevo('piedra')}>+ Piedra</button>
              <button className="boton-sm boton-secundario" onClick={() => nuevo('accesorio')}>+ Accesorio</button>
              <button className="boton-sm boton-secundario" onClick={() => nuevo('servicio')}>+ Servicio</button>
            </>
          )}
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto</th><th>Tipo</th><th>Unidad</th><th>Caja</th>
              {listas.map((l) => <th key={l.id} style={{ textAlign: 'right' }}>{l.nombre}</th>)}
              {gerencia && <th style={{ textAlign: 'right' }}>Costo/m²</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.id} style={p.activo ? undefined : { opacity: 0.5 }}>
                <td><strong>{p.nombre}</strong>{p.color && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{p.modelo} · {p.color}</small>}</td>
                <td>{p.tipo}</td>
                <td>{p.unidad_venta}</td>
                <td>{p.m2_por_caja ? `${num(p.m2_por_caja, 3)} m²` : p.rendimiento_m2 ? `rinde ${num(p.rendimiento_m2)} m²` : '—'}</td>
                {listas.map((l) => {
                  const v = precios[`${p.id}|${l.id}`] ?? (l.orden === 1 ? Number(p.precio) : null);
                  return <td key={l.id} style={{ textAlign: 'right' }}>{v ? L(v) : '—'}</td>;
                })}
                {gerencia && <td style={{ textAlign: 'right' }}>{Number(p.costo_estandar) > 0 ? L(p.costo_estandar) : '—'}</td>}
                <td>{gerencia && <button className="boton-sm boton-secundario" onClick={() => editar(p)}>Editar</button>}{!p.activo && <> <Etiqueta>inactivo</Etiqueta></>}</td>
              </tr>
            ))}
            {visibles.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin productos</td></tr>}
          </tbody>
        </table>
      </div>

      {editando && (
        <Modal titulo={editando.id ? 'Editar producto' : `Nuevo ${f.tipo}`} onCerrar={() => setEditando(null)} ancho={760}
          pie={<><button className="boton-sm" disabled={guardando} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            {editando.id && gerencia && <button className="boton-sm boton-peligro" disabled={guardando} onClick={eliminar}>🗑 Eliminar</button>}
            {editando.id && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={editando.activo} onChange={(e) => setEditando({ ...editando, activo: e.target.checked })} /> Activo</label>}</>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta="Nombre comercial"><input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Ej.: Piedra Río Ocre" /></Campo>
            <Campo etiqueta="Código" ancho={130}><input value={f.codigo} onChange={(e) => set('codigo', e.target.value)} /></Campo>
            {esPiedra && <Campo etiqueta="Modelo"><input value={f.modelo} onChange={(e) => set('modelo', e.target.value)} /></Campo>}
            {esPiedra && <Campo etiqueta="Color"><input value={f.color} onChange={(e) => set('color', e.target.value)} /></Campo>}
            <Campo etiqueta="Se vende por" ancho={150}>
              <select value={f.unidad_venta} onChange={(e) => set('unidad_venta', e.target.value)}>{UNIDADES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
            </Campo>
            {esPiedra && <Campo etiqueta="m² por caja" ancho={120}><input type="number" step="0.001" value={f.m2_por_caja} onChange={(e) => set('m2_por_caja', e.target.value)} /></Campo>}
            {esPiedra && <Campo etiqueta="Piezas por m²" ancho={120}><input type="number" step="0.01" value={f.piezas_por_m2} onChange={(e) => set('piezas_por_m2', e.target.value)} /></Campo>}
            {esPiedra && <Campo etiqueta="Peso kg/m²" ancho={110} ayuda="Para el flete"><input type="number" step="0.1" value={f.peso_kg_m2} onChange={(e) => set('peso_kg_m2', e.target.value)} /></Campo>}
            {esPiedra && <Campo etiqueta="Stock mínimo m²" ancho={130}><input type="number" step="1" value={f.stock_minimo_m2} onChange={(e) => set('stock_minimo_m2', e.target.value)} /></Campo>}
            {esAcc && <Campo etiqueta="Rendimiento (m² por unidad)" ancho={200} ayuda="Ej.: un saco de pegamento cubre X m²"><input type="number" step="0.1" value={f.rendimiento_m2} onChange={(e) => set('rendimiento_m2', e.target.value)} /></Campo>}
            <Campo etiqueta="ISV" ancho={110}>
              <select value={f.impuesto1_tasa} onChange={(e) => set('impuesto1_tasa', e.target.value)}><option value={0.15}>15%</option><option value={0}>0%</option></select>
            </Campo>
            <Campo etiqueta="Descripción"><input value={f.descripcion} onChange={(e) => set('descripcion', e.target.value)} /></Campo>
          </div>
          <h3 style={{ margin: '14px 0 6px' }}>Precios por lista</h3>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {!editando.id && <Campo etiqueta="Precio Público (con ISV)" ancho={190}><input type="number" step="0.01" value={f.precio} onChange={(e) => set('precio', e.target.value)} /></Campo>}
            {editando.id && listas.map((l) => (
              <Campo key={l.id} etiqueta={`${l.nombre} ${l.isv_incluido ? '(con ISV)' : '(sin ISV)'}`} ancho={190}>
                <input type="number" step="0.01" value={editando.preciosForm[l.id] ?? ''} onChange={(e) => setEditando({ ...editando, preciosForm: { ...editando.preciosForm, [l.id]: e.target.value } })} />
              </Campo>
            ))}
            {!editando.id && <small style={{ color: 'var(--text-dim)' }}>Guarda primero; después podrás cargar Contratista y Distribuidor.</small>}
          </div>
        </Modal>
      )}
    </div>
  );
}
