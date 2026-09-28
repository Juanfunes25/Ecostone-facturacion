import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { colorLibre, colorSucursal, nombreCortoSucursal, PALETA_SUCURSALES } from '../lib/coloresSucursal.js';

// Muestras de la paleta: las que ya usa otra sucursal quedan bloqueadas,
// porque el color existe justamente para no confundir una con otra.
function SelectorColor({ valor, onCambiar, sucursales, excepto }) {
  return (
    <div className="selector-color" role="radiogroup" aria-label="Color de la sucursal">
      {PALETA_SUCURSALES.map((p) => {
        const duena = sucursales.find((s) => s.id !== excepto && s.color?.toLowerCase() === p.color.toLowerCase());
        const elegido = valor?.toLowerCase() === p.color.toLowerCase();
        return (
          <button
            key={p.color}
            type="button"
            role="radio"
            aria-checked={elegido}
            className={`muestra-color ${elegido ? 'elegida' : ''}`}
            style={{ background: p.color }}
            disabled={!!duena}
            title={duena ? `${p.nombre} — ya lo usa ${nombreCortoSucursal(duena.nombre)}` : p.nombre}
            onClick={() => onCambiar(p.color)}
          >
            {elegido ? '✓' : duena ? '·' : ''}
          </button>
        );
      })}
    </div>
  );
}

export default function Sucursales({ session, sucursales, onCreada }) {
  const [form, setForm] = useState({ nombre: '', alias: '', direccion: '', color: '' });
  const [error, setError] = useState('');
  const [ultimaCreada, setUltimaCreada] = useState(null);
  const [estadosCai, setEstadosCai] = useState([]);
  const [editandoId, setEditandoId] = useState(null);
  const [formEdicion, setFormEdicion] = useState({ nombre: '', direccion: '', color: '' });

  useEffect(() => {
    api
      .get('/puntos-emision/estado', session)
      .then(setEstadosCai)
      .catch(() => {});
  }, []);

  function estadoCaiDe(sucursalId) {
    return estadosCai.find((e) => e.sucursal_id === sucursalId);
  }

  const colorNueva = form.color || colorLibre(sucursales);

  async function crear() {
    setError('');
    try {
      const sucursal = await api.post('/sucursales', session, { ...form, color: colorNueva });
      setUltimaCreada(sucursal);
      setForm({ nombre: '', alias: '', direccion: '', color: '' });
      onCreada?.();
    } catch (e) {
      setError(e.message);
    }
  }

  function editar(s) {
    setEditandoId(s.id);
    setFormEdicion({ nombre: s.nombre, direccion: s.direccion, color: s.color ?? colorSucursal(s.id) });
  }

  async function guardarEdicion() {
    setError('');
    try {
      await api.put(`/sucursales/${editandoId}`, session, { ...formEdicion, activo: true });
      setEditandoId(null);
      onCreada?.();
    } catch (e) {
      setError(e.message);
    }
  }

  async function desactivar(s) {
    if (
      !window.confirm(
        `¿Desactivar "${s.nombre}"? Deja de aparecer para facturar y en los selectores del sistema. No borra sus facturas ni su historial.`
      )
    ) {
      return;
    }
    try {
      await api.put(`/sucursales/${s.id}`, session, { nombre: s.nombre, direccion: s.direccion, activo: false });
      onCreada?.();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>Sucursales</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9em', marginTop: -8 }}>
          Cada sucursal tiene su propio color: pinta la barra superior, la franja lateral y los títulos de toda la
          app mientras se trabaja en ella. Dos sucursales nunca pueden tener el mismo.
        </p>
        <table className="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Alias</th>
              <th>Dirección</th>
              <th>CAI</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sucursales.map((s) => {
              const estado = estadoCaiDe(s.id);
              if (editandoId === s.id) {
                return (
                  <tr key={s.id}>
                    <td colSpan={3}>
                      <div className="toolbar" style={{ marginBottom: 8 }}>
                        <input
                          style={{ marginBottom: 0 }}
                          value={formEdicion.nombre}
                          onChange={(e) => setFormEdicion({ ...formEdicion, nombre: e.target.value })}
                        />
                        <input
                          style={{ marginBottom: 0 }}
                          value={formEdicion.direccion}
                          onChange={(e) => setFormEdicion({ ...formEdicion, direccion: e.target.value })}
                        />
                      </div>
                      <SelectorColor
                        valor={formEdicion.color}
                        onCambiar={(color) => setFormEdicion({ ...formEdicion, color })}
                        sucursales={sucursales}
                        excepto={s.id}
                      />
                    </td>
                    <td></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="boton-sm" onClick={guardarEdicion}>
                        Guardar
                      </button>{' '}
                      <button className="boton-sm boton-secundario" onClick={() => setEditandoId(null)}>
                        Cancelar
                      </button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={s.id}>
                  <td>
                    <span className="muestra-fila" style={{ background: colorSucursal(s.id) }} />
                    <strong>{nombreCortoSucursal(s.nombre)}</strong>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.8em', marginLeft: 22 }}>{s.nombre}</div>
                  </td>
                  <td>{s.alias}</td>
                  <td>{s.direccion}</td>
                  <td>
                    {estado?.es_borrador && <span className="badge-borrador">Borrador</span>}
                    {estado && !estado.es_borrador && !estado.alerta && (
                      <span className="chip" style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}>
                        Activo
                      </span>
                    )}
                    {estado && !estado.es_borrador && estado.alerta && (
                      <span className="chip" style={{ color: 'var(--aviso)', borderColor: 'var(--aviso)' }}>
                        Por vencer/agotarse
                      </span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="boton-sm boton-secundario" onClick={() => editar(s)}>
                      Editar / color
                    </button>{' '}
                    <button className="boton-sm boton-secundario" onClick={() => desactivar(s)}>
                      Desactivar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Nueva sucursal</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9em' }}>
          Se crea con su propio punto de emisión en modo borrador (sin CAI todavía) — lo activas
          después desde "CAI / Puntos de emisión" en cuanto tengas el rango real del SAR.
        </p>
        <div className="toolbar">
          <input
            placeholder="Nombre completo"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          />
          <input
            placeholder="Alias corto (ej. bulevar)"
            value={form.alias}
            onChange={(e) => setForm({ ...form, alias: e.target.value })}
          />
          <input
            placeholder="Dirección"
            value={form.direccion}
            onChange={(e) => setForm({ ...form, direccion: e.target.value })}
          />
        </div>
        <div style={{ fontSize: '0.85em', color: 'var(--text-dim)', marginBottom: 6 }}>Color</div>
        <SelectorColor valor={colorNueva} onCambiar={(color) => setForm({ ...form, color })} sucursales={sucursales} />
        <button
          className="boton-sm"
          style={{ marginTop: 12 }}
          disabled={!form.nombre || !form.alias || !form.direccion}
          onClick={crear}
        >
          Crear sucursal
        </button>
        {ultimaCreada && (
          <div className="alerta" style={{ marginTop: 12 }}>
            Sucursal "{ultimaCreada.nombre}" creada con punto de emisión{' '}
            {ultimaCreada.punto_emision.punto_emision_codigo} en modo borrador.
          </div>
        )}
      </div>
    </div>
  );
}
