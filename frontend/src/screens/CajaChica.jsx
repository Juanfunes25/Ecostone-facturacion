import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { descargarCsv } from '../lib/csv.js';

const fmtL = (n) => `L ${Number(n).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CajaChica({ session, perfil, sucursales }) {
  const [movimientos, setMovimientos] = useState([]);
  const [rango, setRango] = useState({ fechaInicio: '', fechaFin: '' });
  const [form, setForm] = useState({
    sucursal_id: perfil.sucursal_id ?? sucursales[0]?.id ?? '',
    tipo: 'Otros gastos',
    monto: '',
    concepto: '',
  });
  const [error, setError] = useState('');

  const totalGastado = useMemo(() => movimientos.reduce((s, m) => s + Number(m.monto), 0), [movimientos]);

  async function cargar() {
    const params = new URLSearchParams({ sucursal_id: form.sucursal_id });
    if (rango.fechaInicio) params.set('fechaInicio', rango.fechaInicio);
    if (rango.fechaFin) params.set('fechaFin', rango.fechaFin);
    setMovimientos(await api.get(`/caja-chica?${params.toString()}`, session));
  }

  function exportarCsv() {
    descargarCsv(`caja-chica-${new Date().toISOString().slice(0, 10)}.csv`, movimientos, [
      { titulo: 'Fecha', valor: (m) => m.fecha },
      { titulo: 'Tipo', valor: (m) => m.tipo },
      { titulo: 'Concepto', valor: (m) => m.concepto ?? '' },
      { titulo: 'Monto', valor: (m) => Number(m.monto).toFixed(2) },
      { titulo: 'Usuario', valor: (m) => m.perfiles?.nombre ?? '' },
    ]);
  }

  useEffect(() => {
    cargar().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.sucursal_id, rango.fechaInicio, rango.fechaFin]);

  async function registrar() {
    setError('');
    try {
      await api.post('/caja-chica', session, { ...form, monto: Number(form.monto) });
      setForm({ ...form, monto: '', concepto: '' });
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <div className="panel">
        <h2>Caja chica</h2>
        <div className="toolbar">
          <select value={form.sucursal_id} onChange={(e) => setForm({ ...form, sucursal_id: e.target.value })}>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
            {['Agua', 'Alquileres', 'Otros gastos', 'Publicidad y RRPP', 'Reparaciones y conservación', 'Sueldos y salarios', 'Telefonía e internet', 'Transportes'].map(
              (t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              )
            )}
          </select>
          <input
            type="number"
            step="0.01"
            placeholder="Monto"
            value={form.monto}
            onChange={(e) => setForm({ ...form, monto: e.target.value })}
          />
          <input
            placeholder="Concepto"
            value={form.concepto}
            onChange={(e) => setForm({ ...form, concepto: e.target.value })}
          />
          <button className="boton-sm" disabled={!form.monto} onClick={registrar}>
            Registrar
          </button>
        </div>

        <div className="toolbar">
          <label style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>
            Desde
            <input type="date" value={rango.fechaInicio} onChange={(e) => setRango({ ...rango, fechaInicio: e.target.value })} />
          </label>
          <label style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>
            Hasta
            <input type="date" value={rango.fechaFin} onChange={(e) => setRango({ ...rango, fechaFin: e.target.value })} />
          </label>
          <button className="boton-sm boton-secundario" onClick={exportarCsv} disabled={movimientos.length === 0}>
            Exportar CSV
          </button>
        </div>

        <p>
          Total gastado en esta sucursal: <strong>{fmtL(totalGastado)}</strong>
        </p>

        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Concepto</th>
              <th>Monto</th>
              <th>Usuario</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id}>
                <td>{m.fecha}</td>
                <td>{m.tipo}</td>
                <td>{m.concepto}</td>
                <td>{fmtL(m.monto)}</td>
                <td>{m.perfiles?.nombre ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
