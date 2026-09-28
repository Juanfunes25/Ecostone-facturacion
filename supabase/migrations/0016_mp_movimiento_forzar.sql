-- La producción ya ocurrió en planta: se registra aunque el sistema tenga menos
-- existencia de insumos (p_forzar). Queda stock negativo y el backend crea una alerta.
drop function if exists mp_registrar_movimiento(uuid,text,numeric,numeric,text,numeric,uuid,text,text,uuid,uuid);
create or replace function mp_registrar_movimiento(
  p_mp uuid, p_tipo text, p_cantidad numeric, p_costo numeric default null,
  p_moneda text default 'HNL', p_tc numeric default 1, p_proveedor uuid default null,
  p_documento text default null, p_motivo text default null,
  p_orden uuid default null, p_usuario uuid default null, p_forzar boolean default false
) returns movimientos_mp
language plpgsql set search_path = public, pg_temp as $$
declare
  v_mp materias_primas%rowtype;
  v_stock numeric;
  v_costo numeric;
  v_mov movimientos_mp%rowtype;
begin
  select * into v_mp from materias_primas where id = p_mp for update;
  if v_mp is null then raise exception 'Insumo no encontrado'; end if;
  if p_cantidad = 0 then raise exception 'La cantidad no puede ser cero'; end if;
  select coalesce(sum(cantidad), 0) into v_stock from movimientos_mp where mp_id = p_mp;
  if p_cantidad < 0 and v_stock + p_cantidad < 0 and not p_forzar then
    raise exception 'Stock insuficiente de %: hay % %, se piden %', v_mp.nombre, v_stock, v_mp.unidad, abs(p_cantidad);
  end if;
  v_costo := v_mp.costo_promedio;
  if p_tipo in ('compra','inicial') and p_cantidad > 0 then
    v_costo := coalesce(p_costo, 0) * case when p_moneda = 'USD' then p_tc else 1 end;
    update materias_primas set
      costo_promedio = case when v_stock + p_cantidad > 0
        then round((greatest(v_stock,0) * costo_promedio + p_cantidad * v_costo) / (greatest(v_stock,0) + p_cantidad), 4)
        else v_costo end
    where id = p_mp;
  end if;
  insert into movimientos_mp (mp_id, tipo, cantidad, costo_unitario, moneda, tipo_cambio, proveedor_id, documento, motivo, orden_produccion_id, usuario_id)
  values (p_mp, p_tipo, p_cantidad, v_costo, p_moneda, p_tc, p_proveedor, p_documento, p_motivo, p_orden, p_usuario)
  returning * into v_mov;
  return v_mov;
end $$;
revoke execute on function mp_registrar_movimiento(uuid,text,numeric,numeric,text,numeric,uuid,text,text,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function mp_registrar_movimiento(uuid,text,numeric,numeric,text,numeric,uuid,text,text,uuid,uuid,boolean) to service_role;

create index if not exists ordenes_produccion_colado_idx on ordenes_produccion (fecha_colado);
create index if not exists orden_consumos_orden_idx on orden_consumos (orden_id);
