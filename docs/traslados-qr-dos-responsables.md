# Traslados TRA: alistado y recepción en la entrega física

Implementación del 21/10/2026 para `solicitud_traslado`, el traslado creado desde el carrito de Seller. La segunda persona confirma **al recibir el material del almacenero**, según aclaración del usuario. No se añade transportista ni una confirmación posterior de llegada a Tienda.

## Operación y existencias

1. Seller muestra el QR al crear la solicitud; también está en el detalle y en el documento imprimible. El enlace es `/operaciones/traslados/:id?escanear=1`; no es el QR de un traslado virtual TV ni de un Pedido.
2. Una cuenta de almacén del origen toma el alistado. Las cantidades solicitadas aparecen completas; puede ajustar excepciones con motivo o confirmar el resto. Adjunta fotos y termina el alistado. Este paso no modifica existencias.
3. Otra cuenta, perteneciente al destino, escanea el mismo QR y toma la revisión. Ve lo solicitado y lo alistado; confirma lo recibido o ajusta diferencias con motivo, hasta el máximo alistado. Adjunta sus propias fotos.
4. Al pulsar «Confirmar recepción y traslado», se descuenta el origen y se acredita el destino en una sola transacción. La recepción no vuelve a acreditar el material. El receptor queda identificado y el documento termina RECIBIDO.

El flujo funciona en ambos sentidos. Requiere cuentas distintas, perfiles activos y acceso a las sucursales correspondientes; las cuentas globales autorizadas conservan su alcance. Los controles numéricos reutilizan `CantidadPedido`, con `inputmode=decimal`, coma/punto y cantidad precargada. El motor de Traslados acepta cantidades base con hasta cuatro decimales. Falta verificar la aparición del teclado en dispositivos Android/iOS reales.

Se reutilizan los motores actuales de asignación, Kardex y tandas: sólo se trasladan las cantidades aceptadas. Los saldos no entregados conservan una tanda vinculada. Una línea en cero exige motivo y al menos otra debe tener material. Los botones rápidos preservan las excepciones guardadas.

El alistado **no reserva stock**. Se comprueba otra vez al confirmar la recepción; si otra operación consumió material y ya no alcanza, falla toda la entrega, sin salida parcial ni tanda residual de ese intento. Deben actualizar y comprobar las cantidades antes de reintentar.

La API bloquea el documento y sus líneas, controla versión y compara la solicitud actual con el alistado. Cambios de cantidad, presentación o dirección requieren corrección explícita. Reabrir o devolver exige motivo; conserva las líneas sin cambios y limpia la revisión anterior. Anular antes de entregar no mueve stock. El registro conserva eventos y evidencias de las etapas anteriores.

El mismo lote/versión permite recuperar una confirmación cuya respuesta se perdió. La interfaz consulta primero el recibo; volver a escanear un traslado recibido sólo consulta. Los endpoints anteriores no pueden adelantar ni repetir la salida de una tarea QR. Con la bandera activa tampoco pueden despachar solicitudes nuevas sin pasar por el QR. Los traslados históricos ya EN_TRANSITO, sin tarea QR, conservan su recepción anterior y no vuelven a mover stock.

## Telegram y evidencias

Grupo `-1003058173908`, tema Traslados **17226**. Dos lotes y avisos independientes: 📦 alistado y 📥 entrega/recepción. Cada uno conserva sus fotos, responsables y horas; la recepción incluye también la hora de toma de revisión. El detalle completo lleva una línea con emoji por producto, presentación, cantidad, saldo y motivo. El envío usa la cola existente: la confirmación guarda la evidencia pendiente, y el worker la publica en su siguiente ejecución.

Los recibos por foto y por parte del detalle permiten continuar tras rechazos confirmados sin repetir partes publicadas. Un resultado incierto requiere comprobación manual. Se conserva la retención existente de fotos: 48 horas después del envío completo; pendientes/errores/inciertos no se eliminan por antigüedad. No se modifica OpenClaw.

Incluye el pendiente solicitado tras el piloto de Pedidos: los captions de sus dos fotos independientes identifican alistador/hora y revisor que retira/hora de toma de revisión/salida. No cambia los motores de Pedidos ni VTD; no modifica ni despliega el worker VTD.

## Publicación coordinada, pendiente

La implementación se probó localmente; no se ha aplicado esta migración, activado el circuito ni enviado mensajes reales para esta funcionalidad.

1. Revisar/fusionar los PR de Almacén y Seller. En una base nueva, aplicar `20261021220732_traslados_qr_entrega_dos_personas.sql` después de `20261021192845_pedidos_dos_responsables_evidencias.sql`. En Cation ambas ya figuran con estas versiones y se comprobó la coincidencia exacta de su SQL. No reaplicarlas ni reescribir el historial. La migración verifica la compatibilidad de los motores clonados antes de sustituir sus accesos.
2. Desplegar sólo `evidencia-operaciones-telegram`, incluyendo `worker-pedidos.js` y su dependencia relativa del worker VTD. El diagnóstico administrativo debe devolver HTTP 200, `ok=true` y `traslados_qr=true`, con bot/grupo correctos. No desplegar `evidencia-vtd-telegram`.
3. Publicar ambos frontends y actualizar pestañas antiguas. Verificar el QR del carrito, detalle e impresión; el escaneo directo abre Almacén y conserva el documento después del inicio de sesión. Sin la migración se muestra un mensaje de circuito todavía no disponible.
4. Con autorización de activación, establecer `evidencia_operacion.configuracion.traslados_qr=true` en la fila `id=true`, manteniendo `activo=true`. El valor inicial es **false**. Habilitarlo al final evita bloquear el despacho previo antes de publicar las pantallas nuevas.
5. Validar con dos cuentas/dispositivos reales: entrega física, dos fotos/avisos, cantidades, pendientes y un único movimiento de stock. Comprobar permisos de Storage/Supabase, teclado Android/iOS y diagnóstico/advisors tras la migración. Una prueba real requiere elegir el documento y autorizar sus movimientos; los tests incluidos usan datos sintéticos.

Apagar `traslados_qr` detiene nuevas adopciones; las tareas iniciadas siguen en este circuito. Mantener API, frontend y worker disponibles para cerrarlas. No convertir ni reabrir automáticamente documentos históricos.

## Validación

- `npm run test:qr`: motores PostgreSQL existentes en PGlite con datos sintéticos. Dos cuentas/sucursales, fotos por etapa, cantidades parciales/cero, correcciones, anulación, permisos/RLS, stock en ambos sentidos, fallo de segunda salida que revierte la primera, tandas, recibos, reintentos e histórico. Compara las definiciones de los motores de Pedidos/VTD antes y después.
- Vitest: controles precargados, ajustes sin guardar, fotos obligatorias, recuperación ante respuesta perdida en ambos pasos, escáner y worker Telegram. Seller prueba el flujo de crear desde el carrito, conservar el resultado tras vaciarlo y mostrar su QR.
- Build y ESLint de archivos modificados en ambos proyectos. Capturas de la pantalla real con datos simulados a 320 y 390 px: sin desbordamiento horizontal. No sustituyen la prueba física ni una base Supabase de staging.

El asesor de seguridad remoto se consultó como línea base **antes de desplegar**: conserva avisos existentes de vistas con permisos del propietario, funciones con `search_path` mutable y funciones antiguas ejecutables por clientes. No evalúa esta migración todavía no aplicada; no se ampliaron permisos de esas funciones. Seguimiento: [vistas](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [funciones públicas](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable). Las tablas nuevas privadas tienen RLS y ningún acceso directo de cliente; sólo los accesos públicos invoker delegan acciones autenticadas.
