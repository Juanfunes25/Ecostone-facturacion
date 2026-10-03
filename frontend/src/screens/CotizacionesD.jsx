import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Campo, Etiqueta } from '../components/Modal.jsx';
import CotizacionDEditor from './CotizacionDEditor.jsx';
import { L, num, fechaCorta } from '../lib/fmt.js';
import { imprimirTicket, verPdf } from '../lib/documentos.js';
import AvisoSinStock from '../components/AvisoSinStock.jsx';

const ESTADOS = [['', 'Todas'], ['borrador,enviada', 'Por aprobar'], ['aprobada', 'Aprobadas (por cobrar)'], ['facturada', 'Cobradas y facturadas'], ['rechazada,anulada', 'Cerradas']];
const TONO = { borrador: 'gris', enviada: 'info', aprobada: 'aviso', facturada: 'ok', rechazada: 'peligro', anulada: 'peligro', vencida: 'peligro' };
const TIPOS = { proyecto: 'Proyecto', productos: 'Productos' };

// DISERCO: cotizar (Proyecto o Productos) → aprobar → cobrar y facturar (una factura por cada cobro).
export default function CotizacionesD({ session, perfil }) {
  const [lista, setLista] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [vista, setVista] = useState({ tipo: 'lista' });
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const vende = ['admin', 'gerente', 'vendedor', 'ventas'].includes(perfil.rol);

  async function cargar() {
    const q = new URLSearchParams();
    if (filtro) q.set('estado', filtro);
    if (tipoFiltro) q.set('tipo', tipoFiltro);
    if (busca) q.set('q', busca);
    setLista(await api.get(`/diserco/cotizaciones?${q}`, session));
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, [filtro, tipoFiltro, busca]);

  if (vista.tipo === 'editor') {
    return <CotizacionDEditor session={session} perfil={perfil} inicial={vista.inicial} tipo={vista.nuevoTipo} onCancelar={() => setVista(vista.inicial ? { tipo: 'detalle', id: vista.inicial.id } : { tipo: 'lista' })} onGuardada={(c) => { setAviso(`Cotización ${c.codigo} guardada`); setVista({ tipo: 'detalle', id: c.id }); }} />;
  }
  if (vista.tipo === 'detalle') {
    return <Detalle id={vista.id} session={session} perfil={perfil} aviso={aviso} onAviso={setAviso} onVolver={() => { setVista({ tipo: 'lista' }); cargar().catch(() => {}); }} onEditar={(c) => setVista({ tipo: 'editor', inicial: c })} />;
  }

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <div className="panel">
        <h2>Cotizaciones DISERCO</h2>
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Buscar cliente, proyecto o número…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>{ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}><option value="">Proyectos y productos</option><option value="proyecto">Solo proyectos</option><option value="productos">Solo productos</option></select>
        </div>
        {vende && (
          <div className="toolbar" style={{ flexWrap: 'wrap' }}>
            <button className="boton-md" onClick={() => setVista({ tipo: 'editor', inicial: null, nuevoTipo: 'proyecto' })}>+ Cotización de PROYECTO</button>
            <button className="boton-md" onClick={() => setVista({ tipo: 'editor', inicial: null, nuevoTipo: 'productos' })}>+ Cotización de PRODUCTOS</button>
          </div>
        )}
        <table className="tabla">
          <thead><tr><th>No.</th><th>Cliente / proyecto</th><th>Tipo</th><th>Estado</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Cobrado</th><th>Vigencia</th><th></th></tr></thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.codigo}</strong></td>
                <td><strong>{c.nombre_cliente}</strong>{c.proyecto && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{c.proyecto}</small>}</td>
                <td>{TIPOS[c.tipo]}</td>
                <td><Etiqueta tono={TONO[c.vencida ? 'vencida' : c.estado]}>{c.vencida ? 'vencida' : c.estado}</Etiqueta></td>
                <td style={{ textAlign: 'right' }}>{L(c.total)}</td>
                <td style={{ textAlign: 'right' }}>{c.pagado > 0 ? L(c.pagado) : '—'}</td>
                <td>{['borrador', 'enviada'].includes(c.estado) ? `vence ${fechaCorta(c.fecha_vigencia)}` : '—'}</td>
                <td><button className="boton-sm boton-secundario" onClick={() => setVista({ tipo: 'detalle', id: c.id })}>Abrir</button></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin cotizaciones</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Detalle({ id, session, perfil, aviso, onAviso, onVolver, onEditar }) {
  const [c, setC] = useState(null);
  const [formas, setFormas] = useState([]);
  const [pago, setPago] = useState({ forma_pago_id: '', monto: '', referencia: '', concepto: '' });
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [avisoStock, setAvisoStock] = useState(null);
  const [salidas, setSalidas] = useState([]);
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);
  const vende = ['admin', 'gerente', 'vendedor', 'ventas'].includes(perfil.rol);
  const cobra = ['admin', 'gerente', 'cajero', 'ventas'].includes(perfil.rol);

  async function cargar() {
    const [d, f] = await Promise.all([api.get(`/diserco/cotizaciones/${id}`, session), api.cache('/formas-pago', session)]);
    setC(d);
    setFormas(f);
    if (d.tipo === 'proyecto') api.get(`/diserco/salidas?cotizacion_id=${d.id}`, session).then(setSalidas).catch(() => {});
    setPago((p) => ({ ...p, forma_pago_id: p.forma_pago_id || f.find((x) => x.nombre === 'Efectivo')?.id || f[0]?.id, monto: d.pendiente > 0 ? String(d.pendiente) : '', concepto: '' }));
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, [id]);

  async function hacer(fn, mensaje) {
    setError('');
    setOcupado(true);
    try {
      const r = await fn();
      if (mensaje) onAviso(typeof mensaje === 'function' ? mensaje(r) : mensaje);
      await cargar();
      return r;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function cobrar(confirmar) {
    setError('');
    setOcupado(true);
    try {
      const r = await api.post(`/diserco/cotizaciones/${c.id}/cobros`, session, { ...pago, monto: Number(pago.monto), confirmar_sin_stock: confirmar });
      onAviso(`Pago registrado y factura ${r.factura.numero_factura} emitida.${r.factura.aviso_rtn ? ` ⚠ ${r.factura.aviso_rtn}` : ''}`);
      await cargar();
      try { await imprimirTicket(r.factura.id, session); } catch { /* la impresión no bloquea */ }
    } catch (e) {
      if (e.codigo === 'SIN_STOCK') setAvisoStock(e.faltantes ?? []);
      else setError(e.message);
    } finally {
      setOcupado(false);
    }
  }

  if (!c) return <div className="panel">{error ? <div className="error">{error}</div> : 'Cargando…'}</div>;
  const abierta = ['borrador', 'enviada'].includes(c.estado);
  const esProyecto = c.tipo === 'proyecto';
  const pagaTodo = Number(pago.monto) >= c.pendiente - 0.004;
  const anticipoSugerido = Math.round(Number(c.total) * 50) / 100;
  const post = (ruta, cuerpo = {}) => api.post(`/diserco/cotizaciones/${c.id}/${ruta}`, session, cuerpo);

  return (
    <div>
      {avisoStock && <AvisoSinStock faltantes={avisoStock} onCancelar={() => setAvisoStock(null)} onContinuar={() => { setAvisoStock(null); cobrar(true); }} />}
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {aviso && <div className="aviso-ok" onClick={() => onAviso('')}>{aviso}</div>}
      <div className="panel">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Cotización {c.codigo} <Etiqueta tono={TONO[c.vencida ? 'vencida' : c.estado]}>{c.vencida ? 'vencida' : c.estado}</Etiqueta> <Etiqueta tono="info">{TIPOS[c.tipo]}</Etiqueta></h2>
          <button className="boton-sm boton-secundario" onClick={onVolver}>← Volver</button>
        </div>
        <p style={{ margin: '6px 0' }}><strong>{c.nombre_cliente}</strong>{c.rtn_cliente && ` · RTN ${c.rtn_cliente}`}{c.telefono && ` · ${c.telefono}`}{c.email && ` · ${c.email}`}</p>
        {(c.proyecto || c.ubicacion) && <p style={{ margin: '0 0 6px' }}>{c.proyecto && <strong>{c.proyecto}</strong>}{c.ubicacion && ` — ${c.ubicacion}`}</p>}
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <button className="boton-md boton-secundario" onClick={() => verPdf(`/diserco/cotizaciones/${c.id}/pdf`, session).catch((e) => setError(e.message))}>Ver PDF</button>
          {abierta && vende && <button className="boton-md boton-secundario" onClick={() => onEditar(c)}>Editar</button>}
          {vende && <button className="boton-md boton-secundario" disabled={ocupado} onClick={() => { const email = window.prompt('¿A qué correo la enviamos?', c.email || c.clientes?.email || ''); if (email) hacer(() => post('correo', { email }), (r) => `Enviada a ${r.a}`); }}>Enviar por correo</button>}
          {abierta && vende && !c.vencida && <button className="boton-sm" style={{ background: 'var(--ok)', color: '#fff' }} disabled={ocupado} onClick={() => hacer(() => post('aprobar'), 'Cotización aprobada: ya se puede cobrar y facturar')}>✔ Aprobar</button>}
          {abierta && vende && <button className="boton-sm boton-peligro" onClick={() => { const motivo = window.prompt('Motivo del rechazo:'); if (motivo) hacer(() => post('rechazar', { motivo }), 'Cotización rechazada'); }}>Rechazar</button>}
          {['aprobada', 'facturada'].includes(c.estado) && gerencia && <button className="boton-sm boton-peligro" onClick={() => { const motivo = window.prompt('Motivo de la anulación:'); if (motivo) hacer(() => post('anular', { motivo }), 'Cotización anulada'); }}>Anular</button>}
          {['rechazada', 'anulada'].includes(c.estado) && gerencia && <button className="boton-sm boton-secundario" onClick={() => hacer(() => post('reabrir'), 'Cotización reabierta como borrador')}>Reabrir</button>}
        </div>
        {c.motivo_cierre && ['rechazada', 'anulada'].includes(c.estado) && <p style={{ color: 'var(--text-dim)' }}>Motivo: {c.motivo_cierre}</p>}
      </div>

      <div className="panel">
        <table className="tabla">
          <thead><tr><th>Descripción</th><th style={{ textAlign: 'right' }}>{esProyecto ? 'Área' : 'Cant.'}</th><th>{esProyecto ? 'Unidad' : 'Presentación'}</th><th style={{ textAlign: 'right' }}>P. unitario</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
          <tbody>
            {c.lineas.map((l) => (
              <tr key={l.id}>
                <td style={{ whiteSpace: 'pre-wrap' }}>{l.descripcion}</td>
                <td style={{ textAlign: 'right' }}>{num(l.cantidad, 3)}</td>
                <td>{esProyecto ? l.unidad : l.presentacion || l.unidad}</td>
                <td style={{ textAlign: 'right' }}>{L(l.precio_unitario)}</td>
                <td style={{ textAlign: 'right' }}>{L(Number(l.cantidad) * Number(l.precio_unitario))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          {Number(c.descuento_pct) > 0 && <div>Descuento {num(c.descuento_pct, 2)}%</div>}
          <div>Sub total {L(c.subtotal)}</div>
          <div>ISV 15% {L(c.isv)}</div>
          <div style={{ fontSize: '1.4em' }}><strong>Total {L(c.total)}</strong></div>
        </div>
      </div>

      {esProyecto && salidas.length > 0 && (
        <div className="panel">
          <h2>Material enviado al proyecto</h2>
          <table className="tabla">
            <tbody>
              {salidas.map((s) => (
                <tr key={s.id}>
                  <td>Salida #{s.numero} · {fechaCorta(s.created_at)}</td>
                  <td>{s.items.map((i) => `${num(i.pendiente, 0)} × ${i.productos?.nombre}`).join(', ')}</td>
                  <td><Etiqueta tono={s.estado === 'abierta' ? 'aviso' : 'gris'}>{s.estado === 'abierta' ? 'en curso' : 'cerrada'}</Etiqueta></td>
                  <td style={{ textAlign: 'right' }}>{L(s.costo_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(() => { const costo = salidas.reduce((t, s) => t + s.costo_total, 0); return <p><strong>Costo del material: {L(costo)}</strong>{gerencia && <> · margen sobre material: {L(Number(c.subtotal) - costo)} ({num(Number(c.subtotal) > 0 ? ((Number(c.subtotal) - costo) / Number(c.subtotal)) * 100 : 0, 1)}%) <small style={{ color: 'var(--text-dim)' }}>sin mano de obra</small></>}</p>; })()}
        </div>
      )}

      {['aprobada', 'facturada'].includes(c.estado) && (
        <div className="panel">
          <h2>Cobros y facturas</h2>
          <table className="tabla">
            <tbody>
              {c.pagos.map((p) => (
                <tr key={p.id} style={p.anulado ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                  <td>{fechaCorta(p.created_at)}</td>
                  <td><strong>{p.concepto}</strong></td>
                  <td>{p.formas_pago?.nombre}{p.referencia && ` · ${p.referencia}`}</td>
                  <td style={{ textAlign: 'right' }}>{L(p.monto)}</td>
                  <td>{p.venta?.numero_factura ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {p.venta_id && !p.anulado && <>
                      <button className="boton-sm boton-secundario" onClick={() => verPdf(`/ventas/${p.venta_id}/pdf`, session).catch((e) => setError(e.message))}>Factura PDF</button>{' '}
                      <button className="boton-sm boton-secundario" onClick={() => imprimirTicket(p.venta_id, session, { reimpresion: true }).catch((e) => setError(e.message))}>Ticket</button>
                    </>}
                  </td>
                </tr>
              ))}
              {c.pagos.length === 0 && <tr><td style={{ color: 'var(--text-dim)' }}>Sin cobros todavía</td></tr>}
            </tbody>
          </table>
          <p><strong>Cobrado {L(c.pagado)}</strong> de {L(c.total)} · pendiente {L(c.pendiente)}</p>
          {c.estado === 'aprobada' && cobra && c.pendiente > 0.004 && (
            <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {esProyecto && c.pagado === 0 && (
                <div style={{ width: '100%', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="boton-sm boton-secundario" onClick={() => setPago({ ...pago, monto: String(anticipoSugerido) })}>Anticipo 50% · {L(anticipoSugerido)}</button>
                  <button className="boton-sm boton-secundario" onClick={() => setPago({ ...pago, monto: String(c.pendiente) })}>Pago total · {L(c.pendiente)}</button>
                </div>
              )}
              <Campo etiqueta="Forma de pago" ancho={160}><select value={pago.forma_pago_id} onChange={(e) => setPago({ ...pago, forma_pago_id: e.target.value })}>{formas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select></Campo>
              <Campo etiqueta="Monto" ancho={150} ayuda={!esProyecto ? 'Productos: se cobra completo' : undefined}><input type="number" step="0.01" value={pago.monto} readOnly={!esProyecto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} /></Campo>
              <Campo etiqueta="Referencia (voucher / transferencia)"><input value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} /></Campo>
              {esProyecto && <Campo etiqueta="Concepto en la factura (opcional)" ancho={220}><input value={pago.concepto} placeholder={pagaTodo ? 'Saldo final / Pago total' : 'Anticipo 50%'} onChange={(e) => setPago({ ...pago, concepto: e.target.value })} /></Campo>}
              <button className="boton" style={{ width: '100%', padding: '18px 20px', fontSize: '1.3rem', fontWeight: 800, minHeight: 64 }} disabled={ocupado || !(Number(pago.monto) > 0)} onClick={() => cobrar(false)}>
                {ocupado ? 'Procesando…' : `🧾 REGISTRAR PAGO Y GENERAR FACTURA · ${L(Number(pago.monto) || 0)}${esProyecto && !pagaTodo ? ' (parcial)' : ''}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
