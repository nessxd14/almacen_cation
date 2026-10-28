# Pedidos: tarjetas, origen posterior y tandas

## Regla operativa

Almacén declara lo que tiene físicamente. El stock registrado no limita el alistado ni la salida de las nuevas tandas. Cada producto se presenta en una tarjeta con foto, nombre, código, presentación, cantidad, ubicación y observaciones. Un personalizado muestra ese rótulo y su descripción.

El encabezado superior izquierdo identifica el **origen base**: personalizado en morado, por comprar en amarillo, Almacén en verde y Tienda en naranja. Si todavía no hay origen base se muestra “Por definir”, en gris. El color se deriva de los datos del pedido, con prioridad del personalizado; el reparto real posterior sigue siendo una tarea independiente y admite mezclas.

La referencia visual elegida usa fondo oscuro, tarjeta con imagen protagonista, nombre/cantidad/ubicación sobre un degradado inferior y controles circulares de problema, volver y confirmar. Los colores de origen se conservan en la etiqueta superior izquierda y el fondo de la tarjeta. Los datos generales y el historial de tandas se pueden desplegar sin ocupar el recorrido principal.

- Derecha: confirma la cantidad pendiente completa.
- Izquierda: registra el motivo y la cantidad disponible; permite continuar el recorrido.
- Al terminar: resolver cada incidencia mediante envío parcial, faltante, compra recibida, compra gestionada o reemplazo físico.
- Se puede volver a cualquier tarjeta y corregir antes de confirmar la etapa.
- Los botones ofrecen las mismas acciones que los gestos. Desplazarse verticalmente no confirma un producto.

Una compra gestionada puede cubrir únicamente el faltante: si hay 6 de 10 y se solicitan 4, se conservan las 6 alistadas. La operación no divide la línea comercial ni cambia sus precios. Si ya existe una compra comprometida, su recepción continúa en Compras.

El reemplazo físico conserva el producto solicitado y sus importes. Guarda el producto entregado, su equivalencia en unidades base, el motivo y el responsable; crea una alerta y un evento visibles para el vendedor. El stock que corresponda se mueve sobre el producto físicamente entregado. La revisión comercial queda a cargo del vendedor.

## Origen pendiente del alistador

Después de **Enviar a verificación**, el alistador tiene una tarea para distribuir la cantidad física de cada producto entre Almacén, Tienda y compra. Los tres pueden combinarse. Tienda requiere identificar la sucursal; compra requiere proveedor y admite costo opcional; catálogo de Almacén requiere ubicación física de esa sucursal.

El origen puede declararse durante la verificación o después de la salida. La tarea permanece en Mis tareas aunque la tanda esté despachada, sin depender del límite de las 80 operaciones recientes. Sólo el alistador puede completarla. Una corrección de cantidad durante la verificación vuelve a dejar pendiente el origen si su suma ya no coincide.

La declaración debe sumar exactamente lo que sale. Los reintentos no duplican entregas ni movimientos.

| Momento | Registro de inventario |
| --- | --- |
| Alistar o enviar a verificación | No mueve stock. |
| Declarar origen antes de retirar | Guarda la distribución; espera la salida. |
| Confirmar salida con origen completo | Descuenta una vez la parte de Almacén, permitiendo saldo negativo. |
| Confirmar salida con origen pendiente | Registra la cantidad entregada y mantiene la tarea de origen. |
| Completar origen de una tanda retirada | Registra una vez el descuento de Almacén, con fecha efectiva del retiro. |

Tienda y compra directa quedan como procedencia documental de esta entrega. No se inventan entradas de catálogo ni se modifica el stock de Tienda. Un personalizado sin producto de catálogo no genera Kardex; si se reemplaza por un producto de catálogo, su parte de Almacén sí lo genera.

## Segunda persona y tandas

Se conservan dos responsables y fotos obligatorias en ambas etapas. La segunda persona confirma cuánto sale de cada línea, incluso cero. Puede incluir material que llegó después del alistado, hasta la cantidad todavía pendiente del pedido, indicando el motivo de las diferencias.

Sólo la salida confirmada reduce el saldo del pedido. Al volver a escanear el mismo QR se crea la siguiente tanda con el saldo restante. La mini app muestra su número y conserva enlaces al historial de tandas.

## Implementación y publicación

- Migración: `supabase/migrations/20261028131324_pedidos_tarjetas_origen_posterior.sql`, creada con el CLI de Supabase.
- Las nuevas tandas usan el modo flexible cuando están habilitados los circuitos de dos actores y abastecimiento. La migración `20261028144609_activar_tarjetas_pedidos_pendientes.sql` también activa las tandas existentes de pedidos abiertos que aún no registraron su salida.
- La API reutiliza la autenticación y los bloqueos de pedido/líneas/tanda. Los helpers de inventario son privados; el listado de tareas respeta RLS y pertenece al alistador autenticado.
- Para habilitarlo hay que aplicar la migración y publicar Almacén. El cambio de Seller sólo incorpora el rótulo del evento de reemplazo en su historial.
- Ambas migraciones están aplicadas en Supabase. La interfaz ya estaba publicada en Vercel cuando se activaron las tandas existentes.

Las correcciones posteriores de estas salidas requieren un encargado y la revisión de todos los movimientos asociados. Se impide usar la corrección documental antigua, que no revierte Kardex, sobre una tanda flexible.

OpenClaw y los recordatorios de compra al gerente quedan para una etapa posterior.

## Verificación

- Suite de interfaz de Almacén, pruebas de tarjetas y regresiones del flujo móvil.
- `npm run test:qr`: PostgreSQL en memoria con documentos ficticios; origen 4+2+2, saldo negativo, reintentos, fotos, separación de responsables, material recibido durante revisión, reemplazo, compras parciales y tanda 2 con el mismo QR.
- Prueba de historial de pedidos en Seller.
- Compilación de Almacén y revisión visual a 390 px de ancho.

Las pruebas no registran movimientos ni envían mensajes en los servicios reales.

La activación de las tandas existentes conserva cantidades, alistado, revisiones, responsables, fuentes anteriores y versiones de fotos en borrador. Los orígenes ya resueltos se reutilizan cuando su ubicación/recepción sigue siendo válida; los demás continúan como tarea pendiente. Las recepciones documentales heredadas se consumen una sola vez al salir o completar el origen. Los pedidos completados, cancelados y las salidas históricas permanecen intactos.

Verificación de producción del 28 de octubre: seis pedidos abiertos con el nuevo flujo, cero tandas pendientes en modo anterior, foto de revisión conservada y ninguna transacción nueva de Kardex causada por la activación. El asesor de seguridad no agregó avisos.

Resultado final: 58 archivos de pruebas de Almacén y 513 casos aprobados; integración SQL aprobada; compilación de Almacén aprobada; cinco pruebas del historial de Seller aprobadas. El lint de los componentes y helpers del nuevo flujo pasa. El lint de `PedidosApp.jsx` conserva dos errores previos de efectos de React, ajenos al rótulo del evento añadido aquí.
