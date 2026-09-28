// Genera docs/CODIGO-COMPLETO.md: todo el código fuente del proyecto en un
// solo documento (para replicar la aplicación en otro negocio o dárselo a
// otra sesión de Claude Code). Uso: node scripts/generar-codigo-completo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const salida = path.join(raiz, 'docs', 'CODIGO-COMPLETO.md');

const EXTENSIONES = { '.js': 'js', '.mjs': 'js', '.jsx': 'jsx', '.css': 'css', '.html': 'html', '.json': 'json', '.sql': 'sql', '.yaml': 'yaml', '.yml': 'yaml', '.md': 'markdown', '.example': 'bash' };
const IGNORAR = new Set(['node_modules', 'dist', '.git', 'assets', 'package-lock.json', 'CODIGO-COMPLETO.md']);

// Orden de lectura: configuración → base de datos → backend → frontend.
const SECCIONES = [
  { titulo: 'Configuración y despliegue', rutas: ['render.yaml', 'README.md', 'backend/package.json', 'backend/.env.example', 'frontend/package.json', 'frontend/vite.config.js', 'frontend/index.html'] },
  { titulo: 'Base de datos (migraciones Supabase, en orden)', rutas: ['supabase/migrations'] },
  { titulo: 'Backend: servidor, conexión y middleware', rutas: ['backend/server.js', 'backend/db.js', 'backend/middleware'] },
  { titulo: 'Backend: librerías de negocio', rutas: ['backend/lib'] },
  { titulo: 'Backend: rutas de la API', rutas: ['backend/routes'] },
  { titulo: 'Frontend: shell y utilidades', rutas: ['frontend/src/main.jsx', 'frontend/src/App.jsx', 'frontend/src/api.js', 'frontend/src/supabaseClient.js', 'frontend/src/lib'] },
  { titulo: 'Frontend: componentes', rutas: ['frontend/src/components'] },
  { titulo: 'Frontend: pantallas', rutas: ['frontend/src/screens'] },
  { titulo: 'Frontend: estilos', rutas: ['frontend/src/index.css'] },
];

function listar(ruta) {
  const abs = path.join(raiz, ruta);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [ruta];
  return fs
    .readdirSync(abs)
    .filter((n) => !IGNORAR.has(n))
    .sort()
    .flatMap((n) => listar(path.join(ruta, n)));
}

const vistos = new Set();
const bloques = [];
const indice = [];
let totalLineas = 0;

for (const seccion of SECCIONES) {
  const archivos = seccion.rutas.flatMap(listar).filter((f) => EXTENSIONES[path.extname(f)] && !vistos.has(f));
  if (archivos.length === 0) continue;
  indice.push(`- **${seccion.titulo}**`);
  bloques.push(`\n## ${seccion.titulo}\n`);
  for (const archivo of archivos) {
    vistos.add(archivo);
    const contenido = fs.readFileSync(path.join(raiz, archivo), 'utf8').replace(/\s+$/, '');
    const lineas = contenido.split('\n').length;
    totalLineas += lineas;
    const lenguaje = EXTENSIONES[path.extname(archivo)];
    const cerca = contenido.includes('```') ? '````' : '```';
    indice.push(`  - \`${archivo}\` (${lineas} líneas)`);
    bloques.push(`\n### \`${archivo}\`\n\n${cerca}${lenguaje}\n${contenido}\n${cerca}\n`);
  }
}

const cabecera = `# Código completo — EcoStone Facturación

Todo el código fuente del proyecto en un solo documento, en orden de lectura
(configuración → base de datos → backend → frontend). La explicación de la
lógica, las decisiones y cómo adaptarlo a otro negocio está en
\`docs/GUIA-REPLICACION.md\`: léela primero.

- Archivos: ${vistos.size} · Líneas: ${totalLineas.toLocaleString('es-HN')}
- No se incluyen: \`node_modules\`, el build (\`dist\`), \`package-lock.json\`
  ni las fuentes TTF de \`backend/assets/fonts\` (Poppins, Inter y Barlow
  Condensed, gratuitas en Google Fonts).
- Regenerar: \`node scripts/generar-codigo-completo.mjs\`

## Índice

${indice.join('\n')}
`;

fs.writeFileSync(salida, `${cabecera}${bloques.join('')}\n`);
console.log(`docs/CODIGO-COMPLETO.md: ${vistos.size} archivos, ${totalLineas} líneas`);
