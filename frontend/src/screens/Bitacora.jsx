import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { colorSucursal } from '../lib/coloresSucursal.js';
import { descargarCsv } from '../lib/csv.js';

const ACCIONES = {
  'venta.crear_orden': 'Creó orden',
  'venta.editar_orden': 'Editó orden',
  'venta.descartar_orden': 'Descartó orden',
  'venta.facturar': 'Emitió factura',
  'venta.imprimir_ticket': 'Imprimió ticket',
  'venta.reimprimir_ticket': 'Reimprimió ticket',
  'venta.ver_pdf': 'Abrió PDF',
  'venta.reenviar_correo': 'Reenvió correo',
  'venta.anular': 'Anuló factura',
  'venta.nota_credito_parcial': 'Nota de crédito parcial',
  'cotizacion.convertir_factura': 'Facturó cotización',
  'cotizacion.aceptada': 'Aceptó y agendó cotización',
  'cotizacion.cambio_estado': 'Cambió estado de cotización',
  'evento.seguimiento': 'Seguimiento de evento',
  'evento.reprogramado': 'Reprogramó evento',
  'producto.crear': 'Creó producto',
  'producto.editar': 'Editó producto',
  'producto.desactivar': 'Desactivó producto',
  'usuario.crear': 'Creó usuario',
  'usuario.editar': 'Editó usuario',
  'usuario.cambiar_contrasena': 'Cambió contraseña',
  'cai.editar': 'Modificó CAI/correlativo',
  'cai.activar': 'Activó CAI real (SAR)',
  'cierre.crear': 'Cerró caja',
  'sucursal.editar': 'Editó sucursal',
  'sesion.inicio': 'Inició sesión',
  'sesion.fin': 'Cerró sesión',
  'pantalla.ver': 'Abrió pantalla',
  'orden.quitar_producto': 'Quitó producto de orden',
  'orden.descuento': 'Aplicó descuento',
  'factura.buscar': 'Buscó facturas',
  'factura.ver': 'Vio detalle de factura',
  'reporte.generar': 'Generó reporte',
  'acceso.denegado': 'Intentó entrar sin permiso',
  'cierre.imprimir': 'Imprimió cierre',
  'alerta.revisar': 'Revisó alerta',
  'venta.error_pagos': 'Error al guardar pagos',
  'sesion.dispositivo_nuevo': 'Entró desde un dispositivo nuevo',
  'sesion.login_fallido': 'Intento de entrada fallido',
  'sesion.bloqueo': 'Pantalla bloqueada (inactividad)',
  'sesion.desbloqueo': 'Desbloqueó pantalla',
  'sesion.desbloqueo_fallido': 'Contraseña incorrecta al desbloquear',
  'arqueo.sorpresa': 'Arqueo sorpresa',
  'antifraude.reglas': 'Cambió reglas antifraude',
};

// Acciones que merecen atención inmediata al revisar la bitácora.
const SENSIBLES = new Set([
  'venta.descartar_orden',
  'venta.anular',
  'venta.nota_credito_parcial',
  'venta.reimprimir_ticket',
  'cai.editar',
  'cai.activar',
  'usuario.cambiar_contrasena',
  'orden.quitar_producto',
  'acceso.denegado',
  'venta.error_pagos',
]);

const FILTROS_ACCION = [
  { valor: '', etiqueta: 'Todas las acciones' },
  { valor: 'venta.facturar', etiqueta: 'Facturas emitidas' },
  { valor: 'venta.anular', etiqueta: 'Anulaciones' },
  { valor: 'venta.descartar_orden', etiqueta: 'Órdenes descartadas' },
  { valor: 'venta.editar_orden', etiqueta: 'Órdenes editadas' },
  { valor: 'venta.', etiqueta: 'Todo sobre ventas' },
  { valor: 'venta.imprimir', etiqueta: 'Impresiones' },
  { valor: 'cai.', etiqueta: 'Cambios de CAI' },
  { valor: 'producto.', etiqueta: 'Cambios de productos/precios' },
  { valor: 'usuario.', etiqueta: 'Cambios de usuarios' },
  { valor: 'cierre.', etiqueta: 'Cierres de caja' },
  { valor: 'orden.', etiqueta: 'Cambios en órdenes (quitar/descuento)' },
  { valor: 'acceso.', etiqueta: 'Accesos sin permiso' },
  { valor: 'sesion.', etiqueta: 'Inicios y cierres de sesión' },
  { valor: 'pantalla.', etiqueta: 'Navegación por pantallas' },
];

function documento(r) {
  const d = r.detalle ?? {};
  if (d.numero_factura) return d.numero_factura;
  if (d.numero_orden) return `Orden #${d.numero_orden}`;
  if (d.numero_cotizacion) return `Cotización #${d.numero_cotizacion}`;
  return d.nombre ?? '—';
}

function resumen(r) {
  const d = r.detalle ?? {};
  switch (r.accion) {
    case 'venta.editar_orden':
      return `L ${d.total_anterior} → L ${d.total_nuevo} · antes: ${(d.items_antes ?? []).join(', ') || '—'} · después: ${(d.items_despues ?? []).join(', ')}`;
    case 'venta.descartar_orden':
      return `Total L ${d.total} · ${(d.items ?? []).join(', ')}`;
    case 'venta.facturar':
      return `L ${d.total} · ${(d.pagos ?? []).map((p) => `${p.forma} L${p.monto}`).join(' + ')}${d.descuento_porcentaje ? ` · desc. ${d.descuento_porcentaje}%` : ''} · ${d.cliente ?? ''}`;
    case 'venta.anular':
    case 'venta.nota_credito_parcial':
      return `L ${d.monto_acreditado} de L ${d.total_factura} · Motivo: ${d.motivo}`;
    case 'producto.editar':
    case 'usuario.editar':
    case 'cai.editar':
    case 'cai.activar':
    case 'sucursal.editar':
      return Object.entries(d.cambios ?? {})
        .map(([campo, c]) => `${campo}: ${c.antes ?? '—'} → ${c.despues ?? '—'}`)
        .join(' · ');
    case 'cierre.crear':
      if (d.pos_bac != null) {
        return `POS BAC L ${d.pos_bac} · Ficohsa L ${d.pos_ficohsa} (dif. L ${d.diferencia_tarjeta}) · Efectivo contado L ${d.total_contado} de L ${d.total_esperado} (dif. L ${d.diferencia_efectivo})`;
      }
      return `Esperado L ${d.total_esperado} · Contado L ${d.total_contado} · Diferencia L ${d.diferencia}`;
    case 'orden.quitar_producto':
      return `${d.cantidad ?? 1} × ${d.producto ?? ''} · L ${d.monto ?? 0}`;
    case 'orden.descuento':
      return `${d.porcentaje}% a ${d.cantidad} × ${d.producto}`;
    case 'pantalla.ver':
      return d.pantalla ?? '';
    case 'acceso.denegado':
      return `${d.metodo ?? ''} ${d.ruta ?? ''}${d.motivo ? ` · ${d.motivo}` : ''}`;
    case 'factura.buscar':
      return [d.q && `"${d.q}"`, d.desde && `${d.desde} a ${d.hasta || 'hoy'}`].filter(Boolean).join(' · ');
    case 'factura.ver':
      return `${d.factura ?? ''} · L ${d.total ?? ''}`;
    case 'sesion.inicio':
      return d.navegador ? String(d.navegador).slice(0, 60) : '';
    default:
      return d.total != null ? `L ${d.total}` : d.nota ?? '';
  }
}

export default function Bitacora({ session, sucursales }) {
  const [filtros, setFiltros] = useState({ accion: '', sucursal_id: '', desde: '', hasta: '' });
  const [registros, setRegistros] = useState([]);
  const [verificacion, setVerificacion] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  async function buscar() {
    setCargando(true);
    setError('');
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filtros)) if (v) params.set(k, v);
      setRegistros(await api.get(`/auditoria?${params.toString()}`, session));
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  async function verificar() {
    setVerificacion({ cargando: true });
    try {
      setVerificacion(await api.get('/auditoria/verificar', session));
    } catch (e) {
      setVerificacion(null);
      setError(e.message);
    }
  }

  useEffect(() => {
    buscar();
    verificar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exportar() {
    descargarCsv(`bitacora-${new Date().toISOString().slice(0, 10)}.csv`, registros, [
      { titulo: 'Fecha', valor: (r) => new Date(r.created_at).toLocaleString('es-HN') },
      { titulo: 'Usuario', valor: (r) => r.usuario_nombre ?? 'Sistema' },
      { titulo: 'Acción', valor: (r) => ACCIONES[r.accion] ?? r.accion },
      { titulo: 'Documento', valor: documento },
      { titulo: 'Sucursal', valor: (r) => r.sucursales?.nombre ?? '' },
      { titulo: 'Detalle', valor: resumen },
      { titulo: 'IP', valor: (r) => r.ip ?? '' },
      { titulo: 'Hash', valor: (r) => r.hash },
    ]);
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h2>Bitácora de auditoría</h2>
            <p style={{ color: 'var(--text-dim)', marginTop: -8, maxWidth: 560 }}>
              Registro permanente de quién creó, editó, descartó, imprimió, facturó o anuló cada documento. Nadie puede
              modificar ni borrar estos registros — ni siquiera un administrador.
            </p>
          </div>
          {verificacion && (
            <div className={`sello-integridad ${verificacion.cargando ? '' : verificacion.integra ? 'ok' : 'alterada'}`}>
              {verificacion.cargando
                ? 'Verificando integridad…'
                : verificacion.integra
                  ? `✓ Íntegra · ${verificacion.total.toLocaleString('es-HN')} registros verificados`
                  : `⚠ Registro alterado detectado (#${verificacion.primer_id_alterado})`}
            </div>
          )}
        </div>

        <div className="toolbar">
          <select value={filtros.accion} onChange={(e) => setFiltros({ ...filtros, accion: e.target.value })}>
            {FILTROS_ACCION.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </select>
          <select value={filtros.sucursal_id} onChange={(e) => setFiltros({ ...filtros, sucursal_id: e.target.value })}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
          <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
          <input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
          <button className="boton-sm" disabled={cargando} onClick={buscar}>
            {cargando ? 'Buscando…' : 'Buscar'}
          </button>
          <button className="boton-sm boton-secundario" onClick={verificar}>
            Verificar integridad
          </button>
          <button className="boton-sm boton-secundario" disabled={registros.length === 0} onClick={exportar}>
            Exportar CSV
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Documento</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {registros.map((r) => (
                <tr key={r.id} className={SENSIBLES.has(r.accion) ? 'fila-sensible' : undefined}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {new Date(r.created_at).toLocaleString('es-HN', { dateStyle: 'short', timeStyle: 'medium' })}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.sucursal_id && (
                      <span
                        className="leyenda-punto"
                        title={r.sucursales?.nombre}
                        style={{ background: colorSucursal(r.sucursal_id), marginRight: 6 }}
                      />
                    )}
                    {r.usuario_nombre ?? 'Sistema'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{ACCIONES[r.accion] ?? r.accion}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{documento(r)}</td>
                  <td style={{ color: 'var(--text-dim)', fontSize: '0.88em' }} title={`IP ${r.ip ?? '—'} · hash ${r.hash}`}>
                    {resumen(r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!cargando && registros.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Sin registros con esos filtros.</p>}
        {registros.length >= 300 && (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>
            Se muestran los 300 más recientes — acota por fecha para ver más atrás.
          </p>
        )}
      </div>
    </div>
  );
}
