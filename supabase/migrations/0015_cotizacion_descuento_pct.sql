-- El descuento de una cotización es opcional (negociado) y se captura en porcentaje.
alter table cotizaciones add column if not exists descuento_pct numeric(5,2) not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100);
