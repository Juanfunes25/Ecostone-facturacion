import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { colorSucursal, nombreCortoSucursal } from '../lib/coloresSucursal.js';
import { descargarCsv } from '../lib/csv.js';
import { imprimirCierre, leerConfigImpresora } from '../lib/documentos.js';
import { useCambiosEnVivo } from '../lib/tiempoReal.js';
import { calcularCuadre, estadoDiferencia, inicioDeHoyIso, inputLocalAIso, isoAInputLocal } from '../lib/cierre.js';

const ZONA = 'America/Tegucigalpa';
const VACIO = { pos_bac: '', pos_ficohsa: '', efectivo_contado: '', fondo_caja: '', salidas: '', observaciones: '' };

function L(n) {
  return `L ${Number(n ?? 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaHora(iso) {
  return new Date(iso).toLocaleString('es-HN', { timeZone: ZONA, dateStyle: 'short', timeStyle: 'short' });
}

function ChipDiferencia({ valor, grande = false }) {
  if (valor === null || valor === undefined) return <span className="chip-dif chip-dif-nd">—</span>;
  const e = estadoDiferencia(valor);
  return (
    <span className={`chip-dif chip-dif-${e.clase}${grande ? ' chip-dif-grande' : ''}`}>
      {e.texto}
      {e.clase !== 'cuadra' && ` ${L(Math.abs(valor))}`}
    </span>
  );
}

function CampoMonto({ etiqueta, valor, onChange, ayuda, autoFocus, obligatorio }) {
  return (
    <label className="cierre-campo">
      <span className="cierre-campo-etiqueta">
        {etiqueta}
        {obligatorio && <span className="cierre-obligatorio"> *</span>}
      </span>
      <span className="cierre-campo-input">
        <span className="cierre-campo-prefijo">L</span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={valor}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onWheel={(e) => e.currentTarget.blur()}
        />
      </span>
      {ayuda && <span className="cierre-campo-ayuda">{ayuda}</span>}
    </label>
  );
}

function FilaSistema({ etiqueta, valor, fuerte }) {
  return (
    <div className={`cierre-fila${fuerte ? ' cierre-fila-fuerte' : ''}`}>
      <span>{etiqueta}</span>
      <span>{L(valor)}</span>
    </div>
  );
}

export default function Cierres({ session, perfil, sucursales, sucursalId }) {
  const sucursalFija = perfil.rol === 'cajero' && perfil.sucursal_id;
  const sucursal_id = sucursalFija ? perfil.sucursal_id : sucursalId ?? perfil.sucursal_id ?? sucursales[0]?.id ?? '';
  const sucursal = sucursales.find((s) => s.id === sucursal_id);
  const color = colorSucursal(sucursal_id);

  const [desde, setDesde] = useState(null);
  const [hasta, setHasta] = useState(() => new Date().toISOString());
  const [hastaManual, setHastaManual] = useState(false);
  const [ultimo, setUltimo] = useState(null);
  const [avisoDesde, setAvisoDesde] = useState('');
  const [resumen, setResumen] = useState(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const [historial, setHistorial] = useState([]);
  const [soloEstaSucursal, setSoloEstaSucursal] = useState(true);
  const [detalle, setDetalle] = useState(null);
  const [facturasDetalle, setFacturasDetalle] = useState([]);

  const puedeVerHistorial = perfil.rol !== 'cajero';
  const set = (campo) => (valor) => setForm((f) => ({ ...f, [campo]: valor }));

  // Arranque del turno: donde terminó el último cierre de esta sucursal. Si
  // ese cierre es muy viejo (datos de prueba, sucursal que no cerraba), se
  // toma desde hoy a las 00:00 y se avisa, para no arrastrar semanas.
  const cargarInicio = useCallback(async () => {
    if (!sucursal_id) return;
    setResultado(null);
    setResumen(null);
    setForm(VACIO);
    setHastaManual(false);
    setHasta(new Date().toISOString());
    try {
      const u = await api.get(`/cierres/ultimo?sucursal_id=${sucursal_id}`, session);
      setUltimo(u);
      const ayer = new Date(inicioDeHoyIso());
      ayer.setDate(ayer.getDate() - 1);
      if (u?.fecha_fin && new Date(u.fecha_fin) >= ayer) {
        setDesde(u.fecha_fin);
        setAvisoDesde('');
      } else {
        setDesde(inicioDeHoyIso());
        setAvisoDesde(
          u?.fecha_fin
            ? `El último cierre de esta sucursal fue el ${fechaHora(u.fecha_fin)}. Se tomó desde hoy 00:00: si quedaron ventas sin cerrar, ajusta "Desde".`
            : ''
        );
      }
      if (u?.fondo_caja != null) setForm((f) => ({ ...f, fondo_caja: String(Number(u.fondo_caja)) }));
    } catch (e) {
      setError(e.message);
      setDesde(inicioDeHoyIso());
    }
  }, [sucursal_id, session]);

  useEffect(() => {
    cargarInicio();
  }, [cargarInicio]);

  const cargarResumen = useCallback(async () => {
    if (!sucursal_id || !desde || !hasta) return;
    if (new Date(hasta) <= new Date(desde)) {
      setResumen(null);
      return;
    }
    setCargandoResumen(true);
    try {
      const params = new URLSearchParams({ sucursal_id, desde, hasta });
      const r = await api.get(`/cierres/resumen?${params.toString()}`, session);
      setResumen(r);
      setError('');
      // Las salidas se sugieren de caja chica sólo si nadie las ha tocado.
      setForm((f) => (f.salidas === '' && r.salidas_sugeridas > 0 ? { ...f, salidas: String(r.salidas_sugeridas) } : f));
    } catch (e) {
      setError(e.message);
    } finally {
      setCargandoResumen(false);
    }
  }, [sucursal_id, desde, hasta, session]);

  useEffect(() => {
    const t = setTimeout(cargarResumen, 250);
    return () => clearTimeout(t);
  }, [cargarResumen]);

  // Si entra una venta mientras se cuenta, el "hasta" avanza solo (salvo
  // que lo hayan fijado a mano) y los totales del sistema se actualizan.
  useCambiosEnVivo(
    ['ventas'],
    () => {
      if (!hastaManual) setHasta(new Date().toISOString());
      else cargarResumen();
    },
    { retrasoMs: 800, activo: Boolean(sucursal_id) && !resultado }
  );

  const cargarHistorial = useCallback(async () => {
    if (!puedeVerHistorial) return;
    const filtro = soloEstaSucursal && sucursal_id ? `?sucursal_id=${sucursal_id}` : '';
    setHistorial(await api.get(`/cierres${filtro}`, session));
  }, [puedeVerHistorial, soloEstaSucursal, sucursal_id, session]);

  useEffect(() => {
    cargarHistorial().catch((e) => setError(e.message));
  }, [cargarHistorial]);

  const ciego = resumen?.ciego ?? false;
  const cuadre = useMemo(
    () => (resumen && !ciego ? calcularCuadre(resumen, form) : null),
    [resumen, ciego, form]
  );
  const faltanCampos = form.pos_bac === '' || form.pos_ficohsa === '' || form.efectivo_contado === '';
  const noCuadra =
    cuadre && !faltanCampos && (Math.abs(cuadre.diferencia_tarjeta) >= 1 || Math.abs(cuadre.diferencia_efectivo) >= 1);
  const faltaObservacion = noCuadra && !form.observaciones.trim();
  const puedeCerrar = resumen && !faltanCampos && !faltaObservacion && !guardando && !cargandoResumen;

  async function cerrar() {
    const lineas = [
      `Cerrar caja de ${nombreCortoSucursal(sucursal?.nombre ?? '')}`,
      `Del ${fechaHora(desde)} al ${fechaHora(hasta)}`,
      '',
      `POS BAC: ${L(form.pos_bac)}`,
      `POS Ficohsa: ${L(form.pos_ficohsa)}`,
      `Efectivo contado: ${L(form.efectivo_contado)}`,
    ];
    if (cuadre) {
      lineas.push('', `Tarjeta: ${estadoDiferencia(cuadre.diferencia_tarjeta).texto} ${L(Math.abs(cuadre.diferencia_tarjeta))}`);
      lineas.push(`Efectivo: ${estadoDiferencia(cuadre.diferencia_efectivo).texto} ${L(Math.abs(cuadre.diferencia_efectivo))}`);
    }
    lineas.push('', 'Un cierre no se puede editar después. ¿Confirmas?');
    if (!window.confirm(lineas.join('\n'))) return;

    setGuardando(true);
    setError('');
    try {
      const cierre = await api.post('/cierres', session, {
        sucursal_id,
        fecha_inicio: desde,
        fecha_fin: hasta,
        pos_bac: Number(form.pos_bac),
        pos_ficohsa: Number(form.pos_ficohsa),
        efectivo_contado: Number(form.efectivo_contado),
        fondo_caja: Number(form.fondo_caja || 0),
        salidas: Number(form.salidas || 0),
        observaciones: form.observaciones,
      });
      setResultado(cierre);
      cargarHistorial().catch(() => {});
      if (leerConfigImpresora().autoImprimir) {
        imprimirCierre(cierre.id, session).catch((e) => setError(`Cierre guardado, pero no se pudo imprimir: ${e.message}`));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function verDetalle(c) {
    setDetalle(c);
    setFacturasDetalle([]);
    try {
      const params = new URLSearchParams({
        estado: 'pagada',
        sucursal_id: c.sucursal_id,
        fechaInicio: c.fecha_inicio,
        fechaFin: c.fecha_fin,
      });
      setFacturasDetalle(await api.get(`/ventas?${params.toString()}`, session));
    } catch (e) {
      setError(e.message);
    }
  }

  function reimprimir(id) {
    imprimirCierre(id, session).catch((e) => setError(e.message));
  }

  function exportarHistorialCsv() {
    const num = (v) => (v === null || v === undefined ? '' : Number(v).toFixed(2));
    descargarCsv(`cierres-${new Date().toISOString().slice(0, 10)}.csv`, historial, [
      { titulo: 'Desde', valor: (c) => fechaHora(c.fecha_inicio) },
      { titulo: 'Hasta', valor: (c) => fechaHora(c.fecha_fin) },
      { titulo: 'Sucursal', valor: (c) => c.sucursales?.nombre ?? '' },
      { titulo: 'Cajero', valor: (c) => c.cajero?.nombre ?? '' },
      { titulo: 'De factura', valor: (c) => c.factura_desde ?? '' },
      { titulo: 'A factura', valor: (c) => c.factura_hasta ?? '' },
      { titulo: 'Facturas', valor: (c) => c.cantidad_facturas ?? '' },
      { titulo: 'Total ventas', valor: (c) => num(c.total_ventas) },
      { titulo: 'Tarjeta sistema', valor: (c) => num(c.tarjeta_sistema) },
      { titulo: 'POS BAC', valor: (c) => num(c.pos_bac) },
      { titulo: 'POS Ficohsa', valor: (c) => num(c.pos_ficohsa) },
      { titulo: 'Dif. tarjeta', valor: (c) => num(c.diferencia_tarjeta) },
      { titulo: 'Efectivo ventas', valor: (c) => num(c.efectivo_sistema) },
      { titulo: 'Fondo', valor: (c) => num(c.fondo_caja) },
      { titulo: 'Salidas', valor: (c) => num(c.salidas) },
      { titulo: 'Efectivo esperado', valor: (c) => num(c.total_esperado) },
      { titulo: 'Efectivo contado', valor: (c) => num(c.efectivo_contado ?? c.total_contado) },
      { titulo: 'Dif. efectivo', valor: (c) => num(c.diferencia_efectivo) },
      { titulo: 'Transferencias', valor: (c) => num(c.transferencia_sistema) },
      { titulo: 'Diferencia total', valor: (c) => num(c.diferencia) },
      { titulo: 'Observaciones', valor: (c) => c.observaciones ?? '' },
    ]);
  }

  if (!sucursal_id) {
    return <div className="panel">Elige una sucursal en la barra superior para hacer el cierre.</div>;
  }

  return (
    <div className="cierre" style={{ '--color-cierre': color }}>
      {error && <div className="error">{error}</div>}

      <div className="panel cierre-encabezado">
        <div className="cierre-titulo">
          <span className="cierre-sucursal-punto" style={{ background: color }} />
          <div>
            <h2>Cierre de caja · {nombreCortoSucursal(sucursal?.nombre ?? '')}</h2>
            <div className="cierre-subtitulo">
              {sucursalFija ? 'Tu sucursal' : 'Para cerrar otra sucursal, cámbiala en la barra superior'}
              {ultimo?.fecha_fin && ` · Último cierre: ${fechaHora(ultimo.fecha_fin)}`}
            </div>
          </div>
        </div>
        <div className="cierre-rango">
          <label>
            Desde
            <input
              type="datetime-local"
              value={desde ? isoAInputLocal(desde) : ''}
              onChange={(e) => e.target.value && setDesde(inputLocalAIso(e.target.value))}
              disabled={Boolean(resultado)}
            />
          </label>
          <label>
            Hasta
            <input
              type="datetime-local"
              value={isoAInputLocal(hasta)}
              onChange={(e) => {
                if (!e.target.value) return;
                setHasta(inputLocalAIso(e.target.value));
                setHastaManual(true);
              }}
              disabled={Boolean(resultado)}
            />
          </label>
          <button
            className="boton-sm boton-secundario"
            disabled={Boolean(resultado)}
            onClick={() => {
              setHasta(new Date().toISOString());
              setHastaManual(false);
            }}
          >
            Hasta ahora
          </button>
        </div>
        {avisoDesde && <div className="alerta">{avisoDesde}</div>}
        {resumen && (
          <div className="cierre-kpis">
            <div>
              <span>Facturas</span>
              <strong>{resumen.cantidad_facturas}</strong>
            </div>
            <div>
              <span>Rango</span>
              <strong className="cierre-kpi-rango">
                {resumen.factura_desde ? `${resumen.factura_desde.slice(-8)} → ${resumen.factura_hasta.slice(-8)}` : '—'}
              </strong>
            </div>
            {!ciego && (
              <>
                <div>
                  <span>Total ventas</span>
                  <strong>{L(resumen.total_ventas)}</strong>
                </div>
                <div>
                  <span>Anuladas</span>
                  <strong>
                    {resumen.anuladas}
                    {resumen.anuladas > 0 && <small> ({L(resumen.monto_anulado)})</small>}
                  </strong>
                </div>
              </>
            )}
            {cargandoResumen && <div className="cierre-actualizando">Actualizando…</div>}
          </div>
        )}
      </div>

      {ciego && (
        <div className="alerta">
          Cierre ciego: cuenta y anota lo que tienes. El sistema compara al guardar; el resultado lo ve tu supervisor.
        </div>
      )}

      {resultado ? (
        <div className="panel cierre-resultado">
          <h2>Cierre guardado</h2>
          {resultado.descuadre && (
            <div className="error" style={{ fontWeight: 700 }}>
              ⚠ Descuadre registrado. {resultado.alerta_enviada ? 'Se notificó a los administradores.' : ''}
            </div>
          )}
          <p className="cierre-subtitulo">
            Facturas {resultado.factura_desde ?? '—'} a {resultado.factura_hasta ?? '—'} ({resultado.cantidad_facturas ?? 0})
          </p>
          {resultado.diferencia !== undefined ? (
            <div className="cierre-resultado-grid">
              <div>
                <span>Tarjeta</span>
                <ChipDiferencia valor={resultado.diferencia_tarjeta} grande />
              </div>
              <div>
                <span>Efectivo</span>
                <ChipDiferencia valor={resultado.diferencia_efectivo} grande />
              </div>
              <div>
                <span>Total</span>
                <ChipDiferencia valor={resultado.diferencia} grande />
              </div>
            </div>
          ) : (
            <p>Tu supervisor verá el resultado del cuadre.</p>
          )}
          <div className="cierre-acciones">
            <button onClick={() => reimprimir(resultado.id)}>Imprimir cierre</button>
            <button className="boton-secundario" onClick={cargarInicio}>
              Hacer otro cierre
            </button>
          </div>
          <p className="cierre-campo-ayuda">Engrapa este ticket con los cierres de lote de los POS BAC y Ficohsa.</p>
        </div>
      ) : (
        <>
          <div className="cierre-tarjetas">
            {/* ── TARJETA ─────────────────────────────── */}
            <section className="panel cierre-bloque">
              <header>
                <h3>Tarjeta</h3>
                {cuadre && form.pos_bac !== '' && form.pos_ficohsa !== '' && <ChipDiferencia valor={cuadre.diferencia_tarjeta} />}
              </header>
              {!ciego && resumen && <FilaSistema etiqueta="Según sistema" valor={resumen.tarjeta} fuerte />}
              <CampoMonto etiqueta="Cierre POS BAC" valor={form.pos_bac} onChange={set('pos_bac')} autoFocus obligatorio />
              <CampoMonto etiqueta="Cierre POS Ficohsa" valor={form.pos_ficohsa} onChange={set('pos_ficohsa')} obligatorio />
              <FilaSistema etiqueta="Total de los dos POS" valor={Number(form.pos_bac || 0) + Number(form.pos_ficohsa || 0)} />
            </section>

            {/* ── EFECTIVO ────────────────────────────── */}
            <section className="panel cierre-bloque">
              <header>
                <h3>Efectivo</h3>
                {cuadre && form.efectivo_contado !== '' && <ChipDiferencia valor={cuadre.diferencia_efectivo} />}
              </header>
              {!ciego && resumen && <FilaSistema etiqueta="Ventas en efectivo (sin cambio)" valor={resumen.efectivo} />}
              <div className="cierre-dos">
                <CampoMonto etiqueta="Fondo de caja" valor={form.fondo_caja} onChange={set('fondo_caja')} />
                <CampoMonto
                  etiqueta="Salidas de caja"
                  valor={form.salidas}
                  onChange={set('salidas')}
                  ayuda={resumen?.salidas_sugeridas > 0 ? `Caja chica: ${L(resumen.salidas_sugeridas)}` : undefined}
                />
              </div>
              {cuadre && <FilaSistema etiqueta="Debe haber en gaveta" valor={cuadre.efectivo_esperado} fuerte />}
              <CampoMonto
                etiqueta="Efectivo contado a mano"
                valor={form.efectivo_contado}
                onChange={set('efectivo_contado')}
                ayuda="Todo lo que hay en la gaveta, incluido el fondo"
                obligatorio
              />
            </section>

            {/* ── TRANSFERENCIA ───────────────────────── */}
            {!ciego && (
              <section className="panel cierre-bloque">
                <header>
                  <h3>Transferencia</h3>
                </header>
                {resumen && <FilaSistema etiqueta="Según sistema" valor={resumen.transferencia} fuerte />}
                {resumen?.otros > 0 && <FilaSistema etiqueta="Otras formas de pago" valor={resumen.otros} />}
                <p className="cierre-campo-ayuda">Revisa que coincida con lo acreditado en la banca en línea.</p>
              </section>
            )}
          </div>

          <div className="panel cierre-pie">
            {cuadre && !faltanCampos && (
              <div className="cierre-total">
                <span>Resultado del cuadre</span>
                <ChipDiferencia valor={cuadre.diferencia_total} grande />
              </div>
            )}
            <label className="cierre-observaciones">
              <span className="cierre-campo-etiqueta">
                Observaciones{noCuadra && <span className="cierre-obligatorio"> * (obligatorio: el cierre no cuadra)</span>}
              </span>
              <textarea
                rows={2}
                value={form.observaciones}
                onChange={(e) => set('observaciones')(e.target.value)}
                placeholder="Ej. voucher de L 150 pasado dos veces en BAC, se anuló al día siguiente"
              />
            </label>
            <button className="cierre-boton" disabled={!puedeCerrar} onClick={cerrar}>
              {guardando ? 'Guardando cierre…' : 'Cerrar caja'}
            </button>
            {faltanCampos && (
              <span className="cierre-campo-ayuda">Llena POS BAC, POS Ficohsa y el efectivo contado (0 si no hubo).</span>
            )}
          </div>
        </>
      )}

      {puedeVerHistorial && (
        <div className="panel">
          <div className="cierre-historial-titulo">
            <h2>Historial de cierres</h2>
            <label className="cierre-toggle">
              <input type="checkbox" checked={soloEstaSucursal} onChange={(e) => setSoloEstaSucursal(e.target.checked)} />
              Sólo {nombreCortoSucursal(sucursal?.nombre ?? '')}
            </label>
            <button className="boton-sm boton-secundario" onClick={exportarHistorialCsv} disabled={historial.length === 0}>
              Exportar CSV
            </button>
          </div>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Cierre</th>
                  <th>Sucursal</th>
                  <th>Cajero</th>
                  <th>Facturas</th>
                  <th>Ventas</th>
                  <th>Tarjeta</th>
                  <th>Efectivo</th>
                  <th>Transf.</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ color: 'var(--text-dim)' }}>
                      Sin cierres todavía.
                    </td>
                  </tr>
                )}
                {historial.map((c) => (
                  <tr key={c.id}>
                    <td>{fechaHora(c.fecha_fin)}</td>
                    <td>
                      <span className="leyenda-punto" style={{ background: colorSucursal(c.sucursal_id), display: 'inline-block', marginRight: 6 }} />
                      {nombreCortoSucursal(c.sucursales?.nombre ?? '')}
                    </td>
                    <td>{c.cajero?.nombre ?? '—'}</td>
                    <td>{c.cantidad_facturas ?? '—'}</td>
                    <td>{c.total_ventas != null ? L(c.total_ventas) : '—'}</td>
                    <td>
                      <ChipDiferencia valor={c.diferencia_tarjeta} />
                    </td>
                    <td>
                      <ChipDiferencia valor={c.diferencia_efectivo} />
                    </td>
                    <td>{c.transferencia_sistema != null ? L(c.transferencia_sistema) : '—'}</td>
                    <td>
                      <ChipDiferencia valor={c.diferencia} />
                    </td>
                    <td className="cierre-historial-acciones">
                      <button className="boton-sm boton-secundario" onClick={() => verDetalle(c)}>
                        Ver
                      </button>
                      <button className="boton-sm boton-secundario" onClick={() => reimprimir(c.id)}>
                        Imprimir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detalle && (
        <div className="overlay" onClick={() => setDetalle(null)}>
          <div className="tarjeta cierre-detalle" onClick={(e) => e.stopPropagation()}>
            <h2>Cierre · {nombreCortoSucursal(detalle.sucursales?.nombre ?? '')}</h2>
            <p className="cierre-subtitulo">
              {fechaHora(detalle.fecha_inicio)} → {fechaHora(detalle.fecha_fin)} · {detalle.cajero?.nombre ?? ''}
            </p>
            {detalle.tarjeta_sistema != null ? (
              <table className="tabla cierre-detalle-tabla">
                <thead>
                  <tr>
                    <th></th>
                    <th>Sistema</th>
                    <th>Reportado</th>
                    <th>Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      Tarjeta
                      <div className="cierre-campo-ayuda">
                        BAC {L(detalle.pos_bac)} · Ficohsa {L(detalle.pos_ficohsa)}
                      </div>
                    </td>
                    <td>{L(detalle.tarjeta_sistema)}</td>
                    <td>{L(Number(detalle.pos_bac ?? 0) + Number(detalle.pos_ficohsa ?? 0))}</td>
                    <td>
                      <ChipDiferencia valor={detalle.diferencia_tarjeta} />
                    </td>
                  </tr>
                  <tr>
                    <td>
                      Efectivo
                      <div className="cierre-campo-ayuda">
                        Fondo {L(detalle.fondo_caja)} + ventas {L(detalle.efectivo_sistema)} − salidas {L(detalle.salidas)}
                      </div>
                    </td>
                    <td>{L(detalle.total_esperado)}</td>
                    <td>{L(detalle.efectivo_contado)}</td>
                    <td>
                      <ChipDiferencia valor={detalle.diferencia_efectivo} />
                    </td>
                  </tr>
                  <tr>
                    <td>Transferencia</td>
                    <td>{L(detalle.transferencia_sistema)}</td>
                    <td>—</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="cierre-campo-ayuda">
                Cierre del formato anterior: esperado {L(detalle.total_esperado)}, contado {L(detalle.total_contado)}, diferencia{' '}
                {L(detalle.diferencia)}.
              </p>
            )}
            {detalle.observaciones && (
              <p>
                <strong>Observaciones:</strong> {detalle.observaciones}
              </p>
            )}
            <h3>Facturas ({facturasDetalle.length})</h3>
            <div className="cierre-detalle-facturas">
              {facturasDetalle.map((f) => (
                <div key={f.id} className="pos-orden-linea" style={f.anulada ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                  <span>
                    {f.numero_factura} · {f.clientes?.nombre ?? 'Consumidor Final'}
                  </span>
                  <span>{L(f.total)}</span>
                </div>
              ))}
            </div>
            <div className="cierre-acciones">
              <button onClick={() => reimprimir(detalle.id)}>Imprimir</button>
              <button className="boton-secundario" onClick={() => setDetalle(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
