# Abastecimiento y entregas parciales · 23/10/2026

Un pedido conserva su número y QR. Cada preparación genera una entrega numerada con responsables distintos, fotos independientes de alistado y salida, retiro e historial. Mientras haya cantidades pendientes, el estado interno sigue ABIERTO; la miniapp distingue Pendiente, Envío parcial · pendiente de completar y Completado.

El icono de capas abre las operaciones de la línea. Cinco iconos de 44 px permiten elegir Almacén, Tienda, compra rápida, compra gestionada o declarar pendiente. Cada uno tiene nombre accesible y ayuda; sólo aparece el formulario elegido. La tarjeta conserva cantidades solicitadas, entregadas antes, pendientes y para esta entrega.

## Orígenes y cantidades

- **Almacén:** salida por el motor actual, con ubicaciones, FIFO, reservas y Kardex. Los personalizados existentes se declaran por cantidad sin producto artificial.
- **Tienda:** el alistador registra material que ya trajo físicamente a Almacén. No necesita aprobación ni traslado separado; no consulta ni modifica stock de Tienda.
- **Compra rápida:** recepción documental exclusiva del pedido. Cantidad precargada editable, marca/proveedor o Tercero; costo y comprobante opcionales. La foto del comprobante se incorpora a las fotos del alistado y debe enviarse con esa etapa; no se sube al registrar la recepción. Registrar recibido no confirma alistado ni entrega. No acredita inventario general, pagos ni Caja.
- **Compra gestionada:** usa solicitudes existentes y su recepción habitual. Puede dividir internamente líneas conservando el mismo pedido. Solicitar/comprar no entrega material. Una solicitud SOLICITADA se reduce o cancela con evento de auditoría cuando se cubre directamente. Una compra COMPRADA necesita resolución explícita desde Compras.

La línea admite varios orígenes. Sus cantidades alistadas y revisadas se guardan separadas. La verificación sólo puede reducir lo alistado en cada origen, dejando motivo; para aumentar o cambiar origen debe devolverse la preparación. No puede consumirse más que el saldo de recepción. Las reservas y el plan sólo exigen inventario para la porción de Almacén.

Los recibos documentales no se borran al reabrir/sincronizar. Lo no retirado queda asignado al pedido y se ofrece en la entrega siguiente. Un personalizado parcial conserva ESPECIAL hasta completar; nunca se cierra como Comprado directo. Cada faltante se declara con motivo y situación: Tienda, compra rápida o compra gestionada. Una preparación sin cantidades positivas no genera salida.

## Confirmación y correcciones

Revisión, consumo de recibos, stock aplicable, retiro y cola de Telegram se confirman en una transacción. Las versiones detectan cambios concurrentes; los reintentos exactos recuperan recepción, alistado o retiro sin duplicarlos. Telegram conserva pedido, número de entrega, parcial/final, productos, orígenes, cantidades y pendientes, fotos y responsables; reutiliza el worker existente y sus recibos.

Pedidos queda para gestión, consulta y correcciones. La protección del servidor bloquea nuevas entregas por rutas antiguas aunque no exista preparación. Los eventos de inventario conservan su corrección habitual. Un administrador/gerente puede corregir una salida documental completa, con motivo y clave de reintento: reduce lo entregado y devuelve la asignación al pedido, sin crear stock. La entrega original y su auditoría se conservan; una preparación activa detectará los cambios y requerirá sincronización.

## Publicación compatible

Aplicar la migración de abastecimiento con la bandera `evidencia_operacion.configuracion.abastecimiento_pedidos=false`, publicar frontend y luego activarla. Sólo los nuevos INSERT en `almacen_preparacion` fijan `modo_abastecimiento=true` cuando también están activos evidencia y dos responsables. Todas las preparaciones existentes conservan su contrato; desactivar la bandera sólo detiene la adopción por nuevas preparaciones.

No se modifican compras históricas o ya ingresadas al inventario. El papel de PED-2026-00731 (pedido 828, línea 4928, solicitud 332) conserva su recepción de cuatro resmas y utiliza su salida de inventario habitual; no se crea una segunda compra rápida. El 699 permanece cerrado. VTD, traslados, pagos y worker mantienen sus contratos.

Las revisiones anteriores al circuito de dos responsables conservan sus cantidades y retiro posterior. Su verificador confirma el plan mediante «Confirmar salida por QR»; las rutas tradicionales no reciben una excepción para despachar. El cierre posterior con fotos conserva el tratamiento de salida previa, sin otro descuento. Este puente no activa el nuevo modelo de abastecimiento en la preparación antigua.

## Validación

`npm run test:qr` usa PostgreSQL aislado y motores reales: 10 unidades = 4 Almacén + 3 Tienda + 2 rápidas + 1 gestionada; retiro de 9 y siguiente entrega de 1 con el mismo QR. Incluye personalizados 6+4, recibo rápido 6 retirado 4+2, solicitud reducida, compra comprometida bloqueada, recepción formal sin duplicación, motivo de pendientes, preparación vacía bloqueada, revisión por origen, permisos, versión obsoleta, plan adulterado, fallo después de descontar stock con rollback completo, reintentos, corrección documental autorizada y conservación al reabrir.

Las pruebas de interfaz verifican los cinco iconos accesibles, formularios, Tienda declarada, Tercero, comprobante opcional, recuperación del intento, parciales, revisión e historial. Los casos VTD, Caja, traslados, fotos y Telegram de la suite QR siguen pasando. La comprobación en teléfonos físicos y el teclado Android/iOS requieren operación real.
