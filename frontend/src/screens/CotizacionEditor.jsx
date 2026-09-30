import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Campo } from '../components/Modal.jsx';
import { calcularCotizacion, dimensionarLinea } from '../lib/cotizacion.js';
import { L, num } from '../lib/fmt.js';

// Toda cantidad se captura en números enteros (no se vende media caja).
const entero = (v) => (v === '' ? '' : String(Math.max(0, Math.floor(Number(v) || 0))));
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const LINEA_VACIA = (tipo) => ({ tipo, producto_id: '', descripcion: '', unidad: 'viaje', m2_neto: '', cantidad: '', precio_unitario: '' });
const TIPO_CLIENTE = [['final', 'Cliente final'], ['constructora', 'Constructora'], ['arquitecto', 'Arquitecto / diseñador'], ['instalador', 'Instalador'], ['ferreteria', 'Ferretería'], ['distribuidor', 'Distribuidor']];

// Editor de cotización: m² → cajas completas (sin desperdicio),
// accesorios y flete manuales, ISV incluido o separado según la lista, descuento % opcional.
export default function CotizacionEditor({ session, perfil, inicial, onGuardada, onCancelar }) {
  const [cat, setCat] = useState(null);
  const [cli, setCli] = useState({ cliente_id: '', nombre_cliente: '', rtn_cliente: '', telefono: '', email: '', tipo_cliente: 'final', lista_precio_id: '', exento: false });
  const [enc, setEnc] = useState({ vigencia_dias: 15, anticipo_pct: 0, notas: '', descuento_pct: '' });
  const [verDescuento, setVerDescuento] = useState(false);
  const [lineas, setLineas] = useState([]);
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const gerencia = ['admin', 'gerente'].includes(perfil.rol);

  useEffect(() => {
    (async () => {
      const [productos, listas, pr, params, inventario] = await Promise.all([
        api.cache('/productos', session), api.cache('/listas-precio', session), api.cache('/listas-precio/precios', session), api.cache('/insumos/parametros', session),
        api.get('/inventario/pt', session).catch(() => []),
      ]);
      const parametros = Object.fromEntries(params.map((p) => [p.clave, Number(p.valor)]));
      setCat({ productos, listas, precios: Object.fromEntries(pr.map((x) => [`${x.producto_id}|${x.lista_id}`, Number(x.precio)])), parametros, stock: new Map(inventario.map((i) => [i.id, i])) });
      if (inicial) {
        setCli({ cliente_id: inicial.cliente_id ?? '', nombre_cliente: inicial.nombre_cliente, rtn_cliente: inicial.rtn_cliente ?? '', telefono: inicial.telefono ?? '', email: inicial.email ?? '', tipo_cliente: inicial.clientes?.tipo_cliente ?? 'final', lista_precio_id: inicial.lista_precio_id ?? '', exento: !!inicial.clientes?.exento_impuestos });
        setEnc({ vigencia_dias: inicial.vigencia_dias, anticipo_pct: Number(inicial.anticipo_pct), notas: inicial.notas ?? '', descuento_pct: Number(inicial.descuento_pct) || '' });
        setVerDescuento(Number(inicial.descuento_pct) > 0);
        const preciosMap = Object.fromEntries(pr.map((x) => [`${x.producto_id}|${x.lista_id}`, Number(x.precio)]));
        setLineas(inicial.lineas.map((l) => {
          const prod = productos.find((x) => x.id === l.producto_id);
          const listaIni = listas.find((x) => x.id === inicial.lista_precio_id);
          const deLista = prod ? preciosMap[`${prod.id}|${inicial.lista_precio_id}`] ?? (listaIni && !listaIni.isv_incluido ? Math.round((Number(prod.precio) / (1 + Number(prod.impuesto1_tasa ?? 0.15)) + Number.EPSILON) * 100) / 100 : Number(prod.precio)) : null;
          const factorIni = prod && l.m2_neto && Number(prod.m2_por_caja) > 0 && prod.unidad_venta === 'm2' ? Number(prod.m2_por_caja) : 1;
          const manual = l.producto_id ? Math.abs(Number(l.precio_unitario) - r2(deLista * factorIni)) > 0.005 : true;
          return { tipo: l.tipo, producto_id: l.producto_id ?? '', descripcion: l.descripcion, unidad: l.unidad, m2_neto: l.m2_neto ?? '', cantidad: l.cantidad, precio_unitario: manual ? Number(l.precio_unitario) : '' };
        }));
      } else {
        setEnc((e) => ({ ...e, vigencia_dias: parametros.vigencia_cotizacion_dias ?? 15, anticipo_pct: parametros.anticipo_pct_default ?? 0 }));
        setLineas([LINEA_VACIA('producto')]);
      }
    })().catch((e) => setError(e.message));
  }, []);

  // Los clientes se cargan una vez (memoria compartida) y se filtran aquí: el nombre aparece al instante.
  const [todosClientes, setTodosClientes] = useState([]);
  useEffect(() => { api.cache('/clientes?todos=1', session).then(setTodosClientes).catch(() => {}); }, []);
  useEffect(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 1) return setResultados([]);
    setResultados(todosClientes.filter((c) => !c.es_consumidor_final && [c.nombre, c.rtn, c.telefono, c.email].some((v) => String(v ?? '').toLowerCase().includes(q))).slice(0, 6));
  }, [busca, todosClientes]);

  const lista = useMemo(() => {
    if (!cat) return null;
    return cat.listas.find((l) => l.id === (cli.lista_precio_id || '')) ?? cat.listas.find((l) => l.orden === 1) ?? cat.listas[0];
  }, [cat, cli.lista_precio_id]);
  const porId = useMemo(() => new Map((cat?.productos ?? []).map((p) => [p.id, p])), [cat]);
  // Precio del catálogo = lista Público (con ISV). En una lista sin ISV sin precio propio, se quita el ISV.
  const precioLista = (p) => cat.precios[`${p.id}|${lista?.id}`] ?? (lista && !lista.isv_incluido ? Math.round((Number(p.precio) / (1 + Number(p.impuesto1_tasa ?? 0.15)) + Number.EPSILON) * 100) / 100 : Number(p.precio));

  // Líneas con todo resuelto (mismo cálculo que hace el servidor).
  const resueltas = useMemo(() => {
    if (!cat) return [];
    return lineas.map((l) => {
      const p = l.producto_id ? porId.get(l.producto_id) : null;
      const dim = l.tipo === 'producto' && p && Number(l.m2_neto) > 0 ? dimensionarLinea(p, Number(l.m2_neto), 0) : null;
      const cantidad = dim ? dim.cantidad : Number(l.cantidad) || 0;
      const factor = dim?.factor_precio ?? 1; // con m² por caja se factura por caja: precio por m² × m² por caja
      const lp = p ? r2(precioLista(p) * factor) : 0;
      const precio = l.precio_unitario !== '' && l.precio_unitario !== undefined ? Number(l.precio_unitario) : p ? lp : Number(l.precio_unitario) || 0;
      const costoBase = Number(p?.costo_estandar || 0);
      return { ...l, descuento_pct: 0, p, dim, cantidad, precio_unitario: precio, precio_lista: lp, isv_tasa: p ? Number(p.impuesto1_tasa ?? 0.15) : 0.15, costo_unitario: p ? (p.unidad_venta === 'caja' ? costoBase * Number(p.m2_por_caja || 0) : costoBase * factor) : 0 };
    });
  }, [lineas, cat, lista]);
  const calc = useMemo(() => calcularCotizacion(resueltas, { isv_incluido: lista?.isv_incluido ?? true, descuento_pct: verDescuento ? Number(enc.descuento_pct) || 0 : 0, cliente_exento: cli.exento }), [resueltas, lista, enc.descuento_pct, verDescuento, cli.exento]);

  const setL = (i, patch) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setPiedra = (i, id) => { const p = porId.get(id); setL(i, { producto_id: id, unidad: p?.unidad_venta ?? 'm2', precio_unitario: '' }); };

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
        ...cli, ...enc, lista_precio_id: lista?.id ?? null, anticipo_pct: 0, entrega: 'retira', descuento_pct: verDescuento ? Number(enc.descuento_pct) || 0 : 0,
        lineas: lineas.filter((l) => l.producto_id || l.descripcion).map((l, i) => ({
          tipo: l.tipo, producto_id: l.producto_id || null, descripcion: l.descripcion, unidad: l.unidad,
          m2_neto: l.m2_neto === '' ? null : Number(l.m2_neto), desperdicio_pct: 0,
          cantidad: resueltas[lineas.indexOf(l)]?.cantidad ?? Number(l.cantidad),
          precio_unitario: l.precio_unitario === '' ? undefined : Number(l.precio_unitario), descuento_pct: 0,
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
        </div>
        <div className="toolbar" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Campo etiqueta="Vigencia (días)" ancho={120}><input type="number" value={enc.vigencia_dias} onChange={(e) => setEnc({ ...enc, vigencia_dias: e.target.value })} /></Campo>
        </div>
      </div>

      <div className="panel">
        <h2>Líneas</h2>
        <div className="toolbar">
          <button className="boton-sm" onClick={() => setLineas([...lineas, LINEA_VACIA('producto')])}>+ Piedra</button>
          <button className="boton-sm boton-secundario" onClick={() => setLineas([...lineas, LINEA_VACIA('accesorio')])}>+ Accesorio</button>
          <button className="boton-sm boton-secundario" onClick={() => setLineas([...lineas, { ...LINEA_VACIA('flete'), descripcion: 'Flete', cantidad: 1 }])}>+ Flete</button>
          <button className="boton-sm boton-secundario" onClick={() => setLineas([...lineas, LINEA_VACIA('otro')])}>+ Otro</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tabla" style={{ minWidth: 760 }}>
            <thead><tr><th>Concepto</th><th style={{ width: 110 }}>m²</th><th style={{ width: 160 }}>Se entrega</th><th style={{ width: 130 }}>Precio {lista?.isv_incluido ? 'c/ISV' : 's/ISV'}</th><th style={{ width: 120, textAlign: 'right' }}>Importe</th><th style={{ width: 36 }}></th></tr></thead>
            <tbody>
              {lineas.map((l, i) => {
                const r = resueltas[i];
                const c = calc.lineas[i];
                const esProd = l.tipo === 'producto';
                const esAcc = l.tipo === 'accesorio';
                return (
                  <tr key={i}>
                    <td>
                      {esProd && <select value={l.producto_id} onChange={(e) => setPiedra(i, e.target.value)}><option value="">Elige piedra…</option>{piedras.map((p) => { const st = cat.stock.get(p.id); return <option key={p.id} value={p.id}>{p.nombre}{st ? ` — ${st.disponible_primera > 0 ? `${num(st.disponible_primera, 1)} ${st.unidad} disp.` : 'sin existencia'}` : ''}</option>; })}</select>}
                      {esAcc && <select value={l.producto_id} onChange={(e) => setL(i, { producto_id: e.target.value, unidad: porId.get(e.target.value)?.unidad_venta ?? 'unidad', precio_unitario: '' })}><option value="">Elige accesorio…</option>{accs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>}
                      {!esProd && !esAcc && <input placeholder="Descripción" value={l.descripcion} onChange={(e) => setL(i, { descripcion: e.target.value })} />}
                      {esProd && r?.p && (() => {
                        const st = cat.stock.get(r.p.id);
                        if (!st) return null;
                        const pide = r.p.unidad_venta === 'caja' ? r.cantidad : (r.dim?.m2_entregado ?? r.cantidad);
                        const alcanza = st.disponible_primera >= pide;
                        return (
                          <small style={{ display: 'block', marginTop: 3, color: pide > 0 && !alcanza ? 'var(--peligro)' : 'var(--text-dim)' }}>
                            En inventario: <strong>{num(st.disponible_primera, 2)} {st.unidad}</strong> disponibles
                            {st.reservado > 0 && ` (${num(st.reservado, 2)} reservados)`}
                            {st.en_secado > 0 && ` · ${num(st.en_secado, 2)} en secado`}
                            {pide > 0 && (alcanza ? ' · ✔ alcanza' : ` · faltan ${num(pide - st.disponible_primera, 2)} ${st.unidad}: al aprobar se ordenará producir`)}
                          </small>
                        );
                      })()}
                      {r?.p && r.precio_unitario < r.precio_lista * 0.995 && <small style={{ color: 'var(--peligro)' }}>Bajo lista ({L(r.precio_lista)})</small>}
                    </td>
                    <td>{esProd && <input type="number" inputMode="numeric" step="1" min="1" value={l.m2_neto} onChange={(e) => setL(i, { m2_neto: entero(e.target.value) })} />}</td>
                    <td>
                      {esProd && r?.dim ? (
                        <span>
                          <strong>{num(r.dim.cantidad, 0)} {r.dim.unidad_linea === 'caja' ? 'cajas' : r.p?.unidad_venta === 'm2' ? 'm²' : r.dim.unidad_linea}</strong>
                          {r.dim.unidad_linea === 'caja' && r.p?.unidad_venta === 'm2' && <small style={{ display: 'block', color: 'var(--text-dim)' }}>= {num(r.dim.m2_entregado, 2)} m² (cajas de {num(r.p.m2_por_caja, 2)} m²){r.dim.factor_precio !== 1 && ` · ${L(r.precio_lista)} por caja`}</small>}
                        </span>)
                        : <span style={{ display: 'flex', gap: 4 }}><input type="number" inputMode="numeric" step="1" min="1" value={l.cantidad} onChange={(e) => setL(i, { cantidad: entero(e.target.value) })} /><small>{l.unidad}</small></span>}
                    </td>
                    <td><input type="number" step="0.01" value={l.precio_unitario} placeholder={r?.p ? String(r.precio_lista) : ''} onChange={(e) => setL(i, { precio_unitario: e.target.value })} /></td>
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
          </div>
          <div style={{ textAlign: 'right' }}>
            {!verDescuento && <button className="boton-sm boton-secundario" onClick={() => setVerDescuento(true)}>+ Aplicar descuento negociado</button>}
            {verDescuento && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
                <Campo etiqueta="Descuento negociado (%)" ancho={190}><input type="number" min="0" max="100" step="0.5" autoFocus value={enc.descuento_pct} onChange={(e) => setEnc({ ...enc, descuento_pct: e.target.value })} /></Campo>
                <button className="boton-sm boton-secundario" onClick={() => { setVerDescuento(false); setEnc({ ...enc, descuento_pct: '' }); }}>Quitar</button>
              </div>
            )}
            {calc.descuento_total > 0 && <div>Descuento {num(calc.descuento_pct, 2)}%: −{L(calc.descuento_total)}</div>}
            <div>Subtotal {L(calc.subtotal)}</div>
            <div>ISV 15% {L(calc.isv)}</div>
            <div style={{ fontSize: '1.4em' }}><strong>Total {L(calc.total)}</strong></div>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="boton-sm" disabled={guardando || !cli.nombre_cliente || calc.total <= 0} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar cotización'}</button>
          <button className="boton-sm boton-secundario" onClick={onCancelar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
