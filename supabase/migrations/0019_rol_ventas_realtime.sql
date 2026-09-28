-- El rol "ventas" ve solo su sucursal en tiempo real, igual que el cajero.
drop policy if exists "ventas: lectura segun sucursal del perfil" on ventas;
create policy "ventas: lectura segun sucursal del perfil"
  on ventas for select to authenticated
  using (
    exists (
      select 1 from perfiles p
      where p.id = (select auth.uid())
        and p.activo
        and (p.rol not in ('cajero', 'ventas') or p.sucursal_id is null or p.sucursal_id = ventas.sucursal_id)
    )
  );
