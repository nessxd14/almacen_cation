# Traslados por pasos y saldo en sistema

El QR de Traslado usa el mismo asistente oscuro y violeta de Pedidos:

- Alistador: Productos → Fotos → Confirmar.
- Receptor: Revisar → Fotos → Confirmar recepción.

Se recorre un producto a la vez. Volver conserva las cantidades registradas, las fotos y los borradores. El destino procede de la solicitud; no se modifica durante la recepción. Se mantienen los responsables y permisos del motor existente. Una entrega de cantidad cero no puede finalizarse. Las diferencias se declaran con motivo o se devuelve el traslado para corregirlo.

Alistar no mueve inventario. Confirmar la entrega y recepción descuenta del origen y acredita al destino con las protecciones del servidor existentes. Antes de subir las fotos o confirmar, se vuelve a consultar el stock y se suma el uso del mismo producto entre todas las líneas. Recuperar una respuesta perdida consulta el lote anterior antes de comprobar stock o repetir la escritura.

## Stock visible

Los formularios de Pedidos y Traslados muestran el saldo registrado, cuánto se usará de Almacén y el saldo que quedaría. El cálculo usa unidades base y respeta la presentación. El stock despachable excluye las ubicaciones marcadas fuera del disponible y los saldos no positivos. En un pedido mixto sólo la parte de Almacén consume ese saldo. El carrito virtual muestra también el saldo previsto en su ubicación de origen.

- Consulta completa con saldo cero: **No hay stock disponible en sistema**.
- Cantidad mayor al disponible: **Stock insuficiente**, con la cantidad faltante.
- Consulta fallida o incompleta: se avisa que no pudo consultarse; nunca se presenta como cero.
- Consulta en curso: indicador y botón de actualización protegido contra solicitudes simultáneas desde el panel.

Los saldos son la última consulta, con hora visible, y no equivalen a una reserva. La validación transaccional del servidor sigue siendo definitiva ante movimientos concurrentes. Si hay material físico sin registro, el encargado debe regularizarlo por el circuito de inventario existente; este cambio no agrega stock ni cambia su origen automáticamente.

## Esperas y recuperación

Las consultas de stock tienen un presupuesto total de 15 segundos. Las llamadas RPC de los circuitos de operación y evidencia tienen un plazo de 15 segundos y las subidas de cada foto, 30 segundos. Cuando la API lo permite se aborta la solicitud; el estado de la pantalla deja de esperar y presenta un mensaje para reintentar conservando sus datos.

El timeout de una escritura no demuestra que haya fallado: se conservan el identificador del lote y la condición de confirmación pendiente para consultar el resultado antes de repetir. No se repite automáticamente una salida. En el despacho anterior se conserva el contrato `{resultado, error}` para que el botón salga de su estado ocupado también ante un timeout.

## Validación y alcance

Pruebas unitarias de asistente, consulta completa y paginación, cero frente a error, suma de líneas del mismo producto, timeout, abortado, conservación de fotos y recuperación sin duplicación. Integración QR con PostgreSQL aislado y contratos anteriores. Compilación y ESLint de archivos modificados.

La demo local está en `.local/qa-alistado/traslados/index.html`, con stock suficiente, insuficiente, cero, error y consulta sin respuesta. Usa los componentes reales con un cliente ficticio; no conecta con servicios del negocio ni envía fotos. Las fuentes y artefactos de la demo permanecen fuera de Git.

No se necesita una migración nueva. No se modifican permisos ni se aplican cambios a la base del negocio. `.gitattributes` conserva los SQL históricos con LF para que sus comprobaciones textuales se reproduzcan al clonar en Windows.
