import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta, Kpis, Pestanas } from '../components/Modal.jsx';
import Icono from '../components/Icono.jsx';
import AvisoSinStock from '../components/AvisoSinStock.jsx';
import { L, num } from '../lib/fmt.js';

const TIPOS = { compra: 'Compra', inicial: 'Existencia inicial', ajuste: 'Ajuste', venta: 'Venta (factura)', devolucion: 'Devolución (anulación)', salida_proyecto: 'Salida a proyecto', retorno_proyecto: 'Regresa de proyecto', proyecto: 'Sacar a proyecto' };

// Inventario de productos DISERCO: existencias, compras y ajustes. Cada factura descuenta sola.
export default function InventarioD({ session, perfil }) {
  const [filas, setFilas] = useState([]);
  const [kardex, setKardex] = useState([]);
  const [pestana, setPestana] = useState('stock');
  const [q, setQ] = useState('');
  const [soloBajo, setSoloBajo] = useState(false);
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [faltantes, setFaltantes] = useState(null);
  const [abiertas, setAbiertas] = useState([]);
  const mueve = ['admin', 'gerente', 'bodega'].includes(perfil.rol);
  const admin = perfil.rol === 'admin';
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  async function cargar() {
    const [i, k] = await Promise.all([api.get('/diserco/inventario', session), api.get('/diserco/inventario/kardex', session)]);
    setFilas(i);
    setKardex(k);
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, []);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filas.filter((p) => (!t || [p.nombre, p.codigo].some((v) => String(v ?? '').toLowerCase().includes(t))) && (!soloBajo || p.bajo_minimo));
  }, [filas, q, soloBajo]);
  const valor = filas.reduce((s, p) => s + p.existencia * Number(p.costo_estandar || 0), 0);

  function abrir(tipo, p) {
    setMenu(null);
    if (tipo === 'proyecto') api.get('/diserco/salidas/proyectos', session).then((r) => setAbiertas(r.en_curso)).catch(() => {});
    setModal({ tipo, producto: p, form: { salida_id: '', proyecto: '', responsable: '', cantidad: '', costo: tipo === 'compra' ? String(Number(p.costo_estandar) || '') : '', proveedor: '', referencia: '', motivo: '' } });
  }
  const set = (k, v) => setModal((m) => ({ ...m, form: { ...m.form, [k]: v } }));

  async function guardarProyecto(confirmar = false) {
    setError('');
    try {
      const f = modal.form;
      const items = [{ producto_id: modal.producto.id, cantidad: Number(f.cantidad) }];
      await api.post('/diserco/salidas', session, { proyecto: (f.salida_id || f.proyecto).trim(), items, confirmar_sin_stock: confirmar });
      setAviso(`Salida registrada: ${f.cantidad} × ${modal.producto.nombre}`);
      setModal(null);
      await cargar();
    } catch (e) {
      if (e.codigo === 'SIN_STOCK') setFaltantes({ faltantes: e.faltantes ?? [] });
      else setError(e.message);
    }
  }

  async function guardar() {
    if (modal.tipo === 'proyecto') return guardarProyecto();
    setError('');
    try {
      const f = modal.form;
      await api.post('/diserco/inventario/movimiento', session, { producto_id: modal.producto.id, tipo: modal.tipo, cantidad: Number(f.cantidad), costo: Number(f.costo) || 0, proveedor: f.proveedor, referencia: f.referencia, motivo: f.motivo });
      setAviso(`${TIPOS[modal.tipo]} registrada: ${modal.producto.nombre}`);
      setModal(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {aviso && <div className="aviso-ok" onClick={() => setAviso('')}>{aviso}</div>}
      <div className="panel">
        <h2>Inventario DISERCO</h2>
        <Kpis items={[{ titulo: 'Productos con control', valor: filas.length }, { titulo: 'Bajo el mínimo', valor: filas.filter((p) => p.bajo_minimo).length }, ...(gerencia ? [{ titulo: 'Valor del inventario (costo)', valor: L(valor) }] : [])]} />
        <Pestanas activa={pestana} onCambiar={setPestana} items={[{ id: 'stock', etiqueta: 'Existencias' }, { id: 'kardex', etiqueta: 'Movimientos' }]} />
        {pestana === 'stock' && (
          <>
            <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <input placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={soloBajo} onChange={(e) => setSoloBajo(e.target.checked)} /> Bajo el mínimo</label>
            </div>
            <table className="tabla">
              <thead><tr><th>Producto</th><th style={{ textAlign: 'right', fontSize: '1.05rem', color: 'var(--ok)' }}>EN BODEGA<small style={{ display: 'block', fontWeight: 400 }}>para vender</small></th>{admin && <th style={{ textAlign: 'right', color: 'var(--aviso)' }}>EN PROYECTOS</th>}<th style={{ textAlign: 'right' }}>Mínimo</th>{gerencia && <th style={{ textAlign: 'right' }}>Costo prom.</th>}<th></th></tr></thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.nombre}</strong> {p.bajo_minimo && <Etiqueta tono="peligro">bajo mínimo</Etiqueta>}<small style={{ display: 'block', color: 'var(--text-dim)' }}>{p.presentacion ?? p.unidad_venta}</small></td>
                    <td style={{ textAlign: 'right', background: 'color-mix(in srgb, var(--ok) 9%, transparent)', minWidth: 120 }}><strong style={{ fontSize: '1.7rem', fontWeight: 800, color: p.existencia > 0 ? 'var(--ok)' : 'var(--peligro)' }}>{num(p.existencia, 0)}</strong></td>
                    {admin && <td style={{ textAlign: 'right', minWidth: 120 }}>
                      {p.en_proyectos > 0 ? <><strong style={{ fontSize: '1.3rem', color: 'var(--aviso)' }}>{num(p.en_proyectos, 0)}</strong>{p.proyectos.map((x) => <small key={x.salida_id} style={{ display: 'block', color: 'var(--text-dim)' }}>{x.proyecto}: {num(x.cantidad, 0)}</small>)}</> : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                    </td>}
                    <td style={{ textAlign: 'right' }}>{num(p.stock_minimo, 0)}</td>
                    {gerencia && <td style={{ textAlign: 'right' }}>{Number(p.costo_estandar) > 0 ? L(p.costo_estandar) : '—'}</td>}
                    <td>
                      {mueve && (
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <button className="boton-icono" aria-label="Acciones de inventario" title="Compra, existencia inicial y ajuste" onClick={() => setMenu(menu === p.id ? null : p.id)}><Icono nombre="ajustes" tam={22} /></button>
                          {menu === p.id && (
                            <>
                              <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setMenu(null)} />
                              <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 31, minWidth: 190, display: 'grid', gap: 6, padding: 8, background: 'var(--surface, var(--navy))', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
                                <button className="boton-sm" onClick={() => abrir('proyecto', p)}>Sacar a proyecto</button>
                                <button className="boton-sm boton-secundario" onClick={() => abrir('compra', p)}>Registrar compra</button>
                                <button className="boton-sm boton-secundario" onClick={() => abrir('inicial', p)}>Existencia inicial</button>
                                <button className="boton-sm boton-secundario" onClick={() => abrir('ajuste', p)}>Ajuste</button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {visibles.length === 0 && <tr><td colSpan={admin ? 6 : 5} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>{filas.length === 0 ? 'Aún no hay productos con control de inventario. Créalos en Productos.' : 'Sin resultados.'}</td></tr>}
              </tbody>
            </table>
          </>
        )}
        {pestana === 'kardex' && (
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Producto</th><th>Movimiento</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Detalle</th><th>Usuario</th></tr></thead>
            <tbody>
              {kardex.map((m) => (
                <tr key={m.id}>
                  <td>{new Date(m.created_at).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{m.productos?.nombre}</td>
                  <td>{TIPOS[m.tipo] ?? m.tipo}</td>
                  <td style={{ textAlign: 'right', color: Number(m.cantidad) < 0 ? 'var(--peligro)' : 'var(--ok)' }}>{Number(m.cantidad) > 0 ? '+' : ''}{num(m.cantidad, 0)}</td>
                  <td>{[m.motivo, m.proveedor, m.referencia, Number(m.costo_unitario) > 0 && gerencia ? L(m.costo_unitario) : null].filter(Boolean).join(' · ')}</td>
                  <td>{m.perfiles?.nombre ?? '—'}</td>
                </tr>
              ))}
              {kardex.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin movimientos</td></tr>}
            </tbody>
          </table>
        )}
      </div>
      {faltantes && <AvisoSinStock faltantes={faltantes.faltantes} accion="sacar el material" onCancelar={() => setFaltantes(null)} onContinuar={() => { setFaltantes(null); guardarProyecto(true); }} />}
      {modal && (
        <Modal titulo={`${TIPOS[modal.tipo]} — ${modal.producto.nombre}`} onCerrar={() => setModal(null)} ancho={560} pie={<><button className="boton-md" disabled={!modal.form.cantidad || (modal.tipo === 'proyecto' ? (!modal.form.salida_id && modal.form.proyecto.trim().length < 3) : (modal.tipo !== 'ajuste' && !modal.form.costo)) || (modal.tipo === 'ajuste' && !modal.form.motivo.trim())} onClick={guardar}>Guardar</button><button className="boton-md boton-secundario" onClick={() => setModal(null)}>Cancelar</button></>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {modal.tipo === 'proyecto' && (
              <>
                <Campo etiqueta="Proyecto">
                  <select value={modal.form.salida_id} onChange={(e) => set('salida_id', e.target.value)}>
                    <option value="">➕ Proyecto nuevo…</option>
                    {abiertas.map((s) => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
                  </select>
                </Campo>
                {!modal.form.salida_id && <Campo etiqueta="Nombre del proyecto"><input value={modal.form.proyecto} onChange={(e) => set('proyecto', e.target.value)} /></Campo>}
              </>
            )}
            <Campo etiqueta="Cantidad (entero)" ancho={150} ayuda={modal.tipo === 'ajuste' ? 'Negativo para restar' : undefined}><input type="number" step="1" inputMode="numeric" value={modal.form.cantidad} onChange={(e) => set('cantidad', e.target.value)} autoFocus /></Campo>
            {['compra', 'inicial'].includes(modal.tipo) && <Campo etiqueta="Costo unitario (sin ISV)" ancho={190}><input type="number" step="0.01" min="0" value={modal.form.costo} onChange={(e) => set('costo', e.target.value)} /></Campo>}
            {modal.tipo === 'compra' && <Campo etiqueta="Proveedor"><input value={modal.form.proveedor} onChange={(e) => set('proveedor', e.target.value)} /></Campo>}
            {modal.tipo === 'compra' && <Campo etiqueta="No. de factura del proveedor" ancho={200}><input value={modal.form.referencia} onChange={(e) => set('referencia', e.target.value)} /></Campo>}
            {modal.tipo === 'ajuste' && <Campo etiqueta="Motivo (obligatorio)"><input value={modal.form.motivo} onChange={(e) => set('motivo', e.target.value)} placeholder="Ej.: producto dañado, conteo físico" /></Campo>}
          </div>
        </Modal>
      )}
    </div>
  );
}
