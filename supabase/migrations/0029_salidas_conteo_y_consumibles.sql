-- Salidas a proyecto: al terminar se cuenta lo que regresó. consumible=false → debe regresar (moldes, herramientas).
alter table productos add column if not exists consumible boolean not null default true;
alter table d_salidas add column if not exists resumen jsonb;
update productos set consumible = false
 where empresa = 'diserco'
   and categoria_id in (select id from categorias where empresa = 'diserco' and nombre in ('MOLDES','ALQUILER Y MOLDES USADOS','HERRAMIENTAS'));
