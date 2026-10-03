import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { requireAuth } from './middleware/auth.js';
import { categorias } from './routes/categorias.js';
import { productos } from './routes/productos.js';
import { clientes } from './routes/clientes.js';
import { puntosEmision } from './routes/puntosEmision.js';
import { ventas } from './routes/ventas.js';
import { anulaciones } from './routes/anulaciones.js';
import { cierres } from './routes/cierres.js';
import { reportes } from './routes/reportes.js';
import { usuarios } from './routes/usuarios.js';
import { facturaImpresion } from './routes/facturaImpresion.js';
import { sucursales } from './routes/sucursales.js';
import { dashboard } from './routes/dashboard.js';
import { auditoria } from './routes/auditoria.js';
import { insumos } from './routes/insumos.js';
import { fabricacion } from './routes/fabricacion.js';
import { inventario } from './routes/inventario.js';
import { cotizaciones } from './routes/cotizaciones.js';
import { catalogoFabrica } from './routes/catalogoFabrica.js';
import { registroProduccion } from './routes/registroProduccion.js';
import { reporteProduccion } from './routes/reporteProduccion.js';
import { trazabilidad } from './routes/trazabilidad.js';
import { todasLasEmpresas } from './lib/empresas.js';
import { iniciarLiberacionAutomatica } from './lib/colada.js';
import { antifraude } from './routes/antifraude.js';
import { disercoCotizaciones } from './routes/disercoCotizaciones.js';
import { disercoCatalogo } from './routes/disercoCatalogo.js';
import { disercoSalidas } from './routes/disercoSalidas.js';
import { requireRole } from './middleware/requireRole.js';
import { registrarAuditoria } from './lib/auditoria.js';
import { iniciarVigilancia, registrarLoginFallido } from './lib/antifraude.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(compression());
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Diagnóstico sin login: confirma si SUPABASE_SERVICE_ROLE_KEY quedó bien
// configurada en el entorno de despliegue, sin tener que entrar a la app.
app.get('/api/health/db', async (req, res) => {
  const { error } = await db.from('sucursales').select('id').limit(1);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true });
});

// Intentos fallidos de inicio de sesión (el login lo hace Supabase desde
// el navegador; la pantalla avisa aquí cuando falla). Sin token, con tope
// por IP para que no se pueda abusar.
const fallidosPorIp = new Map();
app.post('/api/sesion/login-fallido', async (req, res) => {
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();
  const minuto = Math.floor(Date.now() / 60000);
  const clave = `${ip}:${minuto}`;
  const n = (fallidosPorIp.get(clave) ?? 0) + 1;
  fallidosPorIp.set(clave, n);
  if (fallidosPorIp.size > 5000) fallidosPorIp.clear();
  if (n > 20) return res.status(429).end();
  await registrarLoginFallido(req, req.body?.acceso);
  res.status(204).end();
});

app.use('/api', requireAuth);

// El operario de planta (rol "produccion") solo puede usar su módulo de registro, y el
// gestor de proyecto (DISERCO) solo las salidas de material: nada de ventas, costos,
// precios ni clientes, aunque llamen a la API a mano.
const RUTAS_POR_ROL = {
  produccion: [/^\/api\/perfil$/, /^\/api\/sucursales$/, /^\/api\/registro-produccion(\/|$)/, /^\/api\/antifraude\/evento$/],
  gestor: [/^\/api\/perfil$/, /^\/api\/sucursales$/, /^\/api\/diserco\/salidas(\/|$)/, /^\/api\/diserco\/inventario$/, /^\/api\/antifraude\/evento$/],
};
app.use('/api', (req, res, next) => {
  const permitidas = RUTAS_POR_ROL[req.perfil?.rol];
  if (!permitidas) return next();
  const ruta = req.originalUrl.split('?')[0];
  if (permitidas.some((r) => r.test(ruta))) return next();
  registrarAuditoria(req, { accion: 'acceso.denegado', entidad: 'sistema', sucursalId: req.perfil.sucursal_id ?? null, detalle: { metodo: req.method, ruta, rol: req.perfil.rol } });
  res.status(403).json({ error: 'No tiene permiso para esta acción' });
});

// Perfil propio: sucursal, rol y flags (cierre ciego, sin horario)
app.get('/api/perfil', async (req, res) => {
  const todas = await todasLasEmpresas();
  res.json({ ...req.perfil, empresa_activa: req.empresa, empresas_info: todas.filter((e) => (req.perfil.empresas ?? ['ecostone']).includes(e.codigo)) });
});

app.get('/api/formas-pago', async (req, res) => {
  const { data, error } = await db.from('formas_pago').select('*').order('nombre');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.use('/api/sucursales', sucursales);
app.use('/api/categorias', categorias);
app.use('/api/productos', productos);
app.use('/api/clientes', clientes);
app.use('/api/puntos-emision', puntosEmision);
app.use('/api/ventas', ventas);
app.use('/api/ventas', facturaImpresion); // /api/ventas/:id/ticket, /api/ventas/:id/pdf
app.use('/api/anulaciones', anulaciones);
app.use('/api/cierres', cierres);
// Reportes y dashboard son de gerencia: antes cualquier cajero
// logueado podía pedir las ventas de todas las sucursales por la API.
app.use('/api/reportes', requireRole('admin', 'gerente'), reportes);
app.use('/api/usuarios', usuarios);
app.use('/api/dashboard', requireRole('admin', 'gerente'), dashboard);
app.use('/api/auditoria', auditoria);
app.use('/api/registro-produccion', registroProduccion);
app.use('/api/reporte-produccion', reporteProduccion);
app.use('/api/trazabilidad', trazabilidad);
app.use('/api/insumos', insumos);
app.use('/api/fabricacion', fabricacion);
app.use('/api/inventario', inventario);
app.use('/api/cotizaciones', cotizaciones);
app.use('/api', catalogoFabrica);
app.use('/api/antifraude', antifraude);
// DISERCO: solo para quien tiene acceso a esa empresa y la está usando.
app.use('/api/diserco', (req, res, next) => {
  if (req.empresa !== 'diserco') return res.status(403).json({ error: 'Entra a DISERCO para usar esta sección' });
  next();
});
app.use('/api/diserco/cotizaciones', disercoCotizaciones);
app.use('/api/diserco/salidas', disercoSalidas);
app.use('/api/diserco', disercoCatalogo);

// Sirve el build del frontend (un solo servicio Render, backend + frontend estático).
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
// index.html y el service worker nunca se cachean en el navegador: así
// cada caja detecta la versión nueva apenas se publica.
app.use(
  express.static(frontendDist, {
    setHeaders(res, ruta) {
      if (/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest)$/.test(ruta)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (/[\\/]assets[\\/]/.test(ruta)) {
        // Archivos con huella en el nombre: no cambian nunca, el navegador los guarda un año.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(frontendDist, 'index.html'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

const port = process.env.PORT || 4200;
app.listen(port, () => {
  console.log(`ecostone-facturacion backend escuchando en :${port}`);
  iniciarVigilancia();
  iniciarLiberacionAutomatica();
});
