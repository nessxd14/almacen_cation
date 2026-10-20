# Correcciones de traslados

Correcciones preparadas en Almacén y Seller el 20 de octubre de 2026. Migración aplicada a la base productiva como 20261020141453_fix_flujo_traslados.sql; publicación de las interfaces mediante las ramas y PRs de traslados.

## Comportamiento

- Piso incorpora el botón **Traslados**. Permite crear solicitudes, consultar estados y registrar la recepción física. Volver al pedido conserva su estado.
- El despacho y la recuperación de faltantes requieren un perfil de almacén o supervisión. La base valida el perfil activo y la sucursal asignada; los perfiles que actualmente no tienen sucursal conservan su alcance previo.
- Seller permite decidir por línea Despachar, Faltante o Rechazar y declarar parciales. Conserva el resultado real del RPC: muestra lo que salió, los bloqueos por stock y los saldos, y ofrece enlaces a las tandas relacionadas. Una cancelación sin envío no se anuncia como despacho.
- La recepción sólo envía líneas realmente despachadas, exige comprobación física y muestra errores con posibilidad de reintento. Los controles permanecen deshabilitados durante la operación.
- Almacén y SQL rechazan cantidades negativas, cero para Despachar, valores no finitos y cantidades superiores a lo solicitado. La recepción tampoco admite más de lo despachado.
- La nueva acción **Recuperar líneas sin salida** copia únicamente líneas `POR_DESPACHAR` de documentos ya despachados, exige `cantidad_despachada=0`, enlaza las líneas originales con sus reemplazos y crea una tanda pendiente. No escribe Kardex, no acredita stock y no confirma recepciones. Reintentar no duplica solicitudes.
- Las devoluciones nuevas permiten seleccionar dirección y el motivo Devolución propone Tienda → Almacén. Devolver un traslado existente invierte su dirección real y excluye líneas rechazadas, movidas o recibidas en cero.
- Almacén pagina solicitudes, líneas y consultas de stock; muestra errores de carga y permite actualizar/reintentar. Los borradores conservan también las acciones por línea.
- El catálogo y escaneo del carrito en modo traslado no aplican la restricción comercial de presentaciones vendibles en Tienda.

Se mantiene la contabilidad existente: el stock se mueve al despachar y la recepción ajusta diferencias. No se migró a un inventario físico separado de mercancía en tránsito.

## Validación

- 104 pruebas unitarias y de interfaz aprobadas entre los dos proyectos, además de las suites de integración SQL indicadas abajo.
- Compilación de Almacén y Seller.
- Pruebas de pantalla: acceso desde Piso, límites, errores visibles, recepción sin líneas rechazadas, espera durante la operación, creación de devoluciones y conservación de borradores.
- Pruebas de repositorio y paginación: 1100 líneas, páginas reducidas por el servidor, errores intermedios y conservación de estados y enlaces.
- `node db/tests/traslados.integration.mjs`: PostgreSQL aislado con la migración real, perfiles de distintas sucursales, identidad del actor, exceso, cero, acciones inválidas, líneas ajenas/repetidas, parciales, faltantes, recepción y recuperación idempotente sin movimiento de stock.
- `node db/tests/flujos-qr.integration.mjs`: suite existente de VTD, Caja, pedidos y carritos virtuales ejecutada con la nueva migración.
- Revisión en Chrome a tamaño de teléfono con datos mock: despacho de 5 de 10, saldo de 5 en una tanda nueva, enlace al faltante y cantidades de recepción visibles.

## Publicación y casos antiguos

1. Aplicar la migración de Almacén `supabase/migrations/20261020141453_fix_flujo_traslados.sql` al proyecto `zxoxougwgstrarwymlvd`.
2. Publicar las interfaces actualizadas de Almacén y Seller. Las funciones mantienen sus firmas existentes; la recuperación agrega un RPC nuevo.
3. Revisar cada traslado histórico. Desde la sucursal de origen, recuperar las líneas que no tuvieron salida registrada. Comprobar físicamente lo entregado y registrar la recepción en destino.

Las 42 cabeceras en tránsito no se cierran automáticamente. Las 50 líneas históricas identificadas en el diagnóstico quedan disponibles para recuperación explícita, sin asumir que el estado del sistema demuestra por sí solo lo ocurrido físicamente.

El árbol de Almacén contiene trabajo previo ajeno a estos fixes. Al preparar una publicación o un commit, revisar el alcance para conservar ese trabajo y no incorporarlo accidentalmente.
