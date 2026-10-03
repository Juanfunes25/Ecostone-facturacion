-- Cobros de DISERCO anulables y unidades de venta para productos de DISERCO.
alter table d_cotizacion_pagos add column if not exists anulado boolean not null default false;
alter table productos drop constraint if exists productos_unidad_venta_check;
alter table productos add constraint productos_unidad_venta_check check (unidad_venta = any (array['m2','caja','pieza','ml','saco','galon','unidad','viaje','global','kit','cubeta','litro']));
