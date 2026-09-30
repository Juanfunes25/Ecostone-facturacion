-- Trazabilidad: cada lote genera su etiqueta al registrarse la producción.
alter table ordenes_produccion
  add column if not exists etiqueta_at timestamptz,
  add column if not exists etiquetas_impresas int not null default 0;
update ordenes_produccion set etiqueta_at = fecha_colado where fecha_colado is not null and etiqueta_at is null;
create index if not exists movimientos_pt_lote_idx on movimientos_pt (lote);
create index if not exists ordenes_produccion_lote_idx on ordenes_produccion (lote);
