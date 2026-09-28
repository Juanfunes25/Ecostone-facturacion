import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { nombreCortoSucursal } from '../lib/coloresSucursal.js';
import { descargarCsv } from '../lib/csv.js';
import { hoyHn, sumarDias } from '../lib/rangosFecha.js';
import { useCambiosEnVivo } from '../lib/tiempoReal.js';

const ZONA = 'America/Tegucigalpa';
const fechaHora = (iso) => new Date(iso).toLocaleString('es-HN', { timeZone: ZONA, dateStyle: 'short', timeStyle: 'short' });
const hora = (iso) => new Date(iso).toLocaleTimeString('es-HN', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const L = (n) => `L ${Number(n ?? 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PESTANAS = [
  { id: 'alertas', etiqueta: 'Alertas' },
  { id: 'cajeros', etiqueta: 'Señales por cajero' },
  { id: 'linea', etiqueta: 'Línea de tiempo' },
  { id: 'arqueo', etiqueta: 'Arqueo sorpresa' },
  { id: 'reglas', etiqueta: 'Reglas' },
];

const ESTADOS = {
  pendiente: 'Pendiente',
  investigando: 'Investigando',
  resuelta: 'Resuelta',
  falso_positivo: 'Falso positivo',
};

const ETIQUETA_TIPO = {
  'cierre.descuadre': 'Descuadre de caja',
  'cierre.patron_desvio': 'Patrón de desvío',
  'cierre.reincidencia': 'Faltantes repetidos',
  'cierre.sin_imprimir': 'Facturas sin imprimir',
  'venta.anular': 'Factura anulada',
  'venta.nota_credito': 'Nota de crédito',
  'venta.descartar_orden': 'Orden descartada',
  'venta.doble_factura': 'Posible doble factura',
  'venta.reimpresion_repetida': 'Reimpresiones repetidas',
  'orden.estacionada': 'Orden estacionada',
  'tercera_edad.carne_repetido': 'Carné repetido',
  'tercera_edad.exceso': 'Exceso de 3ª edad',
  'acceso.denegado': 'Acceso sin permiso',
  'horario.fuera': 'Fuera de horario',
  'sesion.dispositivo_nuevo': 'Dispositivo nuevo',
  'sesion.simultanea': 'Sesión simultánea',
  'sesion.login_fallido': 'Intentos de entrada fallidos',
  'producto.baja_precio': 'Baja de precio',
  'usuario.crear': 'Usuario nuevo',
  'usuario.permisos': 'Cambio de permisos',
  'usuario.contrasena': 'Cambio de contraseña',
  'cai.cambio': 'Cambio fiscal (CAI)',
  'arqueo.descuadre': 'Arqueo con diferencia',
  'bitacora.alterada': 'Bitácora alterada',
};

const ETIQUETA_EVENTO = {
  'venta.descartar_orden': 'Descartó una orden',
  'orden.quitar_producto': 'Quitó producto de una orden',
  'orden.descuento': 'Aplicó descuento',
  'venta.reimprimir_ticket': 'Reimprimió factura',
  'venta.imprimir_ticket': 'Imprimió factura',
  'venta.facturar': 'Emitió factura',
  'venta.crear_orden': 'Abrió orden',
  'venta.editar_orden': 'Modificó orden',
  'acceso.denegado': 'Intentó entrar sin permiso',
  'sesion.inicio': 'Inició sesión',
  'sesion.fin': 'Cerró sesión',
  'sesion.bloqueo': 'Pantalla bloqueada por inactividad',
  'sesion.desbloqueo': 'Desbloqueó la pantalla',
  'sesion.desbloqueo_fallido': 'Contraseña incorrecta al desbloquear',
  'sesion.dispositivo_nuevo': 'Entró desde un dispositivo nuevo',
  'pantalla.ver': 'Abrió pantalla',
  'factura.buscar': 'Buscó facturas',
  'factura.ver': 'Vio una factura',
  'cierre.crear': 'Cerró caja',
  'cierre.imprimir': 'Imprimió cierre',
  'reporte.generar': 'Generó reporte',
};

const SENSIBLES = new Set(['venta.descartar_orden', 'orden.quitar_producto', 'venta.reimprimir_ticket', 'acceso.denegado', 'orden.descuento', 'sesion.desbloqueo_fallido']);

function resumenEvento(e) {
  const d = e.detalle ?? {};
  switch (e.accion) {
    case 'orden.quitar_producto':
      return `${d.cantidad ?? 1} × ${d.producto ?? ''} (${L(d.monto)})`;
    case 'orden.descuento':
      return `${d.porcentaje}% a ${d.cantidad} × ${d.producto}`;
    case 'venta.descartar_orden':
      return `${L(d.total)} · ${d.motivo ?? 'sin motivo'} · ${(d.items ?? []).join(', ')}`;
    case 'acceso.denegado':
      return `${d.metodo ?? ''} ${d.ruta ?? ''}${d.motivo ? ` (${d.motivo})` : ''}`;
    case 'venta.reimprimir_ticket':
      return `${d.numero_factura ?? ''} · copia #${d.reimpresion_no ?? ''} · ${d.motivo ?? ''}`;
    case 'venta.imprimir_ticket':
    case 'venta.facturar':
      return `${d.numero_factura ?? ''} · ${L(d.total)}${d.pagos ? ` · ${d.pagos.map((p) => p.forma).join(' + ')}` : ''}`;
    case 'venta.editar_orden':
      return `L ${d.total_anterior} → L ${d.total_nuevo}`;
    case 'pantalla.ver':
      return d.pantalla ?? '';
    case 'factura.buscar':
      return d.q ? `"${d.q}"` : `${d.desde ?? ''} a ${d.hasta ?? ''}`;
    case 'factura.ver':
      return `${d.factura ?? ''} · ${L(d.total)}`;
    default:
      return '';
  }
}

function Alerta({ a, onEstado }) {
  const [abierta, setAbierta] = useState(false);
  const detalle = Object.entries(a.detalle ?? {}).filter(([, v]) => v !== null && typeof v !== 'object');
  const cerrada = a.estado === 'resuelta' || a.estado === 'falso_positivo';
  return (
    <div className={`af-alerta af-${a.severidad}${cerrada ? ' af-revisada' : ''}`}>
      <div className="af-alerta-fila" onClick={() => setAbierta(!abierta)}>
        <span className={`af-sev af-sev-${a.severidad}`}>{a.severidad}</span>
        <div className="af-alerta-texto">
          <strong>{a.titulo}</strong>
          <span>
            {ETIQUETA_TIPO[a.tipo] ?? a.tipo} · {nombreCortoSucursal(a.sucursales?.nombre ?? '') || 'General'} · {a.usuario_nombre ?? 'Sistema'} ·{' '}
            {fechaHora(a.created_at)}
          </span>
        </div>
        <select
          className={`af-estado af-estado-${a.estado}`}
          value={a.estado ?? 'pendiente'}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onEstado(a, e.target.value)}
        >
          {Object.entries(ESTADOS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {abierta && (
        <div className="af-alerta-detalle">
          {detalle.map(([k, v]) => (
            <div key={k}>
              <span>{k.replace(/_/g, ' ')}</span>
              <strong>{String(v)}</strong>
            </div>
          ))}
          {a.nota_revision && (
            <div>
              <span>nota de seguimiento</span>
              <strong>{a.nota_revision}</strong>
            </div>
          )}
          {a.revisor?.nombre && (
            <div>
              <span>última revisión</span>
              <strong>
                {a.revisor.nombre} · {a.revisada_at ? fechaHora(a.revisada_at) : ''}
              </strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({ semanas }) {
  const max = Math.max(1, ...semanas);
  return (
    <span className="af-mini" title={`Últimas 4 semanas: ${semanas.join(' · ')}`}>
      {semanas.map((v, i) => (
        <span key={i} style={{ height: `${Math.max(8, (v / max) * 100)}%`, opacity: v ? 1 : 0.25 }} />
      ))}
    </span>
  );
}

// ── Pestaña: línea de tiempo ─────────────────────────────────────────────
function LineaTiempo({ session }) {
  const [usuarios, setUsuarios] = useState([]);
  const [usuarioId, setUsuarioId] = useState('');
  const [fecha, setFecha] = useState(hoyHn());
  const [datos, setDatos] = useState(null);
  const [soloSensibles, setSoloSensibles] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/antifraude/usuarios', session).then(setUsuarios).catch((e) => setError(e.message));
  }, [session]);

  async function cargar() {
    if (!usuarioId) return;
    setError('');
    try {
      setDatos(await api.get(`/antifraude/linea-tiempo?usuario_id=${usuarioId}&fecha=${fecha}`, session));
    } catch (e) {
      setError(e.message);
    }
  }

  const nombre = usuarios.find((u) => u.id === usuarioId)?.nombre ?? '';
  const items = (datos?.items ?? []).filter((i) => !soloSensibles || SENSIBLES.has(i.accion));

  function exportar() {
    descargarCsv(`expediente-${nombre.replace(/\s+/g, '-')}-${fecha}.csv`, datos.items, [
      { titulo: 'Hora', valor: (i) => hora(i.momento) },
      { titulo: 'Acción', valor: (i) => ETIQUETA_EVENTO[i.accion] ?? i.accion },
      { titulo: 'Detalle', valor: (i) => resumenEvento(i) || JSON.stringify(i.detalle ?? {}) },
      { titulo: 'Sucursal', valor: (i) => i.sucursal ?? '' },
      { titulo: 'IP', valor: (i) => i.ip ?? '' },
    ]);
  }

  return (
    <div className="panel">
      <h2>Línea de tiempo del turno</h2>
      <p className="af-intro">
        Todo lo que hizo una persona en un día, minuto a minuto: facturas, productos quitados, descuentos, reimpresiones,
        pantallas abiertas. Sirve para reconstruir un turno y cruzarlo con las cámaras. Se exporta como expediente.
      </p>
      {error && <div className="error">{error}</div>}
      <div className="toolbar">
        <select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
          <option value="">Elige a la persona…</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre} ({u.rol})
            </option>
          ))}
        </select>
        <input type="date" value={fecha} max={hoyHn()} onChange={(e) => setFecha(e.target.value)} />
        <button className="boton-sm" onClick={cargar} disabled={!usuarioId}>
          Ver turno
        </button>
        {datos && (
          <>
            <label className="rep-check">
              <input type="checkbox" checked={soloSensibles} onChange={(e) => setSoloSensibles(e.target.checked)} />
              Sólo movimientos sensibles
            </label>
            <button className="boton-sm boton-secundario" onClick={exportar}>
              Exportar expediente (CSV)
            </button>
          </>
        )}
      </div>
      {datos && (
        <>
          <div className="af-resumen-turno">
            <div>
              <span>Facturas</span>
              <strong>{datos.resumen.facturas}</strong>
            </div>
            <div>
              <span>Vendido</span>
              <strong>{L(datos.resumen.total)}</strong>
            </div>
            <div>
              <span>Sin imprimir</span>
              <strong className={datos.resumen.sin_imprimir ? 'rep-alerta' : ''}>{datos.resumen.sin_imprimir}</strong>
            </div>
            <div>
              <span>Reimpresiones</span>
              <strong>{datos.resumen.reimpresiones}</strong>
            </div>
            <div>
              <span>3ª edad</span>
              <strong>{datos.resumen.tercera_edad}</strong>
            </div>
            <div>
              <span>Primer / último movimiento</span>
              <strong>
                {datos.resumen.primer_movimiento ? hora(datos.resumen.primer_movimiento) : '—'} –{' '}
                {datos.resumen.ultimo_movimiento ? hora(datos.resumen.ultimo_movimiento) : '—'}
              </strong>
            </div>
          </div>
          <ol className="af-linea">
            {items.length === 0 && <li className="rep-vacio">Sin movimientos ese día.</li>}
            {items.map((i, idx) => (
              <li key={idx} className={SENSIBLES.has(i.accion) ? 'af-linea-sensible' : ''}>
                <span className="af-linea-hora">{hora(i.momento)}</span>
                <span className="af-linea-punto" />
                <span>
                  <strong>{ETIQUETA_EVENTO[i.accion] ?? i.accion}</strong>
                  {resumenEvento(i) && <span className="rep-tenue"> · {resumenEvento(i)}</span>}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

// ── Pestaña: arqueo sorpresa ─────────────────────────────────────────────
function ArqueoSorpresa({ session, sucursales }) {
  const [sucursalId, setSucursalId] = useState('');
  const [contado, setContado] = useState('');
  const [fondo, setFondo] = useState('');
  const [nota, setNota] = useState('');
  const [resultado, setResultado] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => api.get('/antifraude/arqueos', session).then(setHistorial).catch((e) => setError(e.message)), [session]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function registrar() {
    if (!window.confirm('¿Registrar el arqueo? El sistema compara lo contado contra lo que debería haber en este momento.')) return;
    setGuardando(true);
    setError('');
    try {
      const r = await api.post('/antifraude/arqueos', session, { sucursal_id: sucursalId, contado: Number(contado), fondo_caja: fondo, nota });
      setResultado(r);
      setContado('');
      setNota('');
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="panel">
        <h2>Arqueo sorpresa</h2>
        <p className="af-intro">
          Llega a la sucursal sin avisar, cuenta el efectivo de la gaveta y regístralo aquí. El sistema NO muestra antes cuánto
          debería haber: primero se cuenta, después compara contra fondo + ventas en efectivo − salidas desde el último cierre.
        </p>
        {error && <div className="error">{error}</div>}
        <div className="toolbar">
          <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
            <option value="">Sucursal…</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {nombreCortoSucursal(s.nombre)}
              </option>
            ))}
          </select>
          <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Efectivo contado (L)" value={contado} onChange={(e) => setContado(e.target.value)} />
          <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="Fondo (vacío = el del último cierre)" value={fondo} onChange={(e) => setFondo(e.target.value)} />
          <input placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          <button className="boton-sm" disabled={!sucursalId || contado === '' || guardando} onClick={registrar}>
            {guardando ? 'Registrando…' : 'Registrar arqueo'}
          </button>
        </div>
        {resultado && (
          <div className={Math.abs(resultado.diferencia) < 1 ? 'aviso-ok' : 'error'} style={{ fontWeight: 600 }}>
            {Math.abs(resultado.diferencia) < 1
              ? `Cuadra. Esperado ${L(resultado.esperado)}, contado ${L(resultado.contado)}.`
              : `${resultado.diferencia < 0 ? 'Faltan' : 'Sobran'} ${L(Math.abs(resultado.diferencia))}. Esperado ${L(resultado.esperado)}, contado ${L(resultado.contado)}. Se generó una alerta.`}
          </div>
        )}
      </div>
      <div className="panel">
        <h2>Arqueos anteriores</h2>
        <div className="tabla-scroll">
          <table className="tabla rep-tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Sucursal</th>
                <th>Contó</th>
                <th>En turno</th>
                <th className="rep-num">Esperado</th>
                <th className="rep-num">Contado</th>
                <th className="rep-num">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {historial.length === 0 && (
                <tr>
                  <td colSpan={7} className="rep-vacio">
                    Todavía no hay arqueos.
                  </td>
                </tr>
              )}
              {historial.map((a) => (
                <tr key={a.id}>
                  <td>{fechaHora(a.created_at)}</td>
                  <td>{nombreCortoSucursal(a.sucursales?.nombre ?? '')}</td>
                  <td>{a.usuario?.nombre ?? ''}</td>
                  <td>{a.cajeros_turno ?? '—'}</td>
                  <td className="rep-num">{L(a.esperado)}</td>
                  <td className="rep-num">{L(a.contado)}</td>
                  <td className="rep-num">
                    <strong className={Number(a.diferencia) <= -1 ? 'rep-alerta' : ''}>{L(a.diferencia)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Pestaña: reglas ──────────────────────────────────────────────────────
const CAMPOS_REGLAS = [
  { grupo: 'Descuentos', campos: [
    ['exigir_carne_tercera_edad', 'Exigir nombre y No. de identidad para el 25% de tercera edad', 'bool'],
    ['max_usos_carne_dia', 'Veces que un mismo carné puede usarse al día antes de alertar'],
    ['max_tercera_edad_dia', 'Facturas con 3ª edad por cajero al día antes de alertar'],
  ] },
  { grupo: 'Órdenes e impresión', campos: [
    ['exigir_motivo_descarte', 'Pedir motivo para descartar una orden', 'bool'],
    ['monto_alerta_descarte', 'Monto (L) de orden descartada que genera alerta'],
    ['minutos_orden_estacionada', 'Minutos de una orden abierta sin cobrar antes de alertar'],
    ['minutos_doble_factura', 'Ventana (min) para detectar doble factura'],
    ['exigir_motivo_reimpresion', 'Pedir motivo para reimprimir una factura', 'bool'],
    ['leyenda_factura_gratis', 'Imprimir "Si no recibe su factura, su compra es GRATIS" en el ticket', 'bool'],
  ] },
  { grupo: 'Caja', campos: [
    ['umbral_sobrante', 'Sobrante (L) que se considera relevante'],
    ['faltantes_reincidencia', 'Cierres con faltante en 7 días para alerta de reincidencia'],
    ['minutos_hueco', 'Minutos sin facturar que cuentan como hueco'],
  ] },
  { grupo: 'Sesiones', campos: [
    ['minutos_bloqueo_cajero', 'Bloquear pantalla del cajero tras (min) sin uso'],
    ['minutos_bloqueo_otros', 'Bloquear pantalla de admin/manager tras (min) sin uso'],
    ['intentos_login', 'Intentos fallidos de entrada (15 min) antes de alertar'],
    ['hora_apertura', 'Hora desde la que el uso es normal (0-23)'],
    ['hora_cierre', 'Hora hasta la que el uso es normal (1-24)'],
  ] },
];

function Reglas({ session }) {
  const [reglas, setReglas] = useState(null);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/antifraude/reglas', session).then(setReglas).catch((e) => setError(e.message));
  }, [session]);

  async function guardar() {
    setError('');
    try {
      setReglas(await api.put('/antifraude/reglas', session, reglas));
      setAviso('Reglas guardadas. Aplican de inmediato en todas las sucursales.');
      setTimeout(() => setAviso(''), 4000);
    } catch (e) {
      setError(e.message);
    }
  }

  if (!reglas) return <div className="panel rep-vacio">Cargando reglas…</div>;
  return (
    <div className="panel">
      <h2>Reglas y umbrales</h2>
      <p className="af-intro">Ajusta qué tan estricto es el sistema. Cada cambio queda en la bitácora.</p>
      {error && <div className="error">{error}</div>}
      {aviso && <div className="aviso-ok">{aviso}</div>}
      <div className="af-reglas">
        {CAMPOS_REGLAS.map((g) => (
          <fieldset key={g.grupo}>
            <legend>{g.grupo}</legend>
            {g.campos.map(([clave, etiqueta, tipo]) =>
              tipo === 'bool' ? (
                <label key={clave} className="af-regla af-regla-bool">
                  <input type="checkbox" checked={Boolean(reglas[clave])} onChange={(e) => setReglas({ ...reglas, [clave]: e.target.checked })} />
                  <span>{etiqueta}</span>
                </label>
              ) : (
                <label key={clave} className="af-regla">
                  <span>{etiqueta}</span>
                  <input type="number" min="0" value={reglas[clave]} onChange={(e) => setReglas({ ...reglas, [clave]: e.target.value })} />
                </label>
              )
            )}
          </fieldset>
        ))}
      </div>
      <button className="boton-sm" onClick={guardar} style={{ marginTop: 12 }}>
        Guardar reglas
      </button>
    </div>
  );
}

// ── Pantalla principal ───────────────────────────────────────────────────
export default function Antifraude({ session, sucursales }) {
  const [pestana, setPestana] = useState('alertas');
  const [filtros, setFiltros] = useState(() => ({ desde: sumarDias(hoyHn(), -6), hasta: hoyHn(), sucursal_id: '' }));
  const [alertas, setAlertas] = useState([]);
  const [filtroEstado, setFiltroEstado] = useState('abiertas');
  const [datos, setDatos] = useState(null);
  const [tendencia, setTendencia] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [correo, setCorreo] = useState(null);

  useEffect(() => {
    api.get('/antifraude/correo', session).then(setCorreo).catch(() => {});
    api.get('/antifraude/tendencia', session).then(setTendencia).catch(() => {});
  }, [session]);

  const cargarAlertas = useCallback(async () => {
    const params = new URLSearchParams();
    if (filtroEstado === 'abiertas') params.set('solo_pendientes', '1');
    else if (filtroEstado !== 'todas') params.set('estado', filtroEstado);
    if (filtros.sucursal_id) params.set('sucursal_id', filtros.sucursal_id);
    setAlertas(await api.get(`/antifraude/alertas?${params.toString()}`, session));
  }, [session, filtroEstado, filtros.sucursal_id]);

  const cargarIndicadores = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const params = new URLSearchParams({ desde: filtros.desde, hasta: filtros.hasta });
      if (filtros.sucursal_id) params.set('sucursal_id', filtros.sucursal_id);
      setDatos(await api.get(`/antifraude/indicadores?${params.toString()}`, session));
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [session, filtros]);

  useEffect(() => {
    cargarAlertas().catch((e) => setError(e.message));
  }, [cargarAlertas]);

  useEffect(() => {
    cargarIndicadores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useCambiosEnVivo(['ventas', 'cierres_caja'], () => cargarAlertas().catch(() => {}), { retrasoMs: 2500 });

  async function cambiarEstado(a, estado) {
    let nota = '';
    if (estado !== 'investigando') {
      const r = window.prompt(`${ESTADOS[estado]}: ${a.titulo}\n\n¿Qué encontraste / qué se hizo? (opcional)`, '');
      if (r === null) return;
      nota = r;
    }
    try {
      await api.put(`/antifraude/alertas/${a.id}/estado`, session, { estado, nota });
      cargarAlertas();
    } catch (e) {
      setError(e.message);
    }
  }

  const abiertas = alertas.filter((a) => a.estado === 'pendiente' || a.estado === 'investigando').length;
  const tendenciaPor = new Map(tendencia.map((t) => [t.usuario_id, t]));

  return (
    <div className="antifraude">
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <h2>Antifraude</h2>
        <p className="af-intro">
          Todo lo que se hace en el sistema queda en la bitácora inalterable. Aquí se resume lo que merece revisión y se
          investiga cada caso hasta cerrarlo.
        </p>
        {correo && !correo.configurado && (
          <div className="alerta">
            El envío de correos no está configurado en el servidor: las alertas se ven aquí pero no llegan por correo. Hay que
            agregar GMAIL_USER y GMAIL_APP_PASSWORD en Render.
          </div>
        )}
        {correo?.configurado && <p className="af-intro">Las alertas graves llegan por correo a: {correo.destinatarios.join(', ')}</p>}
        <div className="toolbar">
          <select value={filtros.sucursal_id} onChange={(e) => setFiltros({ ...filtros, sucursal_id: e.target.value })}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {nombreCortoSucursal(s.nombre)}
              </option>
            ))}
          </select>
          <input type="date" value={filtros.desde} max={hoyHn()} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
          <input type="date" value={filtros.hasta} max={hoyHn()} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
          <button
            className="boton-sm"
            onClick={() => {
              cargarIndicadores();
              cargarAlertas();
            }}
            disabled={cargando}
          >
            {cargando ? 'Analizando…' : 'Analizar'}
          </button>
        </div>
      </div>

      <div className="rep-pestanas" role="tablist">
        {PESTANAS.map((p) => (
          <button key={p.id} role="tab" aria-selected={pestana === p.id} className={pestana === p.id ? 'activa' : ''} onClick={() => setPestana(p.id)}>
            {p.etiqueta}
            {p.id === 'alertas' && abiertas > 0 && <span className="rep-contador">{abiertas}</span>}
          </button>
        ))}
      </div>

      {pestana === 'alertas' && (
        <div className="panel">
          <div className="af-titulo">
            <h2>Alertas</h2>
            <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} style={{ width: 'auto' }}>
              <option value="abiertas">Abiertas (pendientes e investigando)</option>
              <option value="pendiente">Pendientes</option>
              <option value="investigando">Investigando</option>
              <option value="resuelta">Resueltas</option>
              <option value="falso_positivo">Falsos positivos</option>
              <option value="todas">Todas</option>
            </select>
          </div>
          {alertas.length === 0 && <p className="rep-vacio">Sin alertas en esta vista. 👌</p>}
          {alertas.map((a) => (
            <Alerta key={a.id} a={a} onEstado={cambiarEstado} />
          ))}
        </div>
      )}

      {pestana === 'cajeros' && datos && (
        <>
          <div className="panel">
            <h2>Señales por cajero</h2>
            <p className="af-intro">
              Cada cajero se compara con el promedio del grupo en el período. La mini-gráfica muestra sus alertas de las últimas
              4 semanas. Una señal no prueba un robo: indica dónde mirar primero.
            </p>
            <div className="tabla-scroll">
              <table className="tabla af-tabla">
                <thead>
                  <tr>
                    <th>Cajero</th>
                    <th>4 sem.</th>
                    <th className="rep-num">Facturas</th>
                    <th className="rep-num">Vendido</th>
                    <th className="rep-num">% efect.</th>
                    <th className="rep-num">% c/desc.</th>
                    <th className="rep-num">3ª edad</th>
                    <th className="rep-num">Anuladas</th>
                    <th className="rep-num">Descartadas</th>
                    <th className="rep-num">Quitados</th>
                    <th className="rep-num">Reimpr.</th>
                    <th className="rep-num">Sin imprimir</th>
                    <th className="rep-num">Faltantes</th>
                    <th className="rep-num">Sin permiso</th>
                    <th>Señales</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.cajeros.length === 0 && (
                    <tr>
                      <td colSpan={15} className="rep-vacio">
                        Sin actividad en el rango.
                      </td>
                    </tr>
                  )}
                  {datos.cajeros.map((c) => (
                    <tr key={c.cajero_id} className={c.riesgo >= 5 ? 'af-fila-alta' : c.riesgo >= 2 ? 'af-fila-media' : ''}>
                      <td>
                        <strong>{c.nombre}</strong>
                      </td>
                      <td>{tendenciaPor.get(c.cajero_id) ? <Mini semanas={tendenciaPor.get(c.cajero_id).semanas} /> : <span className="af-ok">—</span>}</td>
                      <td className="rep-num">{c.facturas}</td>
                      <td className="rep-num">{L(c.total)}</td>
                      <td className="rep-num">{c.pct_efectivo}%</td>
                      <td className="rep-num">{c.pct_descuento}%</td>
                      <td className="rep-num">{c.desc_25}</td>
                      <td className="rep-num">{c.anuladas}</td>
                      <td className="rep-num" title={L(c.monto_descartado)}>
                        {c.descartadas}
                      </td>
                      <td className="rep-num" title={L(c.monto_quitado)}>
                        {c.quitados}
                      </td>
                      <td className="rep-num">{c.reimpresiones}</td>
                      <td className="rep-num">{c.no_impresas}</td>
                      <td className="rep-num" title={L(c.monto_faltante)}>
                        {c.faltantes}
                      </td>
                      <td className="rep-num">{c.accesos_denegados}</td>
                      <td>
                        <div className="af-senales">
                          {c.senales.length === 0 && <span className="af-ok">Sin señales</span>}
                          {c.senales.map((s) => (
                            <span key={s.texto} className={`af-senal af-senal-${s.nivel}`}>
                              {s.texto}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rep-dos-columnas">
            <div className="panel">
              <h2>Huecos sin facturar</h2>
              <p className="af-intro">Ratos largos sin una sola factura con la tienda abierta. Si hubo clientes en cámara, hubo ventas sin facturar.</p>
              <table className="tabla rep-tabla">
                <thead>
                  <tr>
                    <th>Sucursal</th>
                    <th>Día</th>
                    <th>Entre</th>
                    <th className="rep-num">Minutos</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.huecos.length === 0 && (
                    <tr>
                      <td colSpan={4} className="rep-vacio">
                        Sin huecos largos.
                      </td>
                    </tr>
                  )}
                  {datos.huecos.map((h, i) => (
                    <tr key={i}>
                      <td>{nombreCortoSucursal(h.sucursal)}</td>
                      <td>{h.fecha}</td>
                      <td>
                        {h.desde} – {h.hasta}
                      </td>
                      <td className="rep-num">
                        <strong className={h.minutos >= 90 ? 'rep-alerta' : ''}>{h.minutos}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <h2>Movimientos sensibles recientes</h2>
              <div className="af-feed">
                {datos.recientes.length === 0 && <p className="rep-vacio">Nada que reportar.</p>}
                {datos.recientes.map((e) => (
                  <div key={e.id} className="af-evento">
                    <span className="af-evento-hora">{fechaHora(e.created_at)}</span>
                    <span>
                      <strong>{e.usuario_nombre}</strong> · {ETIQUETA_EVENTO[e.accion] ?? e.accion}
                      <br />
                      <span className="rep-tenue">{resumenEvento(e)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {pestana === 'linea' && <LineaTiempo session={session} />}
      {pestana === 'arqueo' && <ArqueoSorpresa session={session} sucursales={sucursales} />}
      {pestana === 'reglas' && <Reglas session={session} />}
    </div>
  );
}
