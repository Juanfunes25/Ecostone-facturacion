import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Etiqueta, Kpis } from '../components/Modal.jsx';
import { BarraHorizontal, BarrasVerticales } from '../components/Graficas.jsx';
import { L, num, fechaCorta, hoyIso, sumarDiasIso } from '../lib/fmt.js';
import { descargarCsv } from '../lib/csv.js';

const hora = (iso) => new Date(iso).toLocaleString('es-HN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Tegucigalpa' });
const TONO = { curando: 'aviso', terminada: 'ok', planificada: 'info', cancelada: 'gris' };
const TXT = { curando: 'curando', terminada: 'en inventario', planificada: 'pendiente', cancelada: 'cancelada' };

// Panorama de producción: todo lo que pasa en planta en una sola pantalla.
export default function ReporteProduccion({ session, perfil }) {
  const [rango, setRango] = useState({ desde: sumarDiasIso(hoyIso(), -29), hasta: hoyIso() });
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  useEffect(() => {
    setD(null);
    api.get(`/reporte-produccion?desde=${rango.desde}&hasta=${rango.hasta}`, session).then(setD).catch((e) => setError(e.message));
  }, [rango.desde, rango.hasta]);

  const atajo = (dias) => setRango({ desde: sumarDiasIso(hoyIso(), -(dias - 1)), hasta: hoyIso() });
  const mesActual = () => setRango({ desde: `${hoyIso().slice(0, 7)}-01`, hasta: hoyIso() });

  function exportar() {
    descargarCsv(`registros-produccion-${rango.desde}_${rango.hasta}.csv`, d.registros, [
      { titulo: 'Fecha y hora', valor: (r) => hora(r.registrado_at) }, { titulo: 'Operario', valor: (r) => r.operario }, { titulo: 'Producto', valor: (r) => r.producto },
      { titulo: 'Cantidad', valor: (r) => r.cantidad }, { titulo: 'Unidad', valor: (r) => r.unidad }, { titulo: 'Lote', valor: (r) => r.lote },
      { titulo: 'Estado', valor: (r) => TXT[r.estado] ?? r.estado }, { titulo: 'Disponible desde', valor: (r) => r.disponible_desde ?? '' },
    ]);
  }

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <div className="panel">
        <h2>Reporte de producción</h2>
        <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="boton-sm boton-secundario" onClick={() => atajo(1)}>Hoy</button>
          <button className="boton-sm boton-secundario" onClick={() => atajo(7)}>7 días</button>
          <button className="boton-sm boton-secundario" onClick={() => atajo(30)}>30 días</button>
          <button className="boton-sm boton-secundario" onClick={mesActual}>Este mes</button>
          <input type="date" value={rango.desde} max={rango.hasta} onChange={(e) => setRango({ ...rango, desde: e.target.value })} style={{ maxWidth: 160 }} />
          <input type="date" value={rango.hasta} min={rango.desde} max={hoyIso()} onChange={(e) => setRango({ ...rango, hasta: e.target.value })} style={{ maxWidth: 160 }} />
          {d && <button className="boton-sm boton-secundario" onClick={exportar}>Exportar registros (CSV)</button>}
        </div>
      </div>

      {!d && !error && <div className="panel">Cargando…</div>}
      {d && (
        <>
          <Kpis items={[
            { titulo: 'Producido', valor: `${num(d.kpis.m2_producidos, 1)} m²`, pie: `${d.kpis.registros} registros${d.kpis.cajas_esquina_producidas ? ` · ${num(d.kpis.cajas_esquina_producidas, 0)} cajas de esquina` : ''}` },
            { titulo: 'Curando ahora', valor: `${num(d.kpis.en_curado_m2, 1)} m²`, pie: `${d.kpis.en_curado_lotes} lotes esperando el fin del curado` },
            { titulo: 'Ya en inventario', valor: `${num(d.kpis.liberado_m2, 1)} m²`, pie: d.kpis.segunda_m2 ? `+ ${num(d.kpis.segunda_m2, 1)} m² de segunda` : 'primera calidad' },
            { titulo: 'Merma', valor: `${num(d.kpis.merma_pct, 1)}%`, pie: `${num(d.kpis.merma_m2, 1)} m² perdidos` },
            ...(gerencia ? [
              { titulo: 'Insumos consumidos', valor: L(d.kpis.costo_insumos), pie: 'a costo promedio' },
              { titulo: 'Costo por m²', valor: d.kpis.costo_m2_promedio != null ? L(d.kpis.costo_m2_promedio) : '—', pie: 'lotes ya liberados' },
            ] : []),
          ]} />

          <div className="panel">
            <h2>Producción por día (m²)</h2>
            <BarrasVerticales datos={d.por_dia} color="var(--primario)" formatear={(n) => (n ? num(n, 1) : '')} />
          </div>

          <div className="dos-columnas">
            <div className="panel"><h2>Por modelo (m²)</h2><BarraHorizontal datos={d.por_modelo} color="var(--primario)" formatear={(n) => num(n, 1)} /></div>
            <div className="panel"><h2>Por operario</h2><BarraHorizontal datos={d.por_operario} color="var(--serie-2)" formatear={(n) => num(n, 1)} />
              <small style={{ color: 'var(--text-dim)' }}>{d.por_operario.map((o) => `${o.nombre}: ${o.registros} registros`).join(' · ')}</small></div>
          </div>

          <div className="panel">
            <h2>Producido por producto</h2>
            <table className="tabla">
              <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Registros</th></tr></thead>
              <tbody>
                {d.por_producto.map((p) => <tr key={p.nombre + p.unidad}><td>{p.nombre}</td><td style={{ textAlign: 'right' }}>{num(p.valor, 2)} {p.unidad}</td><td style={{ textAlign: 'right' }}>{p.registros}</td></tr>)}
                {d.por_producto.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--text-dim)', textAlign: 'center' }}>Sin producción en este rango</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h2>Materia prima: consumo real vs. receta</h2>
            <table className="tabla">
              <thead><tr><th>Insumo</th><th style={{ textAlign: 'right' }}>Según receta</th><th style={{ textAlign: 'right' }}>Consumido</th><th style={{ textAlign: 'right' }}>Desvío</th>{gerencia && <th style={{ textAlign: 'right' }}>Costo</th>}</tr></thead>
              <tbody>
                {d.consumo.map((c) => (
                  <tr key={c.insumo}><td>{c.insumo}</td><td style={{ textAlign: 'right' }}>{num(c.teorico, 2)} {c.unidad}</td><td style={{ textAlign: 'right' }}>{num(c.real, 2)} {c.unidad}</td>
                    <td style={{ textAlign: 'right', color: c.desvio_pct != null && Math.abs(c.desvio_pct) > 10 ? 'var(--peligro)' : undefined }}>{c.desvio_pct != null ? `${c.desvio_pct > 0 ? '+' : ''}${num(c.desvio_pct, 1)}%` : '—'}</td>
                    {gerencia && <td style={{ textAlign: 'right' }}>{L(c.costo)}</td>}</tr>
                ))}
                {d.consumo.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-dim)', textAlign: 'center' }}>Sin consumos. Si los modelos no tienen receta, no se descuenta materia prima.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="dos-columnas">
            <div className="panel">
              <h2>Inventario de piedra hoy</h2>
              <table className="tabla"><tbody>
                {d.inventario.map((i) => <tr key={i.nombre}><td>{i.nombre}</td><td style={{ textAlign: 'right' }}><strong>{num(i.disponible, 1)}</strong> {i.unidad} disp.{i.fisico !== i.disponible && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{num(i.fisico, 1)} físicos (hay reservas)</small>}</td></tr>)}
                {d.inventario.length === 0 && <tr><td style={{ color: 'var(--text-dim)' }}>Aún no hay piedra en inventario (entra al terminar el curado).</td></tr>}
              </tbody></table>
            </div>
            <div className="panel">
              <h2>Insumos críticos</h2>
              <table className="tabla"><tbody>
                {d.insumos_criticos.map((i) => <tr key={i.nombre}><td>{i.nombre}</td><td style={{ textAlign: 'right' }}>{num(i.stock, 2)} {i.unidad} {i.stock < 0 ? <Etiqueta tono="peligro">negativo</Etiqueta> : <Etiqueta tono="aviso">bajo mínimo</Etiqueta>}</td></tr>)}
                {d.insumos_criticos.length === 0 && <tr><td style={{ color: 'var(--ok)' }}>Todo en orden</td></tr>}
              </tbody></table>
              {d.insumos_criticos.some((i) => i.stock < 0) && <small style={{ color: 'var(--text-dim)' }}>Negativo = se produjo con más materia prima de la registrada: falta cargar compras.</small>}
            </div>
          </div>

          {d.por_producir.length > 0 && (
            <div className="panel">
              <h2>Por producir (pedidos que faltan)</h2>
              <table className="tabla"><tbody>
                {d.por_producir.map((o) => <tr key={o.lote}><td>{o.producto}</td><td>{num(o.cantidad, 2)} {o.unidad}</td><td>{fechaCorta(o.fecha_programada)}</td><td>{o.cotizacion ? `Cot. #${o.cotizacion}` : 'Stock'}</td></tr>)}
              </tbody></table>
            </div>
          )}

          <div className="dos-columnas">
            <div className="panel">
              <h2>Calidad</h2>
              <p style={{ margin: 0 }}><Etiqueta tono="ok">{d.calidad.aprobado} aprobados</Etiqueta> <Etiqueta tono="aviso">{d.calidad.observado} observados</Etiqueta> <Etiqueta tono="peligro">{d.calidad.rechazado} rechazados</Etiqueta></p>
            </div>
            <div className="panel">
              <h2>Alertas de producción</h2>
              {d.alertas.map((a) => <div key={a.id} style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}><Etiqueta tono={a.severidad === 'alta' ? 'peligro' : 'aviso'}>{a.severidad}</Etiqueta> {a.titulo}<small style={{ display: 'block', color: 'var(--text-dim)' }}>{hora(a.created_at)} · {a.estado}</small></div>)}
              {d.alertas.length === 0 && <p style={{ color: 'var(--ok)', margin: 0 }}>Sin alertas en el rango.</p>}
            </div>
          </div>

          <div className="panel">
            <h2>Registros del operario (detalle)</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="tabla" style={{ minWidth: 640 }}>
                <thead><tr><th>Fecha y hora</th><th>Operario</th><th>Producto</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Lote</th><th>Estado</th><th>Disponible</th></tr></thead>
                <tbody>
                  {d.registros.map((r) => (
                    <tr key={r.id}><td>{hora(r.registrado_at)}</td><td>{r.operario}</td><td>{r.producto}</td><td style={{ textAlign: 'right' }}>{num(r.cantidad, 2)} {r.unidad}</td><td>{r.lote}</td>
                      <td><Etiqueta tono={TONO[r.estado]}>{TXT[r.estado] ?? r.estado}</Etiqueta></td><td>{fechaCorta(r.disponible_desde)}</td></tr>
                  ))}
                  {d.registros.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--text-dim)', textAlign: 'center' }}>Sin registros en este rango</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
