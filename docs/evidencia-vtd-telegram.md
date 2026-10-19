# Evidencias de salida VTD hacia Caja

Destino: `@cation_bbb_bot`, grupo `-1003058173908`, tema `17051`.
La foto documenta la **salida de Almacén hacia Caja**, no la entrega final al cliente.

## Operación

Con la integración activada, el encargado adjunta entre una y diez fotos JPEG, PNG o WebP antes de confirmar las cantidades. El navegador las convierte a JPEG de hasta 1600 px en su lado mayor y 1 MiB cada una. Se pueden tomar fotos sucesivas con la cámara o seleccionar varias de la galería. Es necesario tener conexión para guardar la evidencia y confirmar la salida.

Las fotos se suben a un bucket privado, en rutas reservadas por una RPC para la persona, VTD y versión de la entrega. La misma transacción que registra el Kardex exige que estén todas las fotos en Storage y crea el envío pendiente. El cliente no puede saltarse la exigencia llamando a la función privada anterior. Recibir un retorno no exige nuevas fotos.

El cron `evidencia-vtd-telegram` revisa cada minuto si hay trabajo; invoca la Edge Function sólo cuando lo hay. Cada invocación procesa hasta dos VTD. El envío continúa aunque el navegador se cierre. La app consulta su estado y muestra el enlace a Telegram cuando queda confirmado. Los documentos enviados antes de la activación no requieren una evidencia retroactiva.

Telegram recibe una foto o un álbum con número de VTD, responsable, hora de Bolivia, material y referencia de la evidencia. No se publican datos de pago ni el carrito de Caja. Se guardan identificadores de mensajes y archivos, no URLs de descarga que contengan el token del bot.

## Retención y fallos

- Las fotos de un envío confirmado se eliminan mediante la API de Storage **48 horas después de guardar la confirmación**. Quedan el registro y el enlace. La copia independiente queda a cargo del OpenClaw del propietario.
- Los rechazos explícitos se reintentan con espera progresiva, respetando `retry_after`, hasta cinco intentos. Después se muestra «Reintentar envío de fotos». Reintentar no vuelve a ejecutar stock.
- Un timeout, respuesta incompleta o un proceso interrumpido durante el envío queda `INCIERTO`. Telegram no admite una clave de idempotencia para publicar fotos: no se repite automáticamente un resultado desconocido.
- Los pendientes, errores e inciertos no se eliminan por antigüedad. Los borradores abandonados antes de confirmar la salida se limpian a las 48 horas; no representan una salida registrada.
- Si falla borrar Storage, se vuelve a intentar y el registro no se marca como eliminado hasta que Storage confirme.

Para resolver un `INCIERTO`, un administrador debe buscar la referencia en el tema VTD. Si existe, debe registrar los recibos correctos, el instante de confirmación y la retención de 48 h. Si comprobó que no se publicó, puede pasar el lote a `ERROR` para habilitar el reintento. No resolverlo automáticamente ni repetir el stock.

## Configuración y despliegue

1. Aplicar `supabase/migrations/20261019221227_evidencia_vtd_telegram.sql` y `20261019222415_invocacion_vtd_un_solo_uso.sql`. La configuración comienza con `activo=false`; los clientes anteriores continúan funcionando durante la publicación.
2. Guardar **TELEGRAM_BOT_TOKEN** como secreto de Edge Functions. Nunca usar `VITE_` para este token ni incorporarlo a Git.
3. Desplegar `evidencia-vtd-telegram` con `verify_jwt=false`. La función valida una credencial aleatoria de un solo uso y cinco minutos de vigencia mediante una RPC exclusiva de `service_role`. La cola HTTP no contiene secretos reutilizables ni el token de Telegram.
4. Configurar `evidencia_vtd.configuracion.worker_url` con la URL HTTPS de la función. Ejecutar el diagnóstico autenticado del worker (`accion=diagnostico`) para comprobar identidad del bot y acceso/permisos en el grupo.
5. Publicar la miniapp y, sólo después de comprobar el diagnóstico y el cliente publicado, activar `evidencia_vtd.configuracion.activo=true`.

La integración no llama `getUpdates`, no registra un webhook y no modifica el receptor de Telegram de OpenClaw. La lectura automática y el respaldo que haga OpenClaw de sus propios mensajes deben seguir su configuración independiente.

Validación local: `npm test`, `npm run test:qr`, `npm run build`, y ESLint de los archivos modificados. La integración de PostgreSQL usa datos ficticios en memoria, sin ventas de prueba en producción. Las pruebas del worker simulan Telegram, timeouts, rechazos, guardado de recibos y eliminación fallida.
