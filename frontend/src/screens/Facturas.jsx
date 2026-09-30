import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { colorSucursal } from '../lib/coloresSucursal.js';
import { descargarCsv } from '../lib/csv.js';
import { descargarPdf, imprimirTicket, verPdf } from '../lib/documentos.js';
import { useCambiosEnVivo } from '../lib/tiempoReal.js';
import { registrarEvento } from '../lib/eventos.js';

// Formas de pago de una factura, con el efectivo neto del cambio devuelto.
function formasDePago(f) {
  const porForma = new Map();
  for (const p of f.venta_pagos ?? []) {
    const nombre = p.formas_pago?.nombre ?? 'Otro';
    porForma.set(nombre, (porForma.get(nombre) ?? 0) + Number(p.monto));
  }
  if (porForma.has('Efectivo') && Number(f.cambio) > 0) porForma.set('Efectivo', porForma.get('Efectivo') - Number(f.cambio));
  return [...porForma.entries()].map(([nombre, monto]) => ({ nombre, monto }));
}

const CLASE_FORMA = { Efectivo: 'pago-efectivo', Tarjeta: 'pago-tarjeta', Transferencia: 'pago-transferencia' };

function ChipsPago({ factura }) {
  const formas = formasDePago(factura);
  if (formas.length === 0) return <span style={{ color: 'var(--text-dim)' }}>—</span>;
  return (
    <span className="chips-pago">
      {formas.map((p) => (
        <span key={p.nombre} className={`chip-pago ${CLASE_FORMA[p.nombre] ?? ''}`} title={`L ${p.monto.toFixed(2)}`}>
          {p.nombre}
          {formas.length > 1 && ` L${p.monto.toFixed(0)}`}
        </span>
      ))}
    </span>
  );
}

export default function Facturas({ session, perfil, sucursales, filtroInicial, onFiltroInicialUsado }) {
  const [filtros, setFiltros] = useState({ sucursal_id: '', fechaInicio: '', fechaFin: '', q: filtroInicial?.q ?? '' });
  const [cajeroFiltro, setCajeroFiltro] = useState('');
  const [soloAnuladas, setSoloAnuladas] = useState(false);
  const [formaFiltro, setFormaFiltro] = useState('');
  const [facturas, setFacturas] = useState([]);
  const [seleccionada, setSeleccionada] = useState(null);
  const [error, setError] = useState('');
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [reenviando, setReenviando] = useState(false);

  const cajerosDisponibles = useMemo(
    () => [...new Set(facturas.map((f) => f.perfiles?.nombre).filter(Boolean))].sort(),
    [facturas]
  );
  const facturasVisibles = useMemo(() => {
    let lista = facturas;
    if (cajeroFiltro) lista = lista.filter((f) => f.perfiles?.nombre === cajeroFiltro);
    if (soloAnuladas) lista = lista.filter((f) => f.anulada);
    if (formaFiltro) lista = lista.filter((f) => formasDePago(f).some((p) => p.nombre === formaFiltro));
    return lista;
  }, [facturas, cajeroFiltro, soloAnuladas, formaFiltro]);
  const totalesPorForma = useMemo(() => {
    const t = {};
    for (const f of facturasVisibles) {
      if (f.anulada) continue;
      for (const p of formasDePago(f)) t[p.nombre] = (t[p.nombre] ?? 0) + p.monto;
    }
    return t;
  }, [facturasVisibles]);
  const totalVisible = useMemo(
    () => facturasVisibles.reduce((s, f) => s + (f.anulada ? 0 : Number(f.total)), 0),
    [facturasVisibles]
  );

  function exportarCsv() {
    descargarCsv(
      `facturas-${new Date().toISOString().slice(0, 10)}.csv`,
      facturasVisibles,
      [
        { titulo: 'No. Orden', valor: (f) => f.numero_orden },
        { titulo: 'Fecha', valor: (f) => (f.fecha_emision ? new Date(f.fecha_emision).toLocaleString('es-HN') : '') },
        { titulo: 'No. Factura', valor: (f) => f.numero_factura },
        { titulo: 'Cliente', valor: (f) => f.clientes?.nombre ?? 'Consumidor Final' },
        { titulo: 'RTN', valor: (f) => f.clientes?.rtn ?? '' },
        { titulo: 'Impuesto', valor: (f) => Number(f.isv_total).toFixed(2) },
        { titulo: 'Total', valor: (f) => Number(f.total).toFixed(2) },
        { titulo: 'Forma de pago', valor: (f) => formasDePago(f).map((p) => `${p.nombre} ${p.monto.toFixed(2)}`).join(' + ') },
        { titulo: 'Cajero', valor: (f) => f.perfiles?.nombre ?? '' },
        { titulo: 'Anulada', valor: (f) => (f.anulada ? 'Sí' : 'No') },
      ]
    );
  }

  async function buscar() {
    const params = new URLSearchParams({ estado: 'pagada' });
    if (filtros.sucursal_id) params.set('sucursal_id', filtros.sucursal_id);
    if (filtros.fechaInicio) params.set('fechaInicio', filtros.fechaInicio);
    if (filtros.fechaFin) params.set('fechaFin', filtros.fechaFin);
    if (filtros.q) params.set('q', filtros.q);
    if (filtros.q || filtros.fechaInicio) registrarEvento('factura.buscar', { q: filtros.q, desde: filtros.fechaInicio, hasta: filtros.fechaFin });
    setFacturas(await api.get(`/ventas?${params.toString()}`, session));
  }

  useEffect(() => {
    buscar().catch((e) => setError(e.message));
    if (filtroInicial) onFiltroInicialUsado?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Una factura emitida o anulada en cualquier sucursal aparece acá al
  // instante, con los mismos filtros que ya están puestos.
  useCambiosEnVivo(['ventas'], (payload) => {
    const estado = payload.new?.estado ?? payload.old?.estado;
    if (estado && estado !== 'pagada') return;
    buscar().catch(() => {});
  });

  function accionDocumento(promesa) {
    promesa.catch((e) => setError(e.message));
  }

  async function reenviarCorreo(id) {
    setReenviando(true);
    setError('');
    try {
      await api.post(`/ventas/${id}/reenviar-correo`, session, {});
      window.alert('Correo reenviado.');
      buscar();
    } catch (e) {
      setError(e.message);
    } finally {
      setReenviando(false);
    }
  }

  async function verDetalle(id) {
    const detalle = await api.get(`/ventas/${id}`, session);
    setSeleccionada(detalle);
    registrarEvento('factura.ver', { factura: detalle.numero_factura, total: Number(detalle.total) }, detalle.sucursal_id);
    setMotivoAnulacion('');
  }

  async function anular() {
    if (!motivoAnulacion.trim()) return;
    if (!window.confirm(`¿Anular la factura ${seleccionada.numero_factura}? No se puede deshacer; la piedra vuelve al inventario.`)) return;
    try {
      await api.post('/anulaciones', session, { venta_id: seleccionada.id, motivo: motivoAnulacion });
      setSeleccionada(null);
      buscar();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>Listado de facturas</h2>
        <div className="toolbar">
          <select value={filtros.sucursal_id} onChange={(e) => setFiltros({ ...filtros, sucursal_id: e.target.value })}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
          <input type="date" value={filtros.fechaInicio} onChange={(e) => setFiltros({ ...filtros, fechaInicio: e.target.value })} />
          <input type="date" value={filtros.fechaFin} onChange={(e) => setFiltros({ ...filtros, fechaFin: e.target.value })} />
          <input placeholder="Buscar No. de factura" value={filtros.q} onChange={(e) => setFiltros({ ...filtros, q: e.target.value })} />
          <button className="boton-sm" onClick={buscar}>
            Buscar
          </button>
          {cajerosDisponibles.length > 1 && (
            <select value={cajeroFiltro} onChange={(e) => setCajeroFiltro(e.target.value)}>
              <option value="">Todos los cajeros</option>
              {cajerosDisponibles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <select value={formaFiltro} onChange={(e) => setFormaFiltro(e.target.value)}>
            <option value="">Todas las formas de pago</option>
            <option value="Efectivo">Efectivo</option>
            <option value="Tarjeta">Tarjeta</option>
            <option value="Transferencia">Transferencia</option>
          </select>
          <button className="boton-sm boton-secundario" onClick={exportarCsv} disabled={facturasVisibles.length === 0}>
            Exportar CSV
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={soloAnuladas}
              onChange={(e) => setSoloAnuladas(e.target.checked)}
            />
            Sólo anuladas
          </label>
        </div>

        {facturas.length >= 200 && (
          <div className="alerta">
            Se están mostrando los últimos 200 resultados — acota el rango de fechas o la sucursal para ver el resto.
          </div>
        )}

        <p style={{ color: 'var(--text-dim)' }}>
          {facturasVisibles.length} factura{facturasVisibles.length === 1 ? '' : 's'} · Total: L{' '}
          {totalVisible.toFixed(2)}
          {Object.entries(totalesPorForma).map(([nombre, monto]) => (
            <span key={nombre} className={`chip-pago ${CLASE_FORMA[nombre] ?? ''}`} style={{ marginLeft: 8 }}>
              {nombre} L {monto.toFixed(2)}
            </span>
          ))}
        </p>

        <table className="tabla">
          <thead>
            <tr>
              <th>Sucursal</th>
              <th>No. Orden</th>
              <th>Fecha</th>
              <th>No. Factura</th>
              <th>Cliente</th>
              <th>RTN</th>
              <th>Impuesto</th>
              <th>Total</th>
              <th>Pago</th>
              <th>Cajero</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {facturasVisibles.map((f) => (
              <tr key={f.id} style={f.anulada ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                <td>
                  <span
                    className="leyenda-punto"
                    style={{ background: colorSucursal(f.sucursal_id), display: 'inline-block' }}
                    title="Sucursal"
                  />
                </td>
                <td>{f.numero_orden}</td>
                <td>{f.fecha_emision ? new Date(f.fecha_emision).toLocaleString('es-HN') : '—'}</td>
                <td>{f.numero_factura}</td>
                <td>{f.clientes?.nombre ?? 'Consumidor Final'}</td>
                <td>{f.clientes?.rtn ?? '—'}</td>
                <td>L {Number(f.isv_total).toFixed(2)}</td>
                <td>L {Number(f.total).toFixed(2)}</td>
                <td>
                  <ChipsPago factura={f} />
                </td>
                <td>{f.perfiles?.nombre ?? '—'}</td>
                <td>
                  <button className="boton-sm boton-secundario" onClick={() => verDetalle(f.id)}>
                    Ver
                  </button>
                  {f.correo_enviado === false && (
                    <span title={`No se pudo enviar el correo: ${f.correo_error ?? ''}`} style={{ marginLeft: 6 }}>
                      ✉️⚠️
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {seleccionada && (
        <div className="overlay" onClick={() => setSeleccionada(null)}>
          <div className="tarjeta" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            {seleccionada.puntos_emision?.es_borrador && (
              <div className="badge-borrador">Sin validez fiscal — CAI pendiente</div>
            )}
            <h2>{seleccionada.numero_factura}</h2>
            <p>
              {seleccionada.clientes?.nombre || 'Consumidor Final'}
              {seleccionada.clientes?.rtn ? ` · RTN ${seleccionada.clientes.rtn}` : ''}
            </p>
            {(seleccionada.detalle || []).map((d) => (
              <div key={d.id} className="pos-orden-linea">
                <span>
                  {Number(d.cantidad)} × {d.nombre_producto}
                  {Number(d.descuento) > 0 && (
                    <span style={{ color: 'var(--ok)', fontSize: '0.85em' }}>
                      {' '}
                      · desc. {Number(d.descuento_porcentaje) || ''}%{Number(d.descuento_porcentaje) === 25 ? ' 3ra edad' : ''} −L{' '}
                      {Number(d.descuento).toFixed(2)}
                    </span>
                  )}
                </span>
                <span>L {(Number(d.cantidad) * Number(d.precio_unitario)).toFixed(2)}</span>
              </div>
            ))}
            {Number(seleccionada.descuento) > 0 && (
              <div className="pos-totales-fila">
                <span>Descuentos (por producto)</span>
                <span>-L {Number(seleccionada.descuento).toFixed(2)}</span>
              </div>
            )}
            <div className="pos-totales-fila total">
              <span>Total</span>
              <span>L {Number(seleccionada.total).toFixed(2)}</span>
            </div>
            <div className="pos-totales-fila">
              <span>Pagado con</span>
              <ChipsPago factura={seleccionada} />
            </div>
            <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
              <button
                className="boton-secundario boton-sm"
                style={{ flex: 1 }}
                onClick={() => accionDocumento(imprimirTicket(seleccionada.id, session, { reimpresion: true }))}
              >
                🖨 Reimprimir
              </button>
              <button
                className="boton-secundario boton-sm"
                style={{ flex: 1 }}
                onClick={() => accionDocumento(verPdf(`/ventas/${seleccionada.id}/pdf`, session))}
              >
                Ver PDF
              </button>
              <button
                className="boton-secundario boton-sm"
                style={{ flex: 1 }}
                onClick={() =>
                  accionDocumento(
                    descargarPdf(`/ventas/${seleccionada.id}/pdf`, session, `factura-${seleccionada.numero_factura}.pdf`)
                  )
                }
              >
                Descargar PDF
              </button>
            </div>
            {seleccionada.clientes?.email && (
              <button
                className="boton-secundario boton-sm"
                style={{ width: '100%', marginBottom: 10 }}
                disabled={reenviando}
                onClick={() => reenviarCorreo(seleccionada.id)}
              >
                {reenviando ? 'Enviando…' : `Reenviar correo a ${seleccionada.clientes.email}`}
              </button>
            )}

            {perfil.rol === 'admin' && !seleccionada.anulada && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <input placeholder="Motivo de la anulación" value={motivoAnulacion} onChange={(e) => setMotivoAnulacion(e.target.value)} />
                <p style={{ fontSize: '0.8em', color: 'var(--text-dim)', marginTop: -6 }}>
                  Una factura emitida no se modifica: solo se puede reimprimir o anular. Al anular conserva su número y la piedra regresa al inventario.
                </p>
                <button className="boton-peligro" disabled={!motivoAnulacion.trim()} onClick={anular}>
                  Anular factura
                </button>
              </div>
            )}
            {seleccionada.anulada && <div className="alerta">Esta factura ya fue anulada.</div>}

            <button className="boton-secundario" onClick={() => setSeleccionada(null)}>
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
