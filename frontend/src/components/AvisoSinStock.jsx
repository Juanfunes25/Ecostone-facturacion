// Ventana de aviso cuando se va a facturar o sacar material sin existencia suficiente.
// Deja continuar (la existencia queda en negativo y se genera una alerta) o cancelar.
export default function AvisoSinStock({ faltantes, accion = 'facturar', onContinuar, onCancelar }) {
  return (
    <div className="overlay" style={{ zIndex: 80 }}>
      <div className="tarjeta" style={{ maxWidth: 460, borderTop: '6px solid var(--aviso)' }}>
        <h2 style={{ marginTop: 0 }}>⚠ No hay existencia suficiente</h2>
        <p style={{ marginTop: 0 }}>Según el inventario, esto no alcanza:</p>
        <table className="tabla">
          <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Pides</th><th style={{ textAlign: 'right' }}>Hay</th></tr></thead>
          <tbody>
            {faltantes.map((f) => (
              <tr key={f.producto}><td><strong>{f.producto}</strong></td><td style={{ textAlign: 'right' }}>{f.pedido}</td><td style={{ textAlign: 'right', color: 'var(--peligro)', fontWeight: 700 }}>{f.hay}</td></tr>
            ))}
          </tbody>
        </table>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9em' }}>Si continúas, el inventario quedará en negativo y se avisará al administrador. Revisa el conteo físico y registra la compra pendiente.</p>
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="boton-md" style={{ flex: 1 }} onClick={onContinuar}>Sí, {accion} de todos modos</button>
          <button className="boton-md boton-secundario" style={{ flex: 1 }} onClick={onCancelar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
