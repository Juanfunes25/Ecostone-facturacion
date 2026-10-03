-- Multiempresa: EcoStone (Stone Factory S.A.) y DISERCO comparten el sistema.
-- La separación fiscal sale de la sucursal: cada empresa tiene sus sucursales,
-- sus puntos de emisión (CAI/correlativo) y por lo tanto sus facturas y cierres.
create table if not exists empresas (
  codigo text primary key,
  nombre text not null,
  razon_social text not null,
  rtn text,
  direccion text,
  ciudad text,
  telefono text,
  correo text,
  web text,
  color text,
  orden int not null default 0
);
alter table empresas enable row level security;

insert into empresas (codigo, nombre, razon_social, rtn, direccion, ciudad, telefono, correo, web, color, orden) values
  ('diserco', 'DISERCO', 'Distribución y Servicios de la Construcción', null, 'Prolongación Av. Junior, 18 y 19 calle, 4 ave. N.E.', 'San Pedro Sula, Honduras', '(504) 2552-2503', null, 'www.diserco.hn', '#e8762b', 1),
  ('ecostone', 'EcoStone', 'Stone Factory S.A.', '05019013557791', '7 Calle, 14 Ave S.O.', 'San Pedro Sula, Honduras', '3191-2727', 'administracion@ecostone.com.hn', null, '#4f6b3c', 2)
on conflict (codigo) do nothing;

alter table sucursales add column if not exists empresa text not null default 'ecostone' references empresas(codigo);
alter table perfiles add column if not exists empresas text[] not null default '{ecostone}';
alter table productos add column if not exists empresa text not null default 'ecostone' references empresas(codigo);
alter table categorias add column if not exists empresa text not null default 'ecostone' references empresas(codigo);
alter table productos add column if not exists presentacion text;
alter table productos add column if not exists rendimiento_texto text;
alter table productos add column if not exists controla_inventario boolean not null default false;
alter table productos add column if not exists stock_minimo numeric(14,3) not null default 0;
create index if not exists productos_empresa_idx on productos (empresa);

-- Sucursal y punto de emisión de DISERCO (en modo BORRADOR hasta tener el CAI real).
insert into sucursales (nombre, alias, direccion, color, empresa)
select 'DISERCO', 'diserco', 'Prolongación Av. Junior, 18 y 19 calle, 4 ave. N.E., San Pedro Sula', '#e8762b', 'diserco'
where not exists (select 1 from sucursales where alias = 'diserco');

insert into puntos_emision (sucursal_id, punto_emision_codigo, punto_venta_codigo, tipo_documento_codigo, correlativo_desde, correlativo_hasta, correlativo_actual, es_borrador, activo)
select s.id, '001', '001', '01', 1, 99999999, 1, true, true from sucursales s
where s.alias = 'diserco' and not exists (select 1 from puntos_emision p where p.sucursal_id = s.id);

-- El administrador entra a las dos empresas.
update perfiles set empresas = '{diserco,ecostone}' where rol = 'admin';

-- Categoría base del catálogo DISERCO.
insert into categorias (nombre, orden, empresa)
select x.n, x.o, 'diserco' from (values ('Epóxicos', 1), ('Poliuretanos y selladores', 2), ('Pulido y preparación', 3), ('Otros', 9)) as x(n, o)
where not exists (select 1 from categorias where empresa = 'diserco');
