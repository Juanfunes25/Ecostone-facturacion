import { IsotipoEcoStone } from '../components/Icono.jsx';

// Primera pantalla de quien trabaja en las dos empresas: dos botones grandes.
// Quien solo tiene una empresa (ej. producción de EcoStone) nunca la ve.
const MARCAS = {
  diserco: { fondo: '#e8762b', texto: '#fff', lema: 'Distribución y servicios de la construcción' },
  ecostone: { fondo: '#3f5433', texto: '#f4f1ea', lema: 'Piedra de enchape · Stone Factory' },
};

export default function SelectorEmpresa({ perfil, onElegir, onSalir }) {
  const empresas = [...(perfil.empresas_info ?? [])].sort((a, b) => a.orden - b.orden);
  return (
    <div className="pantalla" style={{ flexDirection: 'column', gap: 24, padding: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '1.8rem' }}>Hola, {perfil.nombre}</h1>
        <p style={{ color: 'var(--text-dim)', margin: '6px 0 0', fontSize: '1.1rem' }}>¿A qué empresa vas a entrar?</p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center', width: '100%' }}>
        {empresas.map((e) => {
          const m = MARCAS[e.codigo] ?? { fondo: e.color || '#333', texto: '#fff', lema: e.razon_social };
          return (
            <button
              key={e.codigo}
              onClick={() => onElegir(e.codigo)}
              style={{ flex: '1 1 280px', maxWidth: 380, minHeight: 230, border: 0, borderRadius: 18, cursor: 'pointer', background: m.fondo, color: m.texto, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, boxShadow: '0 10px 30px rgba(0,0,0,.28)' }}
            >
              {e.codigo === 'diserco' ? <img src="/diserco-logo.png" alt="" style={{ width: 110, height: 'auto', borderRadius: 6 }} /> : <IsotipoEcoStone tam={72} color={m.texto} />}
              <strong style={{ fontSize: '2rem', letterSpacing: 2 }}>{e.nombre.toUpperCase()}</strong>
              <small style={{ opacity: 0.9, fontSize: '0.95rem' }}>{m.lema}</small>
            </button>
          );
        })}
      </div>
      <button className="boton-secundario boton-sm" onClick={onSalir}>Cerrar sesión</button>
    </div>
  );
}
