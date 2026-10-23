# Pedidos: alistador y verificador que retira

Ampliación del 21/10/2026. VTD conserva su flujo, worker y configuración. Traslados virtuales siguen con su circuito de dos responsables y el tema 17226.

## Operación

1. El alistador ve la cantidad solicitada precargada. Ajusta las excepciones directamente, elige presentación o unidad base y registra motivo cuando falta material. «No se alistó» coloca cero. «Todo lo demás preparado» confirma sólo lo que aún no se guardó; conserva cantidades y motivos existentes.
2. Adjunta entre 1 y 10 fotos y pulsa «Enviar a verificación». Se guarda el alistado y un aviso de Telegram en tema 9, sin mover stock.
3. Otra persona escanea/toma la revisión. Las cantidades precargadas son las alistadas, con lo solicitado visible. Puede ajustarlas hasta lo pendiente del pedido, dejando motivo de cualquier diferencia con el alistado. «Sin salida» coloca cero. «Todo lo demás coincide» confirma las líneas restantes y conserva las diferencias ya guardadas.
4. El verificador comprueba las ubicaciones de salida propuestas, indica destino, adjunta entre 1 y 10 fotos y pulsa «Confirmar revisión y retirar». Esa misma persona figura como responsable del retiro. Revisión, despacho, Kardex, retiro y envío pendiente se confirman en una transacción.

Los campos empiezan completos y usan teclado decimal mediante `inputmode=decimal`, admitiendo coma y punto, con selección del valor al enfocar. Se validan hasta seis decimales en unidad base; las cantidades que no se representan exactamente en una presentación se muestran en base. La aparición exacta del teclado depende del navegador/teclado instalado: pendiente comprobar en teléfonos Android e iOS reales.

## Stock, reservas y trazabilidad

El servidor propone ubicaciones físicas de la sucursal, con stock positivo y sin ubicaciones excluidas. Respeta el criterio de pick existente: mayor stock primero. Descuenta del plan lo ya asignado a otra línea del mismo producto. El verificador ve las ubicaciones antes de confirmar; si el plan cambia, debe actualizar y comprobarlo de nuevo.

El despacho usa `despachar_linea` y su motor de stock/FIFO existente, sin omitir turno ni permitir sobregiro. Si falla una línea, se revierten todas las salidas, eventos, retiro y cola de esa confirmación. Un personalizado se retira completo o queda pendiente, mediante su motor existente; no se inventa una entrega parcial de personalizados.

Las cantidades alistadas y sus motivos se conservan. Las cantidades revisadas y los motivos de diferencia se registran por separado. Los saldos siguen pendientes en el Pedido y cada entrega parcial mantiene su expediente. Crear la siguiente preparación conserva el circuito de dos actores. Una entrega del circuito anterior ya despachada, pero sin retiro confirmado, puede cerrarla su revisor con destino/fotos: se identifica como salida previa y no se vuelve a mover stock. Los retiros históricos ya confirmados conservan a su responsable original.

El botón rápido sólo completa el checklist. El stock se mueve al confirmar revisión y retiro. Las rutas de despacho manual no pueden saltar esa confirmación en un Pedido tomado por el nuevo circuito; la autorización transaccional vive en una tabla privada sin permisos de cliente. No se modifica caja ni se confirma pago o recepción en destino.

Una respuesta perdida conserva el intento: la app consulta la evidencia y el retiro antes de repetir. El mismo lote, versión, actor, destino y plan recupera la respuesta sin otra salida ni nuevas fotos. Las funciones privadas anteriores no quedan ejecutables directamente por `authenticated`.

## Telegram

Dos avisos independientes por entrega: **📦 Alistado** y **🚚 Salida**. Cada producto tiene nombre, presentación, cantidad alistada o retirada, cantidad pendiente y observación cuando corresponde:

- ✅ Cantidad completa.
- ⚠️ Cantidad parcial.
- ❌ Cero alistado o sin salida.

Los álbumes incluyen una referencia de evidencia. Todo el detalle se publica en mensajes numerados vinculados al álbum; el contenido no se recorta al límite de un caption. Cada mensaje guarda su propio recibo. Si Telegram rechaza una parte posterior, el reintento continúa desde la parte pendiente y no vuelve a publicar fotos ni mensajes confirmados. Si la respuesta es desconocida, queda INCIERTO y requiere revisión manual.

Las fotografías conservan la retención de 48 horas **después de confirmar el envío completo**. Pendientes, errores e inciertos no se eliminan por antigüedad. No se modifica webhook ni receptor de OpenClaw.

## Publicación coordinada

La migración `20261021192845_pedidos_dos_responsables_evidencias.sql` incorpora `evidencia_operacion.configuracion.pedidos_dos_actores=false`. Aplicarla no activa el nuevo circuito ni convierte los retiros históricos.

1. En una base nueva, aplicar esta migración después de `20261020152719_evidencias_pedidos_traslados_retiro.sql`. En Cation ambas ya están registradas con los mismos nombres de versión que Git; se comprobó la coincidencia exacta de su SQL. No reaplicarlas ni reescribir el historial.
2. Desplegar sólo `evidencia-operaciones-telegram`, incluyendo `worker-pedidos.js` y su dependencia relativa del worker VTD. No requiere desplegar ni editar `evidencia-vtd-telegram`.
3. Ejecutar el diagnóstico administrativo de la función nueva: debe devolver HTTP 200 con `ok=true` y `pedidos_dos_actores=true`, bot/grupo correctos.
4. Publicar/verificar el frontend y actualizar pestañas antiguas. La interfaz conserva el circuito previo cuando la respuesta del servidor no indica el modo nuevo.
5. Activar `update evidencia_operacion.configuracion set pedidos_dos_actores=true where id and activo`. Las preparaciones nuevas y las que siguen PREPARANDO al pasar por la API adoptan el modo. Las ya despachadas sin retiro confirmado permiten cerrar el retiro por su revisor, sin segundo despacho. Las que estaban listas/en revisión en el circuito anterior conservan su flujo; se puede reabrir una preparación pendiente con motivo para adoptar el nuevo circuito. No convertir documentos ya retirados.
6. Validar desde dos dispositivos/cuentas reales: alistado, ajustes, fotos, revisión, ubicaciones, retiro, álbum/detalle, saldos pendientes y recuperación ante cortes. Verificar Android/iOS, limpieza y respaldo OpenClaw.

Desactivar la bandera detiene la adopción por otras preparaciones. Las ya tomadas por el modo de dos actores lo conservan para no reinterpretar sus cantidades, fotos o responsabilidad a mitad de la entrega. Mantener disponibles el nuevo servidor y worker para cerrarlas.

## Validación

Pruebas sintéticas en PostgreSQL con motores reales: dos responsables distintos, diferencias y ceros, motivos, atajos que preservan excepciones, fotos por etapa, permisos, plan adulterado, separación de sucursales, FIFO, fallo de la segunda salida con reversión de la primera, retiro idempotente, saldo siguiente, mensajes completos y recibos de todas las partes. La definición del motor Caja/VTD se compara antes/después.

Pruebas de interfaz: cantidades precargadas, coma decimal, campos de teclado numérico, ajustes antes de confirmar todo, fotos obligatorias, mismo verificador/retirante y recuperación de respuesta perdida tanto al preparar como al retirar. Worker: recibos, continuidad tras rechazo, timeout, guardado fallido y validación del tema. Capturas a 320 y 390 px sin desbordamiento horizontal. No sustituye la comprobación del teclado ni la operación en un teléfono real.

Fuentes técnicas: [Telegram Bot API](https://core.telegram.org/bots/api#sendmessage), [inputmode](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode).
