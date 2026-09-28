import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta, Kpis, Pestanas } from '../components/Modal.jsx';
import { L, num, fechaCorta } from '../lib/fmt.js';
import { descargarCsv } from '../lib/csv.js';

const TIPO = { inicial: 'Existencia inicial', produccion: 'Producción', reserva: 'Reserva', liberacion: 'Liberación', despacho: 'Despacho', venta: 'Venta', merma: 'Merma', ajuste: 'Ajuste' };

// Producto terminado por modelo + color + lote, con disponible = físico − reservado.
export default function Inventario({ session, perfil }) {
  const [filas, setFilas] = useState([]);
  const [kardex, setKardex] = useState(null);
  const [modal, setModal] = useState(null);
  const [pestana, setPestana] = useState('stock');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);
  const escribe = ['admin', 'gerente', 'bodega'].includes(perfil.rol);

  async function cargar() {
    setFilas(await api.get('/inventario/pt', session));
    setKardex(await api.get('/inventario/pt/kardex', session));
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, []);

  const totalDisp = filas.reduce((s, p) => s + p.disponible_primera, 0);
  const totalRes = filas.reduce((s, p) => s + p.reservado, 0);
  const valor = filas.reduce((s, p) => s + p.fisico_primera * Number(p.costo_estandar ?? 0), 0);

  async function enviar() {
    setError('');
    try {
      const f = modal.form;
      if (modal.tipo === 'conteo') {
        const r = await api.post('/inventario/pt/conteo', session, f);
        setAviso(r.diferencia === 0 ? 'Conteo correcto: coincide con el sistema.' : `Conteo con diferencia de ${num(r.diferencia, 3)} m² (sistema ${num(r.sistema, 3)}, contado ${num(r.contado, 3)}). Se ajustó y quedó alerta.`);
      } else {
        await api.post('/inventario/pt/ajuste', session, { ...f, tipo: modal.tipo === 'inicial' ? 'inicial' : 'ajuste' });
        setAviso('Movimiento registrado');
      }
      setModal(null);
      await cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  const abrir = (tipo, p, lote) => setModal({ tipo, producto: p, form: { producto_id: p.id, lote: lote?.lote ?? '', calidad: lote?.calidad ?? 'primera', m2: '', contado: '', motivo: '', costo_m2: '' } });
  const f = modal?.form;
  const set = (k, v) => setModal({ ...modal, form: { ...modal.form, [k]: v } });

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {aviso && <div className="aviso-ok" onClick={() => setAviso('')}>{aviso}</div>}
      <Kpis items={[
        { titulo: 'm² disponibles (1ª)', valor: num(totalDisp, 1) },
        { titulo: 'm² reservados', valor: num(totalRes, 1), pie: 'Apartados para cotizaciones aprobadas' },
        { titulo: 'Valor a costo', valor: gerencia ? L(valor) : '—' },
        { titulo: 'Bajo el mínimo', valor: String(filas.filter((p) => p.bajo_minimo).length) },
      ]} />
      <Pestanas activa={pestana} onCambiar={setPestana} items={[{ id: 'stock', etiqueta: 'Existencias' }, { id: 'kardex', etiqueta: 'Kardex' }]} />

      {pestana === 'stock' && (
        <div className="panel">
          <div className="toolbar">
            <button className="boton-sm boton-secundario" onClick={() => descargarCsv(`inventario-piedra-${new Date().toISOString().slice(0, 10)}.csv`, filas, [
              { titulo: 'Producto', valor: (p) => p.nombre }, { titulo: 'Físico 1ª m²', valor: (p) => p.fisico_primera }, { titulo: 'Reservado m²', valor: (p) => p.reservado },
              { titulo: 'Disponible m²', valor: (p) => p.disponible_primera }, { titulo: 'Segunda m²', valor: (p) => p.fisico_segunda }, { titulo: 'Cajas disponibles', valor: (p) => p.cajas_disponibles ?? '' },
            ])}>Exportar CSV</button>
          </div>
          <table className="tabla">
            <thead><tr><th>Producto / lotes</th><th style={{ textAlign: 'right' }}>Físico 1ª</th><th style={{ textAlign: 'right' }}>Reservado</th><th style={{ textAlign: 'right' }}>Disponible</th><th style={{ textAlign: 'right' }}>Cajas</th><th style={{ textAlign: 'right' }}>Segunda</th><th></th></tr></thead>
            <tbody>
              {filas.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.nombre}</strong> {p.bajo_minimo && <Etiqueta tono="peligro">bajo mínimo</Etiqueta>}
                    <small style={{ display: 'block', color: 'var(--text-dim)' }}>{p.lotes.length ? p.lotes.map((l) => `${l.lote}${l.calidad === 'segunda' ? ' (2ª)' : ''}: ${num(l.fisico, 1)} m²`).join(' · ') : 'sin existencias'}</small></td>
                  <td style={{ textAlign: 'right' }}>{num(p.fisico_primera, 2)}</td>
                  <td style={{ textAlign: 'right' }}>{num(p.reservado, 2)}</td>
                  <td style={{ textAlign: 'right' }}><strong>{num(p.disponible_primera, 2)}</strong></td>
                  <td style={{ textAlign: 'right' }}>{p.cajas_disponibles ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{num(p.fisico_segunda, 2)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {escribe && <button className="boton-sm boton-secundario" onClick={() => abrir('inicial', p)}>Existencia inicial</button>}{' '}
                    {escribe && <button className="boton-sm boton-secundario" onClick={() => abrir('conteo', p, p.lotes[0])}>Conteo</button>}{' '}
                    {escribe && <button className="boton-sm boton-secundario" onClick={() => abrir('ajuste', p, p.lotes[0])}>Ajuste</button>}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin productos de piedra. Créalos en Catálogo.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pestana === 'kardex' && kardex && (
        <div className="panel">
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Producto</th><th>Lote</th><th>Movimiento</th><th style={{ textAlign: 'right' }}>m²</th><th>Detalle</th><th>Por</th></tr></thead>
            <tbody>
              {kardex.map((k) => (
                <tr key={k.id}><td>{fechaCorta(k.created_at)}</td><td>{k.productos?.nombre}</td><td>{k.lote}{k.calidad === 'segunda' ? ' (2ª)' : ''}</td><td>{TIPO[k.tipo] ?? k.tipo}</td>
                  <td style={{ textAlign: 'right', color: k.m2 < 0 ? 'var(--peligro)' : 'var(--ok)' }}>{k.m2 > 0 ? '+' : ''}{num(k.m2, 3)}</td>
                  <td>{[k.cotizaciones && `Cot. #${k.cotizaciones.numero}`, k.motivo].filter(Boolean).join(' · ')}</td><td>{k.perfiles?.nombre ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal titulo={`${modal.tipo === 'conteo' ? 'Conteo físico' : modal.tipo === 'inicial' ? 'Existencia inicial' : 'Ajuste'} — ${modal.producto.nombre}`} onCerrar={() => setModal(null)}
          pie={<button className="boton-sm" disabled={!f.lote || (modal.tipo === 'conteo' ? f.contado === '' : !f.m2 || !f.motivo)} onClick={enviar}>Registrar</button>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta="Lote" ancho={170}><input value={f.lote} onChange={(e) => set('lote', e.target.value)} placeholder={modal.tipo === 'inicial' ? 'Ej.: INICIAL-01' : 'Lote'} list="lotes" /><datalist id="lotes">{modal.producto.lotes.map((l) => <option key={l.lote + l.calidad} value={l.lote} />)}</datalist></Campo>
            <Campo etiqueta="Calidad" ancho={130}><select value={f.calidad} onChange={(e) => set('calidad', e.target.value)}><option value="primera">Primera</option><option value="segunda">Segunda</option></select></Campo>
            {modal.tipo === 'conteo'
              ? <Campo etiqueta="m² contados" ancho={140} ayuda="Cuenta lo que hay físicamente; el sistema calcula la diferencia"><input type="number" step="0.001" value={f.contado} onChange={(e) => set('contado', e.target.value)} /></Campo>
              : <Campo etiqueta="m²" ancho={130} ayuda={modal.tipo === 'ajuste' ? 'Negativo para restar' : undefined}><input type="number" step="0.001" value={f.m2} onChange={(e) => set('m2', e.target.value)} /></Campo>}
            {modal.tipo === 'inicial' && gerencia && <Campo etiqueta="Costo L/m²" ancho={120}><input type="number" step="0.01" value={f.costo_m2} onChange={(e) => set('costo_m2', e.target.value)} /></Campo>}
            {modal.tipo !== 'conteo' && <Campo etiqueta="Motivo (obligatorio)"><input value={f.motivo} onChange={(e) => set('motivo', e.target.value)} placeholder={modal.tipo === 'inicial' ? 'Ej.: existencia al arrancar el sistema' : 'Ej.: piezas rotas al manipular'} /></Campo>}
          </div>
        </Modal>
      )}
    </div>
  );
}
