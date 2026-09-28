-- La producción pasa a inventario N días después de registrarse (sin etapa de "curado").
insert into parametros (clave, valor, descripcion) values
  ('dias_a_inventario', '5', 'Días que tarda la producción en pasar a inventario')
on conflict (clave) do nothing;

update ordenes_produccion
set fecha_disponible = ((fecha_colado at time zone 'America/Tegucigalpa')::date + 5)
where estado = 'curando' and fecha_colado is not null;
