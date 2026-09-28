// Ventana modal simple (usa las clases .overlay / .tarjeta del sistema).
export default function Modal({ titulo, onCerrar, ancho = 640, children, pie }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCerrar?.()}>
      <div className="tarjeta" style={{ maxWidth: ancho, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0 }}>{titulo}</h2>
          <button className="boton-sm boton-secundario" onClick={onCerrar}>Cerrar</button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
        {pie && <div className="toolbar" style={{ marginTop: 12 }}>{pie}</div>}
      </div>
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda, ancho }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85em', color: 'var(--text-dim)', flex: ancho ? `0 0 ${ancho}px` : '1 1 160px', minWidth: 0 }}>
      {etiqueta}
      {children}
      {ayuda && <small style={{ opacity: 0.8 }}>{ayuda}</small>}
    </label>
  );
}

export function Pestanas({ items, activa, onCambiar }) {
  return (
    <div className="rep-pestanas" role="tablist" style={{ marginBottom: 12 }}>
      {items.map((p) => (
        <button key={p.id} role="tab" aria-selected={activa === p.id} className={activa === p.id ? 'activa' : ''} onClick={() => onCambiar(p.id)}>
          {p.etiqueta}
          {p.contador > 0 && <span className="rep-contador">{p.contador}</span>}
        </button>
      ))}
    </div>
  );
}

export function Kpis({ items }) {
  return (
    <div className="rep-kpis" style={{ marginBottom: 12 }}>
      {items.map((k) => (
        <div className="rep-kpi" key={k.titulo}>
          <span className="rep-kpi-titulo">{k.titulo}</span>
          <strong className="rep-kpi-valor">{k.valor}</strong>
          {k.pie && <span className="rep-kpi-pie">{k.pie}</span>}
        </div>
      ))}
    </div>
  );
}

const COLORES = { ok: 'var(--ok)', aviso: 'var(--aviso)', peligro: 'var(--peligro)', info: 'var(--info)', gris: 'var(--text-dim)' };
export function Etiqueta({ tono = 'gris', children }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, fontSize: '0.78em', fontWeight: 600, color: COLORES[tono], border: `1px solid ${COLORES[tono]}`, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}
