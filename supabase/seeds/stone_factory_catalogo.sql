-- Carga inicial desde el reporte de productos de WizPOS (Stone Factory, 29-sep-2026).
-- Precios de venta con ISV incluido (1166.24 = 1014.12 + 15%). Ajustar m² por caja y rendimientos.

insert into categorias (nombre, orden)
select v.nombre, v.orden from (values ('Rustic Quick fit', 1), ('Castillo Europeo', 2), ('Monasterio', 3), ('Ledgestone/Laja', 4), ('Cliff/Risco', 5), ('Travertino', 6), ('Eco Protector galon', 7), ('PegaPiedra saco', 8), ('Produccion', 9)) as v(nombre, orden)
where not exists (select 1 from categorias c where c.nombre = v.nombre);

insert into productos (codigo, nombre, categoria_id, tipo, modelo, color, unidad_venta, precio, costo_estandar, descripcion)
select v.codigo, v.nombre, (select id from categorias where nombre = v.cat limit 1), v.tipo, v.modelo, v.color, v.unidad, v.precio, v.costo, v.descripcion
from (values
('WP-1', 'Rustic Quick fit Gran Cañon', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Gran Cañon', 'm2', 1166.24, 190.523, null),
('WP-2', 'Rustic Quick fit Arizona', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Arizona', 'm2', 1166.24, 201.2394, null),
('WP-3', 'Rustic Quick fit Golden Mine', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Golden Mine', 'm2', 1166.24, 180.852, null),
('WP-4', 'Rustic Quick fit Gray smoke', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Gray smoke', 'm2', 1166.24, 183.73, null),
('WP-5', 'Rustic Quick fit Desert Sand', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Desert Sand', 'm2', 1166.24, 170.659, null),
('WP-6', 'Rustic Quick fit Slate', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Slate', 'm2', 1166.24, 212.221, null),
('WP-7', 'Rustic Quick fit Perla', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Perla', 'm2', 1166.24, 155.5, null),
('WP-8', 'Rustic Quick fit Everest', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Everest', 'm2', 1213.5, 242.358, null),
('WP-9', 'Rustic Quick fit New Mexico', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'New Mexico', 'm2', 1213.5, 205.682, null),
('WP-30', 'Rustic Quick fit Gran Cañon Caja esquina', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Gran Cañon', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-31', 'Rustic Quick fit Arizona Caja esquina', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Arizona', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-32', 'Rustic Quick fit Golden Mine Caja esquina', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Golden Mine', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-33', 'Rustic Quick fit Gray smoke Caja esquina', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Gray smoke', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-34', 'Rustic Quick fit Desert Sand Caja esquina', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Desert Sand', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-35', 'Rustic Quick fit Slate Caja esquina', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Slate', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-36', 'Rustic Quick fit Perla Caja esquina', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Perla', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-37', 'Rustic Quick fit Everest Caja esquina', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'Everest', 'caja', 1194.59, 0, 'Caja de piezas de esquina'),
('WP-38', 'Rustic Quick fit New Mexico Caja esquina', 'Rustic Quick fit', 'piedra', 'Rustic Quick fit', 'New Mexico', 'caja', 1194.59, 0, 'Caja de piezas de esquina'),
('WP-10', 'Castillo Europeo Desert Sand', 'Castillo Europeo', 'piedra', 'Castillo Europeo', 'Desert Sand', 'm2', 1166.24, 234.477, null),
('WP-11', 'Castillo Europeo Blanco', 'Castillo Europeo', 'piedra', 'Castillo Europeo', 'Blanco', 'm2', 1212.74, 261.084, null),
('WP-12', 'Castillo Europeo Gray smoke', 'Castillo Europeo', 'piedra', 'Castillo Europeo', 'Gray smoke', 'm2', 1166.24, 368.2, null),
('WP-13', 'Castillo Europeo Onyx', 'Castillo Europeo', 'piedra', 'Castillo Europeo', 'Onyx', 'm2', 1295.82, 411.65, null),
('WP-39', 'Castillo Europeo Desert Sand Caja esquina', 'Castillo Europeo', 'piedra', 'Castillo Europeo', 'Desert Sand', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-40', 'Castillo Europeo Blanco Caja esquina', 'Castillo Europeo', 'piedra', 'Castillo Europeo', 'Blanco', 'caja', 1194.59, 0, 'Caja de piezas de esquina'),
('WP-41', 'Castillo Europeo Gray smoke Caja esquina', 'Castillo Europeo', 'piedra', 'Castillo Europeo', 'Gray smoke', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-42', 'Castillo Europeo Onyx Caja esquina', 'Castillo Europeo', 'piedra', 'Castillo Europeo', 'Onyx', 'caja', 1278.21, 0, 'Caja de piezas de esquina'),
('WP-14', 'Monasterio Desert Sand', 'Monasterio', 'piedra', 'Monasterio', 'Desert Sand', 'm2', 1166.24, 208.984, null),
('WP-15', 'Monasterio Ozark', 'Monasterio', 'piedra', 'Monasterio', 'Ozark', 'm2', 1166.24, 322.804, null),
('WP-16', 'Monasterio Smoke Gray', 'Monasterio', 'piedra', 'Monasterio', 'Smoke Gray', 'm2', 1166.24, 275.51, null),
('WP-17', 'Monasterio Blanco', 'Monasterio', 'piedra', 'Monasterio', 'Blanco', 'm2', 1212.74, 253.094, null),
('WP-43', 'Monasterio Desert Sand Caja esquina', 'Monasterio', 'piedra', 'Monasterio', 'Desert Sand', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-44', 'Monasterio Ozark Caja esquina', 'Monasterio', 'piedra', 'Monasterio', 'Ozark', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-45', 'Monasterio Smoke Gray Caja esquina', 'Monasterio', 'piedra', 'Monasterio', 'Smoke Gray', 'caja', 1319.55, 0, 'Caja de piezas de esquina'),
('WP-46', 'Monasterio Blanco Caja esquina', 'Monasterio', 'piedra', 'Monasterio', 'Blanco', 'caja', 1194.59, 0, 'Caja de piezas de esquina'),
('WP-18', 'Ledgestone/Laja Desert', 'Ledgestone/Laja', 'piedra', 'Ledgestone/Laja', 'Desert', 'm2', 1166.24, 214.802, null),
('WP-19', 'Ledgestone/Laja Slate', 'Ledgestone/Laja', 'piedra', 'Ledgestone/Laja', 'Slate', 'm2', 1166.24, 286.148, null),
('WP-20', 'Cliff/Risco Charcoal', 'Cliff/Risco', 'piedra', 'Cliff/Risco', 'Charcoal', 'm2', 1222.16, 269.498, null),
('WP-21', 'Cliff/Risco Slate', 'Cliff/Risco', 'piedra', 'Cliff/Risco', 'Slate', 'm2', 1222.16, 242.051, null),
('WP-22', 'Cliff/Risco Perla', 'Cliff/Risco', 'piedra', 'Cliff/Risco', 'Perla', 'm2', 1222.16, 179.32, null),
('WP-23', 'Cliff/Risco Coquina', 'Cliff/Risco', 'piedra', 'Cliff/Risco', 'Coquina', 'm2', 1222.16, 257.5575, null),
('WP-47', 'Cliff/Risco Ivory', 'Cliff/Risco', 'piedra', 'Cliff/Risco', 'Ivory', 'm2', 1295.82, 254.729, null),
('WP-24', 'Travertino Gold', 'Travertino', 'piedra', 'Travertino', 'Gold', 'm2', 1222.16, 310.971, null),
('WP-25', 'Travertino Monaco', 'Travertino', 'piedra', 'Travertino', 'Monaco', 'm2', 1222.16, 207.106, null),
('WP-26', 'Travertino Blanco', 'Travertino', 'piedra', 'Travertino', 'Blanco', 'm2', 1222.16, 248.938, null),
('WP-27', 'Travertino Onyx', 'Travertino', 'piedra', 'Travertino', 'Onyx', 'm2', 1295.82, 271.4, null),
('WP-28', 'Eco Protector galon', 'Eco Protector galon', 'accesorio', null, null, 'galon', 719.76, 0, null),
('WP-56', 'Sellador Acrilico Clear Sealer Galon', 'Eco Protector galon', 'accesorio', null, null, 'galon', 1217.24, 0, null),
('WP-29', 'PegaPiedra saco', 'PegaPiedra saco', 'accesorio', null, null, 'saco', 567.14, 0, null),
('WP-60', 'PegaPiedra Blanco Saco', 'PegaPiedra saco', 'accesorio', null, null, 'saco', 686.82, 0, null)
) as v(codigo, nombre, cat, tipo, modelo, color, unidad, precio, costo, descripcion)
where not exists (select 1 from productos p where p.codigo = v.codigo);

-- Insumos de la categoría "Produccion" del reporte: pasan a materias primas.
delete from materias_primas where nombre like '[EJEMPLO]%' and codigo in ('MP-CEM-01','MP-AGR-01','MP-PIG-01','MP-PIG-02','MP-PIG-03','MP-EMP-01','MP-EMP-02')
  and not exists (select 1 from movimientos_mp m where m.mp_id = materias_primas.id);
insert into materias_primas (codigo, nombre, categoria, unidad, costo_promedio, notas)
select v.codigo, v.nombre, v.categoria::categoria_mp, v.unidad, v.costo, 'Costo tomado del reporte WizPOS (29-sep-2026): confirmar con la última factura de compra'
from (values
('WP-48', 'Cemento Gris lb', 'cemento', 'lb', 1.69),
('WP-49', 'Agregado Lb', 'agregado', 'lb', 6.35),
('WP-50', 'Cemento Blanco lb', 'cemento', 'lb', 4.87),
('WP-51', 'Color Amarillo Lb', 'pigmento', 'lb', 55.33),
('WP-52', 'Color Negro Lb', 'pigmento', 'lb', 49.8),
('WP-53', 'Color Rojo Lb', 'pigmento', 'lb', 52.56),
('WP-54', 'Caja QF c/separador', 'empaque', 'unidad', 45.27),
('WP-55', 'Caja travertino c/ separador', 'empaque', 'unidad', 53.98),
('WP-57', 'Caja Risco c/separador', 'empaque', 'unidad', 51.0324),
('WP-58', 'Caja Monasterio c/separador', 'empaque', 'unidad', 47.73),
('WP-59', 'Caja Castillo c/separador', 'empaque', 'unidad', 48.69)
) as v(codigo, nombre, categoria, unidad, costo)
where not exists (select 1 from materias_primas m where m.codigo = v.codigo);
