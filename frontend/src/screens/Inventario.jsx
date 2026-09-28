import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta, Kpis, Pestanas } from '../components/Modal.jsx';
import { L, num, fechaCorta } from '../lib/fmt.js';
import { descargarCsv } from '../lib/csv.js';

const TIPO = { inicial: 'Existencia inicial', produccion: 'Lista para vender', reserva: 'Reserva', liberacion: 'Liberación', despacho: 'Despacho', venta: 'Venta', merma: 'Merma', ajuste: 'Ajuste' };
const norm = (t) => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// Producto terminado por modelo + color + lote: disponible = físico − reservado.
// Lo que pasa a "Lista para vender" entra aquí; lo que sigue en secado se muestra aparte.
export default function Inventario({ session, perfil }) {
  const [filas, setFilas] = useState([]);
  const [kardex, setKardex] = useState([]);
  const [modal, setModal] = useState(null);
  const [pestana, setPestana] = useState('stock');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [f, setF] = useState({ q: '', modelo: '', color: '', pieza: '', soloExistencia: true, soloBajo: false, soloSecado: false });
  const [fk, setFk] = useState({ q: '', tipo: '' });
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);
  const escribe = ['admin', 'gerente', 'bodega'].includes(perfil.rol);

  async function cargar() {
    const [pt, kx] = await Promise.all([api.get('/inventario/pt', session), api.get('/inventario/pt/kardex', session)]);
    setFilas(pt);
    setKardex(kx);
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, []);

  const modelos = useMemo(() => [...new Set(filas.map((p) => p.modelo).filter(Boolean))].sort(), [filas]);
  const colores = useMemo(() => [...new Set(filas.filter((p) => !f.modelo || p.modelo === f.modelo).map((p) => p.color).filter(Boolean))].sort(), [filas, f.modelo]);

  const tieneAlgo = (p) => p.fisico_primera !== 0 || p.fisico_segunda !== 0 || p.disponible_primera !== 0 || p.en_secado > 0;
  const visibles = useMemo(() => {
    const q = norm(f.q);
    return filas
      .filter((p) => (!f.modelo || p.modelo === f.modelo) && (!f.color || p.color === f.color)
        && (!f.pieza || (f.pieza === 'esquina') === p.esquina)
        && (!q || norm(`${p.nombre} ${p.modelo} ${p.color} ${p.lotes.map((l) => l.lote).join(' ')} ${p.lotes_secado.map((l) => l.lote).join(' ')}`).includes(q))
        && (!f.soloExistencia || tieneAlgo(p)) && (!f.soloBajo || p.bajo_minimo) && (!f.soloSecado || p.en_secado > 0))
      .sort((a, b) => b.disponible_primera - a.disponible_primera || b.en_secado - a.en_secado || a.nombre.localeCompare(b.nombre));
  }, [filas, f]);
  const hayFiltro = f.q || f.modelo || f.color || f.pieza || f.soloBajo || f.soloSecado || !f.soloExistencia;
  const limpiar = () => setF({ q: '', modelo: '', color: '', pieza: '', soloExistencia: true, soloBajo: false, soloSecado: false });

  const m2 = filas.filter((p) => !p.esquina);
  const totalDisp = m2.reduce((s, p) => s + p.disponible_primera, 0);
  const totalRes = m2.reduce((s, p) => s + p.reservado, 0);
  const totalSecado = m2.reduce((s, p) => s + p.en_secado, 0);
  const cajasEsq = filas.filter((p) => p.esquina).reduce((s, p) => s + p.disponible_primera, 0);
  const valor = filas.reduce((s, p) => s + p.fisico_primera * Number(p.costo_estandar ?? 0), 0);

  const kardexVisible = useMemo(() => {
    const q = norm(fk.q);
    return kardex.filter((k) => (!fk.tipo || k.tipo === fk.tipo) && (!q || norm(`${k.productos?.nombre} ${k.lote} ${k.motivo ?? ''}`).includes(q)));
  }, [kardex, fk]);

  async function enviar() {
    setError('');
    try {
      const d = modal.form;
      if (modal.tipo === 'conteo') {
        const r = await api.post('/inventario/pt/conteo', session, d);
        setAviso(r.diferencia === 0 ? 'Conteo correcto: coincide con el sistema.' : `Conteo con diferencia de ${num(r.diferencia, 3)} (sistema ${num(r.sistema, 3)}, contado ${num(r.contado, 3)}). Se ajustó y quedó alerta.`);
      } else {
        await api.post('/inventario/pt/ajuste', session, { ...d, tipo: modal.tipo === 'inicial' ? 'inicial' : 'ajuste' });
        setAviso('Movimiento registrado');
      }
      setModal(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  const abrir = (tipo, p, lote) => setModal({ tipo, producto: p, form: { producto_id: p.id, lote: lote?.lote ?? '', calidad: lote?.calidad ?? 'primera', m2: '', contado: '', motivo: '', costo_m2: '' } });
  const d = modal?.form;
  const set = (k, v) => setModal({ ...modal, form: { ...modal.form, [k]: v } });

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {aviso && <div className="aviso-ok" onClick={() => setAviso('')}>{aviso}</div>}
      <Kpis items={[
        { titulo: 'DISPONIBLE PARA VENDER', valor: `${num(totalDisp, 1)} m²`, pie: cajasEsq ? `+ ${num(cajasEsq, 0)} cajas de esquina` : undefined },
        { titulo: 'Reservado', valor: `${num(totalRes, 1)} m²`, pie: 'Apartado para cotizaciones aprobadas' },
        { titulo: 'En secado', valor: `${num(totalSecado, 1)} m²`, pie: 'Aún no entra al inventario' },
        { titulo: 'Valor a costo', valor: gerencia ? L(valor) : '—' },
        { titulo: 'Bajo el mínimo', valor: String(filas.filter((p) => p.bajo_minimo).length) },
      ]} />
      <Pestanas activa={pestana} onCambiar={setPestana} items={[{ id: 'stock', etiqueta: 'Existencias' }, { id: 'kardex', etiqueta: 'Movimientos' }]} />

      {pestana === 'stock' && (
        <div className="panel">
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="Buscar modelo, color o lote…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ flex: '1 1 220px' }} />
            <select value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value, color: '' })}><option value="">Todos los modelos</option>{modelos.map((m) => <option key={m}>{m}</option>)}</select>
            <select value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })}><option value="">Todos los colores</option>{colores.map((c) => <option key={c}>{c}</option>)}</select>
            <select value={f.pieza} onChange={(e) => setF({ ...f, pieza: e.target.value })}><option value="">Plana y esquina</option><option value="plana">Piedra plana</option><option value="esquina">Caja de esquina</option></select>
          </div>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.soloExistencia} onChange={(e) => setF({ ...f, soloExistencia: e.target.checked })} /> Solo con existencia</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.soloSecado} onChange={(e) => setF({ ...f, soloSecado: e.target.checked })} /> En secado</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={f.soloBajo} onChange={(e) => setF({ ...f, soloBajo: e.target.checked })} /> Bajo el mínimo</label>
            {hayFiltro && <button className="boton-sm boton-secundario" onClick={limpiar}>Limpiar filtros</button>}
            <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>Mostrando {visibles.length} de {filas.length}</span>
            <button className="boton-sm boton-secundario" onClick={() => descargarCsv(`inventario-piedra-${new Date().toISOString().slice(0, 10)}.csv`, visibles, [
              { titulo: 'Producto', valor: (p) => p.nombre }, { titulo: 'Unidad', valor: (p) => p.unidad }, { titulo: 'En secado', valor: (p) => p.en_secado }, { titulo: 'Físico 1ª', valor: (p) => p.fisico_primera },
              { titulo: 'Reservado', valor: (p) => p.reservado }, { titulo: 'Disponible', valor: (p) => p.disponible_primera },
            ])}>Exportar CSV</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabla" style={{ minWidth: 620 }}>
              <thead><tr><th>Producto / lotes</th><th style={{ textAlign: 'right' }}>En secado</th><th style={{ textAlign: 'right' }}>Físico 1ª</th><th style={{ textAlign: 'right' }}>Reservado</th><th style={{ textAlign: 'right', fontSize: '1.05rem', color: 'var(--ok)' }}>DISPONIBLE</th><th></th></tr></thead>
              <tbody>
                {visibles.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.nombre}</strong> {p.bajo_minimo && <Etiqueta tono="peligro">bajo mínimo</Etiqueta>}
                      <small style={{ display: 'block', color: 'var(--text-dim)' }}>
                        {p.lotes.length ? p.lotes.map((l) => `${l.lote}${l.calidad === 'segunda' ? ' (2ª)' : ''}: ${num(l.fisico, 1)} ${p.unidad}`).join(' · ') : 'sin existencias'}
                        {p.lotes_secado.length > 0 && <span style={{ color: 'var(--aviso)' }}> · secando: {p.lotes_secado.map((l) => `${l.lote} (lista el ${fechaCorta(l.lista_el)})`).join(', ')}</span>}
                      </small></td>
                    <td style={{ textAlign: 'right', color: p.en_secado ? 'var(--aviso)' : undefined }}>{p.en_secado ? `${num(p.en_secado, 2)} ${p.unidad}` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{num(p.fisico_primera, 2)}</td>
                    <td style={{ textAlign: 'right' }}>{num(p.reservado, 2)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', background: 'color-mix(in srgb, var(--ok) 9%, transparent)', minWidth: 130 }}>
                      <strong style={{ fontSize: '1.7rem', lineHeight: 1.1, fontWeight: 800, color: p.disponible_primera > 0 ? 'var(--ok)' : 'var(--text-dim)' }}>{num(p.disponible_primera, 2)}</strong>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{p.unidad}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {escribe && <button className="boton-sm boton-secundario" onClick={() => abrir('inicial', p)}>Existencia inicial</button>}{' '}
                      {escribe && <button className="boton-sm boton-secundario" onClick={() => abrir('conteo', p, p.lotes[0])}>Conteo</button>}{' '}
                      {escribe && <button className="boton-sm boton-secundario" onClick={() => abrir('ajuste', p, p.lotes[0])}>Ajuste</button>}
                    </td>
                  </tr>
                ))}
                {visibles.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>
                    {filas.length === 0 ? 'Sin productos de piedra. Créalos en Catálogo.' : 'No hay resultados con estos filtros.'}
                    {hayFiltro && <> <button className="boton-sm boton-secundario" onClick={limpiar}>Limpiar filtros</button></>}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pestana === 'kardex' && (
        <div className="panel">
          <div className="toolbar" style={{ flexWrap: 'wrap' }}>
            <input placeholder="Buscar producto, lote o motivo…" value={fk.q} onChange={(e) => setFk({ ...fk, q: e.target.value })} style={{ flex: '1 1 220px' }} />
            <select value={fk.tipo} onChange={(e) => setFk({ ...fk, tipo: e.target.value })}><option value="">Todos los movimientos</option>{Object.entries(TIPO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
            <span style={{ color: 'var(--text-dim)', alignSelf: 'center' }}>{kardexVisible.length} de {kardex.length}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabla" style={{ minWidth: 640 }}>
              <thead><tr><th>Fecha</th><th>Producto</th><th>Lote</th><th>Movimiento</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Detalle</th><th>Por</th></tr></thead>
              <tbody>
                {kardexVisible.map((k) => (
                  <tr key={k.id}><td>{fechaCorta(k.created_at)}</td><td>{k.productos?.nombre}</td><td>{k.lote}{k.calidad === 'segunda' ? ' (2ª)' : ''}</td><td>{TIPO[k.tipo] ?? k.tipo}</td>
                    <td style={{ textAlign: 'right', color: k.m2 < 0 ? 'var(--peligro)' : 'var(--ok)' }}>{k.m2 > 0 ? '+' : ''}{num(k.m2, 3)}</td>
                    <td>{[k.cotizaciones && `Cot. #${k.cotizaciones.numero}`, k.motivo].filter(Boolean).join(' · ')}</td><td>{k.perfiles?.nombre ?? '—'}</td></tr>
                ))}
                {kardexVisible.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin movimientos</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal && (
        <Modal titulo={`${modal.tipo === 'conteo' ? 'Conteo físico' : modal.tipo === 'inicial' ? 'Existencia inicial' : 'Ajuste'} — ${modal.producto.nombre}`} onCerrar={() => setModal(null)}
          pie={<button className="boton-sm" disabled={!d.lote || (modal.tipo === 'conteo' ? d.contado === '' : !d.m2 || !d.motivo)} onClick={enviar}>Registrar</button>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta="Lote" ancho={170}><input value={d.lote} onChange={(e) => set('lote', e.target.value)} placeholder={modal.tipo === 'inicial' ? 'Ej.: INICIAL-01' : 'Lote'} list="lotes" /><datalist id="lotes">{modal.producto.lotes.map((l) => <option key={l.lote + l.calidad} value={l.lote} />)}</datalist></Campo>
            {modal.tipo === 'conteo'
              ? <Campo etiqueta={`Contado (${modal.producto.unidad})`} ancho={150} ayuda="Cuenta lo que hay físicamente; el sistema calcula la diferencia"><input type="number" inputMode="numeric" step="1" min="0" value={d.contado} onChange={(e) => set('contado', e.target.value)} /></Campo>
              : <Campo etiqueta={modal.producto.unidad} ancho={130} ayuda={modal.tipo === 'ajuste' ? 'Negativo para restar' : undefined}><input type="number" inputMode="numeric" step="1" value={d.m2} onChange={(e) => set('m2', e.target.value)} /></Campo>}
            {modal.tipo === 'inicial' && gerencia && <Campo etiqueta="Costo L/m²" ancho={120}><input type="number" step="0.01" value={d.costo_m2} onChange={(e) => set('costo_m2', e.target.value)} /></Campo>}
            {modal.tipo !== 'conteo' && <Campo etiqueta="Motivo (obligatorio)"><input value={d.motivo} onChange={(e) => set('motivo', e.target.value)} placeholder={modal.tipo === 'inicial' ? 'Ej.: existencia al arrancar el sistema' : 'Ej.: piezas rotas al manipular'} /></Campo>}
          </div>
        </Modal>
      )}
    </div>
  );
}
