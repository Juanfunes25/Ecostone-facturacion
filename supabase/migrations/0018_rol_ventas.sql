-- Nuevo rol "ventas": cotizaciones, venta directa, facturas, inventario de piedra y clientes.
alter type rol_usuario add value if not exists 'ventas';
