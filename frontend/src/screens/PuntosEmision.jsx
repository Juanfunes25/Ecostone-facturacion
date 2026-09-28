import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { colorSucursal, nombreCortoSucursal } from '../lib/coloresSucursal.js';

const CAI_VALIDO = /^[0-9A-F]{6}(-[0-9A-F]{6}){4}-[0-9A-F]{2}$/;

// Acepta el CAI pegado con o sin guiones/espacios (mismo criterio que el backend).
function normalizarCai(valor) {
  const texto = String(valor ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (/^[0-9A-F]{32}$/.test(texto)) return texto.match(/.{1,6}/g).join('-');
  return String(valor ?? '').trim().toUpperCase();
}

function numero(form, correlativo) {
  return `${form.punto_emision_codigo}-${form.punto_venta_codigo}-${form.tipo_documento_codigo}-${String(correlativo || 0).padStart(8, '0')}`;
}

// Revisión en vivo del formulario, para que el botón diga exactamente qué
// falta en vez de fallar al guardar.
function problemas(form) {
  const p = [];
  if (!CAI_VALIDO.test(normalizarCai(form.cai))) p.push('CAI: 32 caracteres, formato XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XX');
  if (!/^\d{3}$/.test(form.punto_emision_codigo)) p.push('Establecimiento: 3 dígitos');
  if (!/^\d{3}$/.test(form.punto_venta_codigo)) p.push('Punto de emisión: 3 dígitos');
  if (!/^\d{2}$/.test(form.tipo_documento_codigo)) p.push('Tipo de documento: 2 dígitos');
  const desde = Number(form.correlativo_desde);
  const hasta = Number(form.correlativo_hasta);
  const actual = Number(form.correlativo_actual);
  if (!Number.isInteger(desde) || desde < 1) p.push('Rango desde: número mayor que 0');
  if (!Number.isInteger(hasta) || hasta < desde) p.push('Rango hasta: mayor o igual que "desde"');
  if (!Number.isInteger(actual) || actual < desde || actual > hasta) p.push('Próxima factura: dentro del rango');
  if (!form.fecha_limite_emision) p.push('Fecha límite de emisión');
  return p;
}

export default function PuntosEmision({ session, perfil }) {
  const [puntos, setPuntos] = useState([]);
  const [editando, setEditando] = useState(null); // { id, modo: 'activar' | 'editar' }
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setPuntos(await api.get('/puntos-emision/estado', session));
  }

  useEffect(() => {
    cargar().catch((e) => setError(e.message));
  }, []);

  function abrir(pe, modo) {
    setError('');
    setAviso('');
    setEditando({ id: pe.id, modo, nombre: pe.sucursales?.nombre ?? '' });
    setForm({
      // Al activar, el CAI de prueba no sirve: se pide el de la resolución del SAR.
      cai: modo === 'activar' ? '' : pe.cai ?? '',
      punto_emision_codigo: pe.punto_emision_codigo ?? '',
      punto_venta_codigo: pe.punto_venta_codigo ?? '',
      tipo_documento_codigo: pe.tipo_documento_codigo ?? '01',
      correlativo_desde: String(modo === 'activar' ? '' : pe.correlativo_desde),
      correlativo_hasta: String(modo === 'activar' ? '' : pe.correlativo_hasta),
      correlativo_actual: String(modo === 'activar' ? '' : pe.correlativo_actual),
      fecha_limite_emision: modo === 'activar' ? '' : pe.fecha_limite_emision ?? '',
    });
  }

  function cambiar(campo, valor) {
    setForm((f) => {
      const nuevo = { ...f, [campo]: valor };
      // Al activar, la primera factura real es el inicio del rango autorizado.
      if (editando?.modo === 'activar' && campo === 'correlativo_desde' && (f.correlativo_actual === '' || f.correlativo_actual === f.correlativo_desde)) {
        nuevo.correlativo_actual = valor;
      }
      return nuevo;
    });
  }

  async function guardar() {
    const cuerpo = {
      ...form,
      cai: normalizarCai(form.cai),
      correlativo_desde: Number(form.correlativo_desde),
      correlativo_hasta: Number(form.correlativo_hasta),
      correlativo_actual: Number(form.correlativo_actual),
      es_borrador: false,
    };
    if (editando.modo === 'activar') {
      const ok = window.confirm(
        [
          `ACTIVAR CAI REAL — ${editando.nombre}`,
          '',
          `CAI: ${cuerpo.cai}`,
          `Rango: ${numero(form, cuerpo.correlativo_desde)} a ${numero(form, cuerpo.correlativo_hasta)}`,
          `Primera factura: ${numero(form, cuerpo.correlativo_actual)}`,
          `Fecha límite: ${form.fecha_limite_emision}`,
          '',
          'Desde este momento las facturas de esta sucursal tienen validez fiscal ante el SAR.',
          '¿Los datos coinciden exactamente con la resolución?',
        ].join('\n')
      );
      if (!ok) return;
    } else if (!window.confirm('Vas a modificar datos fiscales del CAI. Queda registrado en la bitácora. ¿Continuar?')) {
      return;
    }
    setGuardando(true);
    setError('');
    try {
      await api.put(`/puntos-emision/${editando.id}`, session, cuerpo);
      setAviso(
        editando.modo === 'activar'
          ? `CAI real activado en ${nombreCortoSucursal(editando.nombre)}. La próxima factura será la ${numero(form, cuerpo.correlativo_actual)}.`
          : 'Cambios guardados.'
      );
      setEditando(null);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function volverABorrador(pe) {
    const ok = window.confirm(
      `¿Volver ${pe.sucursales?.nombre} a MODO BORRADOR?\n\nLas facturas nuevas saldrán como "BORRADOR-…" sin validez fiscal. Úsalo sólo si activaste el CAI por error.`
    );
    if (!ok) return;
    try {
      await api.put(`/puntos-emision/${pe.id}`, session, { es_borrador: true });
      setAviso('Punto de emisión en modo borrador.');
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  const faltan = form ? problemas(form) : [];

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {aviso && <div className="alerta">{aviso}</div>}
      <div className="panel">
        <h2>Puntos de emisión (CAI)</h2>
        <p className="cai-ayuda">
          Mientras una sucursal está en <strong>modo borrador</strong>, sus facturas salen numeradas como
          «BORRADOR-…» y sin validez fiscal. Cuando el contador te entregue la resolución del SAR, usa
          <strong> Activar CAI real</strong> y copia los datos tal cual.
        </p>
        <div className="cai-lista">
          {puntos.map((pe) => (
            <div key={pe.id} className={`cai-tarjeta${pe.es_borrador ? ' cai-tarjeta-borrador' : ''}`} style={{ '--color-pe': colorSucursal(pe.sucursal_id) }}>
              <div className="cai-tarjeta-encabezado">
                <strong>{nombreCortoSucursal(pe.sucursales?.nombre ?? '')}</strong>
                <span className={`cai-estado ${pe.es_borrador ? 'cai-estado-borrador' : 'cai-estado-real'}`}>
                  {pe.es_borrador ? 'Modo borrador' : 'CAI real activo'}
                </span>
              </div>
              {pe.alerta && !pe.es_borrador && (
                <div className="alerta">
                  {pe.agotado && 'El rango de correlativos está agotado. '}
                  {pe.vencido && 'La fecha límite de emisión ya venció. '}
                  {!pe.agotado && !pe.vencido && `Quedan ${pe.dias_restantes ?? '?'} días o ${Math.round((100 - pe.porcentaje_usado) * 10) / 10}% del rango.`}
                </div>
              )}
              <dl className="cai-datos">
                <dt>CAI</dt>
                <dd className="cai-codigo">{pe.es_borrador ? 'de prueba' : pe.cai}</dd>
                <dt>Próxima factura</dt>
                <dd>
                  {pe.es_borrador && 'BORRADOR-'}
                  {numero(pe, pe.correlativo_actual)}
                </dd>
                {!pe.es_borrador && (
                  <>
                    <dt>Rango autorizado</dt>
                    <dd>
                      {pe.correlativo_desde} – {pe.correlativo_hasta} ({pe.porcentaje_usado}% usado)
                    </dd>
                    <dt>Fecha límite</dt>
                    <dd>{pe.fecha_limite_emision ?? 'sin definir'}</dd>
                  </>
                )}
              </dl>

              {perfil.rol === 'admin' && editando?.id !== pe.id && (
                <div className="cai-acciones">
                  {pe.es_borrador ? (
                    <button className="boton-sm" onClick={() => abrir(pe, 'activar')}>
                      Activar CAI real
                    </button>
                  ) : (
                    <>
                      <button className="boton-sm boton-secundario" onClick={() => abrir(pe, 'editar')}>
                        Editar
                      </button>
                      <button className="boton-sm boton-secundario" onClick={() => volverABorrador(pe)}>
                        Volver a borrador
                      </button>
                    </>
                  )}
                </div>
              )}

              {editando?.id === pe.id && form && (
                <div className="cai-form">
                  <h3>{editando.modo === 'activar' ? 'Datos de la resolución del SAR' : 'Editar CAI'}</h3>
                  <label className="cai-form-ancho">
                    CAI
                    <input
                      className="cai-codigo"
                      placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XX"
                      autoCapitalize="characters"
                      value={form.cai}
                      onChange={(e) => cambiar('cai', e.target.value)}
                      onBlur={(e) => cambiar('cai', normalizarCai(e.target.value))}
                      autoFocus
                    />
                  </label>
                  <label>
                    Establecimiento
                    <input maxLength={3} inputMode="numeric" value={form.punto_emision_codigo} onChange={(e) => cambiar('punto_emision_codigo', e.target.value)} />
                  </label>
                  <label>
                    Punto de emisión
                    <input maxLength={3} inputMode="numeric" value={form.punto_venta_codigo} onChange={(e) => cambiar('punto_venta_codigo', e.target.value)} />
                  </label>
                  <label>
                    Tipo de documento
                    <input maxLength={2} inputMode="numeric" value={form.tipo_documento_codigo} onChange={(e) => cambiar('tipo_documento_codigo', e.target.value)} />
                  </label>
                  <label>
                    Rango desde
                    <input type="number" min="1" value={form.correlativo_desde} onChange={(e) => cambiar('correlativo_desde', e.target.value)} />
                  </label>
                  <label>
                    Rango hasta
                    <input type="number" min="1" value={form.correlativo_hasta} onChange={(e) => cambiar('correlativo_hasta', e.target.value)} />
                  </label>
                  <label>
                    Próxima factura
                    <input type="number" min="1" value={form.correlativo_actual} onChange={(e) => cambiar('correlativo_actual', e.target.value)} />
                  </label>
                  <label>
                    Fecha límite de emisión
                    <input type="date" value={form.fecha_limite_emision} onChange={(e) => cambiar('fecha_limite_emision', e.target.value)} />
                  </label>
                  {faltan.length === 0 ? (
                    <p className="cai-form-ancho cai-vista">
                      Rango: <strong>{numero(form, form.correlativo_desde)}</strong> a <strong>{numero(form, form.correlativo_hasta)}</strong>
                      <br />
                      Primera factura: <strong>{numero(form, form.correlativo_actual)}</strong>
                    </p>
                  ) : (
                    <ul className="cai-form-ancho cai-faltan">
                      {faltan.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  )}
                  <div className="cai-form-ancho cai-acciones">
                    <button className="boton-sm" disabled={faltan.length > 0 || guardando} onClick={guardar}>
                      {guardando ? 'Guardando…' : editando.modo === 'activar' ? 'Activar CAI real' : 'Guardar cambios'}
                    </button>
                    <button className="boton-sm boton-secundario" onClick={() => setEditando(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
