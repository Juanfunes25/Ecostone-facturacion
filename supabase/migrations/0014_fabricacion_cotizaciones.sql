-- Fabricación (insumos, recetas, moldes, producción, calidad, inventario) y
-- ciclo comercial (cotización → aprobación/pago → factura). Todo el acceso pasa
-- por el backend (service_role): RLS activo y sin políticas.

-- ── Parámetros configurables ────────────────────────────────────────────────
create table parametros (
  clave text primary key,
  valor jsonb not null,
  descripcion text,
  updated_at timestamptz not null default now()
);
alter table parametros enable row level security;
insert into parametros (clave, valor, descripcion) values
  ('tipo_cambio_usd', '26.3', 'L por USD (editable; [SUPUESTO] hasta confirmar)'),
  ('desperdicio_default_pct', '8', '% de desperdicio sugerido en cotizaciones (5 a 10)'),
  ('isv_tasa', '0.15', 'Tasa de ISV'),
  ('vigencia_cotizacion_dias', '15', 'Días de vigencia de una cotización'),
  ('anticipo_pct_default', '0', '% de anticipo por defecto (0 = pago total)'),
  ('tolerancia_consumo_pct', '10', 'Desvío tolerado entre consumo real y receta'),
  ('merma_maxima_pct', '8', 'Merma normal de producción (alerta si se pasa)'),
  ('descuento_max_vendedor_pct', '5', 'Tope de descuento del vendedor'),
  ('descuento_max_gerente_pct', '15', 'Tope de descuento del gerente'),
  ('coladas_por_molde_dia', '1', 'Coladas por molde por día (desmolde a las 24 h)');

-- ── Proveedores ─────────────────────────────────────────────────────────────
create table proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rtn text,
  contacto text,
  telefono text,
  email text,
  dias_credito int not null default 0,
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table proveedores enable row level security;

-- ── Materias primas (insumos) ───────────────────────────────────────────────
create type categoria_mp as enum
  ('cemento','arena','agregado','aditivo','pigmento','desmoldante','sellador','fibra','empaque','molde','otro');

create table materias_primas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  nombre text not null,
  categoria categoria_mp not null default 'otro',
  unidad text not null default 'kg',
  costo_promedio numeric(14,4) not null default 0,      -- siempre en Lempiras
  moneda text not null default 'HNL' check (moneda in ('HNL','USD')),  -- moneda habitual de compra
  stock_minimo numeric(14,3) not null default 0,
  proveedor_id uuid references proveedores(id),
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table materias_primas enable row level security;

create table movimientos_mp (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  mp_id uuid not null references materias_primas(id),
  tipo text not null check (tipo in ('inicial','compra','consumo','merma','ajuste','devolucion')),
  cantidad numeric(14,3) not null,                      -- + entra, - sale
  costo_unitario numeric(14,4) not null default 0,      -- en Lempiras
  moneda text not null default 'HNL',
  tipo_cambio numeric(10,4) not null default 1,
  proveedor_id uuid references proveedores(id),
  documento text,
  motivo text,
  orden_produccion_id uuid,
  usuario_id uuid references perfiles(id)
);
create index movimientos_mp_mp_idx on movimientos_mp (mp_id, created_at desc);
alter table movimientos_mp enable row level security;

create view stock_mp with (security_invoker = true) as
  select mp_id, coalesce(sum(cantidad), 0) as stock from movimientos_mp group by mp_id;

-- Movimiento atómico: bloquea el insumo, impide stock negativo y recalcula el
-- costo promedio ponderado en cada compra (los precios en USD se convierten al
-- tipo de cambio del día y se guardan en Lempiras).
create or replace function mp_registrar_movimiento(
  p_mp uuid, p_tipo text, p_cantidad numeric, p_costo numeric default null,
  p_moneda text default 'HNL', p_tc numeric default 1, p_proveedor uuid default null,
  p_documento text default null, p_motivo text default null,
  p_orden uuid default null, p_usuario uuid default null
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
  if p_cantidad < 0 and v_stock + p_cantidad < 0 then
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
revoke execute on function mp_registrar_movimiento(uuid,text,numeric,numeric,text,numeric,uuid,text,text,uuid,uuid) from public, anon, authenticated;
grant execute on function mp_registrar_movimiento(uuid,text,numeric,numeric,text,numeric,uuid,text,text,uuid,uuid) to service_role;

-- ── Catálogo de piedra: atributos de fábrica ────────────────────────────────
alter table productos
  add column if not exists tipo text not null default 'piedra' check (tipo in ('piedra','accesorio','servicio','otro')),
  add column if not exists modelo text,
  add column if not exists color text,
  add column if not exists unidad_venta text not null default 'm2' check (unidad_venta in ('m2','caja','pieza','ml','saco','galon','unidad','viaje','global')),
  add column if not exists m2_por_caja numeric(10,4),
  add column if not exists piezas_por_m2 numeric(10,3),
  add column if not exists peso_kg_m2 numeric(10,2),
  add column if not exists rendimiento_m2 numeric(10,3),   -- accesorios: m² que cubre una unidad
  add column if not exists costo_estandar numeric(14,4) not null default 0,
  add column if not exists stock_minimo_m2 numeric(12,3) not null default 0,
  add column if not exists descripcion text;
alter table detalle_venta alter column precio_unitario type numeric(14,4);

-- ── Listas de precio ────────────────────────────────────────────────────────
create table listas_precio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  isv_incluido boolean not null default false,           -- true: precios ya incluyen ISV (mostrador)
  orden int not null default 0,
  activo boolean not null default true
);
alter table listas_precio enable row level security;
insert into listas_precio (nombre, isv_incluido, orden) values
  ('Público', true, 1), ('Contratista', false, 2), ('Distribuidor', false, 3);

create table precios_producto (
  producto_id uuid not null references productos(id) on delete cascade,
  lista_id uuid not null references listas_precio(id) on delete cascade,
  precio numeric(14,4) not null check (precio >= 0),
  primary key (producto_id, lista_id)
);
alter table precios_producto enable row level security;

alter table clientes
  add column if not exists tipo_cliente text not null default 'final' check (tipo_cliente in ('final','constructora','arquitecto','instalador','ferreteria','distribuidor')),
  add column if not exists lista_precio_id uuid references listas_precio(id),
  add column if not exists limite_credito numeric(12,2) not null default 0,
  add column if not exists dias_credito int not null default 0;

create table zonas_flete (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  tarifa numeric(12,2) not null default 0,
  activo boolean not null default true
);
alter table zonas_flete enable row level security;

-- ── Moldes ──────────────────────────────────────────────────────────────────
create table moldes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  producto_id uuid references productos(id),
  piezas_por_colada int not null default 1,
  m2_por_colada numeric(10,3) not null default 0,
  vida_util_usos int not null default 300,
  usos int not null default 0,
  estado text not null default 'activo' check (estado in ('activo','mantenimiento','baja')),
  notas text,
  created_at timestamptz not null default now()
);
alter table moldes enable row level security;

-- ── Recetas (consumo de insumos por m² terminado) ───────────────────────────
create table recetas (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id),
  nombre text not null,
  merma_esperada_pct numeric(5,2) not null default 5,
  mano_obra_m2 numeric(12,2) not null default 0,
  indirectos_m2 numeric(12,2) not null default 0,
  dias_curado int not null default 7,
  horas_desmolde int not null default 24,
  notas text,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index recetas_activa_idx on recetas (producto_id) where activa;
alter table recetas enable row level security;

create table receta_items (
  receta_id uuid not null references recetas(id) on delete cascade,
  mp_id uuid not null references materias_primas(id),
  cantidad_m2 numeric(14,4) not null check (cantidad_m2 > 0),
  primary key (receta_id, mp_id)
);
alter table receta_items enable row level security;

-- ── Cotizaciones ────────────────────────────────────────────────────────────
create sequence cotizaciones_numero_seq start 1001;
create table cotizaciones (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null default nextval('cotizaciones_numero_seq'),
  estado text not null default 'borrador' check (estado in ('borrador','enviada','aprobada','rechazada','vencida','facturada','anulada')),
  cliente_id uuid references clientes(id),
  nombre_cliente text not null,
  rtn_cliente text, telefono text, email text,
  proyecto text not null,
  direccion_obra text,
  lista_precio_id uuid references listas_precio(id),
  isv_incluido boolean not null default false,
  vigencia_dias int not null default 15,
  fecha_vigencia date,
  descuento numeric(12,2) not null default 0,
  subtotal numeric(14,2) not null default 0,
  isv numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  anticipo_pct numeric(5,2) not null default 0,
  entrega text not null default 'despacho' check (entrega in ('retira','despacho')),
  fecha_entrega date,
  aprobada_at timestamptz,
  aprobada_por uuid references perfiles(id),
  venta_id uuid references ventas(id),
  vendedor_id uuid references perfiles(id),
  sucursal_id uuid references sucursales(id),
  notas text,
  motivo_cierre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cotizaciones_estado_idx on cotizaciones (estado, created_at desc);
alter table cotizaciones enable row level security;
alter table ventas add column if not exists cotizacion_id uuid references cotizaciones(id);

create table cotizacion_lineas (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references cotizaciones(id) on delete cascade,
  orden int not null default 0,
  tipo text not null default 'producto' check (tipo in ('producto','accesorio','flete','instalacion','otro')),
  producto_id uuid references productos(id),
  descripcion text not null,
  unidad text not null default 'm2',
  m2_neto numeric(12,3),
  desperdicio_pct numeric(5,2) not null default 0,
  cajas numeric(12,3),
  cantidad numeric(12,3) not null check (cantidad > 0),   -- unidades vendidas (m² ya redondeados a cajas)
  precio_unitario numeric(14,4) not null check (precio_unitario >= 0),
  descuento_pct numeric(5,2) not null default 0,
  isv_tasa numeric(5,4) not null default 0.15,
  monto numeric(14,2) not null default 0,                 -- total de la línea con ISV
  costo_unitario numeric(14,4) not null default 0
);
create index cotizacion_lineas_idx on cotizacion_lineas (cotizacion_id, orden);
alter table cotizacion_lineas enable row level security;

create table cotizacion_pagos (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references cotizaciones(id) on delete cascade,
  tipo text not null default 'pago' check (tipo in ('anticipo','pago')),
  forma_pago_id uuid not null references formas_pago(id),
  monto numeric(14,2) not null check (monto > 0),
  referencia text,
  usuario_id uuid references perfiles(id),
  created_at timestamptz not null default now()
);
alter table cotizacion_pagos enable row level security;

-- ── Producción ──────────────────────────────────────────────────────────────
create sequence ordenes_produccion_numero_seq start 1;
create table ordenes_produccion (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null default nextval('ordenes_produccion_numero_seq'),
  lote text not null unique,
  producto_id uuid not null references productos(id),
  receta_id uuid references recetas(id),
  cotizacion_id uuid references cotizaciones(id),
  estado text not null default 'planificada' check (estado in ('planificada','curando','terminada','cancelada')),
  m2_planificado numeric(12,3) not null check (m2_planificado > 0),
  m2_bueno numeric(12,3), m2_segunda numeric(12,3), m2_merma numeric(12,3),
  molde_id uuid references moldes(id),
  coladas int,
  fecha_programada date,
  fecha_colado timestamptz,
  fecha_disponible date,
  fecha_terminada timestamptz,
  responsable_id uuid references perfiles(id),
  costo_mp numeric(14,2), costo_mano_obra numeric(14,2), costo_indirectos numeric(14,2),
  costo_total numeric(14,2), costo_m2 numeric(14,4),
  notas text,
  creada_por uuid references perfiles(id),
  created_at timestamptz not null default now()
);
create index ordenes_produccion_estado_idx on ordenes_produccion (estado, fecha_programada);
alter table ordenes_produccion enable row level security;

create table orden_consumos (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references ordenes_produccion(id) on delete cascade,
  mp_id uuid not null references materias_primas(id),
  teorico numeric(14,3) not null,
  real numeric(14,3),
  costo_unitario numeric(14,4) not null default 0
);
alter table orden_consumos enable row level security;

create table controles_calidad (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references ordenes_produccion(id) on delete cascade,
  prueba text not null,
  resultado text not null check (resultado in ('aprobado','observado','rechazado')),
  valor numeric(14,3),
  unidad text,
  notas text,
  usuario_id uuid references perfiles(id),
  created_at timestamptz not null default now()
);
alter table controles_calidad enable row level security;

-- ── Inventario de producto terminado (por producto + lote + calidad) ────────
create table movimientos_pt (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  producto_id uuid not null references productos(id),
  lote text not null,
  calidad text not null default 'primera' check (calidad in ('primera','segunda')),
  tipo text not null check (tipo in ('inicial','produccion','reserva','liberacion','despacho','venta','merma','ajuste')),
  m2 numeric(14,3) not null,                            -- + entra, - sale
  costo_m2 numeric(14,4) not null default 0,
  motivo text,
  orden_produccion_id uuid references ordenes_produccion(id),
  cotizacion_id uuid references cotizaciones(id),
  venta_id uuid references ventas(id),
  usuario_id uuid references perfiles(id)
);
create index movimientos_pt_idx on movimientos_pt (producto_id, lote, created_at desc);
alter table movimientos_pt enable row level security;

-- fisico = lo que hay en la bodega; disponible = fisico menos lo reservado.
create view stock_pt with (security_invoker = true) as
  select producto_id, lote, calidad,
    coalesce(sum(m2) filter (where tipo not in ('reserva','liberacion')), 0) as fisico,
    coalesce(sum(m2), 0) as disponible,
    max(created_at) as ultimo_movimiento
  from movimientos_pt group by producto_id, lote, calidad;

create or replace function pt_registrar_movimiento(
  p_producto uuid, p_lote text, p_calidad text, p_tipo text, p_m2 numeric,
  p_costo numeric default 0, p_motivo text default null, p_orden uuid default null,
  p_cotizacion uuid default null, p_venta uuid default null, p_usuario uuid default null
) returns movimientos_pt
language plpgsql set search_path = public, pg_temp as $$
declare
  v_fisico numeric; v_disp numeric; v_mov movimientos_pt%rowtype;
begin
  perform 1 from productos where id = p_producto for update;
  if p_m2 = 0 then raise exception 'Los m² no pueden ser cero'; end if;
  select coalesce(sum(m2) filter (where tipo not in ('reserva','liberacion')), 0), coalesce(sum(m2), 0)
    into v_fisico, v_disp
  from movimientos_pt where producto_id = p_producto and lote = p_lote and calidad = p_calidad;
  if p_m2 < 0 and p_tipo in ('despacho','venta','merma','ajuste') and v_fisico + p_m2 < 0 then
    raise exception 'Stock físico insuficiente en el lote %: hay % m², se piden %', p_lote, v_fisico, abs(p_m2);
  end if;
  if p_m2 < 0 and p_tipo = 'reserva' and v_disp + p_m2 < 0 then
    raise exception 'Disponible insuficiente en el lote %: hay % m², se piden %', p_lote, v_disp, abs(p_m2);
  end if;
  insert into movimientos_pt (producto_id, lote, calidad, tipo, m2, costo_m2, motivo, orden_produccion_id, cotizacion_id, venta_id, usuario_id)
  values (p_producto, p_lote, p_calidad, p_tipo, p_m2, p_costo, p_motivo, p_orden, p_cotizacion, p_venta, p_usuario)
  returning * into v_mov;
  return v_mov;
end $$;
revoke execute on function pt_registrar_movimiento(uuid,text,text,text,numeric,numeric,text,uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function pt_registrar_movimiento(uuid,text,text,text,numeric,numeric,text,uuid,uuid,uuid,uuid) to service_role;

-- ── Semillas genéricas (todas marcadas [EJEMPLO]; costos en 0 hasta cargar reales) ──
insert into materias_primas (codigo, nombre, categoria, unidad, moneda, notas) values
  ('MP-CEM-01', '[EJEMPLO] Cemento gris (saco 42.5 kg)', 'cemento', 'saco', 'HNL', 'Ligante principal'),
  ('MP-ARE-01', '[EJEMPLO] Arena fina lavada', 'arena', 'kg', 'HNL', null),
  ('MP-AGR-01', '[EJEMPLO] Agregado ligero (piedra pómez / perlita)', 'agregado', 'kg', 'HNL', 'ASTM C330 para unidades livianas'),
  ('MP-PIG-01', '[EJEMPLO] Óxido de hierro rojo', 'pigmento', 'kg', 'USD', 'Pigmento mineral; guardar en USD'),
  ('MP-PIG-02', '[EJEMPLO] Óxido de hierro negro', 'pigmento', 'kg', 'USD', null),
  ('MP-PIG-03', '[EJEMPLO] Óxido de hierro amarillo/ocre', 'pigmento', 'kg', 'USD', null),
  ('MP-ADI-01', '[EJEMPLO] Superplastificante / reductor de agua', 'aditivo', 'kg', 'HNL', null),
  ('MP-ADI-02', '[EJEMPLO] Repelente de agua integral', 'aditivo', 'kg', 'HNL', null),
  ('MP-FIB-01', '[EJEMPLO] Fibra de polipropileno', 'fibra', 'kg', 'HNL', 'Refuerzo contra fisuras'),
  ('MP-DES-01', '[EJEMPLO] Desmoldante (polvo o líquido)', 'desmoldante', 'kg', 'HNL', null),
  ('MP-SEL-01', '[EJEMPLO] Sellador / hidrofugante', 'sellador', 'galon', 'HNL', null),
  ('MP-EMP-01', '[EJEMPLO] Caja de cartón para embalaje', 'empaque', 'unidad', 'HNL', null),
  ('MP-EMP-02', '[EJEMPLO] Tarima / pallet y fleje', 'empaque', 'unidad', 'HNL', null);
