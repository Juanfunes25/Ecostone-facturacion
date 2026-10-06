-- Excel original de cada cotización importada (se guarda junto a la cotización).
create table if not exists d_cotizacion_archivos (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references d_cotizaciones(id) on delete cascade,
  nombre text not null,
  contenido text not null, -- base64
  created_at timestamptz not null default now()
);
create index if not exists d_cotizacion_archivos_cot_idx on d_cotizacion_archivos(cotizacion_id);
alter table d_cotizacion_archivos enable row level security;
