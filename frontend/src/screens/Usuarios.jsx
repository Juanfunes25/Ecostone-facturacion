import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { colorSucursal } from '../lib/coloresSucursal.js';

// Cajeros que no usan correo entran con un nombre de usuario libre
// (ej. "María López", "caja 2"). Sin mínimo de contraseña: decisión de Juan.
// La traducción a lo que pide Supabase la hace backend/lib/acceso.js.

const VACIO = {
  acceso: '',
  password: '',
  nombre: '',
  rol: 'cajero',
  sucursal_id: '',
  cierre_ciego: false,
  sin_horario: false,
  empresas: ['ecostone'],
};

const EMPRESAS = [['ecostone', 'EcoStone'], ['diserco', 'DISERCO']];

function SelectorEmpresas({ valor, onCambiar }) {
  return (
    <span style={{ display: 'inline-flex', gap: 10, color: 'var(--text-dim)' }}>
      {EMPRESAS.map(([codigo, nombre]) => (
        <label key={codigo} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={(valor ?? []).includes(codigo)} onChange={(e) => { const lista = e.target.checked ? [...(valor ?? []), codigo] : (valor ?? []).filter((c) => c !== codigo); if (lista.length) onCambiar(lista); }} />
          {nombre}
        </label>
      ))}
    </span>
  );
}

export default function Usuarios({ session }) {
  const [sucursales, setSucursales] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [rolFiltro, setRolFiltro] = useState('');
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState('');
  const [creando, setCreando] = useState(false);

  const usuariosVisibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return usuarios.filter((u) => {
      const coincideTexto = !q || u.nombre.toLowerCase().includes(q) || (u.acceso ?? '').toLowerCase().includes(q);
      const coincideRol = !rolFiltro || u.rol === rolFiltro;
      return coincideTexto && coincideRol;
    });
  }, [usuarios, busqueda, rolFiltro]);

  async function cargar() {
    setUsuarios(await api.get('/usuarios', session));
  }

  useEffect(() => {
    cargar().catch((e) => setError(e.message));
    api.get('/sucursales?todas=1', session).then(setSucursales).catch(() => {});
  }, []);

  async function crear() {
    setError('');
    setCreando(true);
    try {
      await api.post('/usuarios', session, {
        ...form,
        acceso: form.acceso.trim(),
        sucursal_id: form.sucursal_id || null,
      });
      setForm(VACIO);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreando(false);
    }
  }

  async function actualizar(u, cambios) {
    if (cambios.activo === false) {
      if (!window.confirm(`¿Desactivar a ${u.nombre}? No va a poder entrar al sistema hasta que lo vuelvas a activar.`)) {
        return;
      }
    }
    await api.put(`/usuarios/${u.id}`, session, { ...u, ...cambios, sucursal_id: u.sucursal_id ?? null });
    cargar();
  }

  async function restablecerContrasena(u) {
    const nueva = window.prompt(`Nueva contraseña para ${u.nombre} `);
    if (!nueva) return;
    try {
      await api.post(`/usuarios/${u.id}/reset-password`, session, { password: nueva });
      window.alert('Contraseña actualizada.');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>Nuevo usuario</h2>
        <div className="toolbar">
          <input
            placeholder="Usuario (ej. María López) o correo"
            autoCapitalize="none"
            value={form.acceso}
            onChange={(e) => setForm({ ...form, acceso: e.target.value })}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <input
            placeholder="Nombre completo"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
          />
          <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value })}>
            <option value="cajero">Cajero</option>
            <option value="ventas">Ventas</option>
            <option value="gerente">Gerente</option>
            <option value="vendedor">Vendedor</option>
            <option value="bodega">Bodega / despacho</option>
            <option value="produccion">Producción</option>
            <option value="admin">Administrador</option>
          </select>
          <select value={form.sucursal_id} onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
          <SelectorEmpresas valor={form.empresas} onCambiar={(empresas) => setForm({ ...form, empresas })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={form.cierre_ciego}
              onChange={(e) => setForm({ ...form, cierre_ciego: e.target.checked })}
            />
            Cierre ciego
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)' }}>
            <input
              type="checkbox"
              style={{ width: 'auto' }}
              checked={form.sin_horario}
              onChange={(e) => setForm({ ...form, sin_horario: e.target.checked })}
            />
            Sin horario
          </label>
          <button
            className="boton-sm"
            disabled={
              creando || !form.acceso.trim() || !form.password || !form.nombre.trim()
            }
            onClick={crear}
          >
            {creando ? 'Creando…' : 'Crear usuario'}
          </button>
        </div>
        {form.acceso.trim() && (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85em', marginTop: -4 }}>
            Entrará escribiendo <strong style={{ color: 'var(--text)' }}>{form.acceso.trim().replace(/\s+/g, ' ')}</strong> y su
            contraseña. En el usuario no importan mayúsculas ni tildes; en la contraseña sí.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Usuarios</h2>
        <div className="toolbar">
          <input placeholder="Buscar por nombre o usuario…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <select value={rolFiltro} onChange={(e) => setRolFiltro(e.target.value)}>
            <option value="">Todos los roles</option>
            <option value="cajero">Cajero</option>
            <option value="ventas">Ventas</option>
            <option value="gerente">Gerente</option>
            <option value="vendedor">Vendedor</option>
            <option value="bodega">Bodega / despacho</option>
            <option value="produccion">Producción</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Usuario / correo</th>
              <th>Rol</th>
              <th>Sucursal</th>
              <th>Empresas</th>
              <th>Cierre ciego</th>
              <th>Activo</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {usuariosVisibles.map((u) => (
              <tr key={u.id}>
                <td>{u.nombre}</td>
                <td style={{ color: 'var(--text-dim)', fontSize: '0.9em' }}>{u.acceso ?? '—'}</td>
                <td>{u.rol}</td>
                <td>
                  {u.sucursal_id && (
                    <span
                      className="leyenda-punto"
                      style={{ background: colorSucursal(u.sucursal_id), display: 'inline-block', marginRight: 6 }}
                    />
                  )}
                  {u.sucursales?.nombre ?? 'Todas'}
                </td>
                <td><SelectorEmpresas valor={u.empresas} onCambiar={(empresas) => actualizar(u, { empresas })} /></td>
                <td>{u.cierre_ciego ? 'Sí' : 'No'}</td>
                <td>{u.activo ? 'Sí' : 'No'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="boton-sm boton-secundario"
                    onClick={() => actualizar(u, { activo: !u.activo })}
                  >
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>{' '}
                  <button className="boton-sm boton-secundario" onClick={() => restablecerContrasena(u)}>
                    Contraseña
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
