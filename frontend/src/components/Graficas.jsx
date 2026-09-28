// Gráficas mínimas en HTML/CSS puro (sin librería) — mismo criterio que el
// resto del ecosistema de apps. Ver skill dataviz: una serie = un color fijo,
// sin leyenda; >=2 series simultáneas = paleta categórica + leyenda.

export function Leyenda({ items }) {
  return (
    <div className="leyenda">
      {items.map((it) => (
        <span key={it.nombre} className="leyenda-item">
          <span className="leyenda-punto" style={{ background: it.color }} />
          {it.nombre}
        </span>
      ))}
    </div>
  );
}

export function BarraHorizontal({ datos, valorClave = 'valor', etiquetaClave = 'nombre', color, formatear }) {
  const max = Math.max(1, ...datos.map((d) => Number(d[valorClave])));
  const fmt = formatear ?? ((n) => n.toLocaleString('es-HN'));
  return (
    <div>
      {datos.map((d) => (
        <div key={d[etiquetaClave]} className="barra-h-fila">
          <span className="barra-h-etiqueta" title={d[etiquetaClave]}>
            {d[etiquetaClave]}
          </span>
          <span className="barra-h-pista">
            <span
              className="barra-h-relleno"
              style={{ width: `${(Number(d[valorClave]) / max) * 100}%`, background: d.color ?? color }}
            />
          </span>
          <span className="barra-h-valor">{fmt(Number(d[valorClave]))}</span>
        </div>
      ))}
      {datos.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Sin datos en este rango.</p>}
    </div>
  );
}

export function BarrasVerticales({ datos, valorClave = 'valor', etiquetaClave = 'etiqueta', color, formatear }) {
  const max = Math.max(1, ...datos.map((d) => Number(d[valorClave])));
  const fmt = formatear ?? ((n) => n.toLocaleString('es-HN'));
  return (
    <div className="barras-verticales">
      {datos.map((d, i) => (
        <div key={`${d[etiquetaClave]}-${i}`} className="barra-v-col">
          <span className="barra-v-valor">{fmt(Number(d[valorClave]))}</span>
          <div
            className="barra-v-relleno"
            style={{ height: `${Math.max(2, (Number(d[valorClave]) / max) * 100)}%`, background: d.color ?? color }}
          />
          <span className="barra-v-etiqueta">{d[etiquetaClave]}</span>
        </div>
      ))}
      {datos.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Sin datos en este rango.</p>}
    </div>
  );
}
