import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Etiqueta, Kpis } from '../components/Modal.jsx';
import { L, num, fechaCorta } from '../lib/fmt.js';
import { verPdf } from '../lib/documentos.js';

const cuando = (iso) => (iso ? new Date(iso).toLocaleString('es-HN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Tegucigalpa' }) : '—');
const ESTADO = { planificada: ['Por iniciar', 'info'], curando: ['En secado', 'aviso'], terminada: ['Lista para vender', 'ok'], cancelada: ['Cancelada', 'gris'] };
const MOV = { produccion: 'Entró al inventario (lista para vender)', reserva: 'Reservado para una cotización', liberacion: 'Reserva liberada', despacho: 'Despachado', venta: 'Vendido', merma: 'Merma', ajuste: 'Ajuste de inventario', inicial: 'Existencia inicial' };

// Trazabilidad de un lote: de dónde vino (insumos, operario, calidad) y a dónde fue
// (inventario, reservas, cotizaciones y facturas). Es la pantalla que abre el QR de la etiqueta.
export default function Trazabilidad({ session, perfil, loteInicial }) {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState([]);
  const [lote, setLote] = useState(loteInicial ?? '');
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  useEffect(() => { if (loteInicial) setLote(loteInicial); }, [loteInicial]);
  useEffect(() => {
    const id = setTimeout(() => api.get(`/trazabilidad?q=${encodeURIComponent(q)}`, session).then(setLista).catch((e) => setError(e.message)), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    if (!lote) return setT(null);
    setError('');
    api.get(`/trazabilidad/lote/${encodeURIComponent(lote)}`, session).then(setT).catch((e) => { setT(null); setError(e.message); });
  }, [lote]);

  const linea = useMemo(() => {
    if (!t) return [];
    const ev = [];
    const o = t.orden;
    if (o) {
      ev.push({ f: o.registrado_at, txt: `Producción registrada: ${num(o.cantidad_registrada, 0)} de ${o.producto}`, por: o.operario });
      if (o.etiqueta_at) ev.push({ f: o.etiqueta_at, txt: `Etiqueta del lote generada${o.etiquetas_impresas ? ` (impresa/abierta ${o.etiquetas_impresas} ${o.etiquetas_impresas === 1 ? 'vez' : 'veces'})` : ''}` });
    }
    for (const c of t.calidad) ev.push({ f: c.fecha, txt: `Control de calidad — ${c.prueba}: ${c.resultado}${c.valor != null ? ` (${num(c.valor, 3)} ${c.unidad ?? ''})` : ''}`, por: c.por });
    for (const m of t.movimientos) ev.push({ f: m.fecha, txt: `${MOV[m.tipo] ?? m.tipo}: ${m.cantidad > 0 ? '+' : ''}${num(m.cantidad, 0)}${m.cotizacion ? ` · Cot. #${m.cotizacion} (${m.cliente})` : ''}${m.factura ? ` · Factura ${m.factura}` : ''}${m.detalle && !m.cotizacion ? ` · ${m.detalle}` : ''}`, por: m.por });
    return ev.filter((e) => e.f).sort((a, b) => new Date(a.f) - new Date(b.f));
  }, [t]);

  const o = t?.orden;
  const [txtEstado, tonoEstado] = ESTADO[o?.estado] ?? ['—', 'gris'];

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <div className="panel">
        <h2>Trazabilidad de lotes</h2>
        <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>Busca por número de lote o por producto, o escanea el QR de la etiqueta. Cada producción genera su etiqueta sola al registrarse.</p>
        <div className="toolbar">
          <input placeholder="Lote (ej.: EC-260928-01) o producto…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 260px' }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tabla" style={{ minWidth: 560 }}>
            <thead><tr><th>Lote</th><th>Producto</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Estado</th><th>Producido</th><th></th></tr></thead>
            <tbody>
              {lista.map((x) => (
                <tr key={x.lote} style={x.lote === lote ? { background: 'color-mix(in srgb, var(--ok) 10%, transparent)' } : undefined}>
                  <td><strong>{x.lote}</strong></td><td>{x.producto}</td><td style={{ textAlign: 'right' }}>{num(x.cantidad, 0)}</td>
                  <td><Etiqueta tono={(ESTADO[x.estado] ?? [])[1]}>{(ESTADO[x.estado] ?? [x.estado])[0]}</Etiqueta></td><td>{cuando(x.registrado_at)}</td>
                  <td><button className="boton-sm boton-secundario" onClick={() => setLote(x.lote)}>Trazar</button></td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin lotes</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {t && (
        <>
          <div className="panel">
            <div className="toolbar" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Lote {t.lote} {o && <Etiqueta tono={tonoEstado}>{txtEstado}</Etiqueta>}</h2>
              {o && (
                <div className="toolbar" style={{ margin: 0 }}>
                  <button className="boton-md" onClick={() => verPdf(`/trazabilidad/lote/${encodeURIComponent(t.lote)}/etiqueta`, session).catch((e) => setError(e.message))}>🏷 Imprimir etiqueta</button>
                  <button className="boton-md boton-secundario" onClick={() => { if (o.cantidad_registrada > 60 && !window.confirm(`Se generarán ${o.cantidad_registrada} etiquetas (una por caja). ¿Continuar?`)) return; verPdf(`/trazabilidad/lote/${encodeURIComponent(t.lote)}/etiqueta?modo=cajas`, session).catch((e) => setError(e.message)); }}>Etiquetas por caja ({num(o.cantidad_registrada, 0)})</button>
                </div>
              )}
            </div>
            {!o && <p style={{ color: 'var(--aviso)' }}>Este lote no viene de una orden de producción (es existencia inicial o un ajuste): solo hay movimientos de inventario.</p>}
            {o && (
              <div className="dos-columnas" style={{ marginTop: 10 }}>
                <div>
                  <p style={{ margin: '4px 0' }}><strong>{o.producto}</strong>{o.color && ` · ${o.color}`}</p>
                  <p style={{ margin: '4px 0' }}>Producido: <strong>{cuando(o.registrado_at)}</strong></p>
                  <p style={{ margin: '4px 0' }}>Operario: <strong>{o.operario ?? '—'}</strong></p>
                  <p style={{ margin: '4px 0' }}>Lista para vender: <strong>{o.lista_at ? cuando(o.lista_at) : `se espera el ${fechaCorta(o.disponible_desde)}`}</strong></p>
                </div>
                <div>
                  <p style={{ margin: '4px 0' }}>Orden de producción: <strong>#{o.numero}</strong></p>
                  <p style={{ margin: '4px 0' }}>Mezcla / receta: <strong>{o.receta ?? 'sin receta'}</strong></p>
                  {o.molde && <p style={{ margin: '4px 0' }}>Molde: <strong>{o.molde}</strong></p>}
                  {o.cotizacion_origen && <p style={{ margin: '4px 0' }}>Producido para la cotización <strong>#{o.cotizacion_origen.numero}</strong> ({o.cotizacion_origen.cliente})</p>}
                  {gerencia && o.costo_m2 != null && <p style={{ margin: '4px 0' }}>Costo real: <strong>{L(o.costo_m2)}</strong> por m²</p>}
                </div>
              </div>
            )}
          </div>

          <Kpis items={[
            ...(o ? [{ titulo: 'Registrado', valor: num(o.cantidad_registrada, 0) }, { titulo: 'Lista para vender', valor: o.cantidad_lista != null ? num(o.cantidad_lista, 0) : '—', pie: o.merma ? `${num(o.merma, 0)} de merma` : undefined }] : []),
            { titulo: 'En inventario hoy', valor: num(t.inventario.fisico, 0) },
            { titulo: 'Reservado', valor: num(t.inventario.reservado, 0) },
            { titulo: 'Disponible', valor: num(t.inventario.disponible, 0) },
          ]} />

          {t.consumos.length > 0 && (
            <div className="panel">
              <h2>Materia prima usada (hacia atrás)</h2>
              <div style={{ overflowX: 'auto' }}>
                <table className="tabla" style={{ minWidth: 560 }}>
                  <thead><tr><th>Insumo</th><th style={{ textAlign: 'right' }}>Según receta</th><th style={{ textAlign: 'right' }}>Usado</th><th>Última compra antes del lote (proveedor · factura)</th></tr></thead>
                  <tbody>
                    {t.consumos.map((c, i) => {
                      const compra = t.compras[i]?.ultima_compra;
                      return (
                        <tr key={c.insumo}>
                          <td>{c.insumo}</td><td style={{ textAlign: 'right' }}>{num(c.teorico, 2)} {c.unidad}</td><td style={{ textAlign: 'right' }}>{c.real != null ? `${num(c.real, 2)} ${c.unidad}` : '—'}</td>
                          <td>{compra ? `${compra.proveedor ?? 'sin proveedor'} · ${compra.factura ?? 'sin factura'} · ${fechaCorta(compra.fecha)}` : <span style={{ color: 'var(--text-dim)' }}>sin compras registradas</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {t.destinos.length > 0 && (
            <div className="panel">
              <h2>Destino: cotizaciones y facturas (hacia adelante)</h2>
              <table className="tabla"><thead><tr><th>Cotización</th><th>Cliente</th><th>Estado</th><th style={{ textAlign: 'right' }}>Reservado</th><th>Factura</th></tr></thead>
                <tbody>{t.destinos.map((d) => <tr key={d.cotizacion}><td>#{d.cotizacion}</td><td>{d.cliente}</td><td>{d.estado}</td><td style={{ textAlign: 'right' }}>{num(d.reservado, 0)}</td><td>{d.facturas.join(', ') || '—'}</td></tr>)}</tbody></table>
            </div>
          )}

          <div className="panel">
            <h2>Historia del lote</h2>
            {linea.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <span style={{ minWidth: 170, color: 'var(--text-dim)', fontSize: '0.85rem' }}>{cuando(e.f)}</span>
                <span style={{ flex: 1 }}>{e.txt}{e.por && <small style={{ color: 'var(--text-dim)' }}> · {e.por}</small>}</span>
              </div>
            ))}
            {linea.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Sin eventos.</p>}
          </div>
        </>
      )}
    </div>
  );
}
