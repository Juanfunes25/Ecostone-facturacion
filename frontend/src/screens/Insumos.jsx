import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta, Kpis, Pestanas } from '../components/Modal.jsx';
import { L, num, fechaCorta } from '../lib/fmt.js';
import { descargarCsv } from '../lib/csv.js';

const CATEGORIAS = ['cemento', 'arena', 'agregado', 'aditivo', 'pigmento', 'desmoldante', 'sellador', 'fibra', 'empaque', 'molde', 'otro'];
const MP_VACIO = { codigo: '', nombre: '', categoria: 'cemento', unidad: 'kg', moneda: 'HNL', stock_minimo: '', proveedor_id: '', notas: '' };
const PROV_VACIO = { nombre: '', rtn: '', contacto: '', telefono: '', email: '', dias_credito: 0, notas: '' };
const ETIQUETA_MOV = { compra: 'Compra', consumo: 'Consumo producción', ajuste: 'Ajuste', merma: 'Merma', devolucion: 'Devolución', inicial: 'Existencia inicial' };

export default function Insumos({ session, perfil }) {
  const [pestana, setPestana] = useState('insumos');
  const [mps, setMps] = useState([]);
  const [provs, setProvs] = useState([]);
  const [tc, setTc] = useState(null);
  const [busca, setBusca] = useState('');
  const [cat, setCat] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [modal, setModal] = useState(null); // {tipo, mp?, form}
  const [kardex, setKardex] = useState(null);
  const puedeEscribir = ['admin', 'gerente', 'bodega'].includes(perfil.rol);
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  async function cargar() {
    const [m, p, params] = await Promise.all([api.get('/insumos/materias-primas', session), api.get('/insumos/proveedores', session), api.get('/insumos/parametros', session)]);
    setMps(m);
    setProvs(p);
    setTc(Number(params.find((x) => x.clave === 'tipo_cambio_usd')?.valor ?? 0));
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, []);

  const visibles = useMemo(() => mps.filter((m) => (!cat || m.categoria === cat) && (!busca || `${m.nombre} ${m.codigo ?? ''}`.toLowerCase().includes(busca.toLowerCase()))), [mps, busca, cat]);
  const valorTotal = mps.reduce((s, m) => s + m.valor_inventario, 0);
  const bajos = mps.filter((m) => m.bajo_minimo && m.activo);

  async function guardar(fn) {
    setError('');
    try {
      await fn();
      setModal(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  const abrirMp = (mp) => setModal({ tipo: 'mp', form: mp ? { ...MP_VACIO, ...Object.fromEntries(Object.keys(MP_VACIO).map((k) => [k, mp[k] ?? ''])), id: mp.id, activo: mp.activo } : { ...MP_VACIO } });
  const abrirMov = (mp, tipo) => setModal({ tipo: 'mov', mp, form: { tipo, cantidad: '', costo_unitario: '', moneda: mp.moneda, proveedor_id: mp.proveedor_id ?? '', documento: '', motivo: '' } });

  async function verKardex(mp) {
    setKardex({ mp, filas: await api.get(`/insumos/materias-primas/${mp.id}/kardex`, session) });
  }

  function exportar() {
    descargarCsv(`insumos-${new Date().toISOString().slice(0, 10)}.csv`, mps, [
      { titulo: 'Código', valor: (m) => m.codigo ?? '' }, { titulo: 'Insumo', valor: (m) => m.nombre }, { titulo: 'Categoría', valor: (m) => m.categoria },
      { titulo: 'Unidad', valor: (m) => m.unidad }, { titulo: 'Stock', valor: (m) => m.stock }, { titulo: 'Mínimo', valor: (m) => m.stock_minimo },
      { titulo: 'Costo promedio L', valor: (m) => Number(m.costo_promedio).toFixed(4) }, { titulo: 'Valor L', valor: (m) => m.valor_inventario },
    ]);
  }

  const f = modal?.form;
  const set = (k, v) => setModal({ ...modal, form: { ...modal.form, [k]: v } });

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {aviso && <div className="aviso-ok">{aviso}</div>}
      <Kpis items={[
        { titulo: 'Insumos activos', valor: num(mps.filter((m) => m.activo).length, 0) },
        { titulo: 'Valor del inventario', valor: gerencia ? L(valorTotal) : '—' },
        { titulo: 'Bajo el mínimo', valor: num(bajos.length, 0), pie: bajos.slice(0, 2).map((b) => b.nombre.replace('[EJEMPLO] ', '')).join(', ') },
        { titulo: 'Tipo de cambio USD', valor: tc ? `L ${num(tc, 2)}` : '—', pie: 'Se edita en Producción → Parámetros' },
      ]} />
      <Pestanas activa={pestana} onCambiar={setPestana} items={[{ id: 'insumos', etiqueta: 'Insumos' }, { id: 'proveedores', etiqueta: 'Proveedores' }]} />

      {pestana === 'insumos' && (
        <div className="panel">
          <div className="toolbar">
            <input placeholder="Buscar insumo o código…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas las categorías</option>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select>
            {puedeEscribir && <button className="boton-sm" onClick={() => abrirMp(null)}>+ Insumo</button>}
            <button className="boton-sm boton-secundario" onClick={exportar}>Exportar CSV</button>
          </div>
          <table className="tabla">
            <thead><tr><th>Insumo</th><th>Categoría</th><th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>Mínimo</th>{gerencia && <th style={{ textAlign: 'right' }}>Costo prom.</th>}{gerencia && <th style={{ textAlign: 'right' }}>Valor</th>}<th></th></tr></thead>
            <tbody>
              {visibles.map((m) => (
                <tr key={m.id} style={m.activo ? undefined : { opacity: 0.5 }}>
                  <td><strong>{m.nombre}</strong><small style={{ display: 'block', color: 'var(--text-dim)' }}>{m.codigo} · {m.proveedores?.nombre ?? 'sin proveedor'}</small></td>
                  <td>{m.categoria}</td>
                  <td style={{ textAlign: 'right' }}>{num(m.stock, 3)} {m.unidad} {m.bajo_minimo && <Etiqueta tono="peligro">bajo mínimo</Etiqueta>}</td>
                  <td style={{ textAlign: 'right' }}>{num(m.stock_minimo, 3)}</td>
                  {gerencia && <td style={{ textAlign: 'right' }}>{L(m.costo_promedio)}{m.moneda === 'USD' && m.costo_usd != null && <small style={{ display: 'block', color: 'var(--text-dim)' }}>US$ {num(m.costo_usd, 4)}</small>}</td>}
                  {gerencia && <td style={{ textAlign: 'right' }}>{L(m.valor_inventario)}</td>}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {puedeEscribir && <button className="boton-sm" onClick={() => abrirMov(m, 'compra')}>Compra</button>}{' '}
                    <button className="boton-sm boton-secundario" onClick={() => abrirMov(m, 'merma')}>Merma</button>{' '}
                    {puedeEscribir && <button className="boton-sm boton-secundario" onClick={() => abrirMov(m, 'ajuste')}>Ajuste</button>}{' '}
                    <button className="boton-sm boton-secundario" onClick={() => verKardex(m)}>Kardex</button>{' '}
                    {puedeEscribir && <button className="boton-sm boton-secundario" onClick={() => abrirMp(m)}>Editar</button>}
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin insumos</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pestana === 'proveedores' && (
        <div className="panel">
          <div className="toolbar">{puedeEscribir && <button className="boton-sm" onClick={() => setModal({ tipo: 'prov', form: { ...PROV_VACIO } })}>+ Proveedor</button>}</div>
          <table className="tabla">
            <thead><tr><th>Proveedor</th><th>RTN</th><th>Contacto</th><th>Crédito</th><th></th></tr></thead>
            <tbody>
              {provs.map((p) => (
                <tr key={p.id}><td><strong>{p.nombre}</strong></td><td>{p.rtn ?? '—'}</td><td>{[p.contacto, p.telefono, p.email].filter(Boolean).join(' · ') || '—'}</td><td>{p.dias_credito ? `${p.dias_credito} días` : 'Contado'}</td>
                  <td>{puedeEscribir && <button className="boton-sm boton-secundario" onClick={() => setModal({ tipo: 'prov', form: { ...PROV_VACIO, ...p } })}>Editar</button>}</td></tr>
              ))}
              {provs.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Aún no hay proveedores</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {modal?.tipo === 'mp' && (
        <Modal titulo={f.id ? 'Editar insumo' : 'Nuevo insumo'} onCerrar={() => setModal(null)}
          pie={<button className="boton-sm" disabled={!f.nombre} onClick={() => guardar(() => (f.id ? api.put(`/insumos/materias-primas/${f.id}`, session, f) : api.post('/insumos/materias-primas', session, f)))}>Guardar</button>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} /></Campo>
            <Campo etiqueta="Código" ancho={130}><input value={f.codigo} onChange={(e) => set('codigo', e.target.value)} /></Campo>
            <Campo etiqueta="Categoría" ancho={150}><select value={f.categoria} onChange={(e) => set('categoria', e.target.value)}>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></Campo>
            <Campo etiqueta="Unidad" ancho={110}><input value={f.unidad} onChange={(e) => set('unidad', e.target.value)} placeholder="kg, saco, gal…" /></Campo>
            <Campo etiqueta="Moneda de compra" ancho={150} ayuda="USD para pigmentos importados"><select value={f.moneda} onChange={(e) => set('moneda', e.target.value)}><option value="HNL">Lempiras</option><option value="USD">Dólares</option></select></Campo>
            <Campo etiqueta="Stock mínimo" ancho={120}><input type="number" step="0.001" value={f.stock_minimo} onChange={(e) => set('stock_minimo', e.target.value)} /></Campo>
            <Campo etiqueta="Proveedor habitual"><select value={f.proveedor_id ?? ''} onChange={(e) => set('proveedor_id', e.target.value)}><option value="">—</option>{provs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
            {f.id && <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.activo} onChange={(e) => set('activo', e.target.checked)} /> Activo</label>}
          </div>
        </Modal>
      )}

      {modal?.tipo === 'prov' && (
        <Modal titulo={f.id ? 'Editar proveedor' : 'Nuevo proveedor'} onCerrar={() => setModal(null)}
          pie={<button className="boton-sm" disabled={!f.nombre} onClick={() => guardar(() => (f.id ? api.put(`/insumos/proveedores/${f.id}`, session, f) : api.post('/insumos/proveedores', session, f)))}>Guardar</button>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => set('nombre', e.target.value)} /></Campo>
            <Campo etiqueta="RTN"><input value={f.rtn ?? ''} onChange={(e) => set('rtn', e.target.value)} /></Campo>
            <Campo etiqueta="Contacto"><input value={f.contacto ?? ''} onChange={(e) => set('contacto', e.target.value)} /></Campo>
            <Campo etiqueta="Teléfono"><input value={f.telefono ?? ''} onChange={(e) => set('telefono', e.target.value)} /></Campo>
            <Campo etiqueta="Correo"><input value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Campo>
            <Campo etiqueta="Días de crédito" ancho={130}><input type="number" value={f.dias_credito} onChange={(e) => set('dias_credito', Number(e.target.value))} /></Campo>
          </div>
        </Modal>
      )}

      {modal?.tipo === 'mov' && (
        <Modal titulo={`${ETIQUETA_MOV[f.tipo]} — ${modal.mp.nombre}`} onCerrar={() => setModal(null)}
          pie={<button className="boton-sm" disabled={!f.cantidad} onClick={() => guardar(async () => { await api.post(`/insumos/materias-primas/${modal.mp.id}/movimiento`, session, f); setAviso(`${ETIQUETA_MOV[f.tipo]} registrada`); setTimeout(() => setAviso(''), 4000); })}>Registrar</button>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta={`Cantidad (${modal.mp.unidad})`} ayuda={f.tipo === 'ajuste' ? 'Usa negativo para restar' : undefined} ancho={160}><input type="number" step="0.001" value={f.cantidad} onChange={(e) => set('cantidad', e.target.value)} /></Campo>
            {f.tipo === 'compra' && (
              <>
                <Campo etiqueta={`Costo unitario (${f.moneda === 'USD' ? 'US$' : 'L'})`} ancho={170} ayuda={f.moneda === 'USD' && tc ? `Se convierte a L ${num(tc, 2)} por dólar` : undefined}><input type="number" step="0.0001" value={f.costo_unitario} onChange={(e) => set('costo_unitario', e.target.value)} /></Campo>
                <Campo etiqueta="Moneda" ancho={120}><select value={f.moneda} onChange={(e) => set('moneda', e.target.value)}><option value="HNL">L</option><option value="USD">US$</option></select></Campo>
                <Campo etiqueta="Proveedor"><select value={f.proveedor_id} onChange={(e) => set('proveedor_id', e.target.value)}><option value="">—</option>{provs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
                <Campo etiqueta="No. factura del proveedor"><input value={f.documento} onChange={(e) => set('documento', e.target.value)} /></Campo>
              </>
            )}
            {f.tipo !== 'compra' && <Campo etiqueta="Motivo (obligatorio)"><input value={f.motivo} onChange={(e) => set('motivo', e.target.value)} placeholder="Ej.: saco roto, conteo físico, derrame…" /></Campo>}
          </div>
        </Modal>
      )}

      {kardex && (
        <Modal titulo={`Kardex — ${kardex.mp.nombre}`} onCerrar={() => setKardex(null)} ancho={820}>
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Movimiento</th><th style={{ textAlign: 'right' }}>Cantidad</th>{gerencia && <th style={{ textAlign: 'right' }}>Costo</th>}<th>Detalle</th><th>Por</th></tr></thead>
            <tbody>
              {kardex.filas.map((k) => (
                <tr key={k.id}><td>{fechaCorta(k.created_at)}</td><td>{ETIQUETA_MOV[k.tipo] ?? k.tipo}</td><td style={{ textAlign: 'right', color: k.cantidad < 0 ? 'var(--peligro)' : 'var(--ok)' }}>{k.cantidad > 0 ? '+' : ''}{num(k.cantidad, 3)}</td>
                  {gerencia && <td style={{ textAlign: 'right' }}>{L(k.costo_unitario)}</td>}<td>{[k.proveedores?.nombre, k.documento, k.motivo].filter(Boolean).join(' · ')}</td><td>{k.perfiles?.nombre ?? '—'}</td></tr>
              ))}
              {kardex.filas.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin movimientos</td></tr>}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}
