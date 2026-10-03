-- DISERCO: cotizaciones (proyecto / productos), cobros con factura propia e inventario.

-- ── Inventario general (unidades enteras: kits, galones, cubetas…) ──────────
create table if not exists inv_movimientos (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  producto_id uuid not null references productos(id),
  tipo text not null check (tipo in ('inicial','compra','venta','ajuste','devolucion')),
  cantidad numeric(14,3) not null,                 -- + entra, - sale
  costo_unitario numeric(14,4) not null default 0, -- sin ISV
  motivo text,
  proveedor text,
  referencia text,
  venta_id uuid references ventas(id),
  usuario_id uuid references perfiles(id)
);
create index if not exists inv_movimientos_idx on inv_movimientos (producto_id, created_at desc);
alter table inv_movimientos enable row level security;

create or replace view inv_stock with (security_invoker = true) as
  select producto_id, coalesce(sum(cantidad), 0) as existencia, max(created_at) as ultimo_movimiento
  from inv_movimientos group by producto_id;

create or replace function inv_registrar(
  p_producto uuid, p_tipo text, p_cantidad numeric, p_costo numeric default 0,
  p_motivo text default null, p_venta uuid default null, p_proveedor text default null,
  p_referencia text default null, p_usuario uuid default null
) returns inv_movimientos
language plpgsql set search_path = public, pg_temp as $$
declare
  v_exist numeric; v_costo_ant numeric; v_mov inv_movimientos%rowtype;
begin
  select coalesce(costo_estandar, 0) into v_costo_ant from productos where id = p_producto for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if p_cantidad = 0 then raise exception 'La cantidad no puede ser cero'; end if;
  select coalesce(sum(cantidad), 0) into v_exist from inv_movimientos where producto_id = p_producto;
  if p_cantidad < 0 and v_exist + p_cantidad < 0 then
    raise exception 'Existencia insuficiente: hay %, se piden %', v_exist, abs(p_cantidad);
  end if;
  insert into inv_movimientos (producto_id, tipo, cantidad, costo_unitario, motivo, proveedor, referencia, venta_id, usuario_id)
  values (p_producto, p_tipo, p_cantidad, coalesce(p_costo, 0), p_motivo, p_proveedor, p_referencia, p_venta, p_usuario)
  returning * into v_mov;
  -- Costo promedio ponderado al entrar mercadería con costo.
  if p_cantidad > 0 and p_tipo in ('compra','inicial') and coalesce(p_costo, 0) > 0 then
    update productos set costo_estandar = round(((greatest(v_exist, 0) * v_costo_ant) + (p_cantidad * p_costo)) / (greatest(v_exist, 0) + p_cantidad), 4)
    where id = p_producto;
  end if;
  return v_mov;
end $$;
revoke execute on function inv_registrar(uuid,text,numeric,numeric,text,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function inv_registrar(uuid,text,numeric,numeric,text,uuid,text,text,uuid) to service_role;

-- ── Cotizaciones DISERCO ─────────────────────────────────────────────────────
create table if not exists d_contador (
  anio int primary key,
  ultimo int not null default 0
);
alter table d_contador enable row level security;
insert into d_contador (anio, ultimo) values (2026, 60) on conflict (anio) do nothing;  -- la última fue la 0060-26

create or replace function d_siguiente_numero(p_anio int) returns int
language plpgsql set search_path = public, pg_temp as $$
declare v int;
begin
  insert into d_contador (anio, ultimo) values (p_anio, 1)
  on conflict (anio) do update set ultimo = d_contador.ultimo + 1
  returning ultimo into v;
  return v;
end $$;
revoke execute on function d_siguiente_numero(int) from public, anon, authenticated;
grant execute on function d_siguiente_numero(int) to service_role;

create table if not exists d_cotizaciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('proyecto','productos')),
  numero int not null,
  anio int not null,
  codigo text not null unique,
  estado text not null default 'borrador' check (estado in ('borrador','enviada','aprobada','rechazada','facturada','anulada')),
  cliente_id uuid references clientes(id),
  nombre_cliente text not null,
  rtn_cliente text, telefono text, email text,
  contacto text,
  proyecto text,
  ubicacion text,
  vigencia_dias int not null default 30,
  fecha_vigencia date,
  descuento_pct numeric(5,2) not null default 0,
  subtotal numeric(14,2) not null default 0,
  isv numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  anticipo_pct numeric(5,2) not null default 0,
  secciones jsonb not null default '[]'::jsonb,
  mostrar_bancos boolean not null default false,
  firma_nombre text, firma_cargo text,
  notas_internas text,
  motivo_cierre text,
  aprobada_at timestamptz,
  aprobada_por uuid references perfiles(id),
  vendedor_id uuid references perfiles(id),
  sucursal_id uuid references sucursales(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists d_cotizaciones_idx on d_cotizaciones (estado, created_at desc);
alter table d_cotizaciones enable row level security;

create table if not exists d_cotizacion_lineas (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references d_cotizaciones(id) on delete cascade,
  orden int not null default 0,
  producto_id uuid references productos(id),
  descripcion text not null,
  presentacion text,
  cantidad numeric(14,3) not null check (cantidad > 0),
  unidad text not null default 'm2',
  precio_unitario numeric(14,4) not null check (precio_unitario >= 0),   -- sin ISV
  isv_tasa numeric(5,4) not null default 0.15,
  monto numeric(14,2) not null default 0,                                 -- con ISV
  costo_unitario numeric(14,4) not null default 0
);
create index if not exists d_cotizacion_lineas_idx on d_cotizacion_lineas (cotizacion_id, orden);
alter table d_cotizacion_lineas enable row level security;

create table if not exists d_cotizacion_pagos (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references d_cotizaciones(id) on delete cascade,
  concepto text not null,
  forma_pago_id uuid not null references formas_pago(id),
  monto numeric(14,2) not null check (monto > 0),
  referencia text,
  venta_id uuid references ventas(id),
  usuario_id uuid references perfiles(id),
  created_at timestamptz not null default now()
);
alter table d_cotizacion_pagos enable row level security;
