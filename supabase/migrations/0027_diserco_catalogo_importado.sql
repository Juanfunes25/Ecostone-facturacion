-- Catálogo DISERCO importado desde WizPOS (278 productos, 16 categorías, existencias iniciales).
-- Datos fuente: supabase/seeds/diserco/*.csv. Aplicado directamente en la base el 2026-10-03.
alter table productos alter column precio type numeric(14,4);   -- precios sin ISV con 4 decimales (precio_con_isv exacto)
alter table productos add column if not exists marca text;
