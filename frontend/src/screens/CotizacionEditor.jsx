import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Campo } from '../components/Modal.jsx';
import { calcularCotizacion, dimensionarLinea, sugerirAccesorios, pesoEstimadoKg } from '../lib/cotizacion.js';
import { L, num, hoyIso, sumarDiasIso } from '../lib/fmt.js';

const LINEA_VACIA = (tipo) => ({ tipo, producto_id: '', descripcion: '', unidad: tipo === 'instalacion' ? 'm2' : 'viaje', m2_neto: '', desperdicio_pct: '', cantidad: '', precio_unitario: '', descuento_pct: 0 });
const TIPO_CLIENTE = [['final', 'Cliente final'], ['constructora', 'Constructora'], ['arquitecto', 'Arquitecto / diseñador'], ['instalador', 'Instalador'], ['ferreteria', 'Ferretería'], ['distribuidor', 'Distribuidor']];

// Editor de cotización de proyecto: m² netos + desperdicio → cajas completas,
// accesorios sugeridos, flete e instalación, ISV incluido o separado según la lista.
export default function CotizacionEditor({ session, perfil, inicial, onGuardada, onCancelar }) {
  const [cat, setCat] = useState(null);
  const [cli, setCli] = useState({ cliente_id: '', nombre_cliente: '', rtn_cliente: '', telefono: '', email: '', tipo_cliente: 'final', lista_precio_id: '', exento: false });
  const [enc, setEnc] = useState({ proyecto: '', direccion_obra: '', entrega: 'despacho', fecha_entrega: '', vigencia_dias: 15, anticipo_pct: 0, notas: '', descuento: '' });
  const [lineas, setLineas] = useState([]);
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  useEffect(() => {
    (async () => {
      const [productos, listas, pr, zonas, params] = await Promise.all([
        api.get('/productos', session), api.get('/listas-precio', session), api.get('/listas-precio/precios', session), api.get('/zonas-flete', session), api.get('/insumos/parametros', session),
      ]);
      const parametros = Object.fromEntries(params.map((p) => [p.clave, Number(p.valor)]));
      setCat({ productos, listas, precios: Object.fromEntries(pr.map((x) => [`${x.producto_id}|${x.lista_id}`, Number(x.precio)])), zonas, parametros });
      if (inicial) {
        setCli({ cliente_id: inicial.cliente_id ?? '', nombre_cliente: inicial.nombre_cliente, rtn_cliente: inicial.rtn_cliente ?? '', telefono: inicial.telefono ?? '', email: inicial.email ?? '', tipo_cliente: inicial.clientes?.tipo_cliente ?? 'final', lista_precio_id: inicial.lista_precio_id ?? '', exento: !!inicial.clientes?.exento_impuestos });
        setEnc({ proyecto: inicial.proyecto, direccion_obra: inicial.direccion_obra ?? '', entrega: inicial.entrega, fecha_entrega: inicial.fecha_entrega ?? '', vigencia_dias: inicial.vigencia_dias, anticipo_pct: Number(inicial.anticipo_pct), notas: inicial.notas ?? '', descuento: Number(inicial.descuento) || '' });
        const preciosMap = Object.fromEntries(pr.map((x) => [`${x.producto_id}|${x.lista_id}`, Number(x.precio)]));
        setLineas(inicial.lineas.map((l) => {
          const prod = productos.find((x) => x.id === l.producto_id);
          const deLista = prod ? preciosMap[`${prod.id}|${inicial.lista_precio_id}`] ?? Number(prod.precio) : null;
          const manual = l.producto_id ? Math.abs(Number(l.precio_unitario) - deLista) > 0.005 : true;
          return { tipo: l.tipo, producto_id: l.producto_id ?? '', descripcion: l.descripcion, unidad: l.unidad, m2_neto: l.m2_neto ?? '', desperdicio_pct: l.desperdicio_pct ?? '', cantidad: l.cantidad, precio_unitario: manual ? Number(l.precio_unitario) : '', descuento_pct: Number(l.descuento_pct) };
        }));
      } else {
        setEnc((e) => ({ ...e, vigencia_dias: parametros.vigencia_cotizacion_dias ?? 15, anticipo_pct: parametros.anticipo_pct_default ?? 0 }));
        setLineas([LINEA_VACIA('producto')]);
      }
    })().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (busca.trim().length < 2) return setResultados([]);
    const t = setTimeout(() => api.get(`/clientes?q=${encodeURIComponent(busca)}`, session).then((r) => setResultados(r.filter((c) => !c.es_consumidor_final).slice(0, 6))).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const lista = useMemo(() => {
    if (!cat) return null;
    return cat.listas.find((l) => l.id === (cli.lista_precio_id || '')) ?? cat.listas.find((l) => l.orden === 1) ?? cat.listas[0];
  }, [cat, cli.lista_precio_id]);
  const porId = useMemo(() => new Map((cat?.productos ?? []).map((p) => [p.id, p])), [cat]);
  const precioLista = (p) => cat.precios[`${p.id}|${lista?.id}`] ?? Number(p.precio);

  // Líneas con todo resuelto (mismo cálculo que hace el servidor).
  const resueltas = useMemo(() => {
    if (!cat) return [];
    return lineas.map((l) => {
      const p = l.producto_id ? porId.get(l.producto_id) : null;
      const dim = l.tipo === 'producto' && p && Number(l.m2_neto) > 0 ? dimensionarLinea(p, Number(l.m2_neto), Number(l.desperdicio_pct) || 0) : null;
      const cantidad = dim ? dim.cantidad : Number(l.cantidad) || 0;
      const lp = p ? precioLista(p) : 0;
      const precio = l.precio_unitario !== '' && l.precio_unitario !== undefined ? Number(l.precio_unitario) : p ? lp : Number(l.precio_unitario) || 0;
      const costoBase = Number(p?.costo_estandar || 0);
      return { ...l, p, dim, cantidad, precio_unitario: precio, precio_lista: lp, isv_tasa: p ? Number(p.impuesto1_tasa ?? 0.15) : 0.15, costo_unitario: p ? (p.unidad_venta === 'caja' ? costoBase * Number(p.m2_por_caja || 0) : costoBase) : 0 };
    });
  }, [lineas, cat, lista]);
  const calc = useMemo(() => calcularCotizacion(resueltas, { isv_incluido: lista?.isv_incluido ?? true, descuento: Number(enc.descuento) || 0, cliente_exento: cli.exento }), [resueltas, lista, enc.descuento, cli.exento]);
  const m2Piedra = resueltas.filter((l) => l.tipo === 'producto' && l.dim).reduce((s, l) => s + l.dim.m2_total, 0);
  const peso = cat ? pesoEstimadoKg(resueltas.map((l) => ({ producto_id: l.producto_id, m2_entregado: l.dim?.m2_entregado })), porId) : 0;

  const setL = (i, patch) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setPiedra = (i, id) => { const p = porId.get(id); setL(i, { producto_id: id, unidad: p?.unidad_venta ?? 'm2', desperdicio_pct: lineas[i].desperdicio_pct === '' ? (cat.parametros.desperdicio_default_pct ?? 8) : lineas[i].desperdicio_pct, precio_unitario: '' }); };

  function sugerir() {
    const accesorios = cat.productos.filter((p) => p.tipo === 'accesorio' && Number(p.rendimiento_m2) > 0);
    if (!m2Piedra) return setError('Primero captura los m² de piedra');
    if (!accesorios.length) return setError('No hay accesorios con rendimiento (m² por unidad) en el catálogo');
    let nuevas = [...lineas];
    for (const s of sugerirAccesorios(m2Piedra, accesorios)) {
      const idx = nuevas.findIndex((l) => l.producto_id === s.producto_id);
      if (idx >= 0) nuevas[idx] = { ...nuevas[idx], cantidad: s.cantidad };
      else nuevas.push({ ...LINEA_VACIA('accesorio'), producto_id: s.producto_id, unidad: s.unidad, cantidad: s.cantidad });
    }
    setLineas(nuevas.filter((l) => !(l.tipo === 'producto' && !l.producto_id && !l.m2_neto)));
    setError('');
  }

  function elegirCliente(c) {
    setCli({ cliente_id: c.id, nombre_cliente: c.nombre, rtn_cliente: c.rtn ?? '', telefono: c.telefono ?? '', email: c.email ?? '', tipo_cliente: c.tipo_cliente ?? 'final', lista_precio_id: c.lista_precio_id ?? '', exento: !!c.exento_impuestos });
    setEnc((e) => ({ ...e, direccion_obra: e.direccion_obra || c.direccion || '' }));
    setBusca(''); setResultados([]);
  }

  async function guardar() {
    setError('');
    setGuardando(true);
    try {
      const cuerpo = {
        ...cli, ...enc, lista_precio_id: lista?.id ?? null, descuento: Number(enc.descuento) || 0,
        lineas: lineas.filter((l) => l.producto_id || l.descripcion).map((l, i) => ({
          tipo: l.tipo, producto_id: l.producto_id || null, descripcion: l.descripcion, unidad: l.unidad,
          m2_neto: l.m2_neto === '' ? null : Number(l.m2_neto), desperdicio_pct: Number(l.desperdicio_pct) || 0,
          cantidad: resueltas[lineas.indexOf(l)]?.cantidad ?? Number(l.cantidad),
          precio_unitario: l.precio_unitario === '' ? undefined : Number(l.precio_unitario), descuento_pct: Number(l.descuento_pct) || 0,
        })),
      };
      const r = inicial ? await api.put(`/cotizaciones/${inicial.id}`, session, cuerpo) : await api.post('/cotizaciones', session, cuerpo);
      onGuardada(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (!cat) return <div className="panel">{error ? <div className="error">{error}</div> : 'Cargando catálogo…'}</div>;
  const piedras = cat.productos.filter((p) => p.tipo === 'piedra');
  const accs = cat.productos.filter((p) => p.tipo === 'accesorio');

  return (
    <div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <div className="panel">
        <h2>{inicial ? `Editar cotización #${inicial.numero}` : 'Nueva cotización de proyecto'}</h2>
        <div style={{ position: 'relative' }}>
          <input placeholder="Buscar cliente existente (nombre, RTN, teléfono)…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {resultados.length > 0 && (
            <div className="panel" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, margin: 0, padding: 6 }}>
              {resultados.map((c) => <button key={c.id} className="boton-sm boton-secundario" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }} onClick={() => elegirCliente(c)}>{c.nombre} {c.rtn ? `· ${c.rtn}` : ''} {c.telefono ? `· ${c.telefono}` : ''}</button>)}
            </div>
          )}
        </div>
        <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
          <Campo etiqueta="Cliente"><input value={cli.nombre_cliente} onChange={(e) => setCli({ ...cli, cliente_id: '', nombre_cliente: e.target.value })} /></Campo>
          <Campo etiqueta="RTN" ancho={150}><input value={cli.rtn_cliente} onChange={(e) => setCli({ ...cli, cliente_id: '', rtn_cliente: e.target.value })} /></Campo>
          <Campo etiqueta="Teléfono" ancho={130}><input value={cli.telefono} onChange={(e) => setCli({ ...cli, telefono: e.target.value })} /></Campo>
          <Campo etiqueta="Correo"><input value={cli.email} onChange={(e) => setCli({ ...cli, email: e.target.value })} /></Campo>
          <Campo etiqueta="Tipo de cliente" ancho={170}><select value={cli.tipo_cliente} onChange={(e) => setCli({ ...cli, tipo_cliente: e.target.value })}>{TIPO_CLIENTE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Campo>
          <Campo etiqueta="Lista de precios" ancho={210} ayuda={lista?.isv_incluido ? 'Precios con ISV incluido' : 'Precios + ISV aparte'}><select value={lista?.id ?? ''} onChange={(e) => setCli({ ...cli, lista_precio_id: e.target.value })}>{cat.listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></Campo>
        </div>
        <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Campo etiqueta="Proyecto / obra"><input value={enc.proyecto} onChange={(e) => setEnc({ ...enc, proyecto: e.target.value })} placeholder="Ej.: Residencial Los Pinos, fachada" /></Campo>
          <Campo etiqueta="Dirección de la obra"><input value={enc.direccion_obra} onChange={(e) => setEnc({ ...enc, direccion_obra: e.target.value })} /></Campo>
          <Campo etiqueta="Entrega" ancho={140}><select value={enc.entrega} onChange={(e) => setEnc({ ...enc, entrega: e.target.value })}><option value="despacho">Despacho a obra</option><option value="retira">Retira en planta</option></select></Campo>
          <Campo etiqueta="Fecha de entrega" ancho={150}><input type="date" min={hoyIso()} value={enc.fecha_entrega} onChange={(e) => setEnc({ ...enc, fecha_entrega: e.target.value })} /></Campo>
          <Campo etiqueta="Vigencia (días)" ancho={110}><input type="number" value={enc.vigencia_dias} onChange={(e) => setEnc({ ...enc, vigencia_dias: e.target.value })} /></Campo>
          <Campo etiqueta="Anticipo %" ancho={100}><input type="number" min="0" max="100" value={enc.anticipo_pct} onChange={(e) => setEnc({ ...enc, anticipo_pct: e.target.value })} /></Campo>
        </div>
      </div>

      <div className="panel">
        <h2>Líneas</h2>
        <div className="toolbar">
          <button className="boton-sm" onClick={() => setLineas([...lineas, LINEA_VACIA('producto')])}>+ Piedra</button>
          <button className="boton-sm boton-secundario" onClick={() => setLineas([...lineas, LINEA_VACIA('accesorio')])}>+ Accesorio</button>
          <button className="boton-sm boton-secundario" onClick={sugerir} title="Calcula pegamento, sellador, etc. según los m² y el rendimiento">✨ Sugerir accesorios</button>
          <select value="" onChange={(e) => { if (!e.target.value) return; const z = cat.zonas.find((x) => x.id === e.target.value); setLineas([...lineas, { ...LINEA_VACIA('flete'), descripcion: `Flete — ${z.nombre}`, cantidad: 1, precio_unitario: Number(z.tarifa) }]); }}>
            <option value="">+ Flete por zona…</option>{cat.zonas.map((z) => <option key={z.id} value={z.id}>{z.nombre} — {L(z.tarifa)}</option>)}
          </select>
          <button className="boton-sm boton-secundario" onClick={() => setLineas([...lineas, { ...LINEA_VACIA('flete'), descripcion: 'Flete', cantidad: 1 }])}>+ Flete manual</button>
          <button className="boton-sm boton-secundario" onClick={() => setLineas([...lineas, { ...LINEA_VACIA('instalacion'), descripcion: 'Instalación de piedra' }])}>+ Instalación</button>
          <button className="boton-sm boton-secundario" onClick={() => setLineas([...lineas, LINEA_VACIA('otro')])}>+ Otro</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tabla" style={{ minWidth: 920 }}>
            <thead><tr><th>Concepto</th><th style={{ width: 100 }}>m² netos</th><th style={{ width: 90 }}>Desp. %</th><th style={{ width: 150 }}>Se entrega</th><th style={{ width: 120 }}>Precio {lista?.isv_incluido ? 'c/ISV' : 's/ISV'}</th><th style={{ width: 80 }}>Desc. %</th><th style={{ width: 120, textAlign: 'right' }}>Importe</th><th style={{ width: 36 }}></th></tr></thead>
            <tbody>
              {lineas.map((l, i) => {
                const r = resueltas[i];
                const c = calc.lineas[i];
                const esProd = l.tipo === 'producto';
                const esAcc = l.tipo === 'accesorio';
                return (
                  <tr key={i}>
                    <td>
                      {esProd && <select value={l.producto_id} onChange={(e) => setPiedra(i, e.target.value)}><option value="">Elige piedra…</option>{piedras.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.color ? ` — ${p.color}` : ''}</option>)}</select>}
                      {esAcc && <select value={l.producto_id} onChange={(e) => setL(i, { producto_id: e.target.value, unidad: porId.get(e.target.value)?.unidad_venta ?? 'unidad', precio_unitario: '' })}><option value="">Elige accesorio…</option>{accs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>}
                      {!esProd && !esAcc && <input placeholder="Descripción" value={l.descripcion} onChange={(e) => setL(i, { descripcion: e.target.value })} />}
                      {r?.p && r.precio_unitario < r.precio_lista * 0.995 && <small style={{ color: 'var(--peligro)' }}>Bajo lista ({L(r.precio_lista)})</small>}
                    </td>
                    <td>{esProd && <input type="number" step="0.01" value={l.m2_neto} onChange={(e) => setL(i, { m2_neto: e.target.value })} />}</td>
                    <td>{esProd && <input type="number" step="0.5" value={l.desperdicio_pct} onChange={(e) => setL(i, { desperdicio_pct: e.target.value })} />}</td>
                    <td>
                      {esProd && r?.dim ? <span><strong>{num(r.dim.cantidad, 2)} {r.p?.unidad_venta === 'caja' ? 'cajas' : 'm²'}</strong>{r.dim.cajas != null && r.p?.unidad_venta !== 'caja' && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{num(r.dim.cajas, 0)} cajas completas</small>}{r.dim.cajas != null && r.p?.unidad_venta === 'caja' && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{num(r.dim.m2_entregado, 2)} m² reales</small>}</span>
                        : <span style={{ display: 'flex', gap: 4 }}><input type="number" step="0.01" value={l.cantidad} onChange={(e) => setL(i, { cantidad: e.target.value })} /><small>{l.unidad}</small></span>}
                    </td>
                    <td><input type="number" step="0.01" value={l.precio_unitario} placeholder={r?.p ? String(r.precio_lista) : ''} onChange={(e) => setL(i, { precio_unitario: e.target.value })} /></td>
                    <td><input type="number" step="0.5" value={l.descuento_pct} onChange={(e) => setL(i, { descuento_pct: e.target.value })} /></td>
                    <td style={{ textAlign: 'right' }}>{L(c?.monto ?? 0)}</td>
                    <td><button className="boton-sm boton-secundario" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="dos-columnas" style={{ marginTop: 12 }}>
          <div>
            <Campo etiqueta="Notas para el cliente"><input value={enc.notas} onChange={(e) => setEnc({ ...enc, notas: e.target.value })} /></Campo>
            <p style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>
              {num(m2Piedra, 2)} m² de piedra (con desperdicio){peso > 0 && <> · peso aprox. {num(peso, 0)} kg (para el flete)</>}.
              La piedra se cobra por caja completa entregada.
            </p>
            {gerencia && <p style={{ fontSize: '0.85em' }}>Costo estimado {L(calc.costo)} · margen <strong>{num(calc.margen_pct, 1)}%</strong></p>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <Campo etiqueta="Descuento global (L)" ancho={180}><input type="number" step="0.01" value={enc.descuento} onChange={(e) => setEnc({ ...enc, descuento: e.target.value })} /></Campo>
            {calc.descuento_total > 0 && <div>Descuento total: −{L(calc.descuento_total)} ({num(calc.descuento_pct, 1)}%)</div>}
            <div>Subtotal {L(calc.subtotal)}</div>
            <div>ISV 15% {L(calc.isv)}</div>
            <div style={{ fontSize: '1.4em' }}><strong>Total {L(calc.total)}</strong></div>
            {Number(enc.anticipo_pct) > 0 && <div style={{ color: 'var(--text-dim)' }}>Anticipo {num(enc.anticipo_pct, 0)}%: {L((calc.total * Number(enc.anticipo_pct)) / 100)}</div>}
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="boton-sm" disabled={guardando || !cli.nombre_cliente || !enc.proyecto || calc.total <= 0} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar cotización'}</button>
          <button className="boton-sm boton-secundario" onClick={onCancelar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
