import { useState } from 'react';
import { guardarConfigImpresora, imprimirPrueba, leerConfigImpresora, PAPELES } from '../lib/documentos.js';

const URL_APP = typeof window !== 'undefined' ? window.location.origin : 'https://ecostone-facturacion.onrender.com';
const ACCESO_DIRECTO = `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --app=${URL_APP}`;

export default function Impresora({ session, sucursales, sucursalId }) {
  const [config, setConfig] = useState(leerConfigImpresora);
  const [estado, setEstado] = useState('');
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);

  function actualizar(cambios) {
    const nueva = { ...config, ...cambios };
    setConfig(nueva);
    guardarConfigImpresora(nueva);
    setEstado('Guardado en esta computadora.');
  }

  async function probar() {
    setError('');
    setEstado('Enviando prueba…');
    try {
      await imprimirPrueba(session, sucursales.find((s) => s.id === sucursalId)?.nombre);
      setEstado('Prueba enviada a la impresora.');
    } catch (e) {
      setEstado('');
      setError(e.message);
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(ACCESO_DIRECTO);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError('No se pudo copiar — selecciona el texto y usa Ctrl+C.');
    }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      {error && <div className="error">{error}</div>}

      <div className="panel">
        <h2>Impresora térmica de esta caja</h2>
        <p style={{ color: 'var(--text-dim)', marginTop: -8 }}>
          Esta configuración se guarda en esta computadora — cada caja puede tener su propia impresora.
        </p>

        <div style={{ fontSize: '0.85em', color: 'var(--text-dim)', marginBottom: 6 }}>Ancho del papel</div>
        <div className="opciones-segmentadas">
          {PAPELES.map((p) => (
            <button
              key={p.columnas}
              className={config.columnas === p.columnas ? 'activo' : ''}
              onClick={() => actualizar({ columnas: p.columnas })}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>

        <label className="interruptor">
          <input
            type="checkbox"
            checked={config.autoImprimir}
            onChange={(e) => actualizar({ autoImprimir: e.target.checked })}
          />
          Imprimir la factura automáticamente al cobrar (1 copia)
        </label>

        <div className="toolbar" style={{ marginTop: 14 }}>
          <button className="boton-sm" onClick={probar}>
            🖨 Imprimir ticket de prueba
          </button>
          {estado && <span style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>{estado}</span>}
        </div>
      </div>

      <div className="panel">
        <h2>Imprimir directo, sin ventana de confirmación</h2>
        <p style={{ color: 'var(--text-dim)', marginTop: -8 }}>
          Sin este paso la factura igual se imprime, pero Chrome muestra la ventana de impresión y hay que dar Enter
          cada vez. Se configura una sola vez por computadora (Windows):
        </p>
        <ol className="pasos">
          <li>
            Instala el driver de la impresora (Epson, Xprinter, 3nStar, etc.) y en <strong>Configuración → Impresoras</strong>{' '}
            márcala como <strong>predeterminada</strong>. En sus preferencias, elige papel de 80 mm (o 58 mm) y márgenes en 0.
          </li>
          <li>
            En el escritorio: clic derecho → <strong>Nuevo → Acceso directo</strong>, y pega esto como ubicación:
            <div className="codigo-copiable">
              <code>{ACCESO_DIRECTO}</code>
              <button className="boton-sm boton-secundario" onClick={copiar}>
                {copiado ? 'Copiado ✓' : 'Copiar'}
              </button>
            </div>
          </li>
          <li>
            Nómbralo <strong>"EcoStone Facturación"</strong>. Cierra todas las ventanas de Chrome y abre el sistema siempre
            desde ese acceso directo.
          </li>
          <li>
            Entra, vuelve a esta pantalla y toca <strong>Imprimir ticket de prueba</strong>: debe salir directo por la
            térmica, sin preguntar. Si las líneas salen cortadas, cambia el ancho del papel arriba.
          </li>
        </ol>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>
          <strong>--kiosk-printing</strong> hace que Chrome imprima en la impresora predeterminada sin mostrar el diálogo.{' '}
          <strong>--app</strong> abre el sistema como aplicación, sin barra de direcciones ni pestañas.
        </p>
      </div>
    </div>
  );
}
