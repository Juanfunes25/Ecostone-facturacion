import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { descargarCsv } from '../lib/csv.js';
import { ATAJOS_REPORTES, hoyHn, primerDiaMesHn } from '../lib/rangosFecha.js';
import { colorSucursal, nombreCortoSucursal } from '../lib/coloresSucursal.js';
import { registrarEvento } from '../lib/eventos.js';

const ZONA = 'America/Tegucigalpa';
const FILTROS_KEY = 'ecostone-facturacion:reportes:filtros:v2';
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const PESTANAS = [
  { id: 'resumen', etiqueta: 'Resumen' },
  { id: 'tiempo', etiqueta: 'Días y horas' },
  { id: 'equipo', etiqueta: 'Sucursales y cajeros' },
  { id: 'productos', etiqueta: 'Productos' },
  { id: 'pagos', etiqueta: 'Pagos y descuentos' },
  { id: 'fiscal', etiqueta: 'ISV / Fiscal' },
  { id: 'libro', etiqueta: 'Libro de ventas' },
  { id: 'anulaciones', etiqueta: 'Anulaciones' },
];

function L(n, decimales = 2) {
  const v = Math.abs(Number(n ?? 0)) < 0.005 ? 0 : Number(n ?? 0); // evita "L -0.00"
  return `L ${v.toLocaleString('es-HN', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;
}

const num = (n) => Number(n ?? 0).toLocaleString('es-HN', { maximumFractionDigits: 2 });
const fechaCorta = (f) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-HN', { timeZone: 'UTC', day: '2-digit', month: 'short' });
const fechaHora = (iso) => new Date(iso).toLocaleString('es-HN', { timeZone: ZONA, dateStyle: 'short', timeStyle: 'short' });
const hora12 = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'a. m.' : 'p. m.'}`;

function leerFiltros() {
  try {
    const f = JSON.parse(localStorage.getItem(FILTROS_KEY) ?? 'null');
    if (f?.fechaInicio && f?.fechaFin) return f;
  } catch {
    // almacenamiento no disponible
  }
  return { sucursal_id: '', fechaInicio: primerDiaMesHn(), fechaFin: hoyHn() };
}

function Variacion({ actual, anterior, invertir = false }) {
  if (anterior === undefined || anterior === null) return null;
  if (Number(anterior) === 0) return Number(actual) > 0 ? <span className="rep-var rep-var-neutra">nuevo</span> : null;
  const v = Math.round(((Number(actual) - Number(anterior)) / Math.abs(Number(anterior))) * 1000) / 10;
  const bueno = invertir ? v <= 0 : v >= 0;
  return (
    <span className={`rep-var ${bueno ? 'rep-var-buena' : 'rep-var-mala'}`} title={`Período anterior: ${num(anterior)}`}>
      {v >= 0 ? '▲' : '▼'} {Math.abs(v)}%
    </span>
  );
}

function Kpi({ titulo, valor, actual, anterior, invertir, detalle, dinero = true }) {
  return (
    <div className="rep-kpi">
      <span className="rep-kpi-titulo">{titulo}</span>
      <strong className="rep-kpi-valor">{dinero ? L(valor) : num(valor)}</strong>
      <span className="rep-kpi-pie">
        <Variacion actual={actual ?? valor} anterior={anterior} invertir={invertir} />
        {detalle && <span>{detalle}</span>}
      </span>
    </div>
  );
}

function Barra({ valor, maximo, color }) {
  const ancho = maximo > 0 ? Math.max(1.5, (valor / maximo) * 100) : 0;
  return (
    <span className="rep-barra">
      <span style={{ width: `${ancho}%`, background: color }} />
    </span>
  );
}

function Seccion({ titulo, children, onCsv, extra }) {
  return (
    <div className="panel rep-seccion">
      <div className="rep-seccion-titulo">
        <h2>{titulo}</h2>
        {extra}
        {onCsv && (
          <button className="boton-sm boton-secundario no-imprimir" onClick={onCsv}>
            CSV
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// Tabla con encabezados que ordenan al hacer clic.
function TablaOrdenable({ filas, columnas, ordenInicial, limite, vacio = 'Sin datos en este rango.' }) {
  const [orden, setOrden] = useState(ordenInicial ?? { clave: columnas[0].clave, desc: true });
  const ordenadas = useMemo(() => {
    const col = columnas.find((c) => c.clave === orden.clave);
    const valor = col?.ordenar ?? ((f) => f[orden.clave]);
    return [...filas].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), 'es');
      return orden.desc ? -cmp : cmp;
    });
  }, [filas, columnas, orden]);
  const visibles = limite ? ordenadas.slice(0, limite) : ordenadas;
  return (
    <div className="tabla-scroll">
      <table className="tabla rep-tabla">
        <thead>
          <tr>
            {columnas.map((c) => (
              <th
                key={c.clave}
                className={`${c.numerica ? 'rep-num' : ''} rep-ordenable`}
                onClick={() => setOrden((o) => ({ clave: c.clave, desc: o.clave === c.clave ? !o.desc : true }))}
              >
                {c.titulo}
                {orden.clave === c.clave && <span className="rep-flecha">{orden.desc ? '▾' : '▴'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibles.length === 0 && (
            <tr>
              <td colSpan={columnas.length} className="rep-vacio">
                {vacio}
              </td>
            </tr>
          )}
          {visibles.map((f, i) => (
            <tr key={f.clave ?? i} className={f.claseFila}>
              {columnas.map((c) => (
                <td key={c.clave} className={c.numerica ? 'rep-num' : ''}>
                  {c.render ? c.render(f) : f[c.clave]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {limite && ordenadas.length > limite && <p className="rep-nota">Mostrando {limite} de {ordenadas.length}. El CSV trae todo.</p>}
    </div>
  );
}

function Hallazgos({ d }) {
  const lista = [];
  const mejorDia = [...d.por_dia].sort((a, b) => b.total - a.total)[0];
  if (mejorDia) lista.push(`Mejor día: ${DIAS[mejorDia.dia_semana]} ${fechaCorta(mejorDia.fecha)} con ${L(mejorDia.total)} (${mejorDia.facturas} facturas).`);
  const horaPico = [...d.por_hora].sort((a, b) => b.total - a.total)[0];
  if (horaPico?.total > 0) lista.push(`Hora pico: ${hora12(horaPico.hora)} a ${hora12((horaPico.hora + 1) % 24)} — ${L(horaPico.total)} en el período.`);
  const diaFuerte = [...d.por_dia_semana].filter((x) => x.dias > 0).sort((a, b) => b.promedio_dia - a.promedio_dia)[0];
  if (diaFuerte) lista.push(`El ${DIAS[diaFuerte.dia].toLowerCase()} es el día más fuerte: promedio ${L(diaFuerte.promedio_dia)} por día.`);
  const estrella = d.productos[0];
  if (estrella) lista.push(`Producto estrella: ${estrella.nombre} — ${L(estrella.total)} (${estrella.participacion}% de la venta).`);
  const lider = d.por_sucursal[0];
  if (lider && d.por_sucursal.length > 1) lista.push(`Sucursal líder: ${nombreCortoSucursal(lider.nombre)} con ${lider.participacion}% de la venta.`);
  const efectivo = d.por_forma_pago.find((f) => f.nombre === 'Efectivo');
  if (efectivo) lista.push(`El ${efectivo.participacion}% se cobró en efectivo (${L(efectivo.monto)} neto del cambio).`);
  if (d.kpis.anuladas > 0) lista.push(`${d.kpis.anuladas} factura(s) anulada(s) por ${L(d.kpis.monto_anulado)} — revísalas en la pestaña Anulaciones.`);
  if (d.isv.borrador.facturas > 0) {
    lista.push(`${d.isv.borrador.facturas} comprobante(s) en modo borrador (sin CAI real): no entran en la base del ISV fiscal.`);
  }
  if (lista.length === 0) return null;
  return (
    <ul className="rep-hallazgos">
      {lista.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function MapaCalor({ calor }) {
  const max = Math.max(0, ...calor.flat());
  // Sólo las horas con movimiento en algún día (la planta no vende de madrugada).
  const horas = Array.from({ length: 24 }, (_, h) => h).filter((h) => calor.some((fila) => fila[h] > 0));
  if (horas.length === 0) return <p className="rep-vacio">Sin ventas en este rango.</p>;
  return (
    <div className="tabla-scroll">
      <table className="rep-calor">
        <thead>
          <tr>
            <th></th>
            {horas.map((h) => (
              <th key={h}>{hora12(h).replace(' ', ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calor.map((fila, dia) => (
            <tr key={dia}>
              <th>{DIAS_CORTOS[dia]}</th>
              {horas.map((h) => {
                const intensidad = max > 0 ? fila[h] / max : 0;
                return (
                  <td
                    key={h}
                    title={`${DIAS[dia]} ${hora12(h)}: ${L(fila[h])}`}
                    style={{ background: `color-mix(in srgb, var(--color-sucursal) ${Math.round(intensidad * 100)}%, var(--navy-elevada))` }}
                  >
                    {fila[h] > 0 && intensidad > 0.45 ? Math.round(fila[h] / 1000) + 'k' : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rep-nota">Más intenso = más venta. Sirve para decidir turnos y cuándo reforzar personal.</p>
    </div>
  );
}

function BloqueFiscal({ titulo, r, aviso }) {
  return (
    <div className="rep-fiscal">
      <h3>{titulo}</h3>
      {aviso && <p className="rep-nota">{aviso}</p>}
      <table className="tabla rep-tabla">
        <tbody>
          <tr>
            <td>Ventas exentas</td>
            <td className="rep-num">{L(r.exento)}</td>
          </tr>
          <tr>
            <td>Ventas exoneradas</td>
            <td className="rep-num">{L(r.exonerado)}</td>
          </tr>
          <tr>
            <td>Ventas gravadas 15% (base)</td>
            <td className="rep-num">{L(r.gravado_15)}</td>
          </tr>
          <tr>
            <td>ISV 15% facturado</td>
            <td className="rep-num">{L(r.isv)}</td>
          </tr>
          <tr>
            <td>(−) ISV de notas de crédito parciales ({L(r.notas_credito)})</td>
            <td className="rep-num">{L(-r.isv_notas_credito)}</td>
          </tr>
          <tr className="rep-fila-total">
            <td>ISV neto</td>
            <td className="rep-num">{L(r.isv_neto)}</td>
          </tr>
          <tr>
            <td>Facturas válidas / anuladas</td>
            <td className="rep-num">
              {r.facturas} / {r.anuladas}
            </td>
          </tr>
        </tbody>
      </table>
      {r.rangos.length > 0 && (
        <>
          <h4>Numeración emitida</h4>
          <div className="tabla-scroll">
          <table className="tabla rep-tabla">
            <thead>
              <tr>
                <th>Sucursal</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th className="rep-num">Emitidas</th>
                <th className="rep-num">Anuladas</th>
                <th className="rep-num">Faltan</th>
              </tr>
            </thead>
            <tbody>
              {r.rangos.map((x) => (
                <tr key={x.sucursal + x.desde}>
                  <td>{nombreCortoSucursal(x.sucursal)}</td>
                  <td className="rep-mono">{x.desde}</td>
                  <td className="rep-mono">{x.hasta}</td>
                  <td className="rep-num">{x.emitidas}</td>
                  <td className="rep-num">{x.anuladas}</td>
                  <td className="rep-num" title="Números del rango que no aparecen en estas fechas">
                    {x.huecos > 0 ? <span className="rep-alerta">{x.huecos}</span> : 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
      {r.por_mes.length > 1 && (
        <>
          <h4>Por mes</h4>
          <div className="tabla-scroll">
          <table className="tabla rep-tabla">
            <thead>
              <tr>
                <th>Mes</th>
                <th className="rep-num">Exento</th>
                <th className="rep-num">Exonerado</th>
                <th className="rep-num">Gravado 15%</th>
                <th className="rep-num">ISV</th>
                <th className="rep-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {r.por_mes.map((m) => (
                <tr key={m.mes}>
                  <td>{m.mes}</td>
                  <td className="rep-num">{L(m.exento)}</td>
                  <td className="rep-num">{L(m.exonerado)}</td>
                  <td className="rep-num">{L(m.gravado_15)}</td>
                  <td className="rep-num">{L(m.isv)}</td>
                  <td className="rep-num">{L(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function Reportes({ session, sucursales }) {
  const [filtros, setFiltros] = useState(leerFiltros);
  const [datos, setDatos] = useState(null);
  const [pestana, setPestana] = useState('resumen');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [buscarProducto, setBuscarProducto] = useState('');
  const [categoria, setCategoria] = useState('');
  const [buscarLibro, setBuscarLibro] = useState('');
  const [soloFiscal, setSoloFiscal] = useState(false);

  async function generar(f = filtros) {
    if (!f.fechaInicio || !f.fechaFin) return setError('Elige fecha inicial y final');
    if (f.fechaFin < f.fechaInicio) return setError('La fecha final es anterior a la inicial');
    setError('');
    setCargando(true);
    try {
      localStorage.setItem(FILTROS_KEY, JSON.stringify(f));
    } catch {
      // no crítico
    }
    try {
      const params = new URLSearchParams({ fechaInicio: f.fechaInicio, fechaFin: f.fechaFin });
      if (f.sucursal_id) params.set('sucursal_id', f.sucursal_id);
      setDatos(await api.get(`/reportes/completo?${params.toString()}`, session));
      registrarEvento('reporte.generar', { desde: f.fechaInicio, hasta: f.fechaFin, sucursal: f.sucursal_id || 'todas' });
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    generar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function aplicarAtajo(a) {
    const f = { ...filtros, ...a.calcular() };
    setFiltros(f);
    generar(f);
  }

  const sufijo = `${filtros.fechaInicio}_a_${filtros.fechaFin}`;
  const nombreSucursal = filtros.sucursal_id
    ? nombreCortoSucursal(sucursales.find((s) => s.id === filtros.sucursal_id)?.nombre ?? '')
    : 'Todas las sucursales';

  const productosFiltrados = useMemo(() => {
    if (!datos) return [];
    const q = buscarProducto.trim().toLowerCase();
    return datos.productos
      .filter((p) => (!q || p.nombre.toLowerCase().includes(q)) && (!categoria || p.categoria === categoria))
      .map((p, i) => ({ ...p, clave: `${p.nombre}-${i}` }));
  }, [datos, buscarProducto, categoria]);

  const libroFiltrado = useMemo(() => {
    if (!datos) return [];
    const q = buscarLibro.trim().toLowerCase();
    return datos.libro_ventas
      .filter((f) => !soloFiscal || !f.borrador)
      .filter(
        (f) =>
          !q ||
          (f.numero_factura ?? '').toLowerCase().includes(q) ||
          f.cliente.toLowerCase().includes(q) ||
          (f.rtn ?? '').includes(q) ||
          f.cajero.toLowerCase().includes(q)
      )
      .map((f) => ({ ...f, clave: f.numero_factura, claseFila: f.anulada ? 'rep-anulada' : undefined }));
  }, [datos, buscarLibro, soloFiscal]);

  const k = datos?.kpis;
  const ka = datos?.kpis_anterior;
  const maxDia = datos ? Math.max(0, ...datos.por_dia.map((d) => d.total)) : 0;
  const maxHora = datos ? Math.max(0, ...datos.por_hora.map((h) => h.total)) : 0;
  const maxDiaSemana = datos ? Math.max(0, ...datos.por_dia_semana.map((d) => d.promedio_dia)) : 0;

  return (
    <div className="reportes">
      {error && <div className="error">{error}</div>}

      <div className="panel rep-filtros no-imprimir">
        <h2>Reportes</h2>
        <div className="toolbar">
          <select value={filtros.sucursal_id} onChange={(e) => setFiltros({ ...filtros, sucursal_id: e.target.value })}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {nombreCortoSucursal(s.nombre)}
              </option>
            ))}
          </select>
          <label className="rep-fecha">
            Desde
            <input type="date" value={filtros.fechaInicio} max={hoyHn()} onChange={(e) => setFiltros({ ...filtros, fechaInicio: e.target.value })} />
          </label>
          <label className="rep-fecha">
            Hasta
            <input type="date" value={filtros.fechaFin} max={hoyHn()} onChange={(e) => setFiltros({ ...filtros, fechaFin: e.target.value })} />
          </label>
          <button className="boton-sm" onClick={() => generar()} disabled={cargando}>
            {cargando ? 'Generando…' : 'Generar'}
          </button>
          <button className="boton-sm boton-secundario" onClick={() => window.print()} disabled={!datos}>
            Imprimir / PDF
          </button>
        </div>
        <div className="rep-atajos">
          {ATAJOS_REPORTES.map((a) => (
            <button key={a.etiqueta} className="boton-sm boton-secundario" onClick={() => aplicarAtajo(a)} disabled={cargando}>
              {a.etiqueta}
            </button>
          ))}
        </div>
      </div>

      <div className="rep-encabezado-impresion">
        <strong>EcoStone — Reporte de ventas</strong>
        <span>
          {nombreSucursal} · {filtros.fechaInicio} a {filtros.fechaFin}
        </span>
      </div>

      {datos && (
        <>
          <div className="rep-pestanas no-imprimir" role="tablist">
            {PESTANAS.map((p) => (
              <button key={p.id} role="tab" aria-selected={pestana === p.id} className={pestana === p.id ? 'activa' : ''} onClick={() => setPestana(p.id)}>
                {p.etiqueta}
                {p.id === 'anulaciones' && k.anuladas + datos.notas_credito.length > 0 && (
                  <span className="rep-contador">{k.anuladas + datos.notas_credito.filter((n) => n.tipo === 'Parcial').length}</span>
                )}
              </button>
            ))}
          </div>

          {pestana === 'resumen' && (
            <>
              <div className="rep-kpis">
                <Kpi titulo="Ventas netas" valor={k.ventas_netas} anterior={ka.ventas_netas} detalle={`vs. ${datos.rango_anterior.desde} a ${datos.rango_anterior.hasta}`} />
                <Kpi titulo="Facturas" valor={k.facturas} anterior={ka.facturas} dinero={false} />
                <Kpi titulo="Ticket promedio" valor={k.ticket_promedio} anterior={ka.ticket_promedio} />
                <Kpi titulo="Unidades vendidas" valor={k.unidades} anterior={ka.unidades} dinero={false} />
                <Kpi titulo="Ventas brutas" valor={k.ventas_brutas} anterior={ka.ventas_brutas} detalle="antes de descuentos" />
                <Kpi titulo="Descuentos" valor={k.descuentos} anterior={ka.descuentos} invertir />
                <Kpi titulo="Notas de crédito" valor={k.notas_credito} anterior={ka.notas_credito} invertir detalle="parciales" />
                <Kpi titulo="ISV facturado" valor={k.isv} anterior={ka.isv} />
              </div>
              <Seccion titulo="Hallazgos del período">
                <Hallazgos d={datos} />
              </Seccion>
              <Seccion
                titulo="Ventas por día"
                onCsv={() =>
                  descargarCsv(`ventas-por-dia-${sufijo}.csv`, datos.por_dia, [
                    { titulo: 'Fecha', valor: (d) => d.fecha },
                    { titulo: 'Día', valor: (d) => DIAS[d.dia_semana] },
                    { titulo: 'Facturas', valor: (d) => d.facturas },
                    { titulo: 'Total', valor: (d) => d.total.toFixed(2) },
                    { titulo: 'Ticket promedio', valor: (d) => d.ticket_promedio.toFixed(2) },
                    { titulo: 'Descuentos', valor: (d) => d.descuentos.toFixed(2) },
                  ])
                }
              >
                <div className="rep-barras-dia">
                  {datos.por_dia.map((d) => (
                    <div key={d.fecha} className={`rep-dia${d.dia_semana >= 5 ? ' rep-dia-finde' : ''}`} title={`${DIAS[d.dia_semana]} ${d.fecha}: ${L(d.total)} · ${d.facturas} facturas`}>
                      <span className="rep-dia-columna">
                        <span style={{ height: `${maxDia > 0 ? Math.max(2, (d.total / maxDia) * 100) : 0}%` }} />
                      </span>
                      <span className="rep-dia-etiqueta">{d.fecha.slice(8)}</span>
                    </div>
                  ))}
                  {datos.por_dia.length === 0 && <p className="rep-vacio">Sin ventas en este rango.</p>}
                </div>
              </Seccion>
            </>
          )}

          {pestana === 'tiempo' && (
            <>
              <Seccion titulo="Mapa de calor: día de la semana × hora">
                <MapaCalor calor={datos.calor} />
              </Seccion>
              <div className="rep-dos-columnas">
                <Seccion
                  titulo="Por hora"
                  onCsv={() =>
                    descargarCsv(`ventas-por-hora-${sufijo}.csv`, datos.por_hora, [
                      { titulo: 'Hora', valor: (h) => `${h.hora}:00` },
                      { titulo: 'Facturas', valor: (h) => h.facturas },
                      { titulo: 'Total', valor: (h) => h.total.toFixed(2) },
                    ])
                  }
                >
                  <table className="tabla rep-tabla">
                    <tbody>
                      {datos.por_hora
                        .filter((h) => h.facturas > 0)
                        .map((h) => (
                          <tr key={h.hora}>
                            <td className="rep-col-etiqueta">{hora12(h.hora)}</td>
                            <td className="rep-col-barra">
                              <Barra valor={h.total} maximo={maxHora} color="var(--color-sucursal)" />
                            </td>
                            <td className="rep-num">{L(h.total, 0)}</td>
                            <td className="rep-num rep-tenue">{h.facturas}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </Seccion>
                <Seccion titulo="Por día de la semana (promedio por día)">
                  <table className="tabla rep-tabla">
                    <tbody>
                      {datos.por_dia_semana.map((d) => (
                        <tr key={d.dia}>
                          <td className="rep-col-etiqueta">{DIAS[d.dia]}</td>
                          <td className="rep-col-barra">
                            <Barra valor={d.promedio_dia} maximo={maxDiaSemana} color="var(--gold)" />
                          </td>
                          <td className="rep-num">{L(d.promedio_dia, 0)}</td>
                          <td className="rep-num rep-tenue">{d.dias} día(s)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Seccion>
              </div>
              <Seccion titulo="Detalle diario">
                <TablaOrdenable
                  filas={datos.por_dia.map((d) => ({ ...d, clave: d.fecha }))}
                  ordenInicial={{ clave: 'fecha', desc: false }}
                  columnas={[
                    { clave: 'fecha', titulo: 'Fecha', render: (d) => `${DIAS_CORTOS[d.dia_semana]} ${d.fecha}` },
                    { clave: 'facturas', titulo: 'Facturas', numerica: true },
                    { clave: 'ticket_promedio', titulo: 'Ticket', numerica: true, render: (d) => L(d.ticket_promedio) },
                    { clave: 'descuentos', titulo: 'Descuentos', numerica: true, render: (d) => L(d.descuentos) },
                    { clave: 'total', titulo: 'Total', numerica: true, render: (d) => L(d.total) },
                  ]}
                />
              </Seccion>
            </>
          )}

          {pestana === 'equipo' && (
            <>
              <Seccion
                titulo="Por sucursal"
                onCsv={() =>
                  descargarCsv(`ventas-por-sucursal-${sufijo}.csv`, datos.por_sucursal, [
                    { titulo: 'Sucursal', valor: (s) => s.nombre },
                    { titulo: 'Facturas', valor: (s) => s.facturas },
                    { titulo: 'Total', valor: (s) => s.total.toFixed(2) },
                    { titulo: 'Participación %', valor: (s) => s.participacion },
                    { titulo: 'Ticket promedio', valor: (s) => s.ticket_promedio.toFixed(2) },
                    { titulo: 'Descuentos', valor: (s) => s.descuentos.toFixed(2) },
                    { titulo: 'Anuladas', valor: (s) => s.anuladas },
                    { titulo: 'Monto anulado', valor: (s) => s.monto_anulado.toFixed(2) },
                  ])
                }
              >
                <TablaOrdenable
                  filas={datos.por_sucursal.map((s) => ({ ...s, clave: s.sucursal_id }))}
                  ordenInicial={{ clave: 'total', desc: true }}
                  columnas={[
                    {
                      clave: 'nombre',
                      titulo: 'Sucursal',
                      render: (s) => (
                        <span className="rep-sucursal">
                          <span className="leyenda-punto" style={{ background: colorSucursal(s.sucursal_id) }} />
                          {nombreCortoSucursal(s.nombre)}
                        </span>
                      ),
                    },
                    { clave: 'participacion', titulo: 'Participación', render: (s) => <span className="rep-part"><Barra valor={s.participacion} maximo={100} color={colorSucursal(s.sucursal_id)} />{s.participacion}%</span> },
                    { clave: 'facturas', titulo: 'Facturas', numerica: true },
                    { clave: 'ticket_promedio', titulo: 'Ticket', numerica: true, render: (s) => L(s.ticket_promedio) },
                    { clave: 'descuentos', titulo: 'Descuentos', numerica: true, render: (s) => L(s.descuentos) },
                    { clave: 'anuladas', titulo: 'Anuladas', numerica: true },
                    { clave: 'total', titulo: 'Total', numerica: true, render: (s) => L(s.total) },
                  ]}
                />
              </Seccion>
              <Seccion
                titulo="Por cajero"
                onCsv={() =>
                  descargarCsv(`ventas-por-cajero-${sufijo}.csv`, datos.por_cajero, [
                    { titulo: 'Cajero', valor: (c) => c.nombre },
                    { titulo: 'Facturas', valor: (c) => c.facturas },
                    { titulo: 'Total', valor: (c) => c.total.toFixed(2) },
                    { titulo: 'Ticket promedio', valor: (c) => c.ticket_promedio.toFixed(2) },
                    { titulo: 'Facturas con descuento', valor: (c) => c.con_descuento },
                    { titulo: 'Monto descuentos', valor: (c) => c.descuentos.toFixed(2) },
                    { titulo: 'Anuladas', valor: (c) => c.anuladas },
                  ])
                }
              >
                <TablaOrdenable
                  filas={datos.por_cajero.map((c, i) => ({ ...c, clave: `${c.nombre}-${i}` }))}
                  ordenInicial={{ clave: 'total', desc: true }}
                  columnas={[
                    { clave: 'nombre', titulo: 'Cajero' },
                    { clave: 'facturas', titulo: 'Facturas', numerica: true },
                    { clave: 'ticket_promedio', titulo: 'Ticket', numerica: true, render: (c) => L(c.ticket_promedio) },
                    {
                      clave: 'con_descuento',
                      titulo: 'Con descuento',
                      numerica: true,
                      render: (c) => `${c.con_descuento} (${c.facturas ? Math.round((c.con_descuento / c.facturas) * 100) : 0}%)`,
                    },
                    { clave: 'descuentos', titulo: 'Descuentos', numerica: true, render: (c) => L(c.descuentos) },
                    { clave: 'anuladas', titulo: 'Anuladas', numerica: true, render: (c) => (c.anuladas > 0 ? <span className="rep-alerta">{c.anuladas}</span> : 0) },
                    { clave: 'total', titulo: 'Total', numerica: true, render: (c) => L(c.total) },
                  ]}
                />
                <p className="rep-nota">Un cajero con muchos descuentos o anulaciones frente a los demás merece una revisión en la Bitácora.</p>
              </Seccion>
              {datos.clientes.length > 0 && (
                <Seccion
                  titulo="Clientes con factura a nombre (sin Consumidor Final)"
                  onCsv={() =>
                    descargarCsv(`clientes-${sufijo}.csv`, datos.clientes, [
                      { titulo: 'Cliente', valor: (c) => c.nombre },
                      { titulo: 'RTN', valor: (c) => c.rtn },
                      { titulo: 'Facturas', valor: (c) => c.facturas },
                      { titulo: 'Total', valor: (c) => c.total.toFixed(2) },
                    ])
                  }
                >
                  <TablaOrdenable
                    filas={datos.clientes.map((c, i) => ({ ...c, clave: `${c.nombre}-${i}` }))}
                    ordenInicial={{ clave: 'total', desc: true }}
                    columnas={[
                      { clave: 'nombre', titulo: 'Cliente' },
                      { clave: 'rtn', titulo: 'RTN', render: (c) => <span className="rep-mono">{c.rtn || '—'}</span> },
                      { clave: 'facturas', titulo: 'Facturas', numerica: true },
                      { clave: 'ultima', titulo: 'Última compra', render: (c) => fechaHora(c.ultima) },
                      { clave: 'total', titulo: 'Total', numerica: true, render: (c) => L(c.total) },
                    ]}
                  />
                </Seccion>
              )}
            </>
          )}

          {pestana === 'productos' && (
            <>
              <Seccion
                titulo="Por categoría"
                onCsv={() =>
                  descargarCsv(`ventas-por-categoria-${sufijo}.csv`, datos.por_categoria, [
                    { titulo: 'Categoría', valor: (c) => c.nombre },
                    { titulo: 'Unidades', valor: (c) => c.cantidad },
                    { titulo: 'Total', valor: (c) => c.total.toFixed(2) },
                    { titulo: 'Participación %', valor: (c) => c.participacion },
                  ])
                }
              >
                <table className="tabla rep-tabla">
                  <tbody>
                    {datos.por_categoria.map((c, i) => (
                      <tr key={c.nombre} className={categoria === c.nombre ? 'rep-seleccionada' : ''} onClick={() => setCategoria(categoria === c.nombre ? '' : c.nombre)} style={{ cursor: 'pointer' }}>
                        <td className="rep-col-etiqueta">{c.nombre}</td>
                        <td className="rep-col-barra">
                          <Barra valor={c.participacion} maximo={datos.por_categoria[0]?.participacion ?? 100} color={`var(--serie-${(i % 4) + 1})`} />
                        </td>
                        <td className="rep-num">{c.participacion}%</td>
                        <td className="rep-num rep-tenue">{num(c.cantidad)} u.</td>
                        <td className="rep-num">{L(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="rep-nota no-imprimir">Toca una categoría para filtrar los productos de abajo.</p>
              </Seccion>
              <Seccion
                titulo={`Productos${categoria ? ` · ${categoria}` : ''} (${productosFiltrados.length})`}
                extra={
                  <input className="rep-buscar no-imprimir" placeholder="Buscar producto…" value={buscarProducto} onChange={(e) => setBuscarProducto(e.target.value)} />
                }
                onCsv={() =>
                  descargarCsv(`productos-${sufijo}.csv`, productosFiltrados, [
                    { titulo: 'Producto', valor: (p) => p.nombre },
                    { titulo: 'Categoría', valor: (p) => p.categoria },
                    { titulo: 'Unidades', valor: (p) => p.cantidad },
                    { titulo: 'Facturas', valor: (p) => p.facturas },
                    { titulo: 'Precio promedio', valor: (p) => p.precio_promedio.toFixed(2) },
                    { titulo: 'Total', valor: (p) => p.total.toFixed(2) },
                    { titulo: 'Participación %', valor: (p) => p.participacion },
                  ])
                }
              >
                <TablaOrdenable
                  filas={productosFiltrados}
                  limite={100}
                  ordenInicial={{ clave: 'total', desc: true }}
                  columnas={[
                    { clave: 'nombre', titulo: 'Producto' },
                    { clave: 'categoria', titulo: 'Categoría' },
                    { clave: 'cantidad', titulo: 'Unidades', numerica: true, render: (p) => num(p.cantidad) },
                    { clave: 'facturas', titulo: 'Facturas', numerica: true },
                    { clave: 'precio_promedio', titulo: 'Precio prom.', numerica: true, render: (p) => L(p.precio_promedio) },
                    { clave: 'participacion', titulo: '% venta', numerica: true, render: (p) => `${p.participacion}%` },
                    { clave: 'total', titulo: 'Total', numerica: true, render: (p) => L(p.total) },
                  ]}
                />
                <p className="rep-nota">El precio promedio ya incluye los descuentos aplicados. Útil para comparar contra el costeo.</p>
              </Seccion>
            </>
          )}

          {pestana === 'pagos' && (
            <div className="rep-dos-columnas">
              <Seccion
                titulo="Formas de pago"
                onCsv={() =>
                  descargarCsv(`formas-de-pago-${sufijo}.csv`, datos.por_forma_pago, [
                    { titulo: 'Forma', valor: (f) => f.nombre },
                    { titulo: 'Monto', valor: (f) => f.monto.toFixed(2) },
                    { titulo: 'Facturas', valor: (f) => f.facturas },
                    { titulo: 'Participación %', valor: (f) => f.participacion },
                  ])
                }
              >
                <table className="tabla rep-tabla">
                  <tbody>
                    {datos.por_forma_pago.map((f, i) => (
                      <tr key={f.nombre}>
                        <td className="rep-col-etiqueta">{f.nombre}</td>
                        <td className="rep-col-barra">
                          <Barra valor={f.participacion} maximo={100} color={`var(--serie-${(i % 4) + 1})`} />
                        </td>
                        <td className="rep-num">{f.participacion}%</td>
                        <td className="rep-num rep-tenue">{f.facturas} fact.</td>
                        <td className="rep-num">{L(f.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="rep-nota">Efectivo neto del cambio devuelto. Tarjeta incluye POS BAC y POS Ficohsa (el detalle por POS está en cada cierre de caja).</p>
              </Seccion>
              <Seccion titulo="Descuentos">
                <table className="tabla rep-tabla">
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th className="rep-num">Facturas</th>
                      <th className="rep-num">Descontado</th>
                      <th className="rep-num">Vendido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.descuentos.length === 0 && (
                      <tr>
                        <td colSpan={4} className="rep-vacio">
                          Sin descuentos en este rango.
                        </td>
                      </tr>
                    )}
                    {datos.descuentos.map((d) => (
                      <tr key={d.porcentaje}>
                        <td>{d.porcentaje === 25 ? '25% tercera edad' : d.porcentaje ? `${d.porcentaje}%` : 'Otro'}</td>
                        <td className="rep-num">{d.facturas}</td>
                        <td className="rep-num">{L(d.monto)}</td>
                        <td className="rep-num">{L(d.ventas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="rep-nota">
                  Los descuentos equivalen al {k.ventas_brutas > 0 ? Math.round((k.descuentos / k.ventas_brutas) * 1000) / 10 : 0}% de la venta bruta.
                </p>
              </Seccion>
            </div>
          )}

          {pestana === 'fiscal' && (
            <Seccion
              titulo="ISV — base para la declaración"
              onCsv={() =>
                descargarCsv(`isv-${sufijo}.csv`, [
                  { tipo: 'Fiscal (CAI real)', ...datos.isv.fiscal },
                  { tipo: 'Borrador (sin CAI)', ...datos.isv.borrador },
                ], [
                  { titulo: 'Tipo', valor: (r) => r.tipo },
                  { titulo: 'Exento', valor: (r) => r.exento.toFixed(2) },
                  { titulo: 'Exonerado', valor: (r) => r.exonerado.toFixed(2) },
                  { titulo: 'Gravado 15%', valor: (r) => r.gravado_15.toFixed(2) },
                  { titulo: 'ISV facturado', valor: (r) => r.isv.toFixed(2) },
                  { titulo: 'ISV notas de crédito', valor: (r) => r.isv_notas_credito.toFixed(2) },
                  { titulo: 'ISV neto', valor: (r) => r.isv_neto.toFixed(2) },
                  { titulo: 'Facturas', valor: (r) => r.facturas },
                  { titulo: 'Anuladas', valor: (r) => r.anuladas },
                ])
              }
            >
              <div className="rep-dos-columnas">
                <BloqueFiscal titulo="Facturas fiscales (CAI real)" r={datos.isv.fiscal} />
                <BloqueFiscal
                  titulo="Comprobantes en modo borrador"
                  r={datos.isv.borrador}
                  aviso="Emitidos sin CAI real: no son facturas fiscales. Coméntalos con el contador antes de declarar."
                />
              </div>
              <p className="rep-nota">
                Base de trabajo para el contador: no incluye compras (crédito fiscal). Las notas de crédito se cuentan en el período en que se emitieron.
              </p>
            </Seccion>
          )}

          {pestana === 'libro' && (
            <Seccion
              titulo={`Libro de ventas (${libroFiltrado.length})`}
              extra={
                <span className="rep-controles no-imprimir">
                  <label className="rep-check">
                    <input type="checkbox" checked={soloFiscal} onChange={(e) => setSoloFiscal(e.target.checked)} />
                    Sólo fiscales
                  </label>
                  <input className="rep-buscar" placeholder="Factura, cliente, RTN o cajero…" value={buscarLibro} onChange={(e) => setBuscarLibro(e.target.value)} />
                </span>
              }
              onCsv={() =>
                descargarCsv(`libro-de-ventas-${sufijo}.csv`, libroFiltrado, [
                  { titulo: 'Fecha', valor: (f) => fechaHora(f.fecha) },
                  { titulo: 'Factura', valor: (f) => f.numero_factura },
                  { titulo: 'Sucursal', valor: (f) => f.sucursal },
                  { titulo: 'Cliente', valor: (f) => f.cliente },
                  { titulo: 'RTN', valor: (f) => f.rtn },
                  { titulo: 'Exento', valor: (f) => (f.anulada ? 0 : f.exento).toFixed(2) },
                  { titulo: 'Exonerado', valor: (f) => (f.anulada ? 0 : f.exonerado).toFixed(2) },
                  { titulo: 'Gravado 15%', valor: (f) => (f.anulada ? 0 : f.gravado_15).toFixed(2) },
                  { titulo: 'ISV', valor: (f) => (f.anulada ? 0 : f.isv).toFixed(2) },
                  { titulo: 'Descuento', valor: (f) => f.descuento.toFixed(2) },
                  { titulo: 'Total', valor: (f) => (f.anulada ? 0 : f.total).toFixed(2) },
                  { titulo: 'Estado', valor: (f) => (f.anulada ? 'ANULADA' : 'Válida') },
                  { titulo: 'Tipo', valor: (f) => (f.borrador ? 'Borrador' : 'Fiscal') },
                  { titulo: 'Cajero', valor: (f) => f.cajero },
                ])
              }
            >
              <TablaOrdenable
                filas={libroFiltrado}
                limite={300}
                ordenInicial={{ clave: 'numero_factura', desc: false }}
                columnas={[
                  { clave: 'fecha', titulo: 'Fecha', render: (f) => fechaHora(f.fecha) },
                  { clave: 'numero_factura', titulo: 'Factura', render: (f) => <span className="rep-mono">{f.numero_factura}</span> },
                  { clave: 'sucursal', titulo: 'Sucursal', render: (f) => nombreCortoSucursal(f.sucursal) },
                  { clave: 'cliente', titulo: 'Cliente', render: (f) => (f.rtn ? `${f.cliente} · ${f.rtn}` : f.cliente) },
                  { clave: 'gravado_15', titulo: 'Gravado', numerica: true, render: (f) => L(f.gravado_15) },
                  { clave: 'isv', titulo: 'ISV', numerica: true, render: (f) => L(f.isv) },
                  { clave: 'total', titulo: 'Total', numerica: true, render: (f) => L(f.total) },
                  { clave: 'anulada', titulo: 'Estado', ordenar: (f) => (f.anulada ? 1 : 0), render: (f) => (f.anulada ? <span className="rep-alerta">Anulada</span> : f.borrador ? 'Borrador' : 'Válida') },
                ]}
              />
            </Seccion>
          )}

          {pestana === 'anulaciones' && (
            <>
              <Seccion
                titulo={`Facturas anuladas (${datos.anuladas.length})`}
                onCsv={() =>
                  descargarCsv(`anuladas-${sufijo}.csv`, datos.anuladas, [
                    { titulo: 'Factura', valor: (a) => a.numero_factura },
                    { titulo: 'Fecha', valor: (a) => fechaHora(a.fecha) },
                    { titulo: 'Sucursal', valor: (a) => a.sucursal },
                    { titulo: 'Cliente', valor: (a) => a.cliente },
                    { titulo: 'Cajero', valor: (a) => a.cajero },
                    { titulo: 'Total', valor: (a) => a.total.toFixed(2) },
                  ])
                }
              >
                <TablaOrdenable
                  filas={datos.anuladas.map((a) => ({ ...a, clave: a.numero_factura }))}
                  ordenInicial={{ clave: 'fecha', desc: true }}
                  vacio="Ninguna factura anulada en este rango."
                  columnas={[
                    { clave: 'numero_factura', titulo: 'Factura', render: (a) => <span className="rep-mono">{a.numero_factura}</span> },
                    { clave: 'fecha', titulo: 'Emitida', render: (a) => fechaHora(a.fecha) },
                    { clave: 'sucursal', titulo: 'Sucursal', render: (a) => nombreCortoSucursal(a.sucursal) },
                    { clave: 'cliente', titulo: 'Cliente' },
                    { clave: 'cajero', titulo: 'Cajero' },
                    { clave: 'total', titulo: 'Total', numerica: true, render: (a) => L(a.total) },
                  ]}
                />
              </Seccion>
              <Seccion
                titulo={`Notas de crédito emitidas (${datos.notas_credito.length})`}
                onCsv={() =>
                  descargarCsv(`notas-de-credito-${sufijo}.csv`, datos.notas_credito, [
                    { titulo: 'Nota', valor: (x) => x.numero_nota },
                    { titulo: 'Factura', valor: (x) => x.numero_factura },
                    { titulo: 'Fecha', valor: (x) => fechaHora(x.fecha) },
                    { titulo: 'Tipo', valor: (x) => x.tipo },
                    { titulo: 'Monto', valor: (x) => x.monto.toFixed(2) },
                    { titulo: 'Motivo', valor: (x) => x.motivo },
                    { titulo: 'Usuario', valor: (x) => x.usuario },
                  ])
                }
              >
                <TablaOrdenable
                  filas={datos.notas_credito.map((x, i) => ({ ...x, clave: `${x.numero_nota}-${i}` }))}
                  ordenInicial={{ clave: 'fecha', desc: true }}
                  vacio="Ninguna nota de crédito en este rango."
                  columnas={[
                    { clave: 'fecha', titulo: 'Fecha', render: (x) => fechaHora(x.fecha) },
                    { clave: 'numero_factura', titulo: 'Factura', render: (x) => <span className="rep-mono">{x.numero_factura}</span> },
                    { clave: 'tipo', titulo: 'Tipo' },
                    { clave: 'motivo', titulo: 'Motivo' },
                    { clave: 'usuario', titulo: 'Autorizó' },
                    { clave: 'monto', titulo: 'Monto', numerica: true, render: (x) => L(x.monto) },
                  ]}
                />
              </Seccion>
            </>
          )}
        </>
      )}

      {!datos && cargando && <div className="panel rep-vacio">Generando reporte…</div>}
    </div>
  );
}
