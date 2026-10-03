-- DISERCO: punto de emisión propio (002) para no chocar con los números de la planta,
-- salidas de material a proyecto y facturación con inventario forzado (con aviso).
update puntos_emision set punto_emision_codigo = '002'
 where sucursal_id = (select id from sucursales where alias = 'diserco') and correlativo_actual = 1;

alter table inv_movimientos add column if not exists salida_id uuid;
alter table inv_movimientos drop constraint if exists inv_movimientos_tipo_check;
alter table inv_movimientos add constraint inv_movimientos_tipo_check
  check (tipo in ('inicial','compra','venta','ajuste','devolucion','salida_proyecto','retorno_proyecto'));

create table if not exists d_salidas (
  id uuid primary key default gen_random_uuid(),
  numero serial,
  proyecto text not null,
  cotizacion_id uuid references d_cotizaciones(id),
  responsable text not null,
  notas text,
  estado text not null default 'abierta' check (estado in ('abierta','cerrada')),
  sucursal_id uuid references sucursales(id),
  creada_por uuid references perfiles(id),
  created_at timestamptz not null default now(),
  cerrada_at timestamptz,
  cerrada_por uuid references perfiles(id)
);
create index if not exists d_salidas_idx on d_salidas (estado, created_at desc);
alter table d_salidas enable row level security;
create table if not exists d_salida_items (
  id uuid primary key default gen_random_uuid(),
  salida_id uuid not null references d_salidas(id) on delete cascade,
  producto_id uuid not null references productos(id),
  cantidad_salida numeric(14,3) not null default 0,
  cantidad_retorno numeric(14,3) not null default 0,
  costo_unitario numeric(14,4) not null default 0,
  unique (salida_id, producto_id)
);
alter table d_salida_items enable row level security;

-- inv_mover = inv_registrar + p_forzar (permite existencia negativa si se confirmó) + p_salida.
create or replace function inv_mover(
  p_producto uuid, p_tipo text, p_cantidad numeric, p_costo numeric default 0,
  p_motivo text default null, p_venta uuid default null, p_proveedor text default null,
  p_referencia text default null, p_usuario uuid default null, p_forzar boolean default false, p_salida uuid default null
) returns inv_movimientos
language plpgsql set search_path = public, pg_temp as $$
declare
  v_exist numeric; v_costo_ant numeric; v_mov inv_movimientos%rowtype;
begin
  select coalesce(costo_estandar, 0) into v_costo_ant from productos where id = p_producto for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if p_cantidad = 0 then raise exception 'La cantidad no puede ser cero'; end if;
  select coalesce(sum(cantidad), 0) into v_exist from inv_movimientos where producto_id = p_producto;
  if p_cantidad < 0 and v_exist + p_cantidad < 0 and not p_forzar then
    raise exception 'Existencia insuficiente: hay %, se piden %', v_exist, abs(p_cantidad);
  end if;
  insert into inv_movimientos (producto_id, tipo, cantidad, costo_unitario, motivo, proveedor, referencia, venta_id, usuario_id, salida_id)
  values (p_producto, p_tipo, p_cantidad, coalesce(p_costo, 0), p_motivo, p_proveedor, p_referencia, p_venta, p_usuario, p_salida)
  returning * into v_mov;
  if p_cantidad > 0 and p_tipo in ('compra','inicial') and coalesce(p_costo, 0) > 0 then
    update productos set costo_estandar = round(((greatest(v_exist, 0) * v_costo_ant) + (p_cantidad * p_costo)) / (greatest(v_exist, 0) + p_cantidad), 4)
    where id = p_producto;
  end if;
  return v_mov;
end $$;
revoke execute on function inv_mover(uuid,text,numeric,numeric,text,uuid,text,text,uuid,boolean,uuid) from public, anon, authenticated;
grant execute on function inv_mover(uuid,text,numeric,numeric,text,uuid,text,text,uuid,boolean,uuid) to service_role;
