# EcoStone Facturación

Sistema de facturación fiscal (SAR/CAI/ISV), inventario, producción, pedidos y
despachos para **EcoStone (Stone Factory)**, fábrica de piedra de enchape en
San Pedro Sula, Honduras.

Nace de `italo-facturacion` (referencia, solo lectura) y se adapta a fábrica.
Stack: Node/Express + React/Vite PWA + Supabase + Render (un solo servicio).

## Estado por fases

| Fase | Contenido | Estado |
|---|---|---|
| F0 | Infraestructura, login, admin en la nube | ✅ |
| F1 | Catálogo de piedra, clientes, listas de precio, motor fiscal, POS, cierre | pendiente |
| F2 | Cotización de proyecto, pedidos, calendario | pendiente |
| F3 | Producción, recetas, inventario, costeo | pendiente |
| F4 | Despachos, cuentas por cobrar | pendiente |
| F5 | Reportes, dashboard, antifraude de fábrica | pendiente |
| F6 | Debug general y `docs/GUIA-ECOSTONE.md` | pendiente |

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
