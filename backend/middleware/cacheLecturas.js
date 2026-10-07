// Memoria de respuestas para lecturas que casi no cambian (catálogos, parámetros, contadores).
// Una sola instancia atiende todo, y TODA escritura (POST/PUT/PATCH/DELETE) vacía la memoria,
// así que nadie ve datos viejos tras guardar algo; el TTL cubre cambios hechos directo en la base.
const REGLAS = [
  [/^\/api\/sucursales$/, 60],
  [/^\/api\/formas-pago$/, 300],
  [/^\/api\/categorias$/, 60],
  [/^\/api\/listas-precio(\/precios)?$/, 60],
  [/^\/api\/insumos\/parametros$/, 60],
  [/^\/api\/antifraude\/reglas$/, 60],
  [/^\/api\/antifraude\/alertas\/(pendientes|nuevas)$/, 10],
  [/^\/api\/diserco\/productos$/, 30],
  [/^\/api\/productos$/, 30],
  [/^\/api\/perfil$/, 30],
];
const memoria = new Map();
const MAX = 600;

export function cacheLecturas(req, res, next) {
  if (req.method !== 'GET') {
    if (!['HEAD', 'OPTIONS'].includes(req.method)) res.on('finish', () => { if (res.statusCode < 400) memoria.clear(); });
    return next();
  }
  const ruta = req.originalUrl.split('?')[0];
  const regla = REGLAS.find(([r]) => r.test(ruta));
  if (!regla || !req.perfil) return next();
  const clave = `${req.perfil.id}|${req.empresa}|${req.originalUrl}`;
  const hit = memoria.get(clave);
  if (hit && hit.hasta > Date.now()) return res.status(200).json(hit.cuerpo);
  const json = res.json.bind(res);
  res.json = (cuerpo) => {
    if (res.statusCode === 200) {
      if (memoria.size > MAX) memoria.clear();
      memoria.set(clave, { cuerpo, hasta: Date.now() + regla[1] * 1000 });
    }
    return json(cuerpo);
  };
  next();
}
