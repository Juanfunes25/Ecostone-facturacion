# Diserco (WizPOS) → nueva base de datos: paquete de importación

Origen: https://diserco.wizpos.cloud · extraído 2026-10-03 (solo lectura) · Moneda HNL · ISV 15%.

## Decisiones del dueño (ya confirmadas, aplicadas en `import_listo/`)
1. `precio` de WizPOS **incluye ISV**. Se guarda `precio_con_isv` (original) y `precio_sin_isv = precio / 1.15` (Exento: tasa 0). Verificado: sin_isv × (1+tasa) = con_isv en las 278 filas.
2. **Solo productos activos**; se excluyen los 8 inactivos y el producto técnico id 307 (`PRODUCTO PARA CLOUDBEDS, NO MODIFICAR`). Lista en `import_listo/excluidos.json`. Importados: **278 productos**.
3. **Existencias**: se importan como `existencia_inicial`; las negativas (54) entran como 0 (alerta `existencia_negativa_a_cero`; el valor original está en `diserco_RAW_todo.json`).
4. Base destino **aún sin esquema definido** → `import_listo/schema.sql` es una PROPUESTA (SQLite/Postgres compatible). Adaptar al esquema real antes de usar; los CSV sirven para cualquier esquema.

## Contenido
- `import_listo/schema.sql`, `seed.sql` (schema + INSERTs, probado cargando en SQLite sin errores ni FKs rotas), `productos.csv` (278), `categorias.csv` (20), `marcas.csv` (8).
- `diserco_RAW_todo.json` — respuesta completa de la API (fuente de verdad). `diserco_catalogo.xlsx` y CSV sueltos — vista de revisión (incluyen inactivos).
- Se conserva `id_origen_wizpos` en todas las tablas para poder conciliar con WizPOS.

## Cosas a vigilar
- Categorías: 2 niveles. Padres (ESTAMPADO 14, SERVICIOS 16, OTROS 17, MICROCEMENTO 18) no tenían productos propios. Existe hija MICROCEMENTO (13) con padre también llamado MICROCEMENTO (18): no fusionar. Importar padres antes que hijas (seed.sql ya lo hace).
- Columna `alerta` (informativa, no bloquea): costo_cero 154, sin_marca 108, precio_cero 29, nombre_duplicado 6 filas (ids distintos, NO fusionar sin confirmar), compuesto_sin_componentes 9.
- `costo`: no se sabe si incluye ISV; se importó tal cual.
- Productos tipo **Compuesto** (9 activos): sus componentes/ingredientes NO están extraídos (en WizPOS: `/api/componentes/{id}`). Pendiente.
- **Clientes y proveedores: PENDIENTE** (pantalla `#/parametros/clienteyproveedor`; endpoint no hallado aún). No inventar datos.
