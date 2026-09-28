-- Todas las cajas de piedra son de 1 m² (se venden cajas completas de 1 m²).
update productos set m2_por_caja = 1 where tipo = 'piedra';
