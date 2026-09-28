// Exportar una lista de objetos a CSV y descargarla — sin dependencias,
// para el contador (facturas, reportes de ventas/ISV, etc.).
export function descargarCsv(nombreArchivo, filas, columnas) {
  const escapar = (valor) => {
    const texto = valor === null || valor === undefined ? '' : String(valor);
    return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };

  const encabezado = columnas.map((c) => escapar(c.titulo)).join(',');
  const lineas = filas.map((fila) => columnas.map((c) => escapar(c.valor(fila))).join(','));
  const csv = [encabezado, ...lineas].join('\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  URL.revokeObjectURL(url);
}
