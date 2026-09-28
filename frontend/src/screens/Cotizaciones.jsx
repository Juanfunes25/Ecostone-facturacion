import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Campo, Etiqueta } from '../components/Modal.jsx';
import CotizacionEditor from './CotizacionEditor.jsx';
import { L, num, fechaCorta } from '../lib/fmt.js';
import { verPdf } from '../lib/documentos.js';
import { imprimirTicket } from '../lib/documentos.js';

const ESTADOS = [['', 'Todas'], ['borrador,enviada', 'Por aprobar'], ['aprobada', 'Aprobadas'], ['facturada', 'Facturadas'], ['rechazada,anulada', 'Cerradas']];
const TONO = { borrador: 'gris', enviada: 'info', aprobada: 'aviso', facturada: 'ok', rechazada: 'peligro', anulada: 'peligro', vencida: 'peligro' };

// Cotización → aprobación → cobro → factura, todo enlazado en un solo flujo.
export default function Cotizaciones({ session, perfil }) {
  const [lista, setLista] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [vista, setVista] = useState({ tipo: 'lista' }); // lista | editor{inicial} | detalle{id}
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const vende = ['admin', 'gerente', 'vendedor'].includes(perfil.rol);

  async function cargar() {
    const q = new URLSearchParams();
    if (filtro) q.set('estado', filtro);
    if (busca) q.set('q', busca);
    setLista(await api.get(`/cotizaciones?${q}`, session));
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, [filtro, busca]);

  if (vista.tipo === 'editor') {
    return <CotizacionEditor session={session} perfil={perfil} inicial={vista.inicial} onCancelar={() => setVista(vista.inicial ? { tipo: 'detalle', id: vista.inicial.id } : { tipo: 'lista' })} onGuardada={(c) => { setAviso(`Cotización #${c.numero} guardada`); setVista({ tipo: 'detalle', id: c.id }); }} />;
  }
  if (vista.tipo === 'detalle') {
    return <Detalle id={vista.id} session={session} perfil={perfil} aviso={aviso} onAviso={setAviso} onVolver={() => { setVista({ tipo: 'lista' }); cargar(); }} onEditar={(c) => setVista({ tipo: 'editor', inicial: c })} />;
  }

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <div className="panel">
        <h2>Cotizaciones y pedidos</h2>
        <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>Primero se cotiza; al aprobarla se reserva la piedra (o se ordena producir lo que falte); al cobrarla se factura.</p>
        <div className="toolbar">
          <input placeholder="Buscar cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>{ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          {vende && <button className="boton-sm" onClick={() => setVista({ tipo: 'editor', inicial: null })}>+ Nueva cotización</button>}
        </div>
        <table className="tabla">
          <thead><tr><th>#</th><th>Cliente / proyecto</th><th>Estado</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Cobrado</th><th>Vigencia / entrega</th><th></th></tr></thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id}>
                <td>{c.numero}</td>
                <td><strong>{c.nombre_cliente}</strong>{c.proyecto && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{c.proyecto}</small>}</td>
                <td><Etiqueta tono={TONO[c.vencida ? 'vencida' : c.estado]}>{c.vencida ? 'vencida' : c.estado}</Etiqueta>{c.venta?.numero_factura && <small style={{ display: 'block' }}>{c.venta.numero_factura}</small>}</td>
                <td style={{ textAlign: 'right' }}>{L(c.total)}</td>
                <td style={{ textAlign: 'right' }}>{c.pagado > 0 ? L(c.pagado) : '—'}</td>
                <td>{['borrador', 'enviada'].includes(c.estado) ? `vence ${fechaCorta(c.fecha_vigencia)}` : c.fecha_entrega ? `entrega ${fechaCorta(c.fecha_entrega)}` : '—'}</td>
                <td><button className="boton-sm boton-secundario" onClick={() => setVista({ tipo: 'detalle', id: c.id })}>Abrir</button></td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin cotizaciones</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Detalle({ id, session, perfil, aviso, onAviso, onVolver, onEditar }) {
  const [c, setC] = useState(null);
  const [formas, setFormas] = useState([]);
  const [pago, setPago] = useState({ forma_pago_id: '', monto: '', referencia: '' });
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);
  const vende = ['admin', 'gerente', 'vendedor'].includes(perfil.rol);
  const cobra = ['admin', 'gerente', 'cajero'].includes(perfil.rol);

  async function cargar() {
    const [d, f] = await Promise.all([api.get(`/cotizaciones/${id}`, session), api.get('/formas-pago', session)]);
    setC(d);
    setFormas(f);
    setPago((p) => ({ ...p, forma_pago_id: p.forma_pago_id || f.find((x) => x.nombre === 'Efectivo')?.id || f[0]?.id, monto: d.pendiente > 0 ? d.pendiente : '' }));
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

  if (!c) return <div className="panel">{error ? <div className="error">{error}</div> : 'Cargando…'}</div>;
  const abierta = ['borrador', 'enviada'].includes(c.estado);

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {aviso && <div className="aviso-ok" onClick={() => onAviso('')}>{aviso}</div>}
      <div className="panel">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Cotización #{c.numero} <Etiqueta tono={TONO[c.vencida ? 'vencida' : c.estado]}>{c.vencida ? 'vencida' : c.estado}</Etiqueta></h2>
          <button className="boton-sm boton-secundario" onClick={onVolver}>← Volver</button>
        </div>
        <p style={{ margin: '6px 0' }}><strong>{c.nombre_cliente}</strong>{c.rtn_cliente && ` · RTN ${c.rtn_cliente}`}{c.telefono && ` · ${c.telefono}`}{c.email && ` · ${c.email}`}</p>
        <p style={{ margin: '0 0 6px' }}>{c.proyecto && <><strong>{c.proyecto}</strong>{c.direccion_obra && ` — ${c.direccion_obra}`} · </>}{c.isv_incluido ? 'Precios con ISV incluido' : 'Precios + ISV'}{c.fecha_entrega && ` · entrega ${fechaCorta(c.fecha_entrega)}`} · vigencia {fechaCorta(c.fecha_vigencia)}</p>
        <div className="toolbar" style={{ flexWrap: 'wrap' }}>
          <button className="boton-md boton-secundario" onClick={() => verPdf(`/cotizaciones/${c.id}/pdf`, session).catch((e) => setError(e.message))}>Ver PDF</button>
          {abierta && vende && <button className="boton-md boton-secundario" onClick={() => onEditar(c)}>Editar</button>}
          {abierta && vende && <button className="boton-md boton-secundario" disabled={ocupado} onClick={() => hacer(() => api.post(`/cotizaciones/${c.id}/enviar`, session, {}), (r) => (r.enviado ? 'Enviada por correo' : `No se pudo enviar: ${r.motivo}`))}>Enviar por correo</button>}
          {abierta && vende && !c.vencida && <button className="boton-sm" style={{ background: 'var(--ok)', color: '#fff' }} disabled={ocupado} onClick={async () => { const r = await hacer(() => api.post(`/cotizaciones/${c.id}/aprobar`, session, {}), 'Cotización aprobada'); if (r) setPlan(r.plan); }}>✔ Aprobar</button>}
          {abierta && vende && <button className="boton-sm boton-peligro" onClick={() => { const motivo = window.prompt('Motivo del rechazo (ej.: precio, eligió a otro proveedor):'); if (motivo) hacer(() => api.post(`/cotizaciones/${c.id}/rechazar`, session, { motivo }), 'Cotización rechazada'); }}>Rechazar</button>}
          {c.estado === 'aprobada' && gerencia && <button className="boton-sm boton-peligro" onClick={() => { const motivo = window.prompt('Motivo de la anulación:'); if (motivo) hacer(() => api.post(`/cotizaciones/${c.id}/anular`, session, { motivo }), 'Cotización anulada; reservas liberadas'); }}>Anular</button>}
        </div>
        {c.vencida && <div className="error" style={{ marginTop: 8 }}>Está vencida. Entra a Editar y guarda para renovar la vigencia y los precios.</div>}
      </div>

      {plan && (
        <div className="panel">
          <h2>Qué pasó al aprobar</h2>
          {plan.reservado.length > 0 && <p>📦 Reservado de bodega: {plan.reservado.map((r) => `${num(r.m2, 2)} m² de ${r.producto} (lote ${r.lote})`).join('; ')}.</p>}
          {plan.ordenes.length > 0 && <p>🏭 Órdenes de producción creadas: {plan.ordenes.map((o) => `${o.lote} — ${num(o.m2, 2)} m² de ${o.producto}, colada el ${fechaCorta(o.fecha_programada)}`).join('; ')}.</p>}
          {plan.pendientes.length > 0 && <div className="error">Falta producir pero no se pudo crear la orden: {plan.pendientes.map((p) => `${p.producto} (${num(p.m2, 2)} m²): ${p.motivo}`).join('; ')}</div>}
          {!plan.reservado.length && !plan.ordenes.length && !plan.pendientes.length && <p>Sin piedra que reservar en esta cotización.</p>}
        </div>
      )}

      <div className="panel">
        <table className="tabla">
          <thead><tr><th>Concepto</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Precio</th><th style={{ textAlign: 'right' }}>Importe</th></tr></thead>
          <tbody>
            {c.lineas.map((l) => (
              <tr key={l.id}>
                <td>{l.descripcion}{l.m2_neto != null && l.cajas != null && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{num(l.m2_neto, 2)} m² → {num(l.cajas, 0)} cajas completas</small>}</td>
                <td style={{ textAlign: 'right' }}>{num(l.cantidad, 3)} {l.unidad}</td><td style={{ textAlign: 'right' }}>{L(l.precio_unitario)}</td>
                <td style={{ textAlign: 'right' }}>{L(l.monto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          {Number(c.descuento) > 0 && <div>Descuento {Number(c.descuento_pct) > 0 ? `${num(c.descuento_pct, 2)}%` : ''}: −{L(c.descuento)}</div>}
          <div>Subtotal {L(c.subtotal)} · ISV {L(c.isv)}</div>
          <div style={{ fontSize: '1.4em' }}><strong>Total {L(c.total)}</strong></div>
          {gerencia && c.margen_pct != null && <div style={{ color: 'var(--text-dim)' }}>Costo {L(c.costo)} · margen {num(c.margen_pct, 1)}%</div>}
        </div>
      </div>

      {(c.reservas?.length > 0 || c.ordenes?.length > 0) && (
        <div className="panel">
          <h2>Producción y existencias de este pedido</h2>
          {c.reservas.map((r, i) => <p key={i} style={{ margin: '4px 0' }}>📦 Reservado: {num(r.m2, 2)} m² de {r.producto} (lote {r.lote})</p>)}
          {c.ordenes.map((o) => <p key={o.id} style={{ margin: '4px 0' }}>🏭 {o.lote}: {num(o.m2_planificado, 2)} m² de {o.productos?.nombre} — <Etiqueta tono={o.estado === 'terminada' ? 'ok' : o.estado === 'curando' ? 'aviso' : 'info'}>{{ planificada: 'por iniciar', curando: 'en secado', terminada: 'lista para vender' }[o.estado] ?? o.estado}</Etiqueta> {o.estado === 'planificada' ? `colada ${fechaCorta(o.fecha_programada)}` : o.estado === 'curando' && o.fecha_disponible ? `lista para vender el ${fechaCorta(o.fecha_disponible)}` : ''}</p>)}
        </div>
      )}

      {['aprobada', 'facturada'].includes(c.estado) && (
        <div className="panel">
          <h2>Cobro {c.estado === 'aprobada' && Number(c.anticipo_pct) > 0 && <small style={{ color: 'var(--text-dim)' }}>· anticipo pactado {num(c.anticipo_pct, 0)}% = {L(c.anticipo_monto)}</small>}</h2>
          <table className="tabla">
            <tbody>
              {c.pagos.map((p) => <tr key={p.id}><td>{fechaCorta(p.created_at)}</td><td>{p.tipo}</td><td>{p.formas_pago?.nombre}{p.referencia && ` · ${p.referencia}`}</td><td style={{ textAlign: 'right' }}>{L(p.monto)}</td><td>{p.perfiles?.nombre}</td></tr>)}
              {c.pagos.length === 0 && <tr><td style={{ color: 'var(--text-dim)' }}>Sin pagos todavía</td></tr>}
            </tbody>
          </table>
          <p><strong>Cobrado {L(c.pagado)}</strong> de {L(c.total)} · pendiente {L(c.pendiente)}</p>
          {c.estado === 'aprobada' && cobra && c.pendiente > 0 && (
            <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Campo etiqueta="Forma de pago" ancho={160}><select value={pago.forma_pago_id} onChange={(e) => setPago({ ...pago, forma_pago_id: e.target.value })}>{formas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select></Campo>
              <Campo etiqueta="Monto" ancho={140}><input type="number" step="0.01" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} /></Campo>
              <Campo etiqueta="Referencia (voucher / transferencia)"><input value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} /></Campo>
              <button className="boton-sm" disabled={ocupado || !pago.monto} onClick={() => hacer(() => api.post(`/cotizaciones/${c.id}/pagos`, session, { ...pago, monto: Number(pago.monto) }), 'Pago registrado')}>Registrar pago</button>
            </div>
          )}
          {c.estado === 'aprobada' && cobra && c.pendiente <= 0.004 && c.pagos.length > 0 && (
            <button className="boton" disabled={ocupado} onClick={async () => { const r = await hacer(() => api.post(`/cotizaciones/${c.id}/facturar`, session, {}), (x) => `Factura ${x.factura.numero_factura} emitida.${x.factura.aviso_rtn ? ` ⚠ ${x.factura.aviso_rtn}` : ''}`); if (r) { try { await imprimirTicket(r.factura.id, session); } catch { /* la impresión no bloquea */ } } }}>🧾 Emitir factura</button>
          )}
          {c.estado === 'facturada' && c.venta && (
            <div className="toolbar">
              <Etiqueta tono="ok">Factura {c.venta.numero_factura}</Etiqueta>
              <button className="boton-sm boton-secundario" onClick={() => imprimirTicket(c.venta_id, session, { reimpresion: true }).catch((e) => setError(e.message))}>Reimprimir ticket</button>
              <button className="boton-sm boton-secundario" onClick={() => verPdf(`/ventas/${c.venta_id}/pdf`, session).catch((e) => setError(e.message))}>Factura PDF</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
