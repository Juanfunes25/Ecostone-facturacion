import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal, { Campo, Etiqueta, Kpis, Pestanas } from '../components/Modal.jsx';
import { L, num, fechaCorta, hoyIso } from '../lib/fmt.js';

const TONO = { planificada: 'info', curando: 'aviso', terminada: 'ok', cancelada: 'gris' };
const TIPO_AGENDA = { colada: ['Colada', 'info'], inventario: ['Lista para vender', 'ok'], entrega: ['Entrega', 'ok'] };
const ESTADO = { planificada: 'Por iniciar', curando: 'En secado', terminada: 'Lista para vender', cancelada: 'Cancelada' };
const PARAM_TEXTO = {
  tipo_cambio_usd: 'Tipo de cambio (L por US$)', desperdicio_default_pct: 'Desperdicio sugerido en cotización (%)', vigencia_cotizacion_dias: 'Vigencia de cotización (días)',
  anticipo_pct_default: 'Anticipo por defecto (%)', tolerancia_consumo_pct: 'Tolerancia consumo vs receta (%)', dias_a_inventario: 'Días en secado antes de pasar a lista para vender', merma_maxima_pct: 'Merma máxima normal (%)',
  descuento_max_vendedor_pct: 'Tope de descuento — vendedor (%)', descuento_max_gerente_pct: 'Tope de descuento — gerente (%)', coladas_por_molde_dia: 'Coladas por molde por día', isv_tasa: 'Tasa de ISV',
};

export default function Fabricacion({ session, perfil, onIrA }) {
  const [pestana, setPestana] = useState('tablero');
  const [resumen, setResumen] = useState(null);
  const [agenda, setAgenda] = useState([]);
  const [ordenes, setOrdenes] = useState([]);
  const [mrp, setMrp] = useState(null);
  const [moldes, setMoldes] = useState([]);
  const [params, setParams] = useState([]);
  const [productos, setProductos] = useState([]);
  const [filtroEstado, setFiltroEstado] = useState('planificada,curando');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [nueva, setNueva] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [moldeForm, setMoldeForm] = useState(null);
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);
  const produce = ['admin', 'gerente', 'produccion'].includes(perfil.rol);

  async function cargar() {
    const [r, a, o, m, mo, p, pr] = await Promise.all([
      api.get('/fabricacion/resumen', session), api.get('/fabricacion/agenda', session), api.get(`/fabricacion/ordenes?estado=${filtroEstado}`, session),
      api.get('/fabricacion/mrp', session), api.get('/fabricacion/moldes', session), api.get('/insumos/parametros', session), api.get('/productos', session),
    ]);
    setResumen(r); setAgenda(a); setOrdenes(o); setMrp(m); setMoldes(mo); setParams(p); setProductos(pr.filter((x) => x.tipo === 'piedra'));
  }
  useEffect(() => { cargar().catch((e) => setError(e.message)); }, [filtroEstado]);

  const ok = (m) => { setAviso(m); setTimeout(() => setAviso(''), 12000); };
  async function accion(fn, mensaje) {
    setError('');
    try {
      const r = await fn();
      if (mensaje) ok(typeof mensaje === 'function' ? mensaje(r) : mensaje);
      await cargar();
      return r;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }

  async function abrirDetalle(id) {
    const d = await api.get(`/fabricacion/ordenes/${id}`, session);
    setDetalle({ orden: d, reales: Object.fromEntries(d.consumos.map((c) => [c.mp_id, c.teorico])), terminar: { m2_bueno: d.m2_planificado, m2_segunda: 0, m2_merma: 0 }, cal: { prueba: '', resultado: 'aprobado', valor: '', unidad: '', notas: '' } });
  }
  async function pasarAListo(x) {
    const faltan = x.fecha_disponible && x.fecha_disponible > hoyIso();
    const msg = `${x.lote}: ${num(x.m2_planificado, 2)} de ${x.productos?.nombre}.\n${faltan ? `Todavía está en secado hasta el ${fechaCorta(x.fecha_disponible)}. ` : ''}¿Pasarla ahora a "Lista para vender" y sumarla al inventario?`;
    if (!window.confirm(msg)) return cargar();
    await accion(() => api.post(`/fabricacion/ordenes/${x.id}/terminar`, session, {}), `Lista para vender: ${num(x.m2_planificado, 2)} de ${x.productos?.nombre} ya están en el Inventario de piedra.`);
  }
  async function refrescarDetalle() { if (detalle) await abrirDetalle(detalle.orden.id); await cargar(); }

  const o = detalle?.orden;

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      {aviso && <div className="aviso-ok">{aviso} {/inventario/i.test(aviso) && onIrA && <button className="boton-sm" onClick={() => onIrA('inventario')}>Ver en inventario</button>} <button className="boton-sm boton-secundario" onClick={() => setAviso('')}>Cerrar</button></div>}
      {resumen && (
        <Kpis items={[
          { titulo: 'Por colar', valor: String(resumen.planificadas), pie: resumen.atrasadas ? `${resumen.atrasadas} atrasadas` : 'al día' },
          { titulo: 'En secado', valor: String(resumen.curando), pie: `${num(resumen.m2_curando, 1)} m² · ${resumen.listas_para_liberar} pasan hoy a lista para vender` },
          { titulo: 'm² disponibles', valor: num(resumen.m2_disponible_primera, 1), pie: `${num(resumen.m2_fisico_total, 1)} m² físicos en bodega` },
          { titulo: 'Insumos bajo mínimo', valor: String(resumen.insumos_bajo_minimo) },
        ]} />
      )}
      <Pestanas activa={pestana} onCambiar={setPestana} items={[
        { id: 'tablero', etiqueta: 'Agenda' }, { id: 'ordenes', etiqueta: 'Órdenes de producción', contador: resumen?.atrasadas },
        { id: 'compras', etiqueta: 'Qué comprar', contador: mrp?.insumos.filter((i) => i.faltante > 0).length }, { id: 'moldes', etiqueta: 'Moldes' }, ...(gerencia ? [{ id: 'params', etiqueta: 'Parámetros' }] : []),
      ]} />

      {pestana === 'tablero' && (
        <div className="panel">
          <h2>Próximos 45 días: producción y entregas</h2>
          <table className="tabla">
            <thead><tr><th style={{ width: 120 }}>Fecha</th><th style={{ width: 140 }}>Qué</th><th>Detalle</th><th></th></tr></thead>
            <tbody>
              {agenda.map((e, i) => (
                <tr key={i} style={e.atrasado ? { background: 'var(--peligro-fondo)' } : undefined}>
                  <td>{fechaCorta(e.fecha)}{e.fecha === hoyIso() && <small style={{ display: 'block', color: 'var(--info)' }}>hoy</small>}</td>
                  <td><Etiqueta tono={TIPO_AGENDA[e.tipo][1]}>{TIPO_AGENDA[e.tipo][0]}</Etiqueta></td>
                  <td>{e.titulo}<small style={{ display: 'block', color: 'var(--text-dim)' }}>{e.detalle}</small></td>
                  <td>{e.atrasado && <Etiqueta tono="peligro">atrasado</Etiqueta>}{e.orden_id && produce && <> <button className="boton-sm boton-secundario" onClick={() => { setPestana('ordenes'); abrirDetalle(e.orden_id); }}>Abrir</button></>}</td>
                </tr>
              ))}
              {agenda.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Nada programado. Las órdenes se crean solas al aprobar cotizaciones sin existencia, o a mano en la pestaña Órdenes.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pestana === 'ordenes' && (
        <div className="panel">
          <div className="toolbar">
            <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
              <option value="planificada,curando">Activas</option><option value="planificada">Por iniciar</option><option value="curando">En secado</option><option value="terminada">Listas para vender</option><option value="cancelada">Canceladas</option>
            </select>
            {produce && <button className="boton-sm" onClick={() => setNueva({ producto_id: '', m2_planificado: '', fecha_programada: '', molde_id: '', notas: '' })}>+ Orden de producción</button>}
          </div>
          <table className="tabla">
            <thead><tr><th>Lote</th><th>Producto</th><th style={{ textAlign: 'right' }}>m²</th><th>Estado</th><th>Programada</th><th>Disponible</th><th>Origen</th><th></th></tr></thead>
            <tbody>
              {ordenes.map((x) => (
                <tr key={x.id}>
                  <td><strong>{x.lote}</strong></td><td>{x.productos?.nombre}</td>
                  <td style={{ textAlign: 'right' }}>{num(x.estado === 'terminada' ? x.m2_bueno : x.m2_planificado, 2)}</td>
                  <td>
                    {x.estado === 'curando' && ['admin', 'gerente', 'bodega'].includes(perfil.rol)
                      ? <select value="curando" onChange={(e) => e.target.value === 'terminada' && pasarAListo(x)}><option value="curando">En secado</option><option value="terminada">Lista para vender</option></select>
                      : <Etiqueta tono={TONO[x.estado]}>{ESTADO[x.estado] ?? x.estado}</Etiqueta>}
                    {x.atrasada && <> <Etiqueta tono="peligro">atrasada</Etiqueta></>}
                  </td>
                  <td>{fechaCorta(x.fecha_programada)}</td><td>{fechaCorta(x.fecha_disponible)}</td>
                  <td>{x.cotizaciones ? `Cot. #${x.cotizaciones.numero}` : 'Stock'}</td>
                  <td><button className="boton-sm boton-secundario" onClick={() => abrirDetalle(x.id)}>Abrir</button></td>
                </tr>
              ))}
              {ordenes.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Sin órdenes</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pestana === 'compras' && mrp && (
        <div className="panel">
          <h2>Planificación de compras (MRP)</h2>
          <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>{mrp.ordenes_planificadas} órdenes planificadas. Requerido = consumo teórico de esas órdenes; sugerido = requerido + stock mínimo − existencia.</p>
          <table className="tabla">
            <thead><tr><th>Insumo</th><th style={{ textAlign: 'right' }}>Existencia</th><th style={{ textAlign: 'right' }}>Requerido</th><th style={{ textAlign: 'right' }}>Mínimo</th><th style={{ textAlign: 'right' }}>Faltante</th><th style={{ textAlign: 'right' }}>Sugerido comprar</th>{gerencia && <th style={{ textAlign: 'right' }}>Costo est.</th>}</tr></thead>
            <tbody>
              {mrp.insumos.map((i) => (
                <tr key={i.id}><td><strong>{i.nombre}</strong><small style={{ display: 'block', color: 'var(--text-dim)' }}>{i.proveedores?.nombre ?? ''}</small></td>
                  <td style={{ textAlign: 'right' }}>{num(i.stock, 2)} {i.unidad}</td><td style={{ textAlign: 'right' }}>{num(i.requerido, 2)}</td><td style={{ textAlign: 'right' }}>{num(i.minimo, 2)}</td>
                  <td style={{ textAlign: 'right', color: i.faltante > 0 ? 'var(--peligro)' : undefined }}>{num(i.faltante, 2)}</td><td style={{ textAlign: 'right' }}><strong>{num(i.sugerido_comprar, 2)} {i.unidad}</strong></td>
                  {gerencia && <td style={{ textAlign: 'right' }}>{L(i.costo_estimado)}</td>}</tr>
              ))}
              {mrp.insumos.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Todo cubierto por ahora.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pestana === 'moldes' && (
        <div className="panel">
          <div className="toolbar">{produce && <button className="boton-sm" onClick={() => setMoldeForm({ codigo: '', nombre: '', producto_id: '', piezas_por_colada: 1, m2_por_colada: '', vida_util_usos: 300 })}>+ Molde</button>}</div>
          <table className="tabla">
            <thead><tr><th>Molde</th><th>Producto</th><th style={{ textAlign: 'right' }}>m² por colada</th><th style={{ textAlign: 'right' }}>Usos</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {moldes.map((m) => (
                <tr key={m.id}><td><strong>{m.codigo}</strong><small style={{ display: 'block', color: 'var(--text-dim)' }}>{m.nombre}</small></td><td>{m.productos?.nombre ?? '—'}</td><td style={{ textAlign: 'right' }}>{num(m.m2_por_colada, 3)}</td>
                  <td style={{ textAlign: 'right' }}>{m.usos} / {m.vida_util_usos} {m.por_reemplazar && <Etiqueta tono="peligro">reemplazar</Etiqueta>}</td><td>{m.estado}</td>
                  <td>{produce && <select value={m.estado} onChange={(e) => accion(() => api.put(`/fabricacion/moldes/${m.id}`, session, { estado: e.target.value }))}><option>activo</option><option>mantenimiento</option><option>baja</option></select>}</td></tr>
              ))}
              {moldes.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-dim)' }}>Registra tus moldes para calcular coladas y controlar su vida útil.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pestana === 'params' && gerencia && (
        <div className="panel">
          <h2>Parámetros del negocio</h2>
          <table className="tabla">
            <tbody>
              {params.map((p) => (
                <tr key={p.clave}><td>{PARAM_TEXTO[p.clave] ?? p.clave}<small style={{ display: 'block', color: 'var(--text-dim)' }}>{p.descripcion}</small></td>
                  <td style={{ width: 180 }}><input type="number" step="0.01" defaultValue={p.valor} onBlur={(e) => Number(e.target.value) !== Number(p.valor) && accion(() => api.put(`/insumos/parametros/${p.clave}`, session, { valor: e.target.value }), 'Parámetro guardado')} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nueva && (
        <Modal titulo="Nueva orden de producción" onCerrar={() => setNueva(null)}
          pie={<button className="boton-sm" disabled={!nueva.producto_id || !nueva.m2_planificado} onClick={async () => { const r = await accion(() => api.post('/fabricacion/ordenes', session, nueva), (x) => `Orden ${x.lote} creada`); if (r) setNueva(null); }}>Crear</button>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta="Producto"><select value={nueva.producto_id} onChange={(e) => setNueva({ ...nueva, producto_id: e.target.value })}><option value="">Elige…</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
            <Campo etiqueta="m² a producir (buenos)" ancho={170}><input type="number" step="0.1" value={nueva.m2_planificado} onChange={(e) => setNueva({ ...nueva, m2_planificado: e.target.value })} /></Campo>
            <Campo etiqueta="Fecha programada" ancho={160}><input type="date" value={nueva.fecha_programada} onChange={(e) => setNueva({ ...nueva, fecha_programada: e.target.value })} /></Campo>
            <Campo etiqueta="Molde" ayuda="Calcula cuántas coladas hacen falta"><select value={nueva.molde_id} onChange={(e) => setNueva({ ...nueva, molde_id: e.target.value })}><option value="">—</option>{moldes.filter((m) => m.estado === 'activo').map((m) => <option key={m.id} value={m.id}>{m.codigo} · {num(m.m2_por_colada, 2)} m²/colada</option>)}</select></Campo>
            <Campo etiqueta="Notas"><input value={nueva.notas} onChange={(e) => setNueva({ ...nueva, notas: e.target.value })} /></Campo>
          </div>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>El consumo de insumos se calcula solo con la receta activa del producto (incluye la merma esperada).</p>
        </Modal>
      )}

      {moldeForm && (
        <Modal titulo="Nuevo molde" onCerrar={() => setMoldeForm(null)} pie={<button className="boton-sm" disabled={!moldeForm.codigo || !moldeForm.nombre} onClick={async () => { const r = await accion(() => api.post('/fabricacion/moldes', session, moldeForm), 'Molde creado'); if (r) setMoldeForm(null); }}>Guardar</button>}>
          <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Campo etiqueta="Código" ancho={120}><input value={moldeForm.codigo} onChange={(e) => setMoldeForm({ ...moldeForm, codigo: e.target.value })} /></Campo>
            <Campo etiqueta="Nombre"><input value={moldeForm.nombre} onChange={(e) => setMoldeForm({ ...moldeForm, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Producto"><select value={moldeForm.producto_id} onChange={(e) => setMoldeForm({ ...moldeForm, producto_id: e.target.value })}><option value="">—</option>{productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Piezas por colada" ancho={130}><input type="number" value={moldeForm.piezas_por_colada} onChange={(e) => setMoldeForm({ ...moldeForm, piezas_por_colada: e.target.value })} /></Campo>
            <Campo etiqueta="m² por colada" ancho={130}><input type="number" step="0.01" value={moldeForm.m2_por_colada} onChange={(e) => setMoldeForm({ ...moldeForm, m2_por_colada: e.target.value })} /></Campo>
            <Campo etiqueta="Vida útil (usos)" ancho={130}><input type="number" value={moldeForm.vida_util_usos} onChange={(e) => setMoldeForm({ ...moldeForm, vida_util_usos: e.target.value })} /></Campo>
          </div>
        </Modal>
      )}

      {o && (
        <Modal titulo={`Orden ${o.lote} — ${o.productos?.nombre}`} ancho={860} onCerrar={() => setDetalle(null)}>
          <div className="toolbar" style={{ flexWrap: 'wrap' }}>
            <Etiqueta tono={TONO[o.estado]}>{ESTADO[o.estado] ?? o.estado}</Etiqueta>
            <span>{num(o.m2_planificado, 2)} m² planificados</span>
            <span>Programada: {fechaCorta(o.fecha_programada)}</span>
            {o.fecha_disponible && <span>Disponible: {fechaCorta(o.fecha_disponible)}</span>}
            {o.cotizaciones && <span>Cot. #{o.cotizaciones.numero}{o.cotizaciones.proyecto ? ` · ${o.cotizaciones.proyecto}` : ''}</span>}
            {o.coladas && <span>{o.coladas} coladas (molde {o.moldes?.codigo})</span>}
          </div>
          <h3 style={{ margin: '12px 0 6px' }}>Insumos: receta vs. realidad</h3>
          <table className="tabla">
            <thead><tr><th>Insumo</th><th style={{ textAlign: 'right' }}>Según receta</th><th style={{ textAlign: 'right' }}>En bodega</th><th style={{ width: 150 }}>{o.estado === 'planificada' ? 'Consumo real' : 'Consumido'}</th></tr></thead>
            <tbody>
              {o.consumos.map((c) => (
                <tr key={c.id}><td>{c.materias_primas.nombre}</td><td style={{ textAlign: 'right' }}>{num(c.teorico, 3)} {c.materias_primas.unidad}</td>
                  <td style={{ textAlign: 'right', color: o.estado === 'planificada' && !c.alcanza ? 'var(--peligro)' : undefined }}>{num(c.stock, 2)}{o.estado === 'planificada' && !c.alcanza && ' ⚠'}</td>
                  <td>{o.estado === 'planificada' ? <input type="number" step="0.001" value={detalle.reales[c.mp_id]} onChange={(e) => setDetalle({ ...detalle, reales: { ...detalle.reales, [c.mp_id]: e.target.value } })} /> : c.real != null ? `${num(c.real, 3)} ${c.materias_primas.unidad}` : '—'}</td></tr>
              ))}
            </tbody>
          </table>

          {o.estado === 'planificada' && produce && (
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="boton-sm" onClick={async () => { const r = await accion(() => api.post(`/fabricacion/ordenes/${o.id}/colar`, session, { consumos: o.consumos.map((c) => ({ mp_id: c.mp_id, real: detalle.reales[c.mp_id] })) }), (x) => x.desvios?.length ? 'Colada registrada con desvíos: se generó una alerta.' : 'Colada registrada: insumos descontados, empieza el curado.'); if (r) await abrirDetalle(o.id); }}>Registrar colada (descuenta insumos)</button>
              {gerencia && <button className="boton-sm boton-peligro" onClick={async () => { const motivo = window.prompt('Motivo de la cancelación:'); if (motivo) { await accion(() => api.post(`/fabricacion/ordenes/${o.id}/cancelar`, session, { motivo }), 'Orden cancelada'); setDetalle(null); } }}>Cancelar orden</button>}
            </div>
          )}

          {o.estado === 'curando' && produce && (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: '0 0 6px' }}>Pasar a lista para vender (entra al inventario)</h3>
              <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Campo etiqueta="m² buenos (1ª)" ancho={140}><input type="number" step="0.01" value={detalle.terminar.m2_bueno} onChange={(e) => setDetalle({ ...detalle, terminar: { ...detalle.terminar, m2_bueno: e.target.value } })} /></Campo>
                <Campo etiqueta="m² de segunda" ancho={140}><input type="number" step="0.01" value={detalle.terminar.m2_segunda} onChange={(e) => setDetalle({ ...detalle, terminar: { ...detalle.terminar, m2_segunda: e.target.value } })} /></Campo>
                <Campo etiqueta="m² de merma" ancho={140}><input type="number" step="0.01" value={detalle.terminar.m2_merma} onChange={(e) => setDetalle({ ...detalle, terminar: { ...detalle.terminar, m2_merma: e.target.value } })} /></Campo>
                <button className="boton-sm" disabled={!Number(detalle.terminar.m2_bueno) && !Number(detalle.terminar.m2_segunda)} onClick={async () => { const r = await accion(() => api.post(`/fabricacion/ordenes/${o.id}/terminar`, session, detalle.terminar), (x) => `Lista para vender: merma ${x.merma_pct}%, costo ${L(x.costo_m2)}/m². ${x.sin_control_calidad ? 'Ojo: sin control de calidad registrado. ' : ''}Ya está en inventario.`); if (r) await abrirDetalle(o.id); }}>Terminar y pasar a inventario</button>
              </div>
              {o.fecha_disponible > hoyIso() && <small style={{ color: 'var(--text-dim)' }}>Pasa sola a lista para vender el {fechaCorta(o.fecha_disponible)}; si lo haces ahora, se adelanta.</small>}
            </div>
          )}

          {o.estado === 'terminada' && (
            <div className="rep-nota" style={{ marginTop: 10 }}>Bueno {num(o.m2_bueno, 2)} m² · Segunda {num(o.m2_segunda, 2)} m² · Merma {num(o.m2_merma, 2)} m²{gerencia && o.costo_m2 != null && <> · Costo real <strong>{L(o.costo_m2)}/m²</strong> (insumos {L(o.costo_mp)}, mano de obra {L(o.costo_mano_obra)}, indirectos {L(o.costo_indirectos)})</>}</div>
          )}

          <h3 style={{ margin: '14px 0 6px' }}>Control de calidad</h3>
          <table className="tabla">
            <thead><tr><th>Prueba</th><th>Resultado</th><th>Valor</th><th>Notas</th><th>Por</th></tr></thead>
            <tbody>
              {o.calidad.map((c) => (<tr key={c.id}><td>{c.prueba}</td><td><Etiqueta tono={c.resultado === 'aprobado' ? 'ok' : c.resultado === 'observado' ? 'aviso' : 'peligro'}>{c.resultado}</Etiqueta></td><td>{c.valor != null ? `${num(c.valor, 3)} ${c.unidad ?? ''}` : '—'}</td><td>{c.notas}</td><td>{c.perfiles?.nombre}</td></tr>))}
              {o.calidad.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-dim)', textAlign: 'center' }}>Sin controles todavía</td></tr>}
            </tbody>
          </table>
          {produce && o.estado !== 'cancelada' && (
            <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
              <Campo etiqueta="Prueba"><input list="pruebas" value={detalle.cal.prueba} onChange={(e) => setDetalle({ ...detalle, cal: { ...detalle.cal, prueba: e.target.value } })} placeholder="Elige o escribe" /><datalist id="pruebas">{['Inspección visual y color', 'Dimensiones y espesor', 'Peso por m²', 'Absorción de agua', 'Resistencia a compresión', 'Adherencia (bond) al mortero', 'Eflorescencia', 'Consistencia de la mezcla'].map((p) => <option key={p} value={p} />)}</datalist></Campo>
              <Campo etiqueta="Resultado" ancho={130}><select value={detalle.cal.resultado} onChange={(e) => setDetalle({ ...detalle, cal: { ...detalle.cal, resultado: e.target.value } })}><option>aprobado</option><option>observado</option><option>rechazado</option></select></Campo>
              <Campo etiqueta="Valor" ancho={100}><input type="number" step="0.001" value={detalle.cal.valor} onChange={(e) => setDetalle({ ...detalle, cal: { ...detalle.cal, valor: e.target.value } })} /></Campo>
              <Campo etiqueta="Unidad" ancho={90}><input value={detalle.cal.unidad} onChange={(e) => setDetalle({ ...detalle, cal: { ...detalle.cal, unidad: e.target.value } })} /></Campo>
              <Campo etiqueta="Notas"><input value={detalle.cal.notas} onChange={(e) => setDetalle({ ...detalle, cal: { ...detalle.cal, notas: e.target.value } })} /></Campo>
              <button className="boton-sm boton-secundario" disabled={!detalle.cal.prueba} onClick={async () => { await accion(() => api.post(`/fabricacion/ordenes/${o.id}/calidad`, session, detalle.cal), 'Control registrado'); await abrirDetalle(o.id); }}>Registrar control</button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
