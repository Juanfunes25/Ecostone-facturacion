// Supabase (PostgREST) devuelve como máximo 1000 filas por consulta. Un mes
// de 5 sucursales pasa de sobra ese número, y los reportes quedaban
// cortados en silencio. traerTodo() pide por páginas hasta agotar.
//
// crearQuery debe devolver una consulta NUEVA en cada llamada (el builder de
// Supabase no se puede reusar) y con un orden estable.
export async function traerTodo(crearQuery, tamanoPagina = 1000) {
  const filas = [];
  for (let desde = 0; ; desde += tamanoPagina) {
    const { data, error } = await crearQuery().range(desde, desde + tamanoPagina - 1);
    if (error) throw new Error(error.message);
    filas.push(...data);
    if (data.length < tamanoPagina) return filas;
  }
}

// .in('col', ids) con miles de ids arma una URL demasiado larga; se parte
// en lotes y se juntan los resultados.
export async function traerPorIds(crearQuery, columna, ids, tamanoLote = 150) {
  const unicos = [...new Set(ids)].filter(Boolean);
  const filas = [];
  for (let i = 0; i < unicos.length; i += tamanoLote) {
    const lote = unicos.slice(i, i + tamanoLote);
    filas.push(...(await traerTodo(() => crearQuery().in(columna, lote))));
  }
  return filas;
}

// Texto libre del usuario dentro de un filtro .or() de PostgREST: comas,
// paréntesis y comillas cambian la estructura del filtro, así que se quitan.
export function textoSeguroFiltro(texto) {
  return String(texto ?? '')
    .replace(/[,()"'\\*%:]/g, ' ')
    .trim()
    .slice(0, 60);
}
