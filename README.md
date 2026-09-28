# EcoStone Facturación

Sistema de facturación fiscal (SAR/CAI/ISV), inventario, producción, pedidos y
despachos para **EcoStone (Stone Factory)**, fábrica de piedra de enchape en
San Pedro Sula, Honduras.

Nace de `italo-facturacion` (referencia, solo lectura) y se adapta a fábrica.
Stack: Node/Express + React/Vite PWA + Supabase + Render (un solo servicio).

## Flujo de negocio

```
Cotización ─► (cliente acepta) Aprobada ─► Cobro (anticipo / pago) ─► Factura (CAI)
                    │                                                   
                    ├─ reserva piedra en bodega (FIFO por lote)
                    └─ lo que falta ─► Orden de producción ─► Colada (descuenta insumos)
                                        ─► Curado ─► Control de calidad ─► Inventario
```

## Módulos

| Módulo | Qué hace |
|---|---|
| Cotizaciones | m² netos + desperdicio → cajas completas, accesorios sugeridos por rendimiento, flete, instalación, ISV incluido o separado según la lista, PDF de marca y correo |
| Catálogo de piedra | Modelo + color, unidad de venta (m², caja, pieza, ml…), listas Público / Contratista / Distribuidor |
| Producción | Órdenes con lote, colada, curado, cierre con 1ª / 2ª / merma, calidad (ASTM C1670), MRP de compras, agenda, moldes |
| Recetas y costos | Insumos por m², merma, mano de obra, indirectos → costo por m² y margen |
| Insumos | Kardex, costo promedio ponderado, compras en L o US$, proveedores, mínimos |
| Inventario | Producto terminado por lote y calidad; físico, reservado y disponible; conteo sorpresa |
| Antifraude | Consumo fuera de receta, merma alta, ajustes repetidos, descuento sobre tope, precio bajo lista |

## Estado por fases

| Fase | Contenido | Estado |
|---|---|---|
| F0 | Infraestructura, login, admin en la nube | ✅ |
| F1 (parcial) | Catálogo, listas de precio, motor fiscal, facturas, cierre | ✅ base · pendiente: POS de mostrador por m², terminales POS/bancos configurables |
| F2 | Cotización de proyecto, aprobación, cobro, factura | ✅ |
| F3 | Producción, recetas, inventario, costeo, calidad | ✅ |
| F4 | Despachos con guía y cuentas por cobrar | pendiente |
| F5 | Reportes de fábrica y dashboard | pendiente |
| F6 | Debug general y `docs/GUIA-ECOSTONE.md` | pendiente |

Pruebas: `npm test --prefix backend` (cálculo de cotizaciones y equivalencia frontend/backend).

## Desarrollo local

```bash
cd backend  && cp .env.example .env && npm i && npm run dev   # :4200
cd frontend && cp .env.example .env && npm i && npm run dev   # :5174
```

## Variables de entorno (Render)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`; opcionales `GMAIL_USER`, `GMAIL_APP_PASSWORD`,
`RESUMEN_CIERRE_EMAIL`. Nunca subir secretos al repo.

## Base de datos

Migraciones en `supabase/migrations/` (en orden). Los puntos de emisión están en
**modo borrador** (`BORRADOR-…`, sin validez fiscal) hasta cargar el CAI real.

## Datos de empresa

Un solo archivo: `backend/lib/empresa.js` (los `[PENDIENTE]` se completan ahí).
