# Pedidos y Traslados QR: responsables y evidencia

La ampliación de Pedidos a dos responsables se documenta en [Pedidos: alistador y verificador que retira](pedidos-dos-responsables.md). Este documento conserva la descripción del circuito anterior para las entregas e históricos que siguen utilizándolo.

Los destinos indicados pertenecen al mismo grupo de Telegram (`-1003058173908`), en temas distintos:

| Operación | Tema | Cuándo se publican las fotos |
| --- | --- | --- |
| Pedidos | `9` | Al confirmar el retiro para transporte |
| Traslados virtuales del circuito QR | `17226` | Al autorizar la salida, por su revisor |
| VTD, circuito existente | `17051` | Conserva su funcionamiento actual |

## Pedidos

1. Una persona prepara y otra verifica, con las reglas existentes.
2. Se registra el despacho mediante «Abrir pedido y despacho». Este paso conserva el descuento de stock y el Kardex actuales.
3. Una tercera persona escanea el QR de esa entrega despachada, entra con su propia cuenta, indica el destino, adjunta entre una y diez fotos y confirma «Retiro para transporte».

El servidor toma el transportista de la sesión; no permite elegir o suplantar a otro usuario. Debe ser distinto del preparador y del revisor y tener un perfil de Almacén habilitado (`almacenero`, `operario`, `gerente` o `admin`) con acceso a la sucursal de origen. No se incorpora un rol nuevo.

El retiro queda **EN_TRANSPORTE**, con nombre, fecha, destino y referencia de evidencia. No confirma recepción en destino ni vuelve a mover stock. Cada entrega parcial tiene su propio retiro. Escanear una entrega despachada consulta su retiro en lugar de crear una preparación nueva; «Crear una nueva preparación» sigue siendo una acción explícita para el saldo restante. Si ya se trabaja en la siguiente preparación, el pedido muestra enlaces a las entregas anteriores pendientes de retiro.

## Traslados

Se conservan los dos responsables asignados del circuito QR: quien alista y quien revisa/autoriza. El revisor adjunta entre una y diez fotos antes de autorizar la salida. La autorización, el movimiento de stock existente y el envío pendiente se guardan en una sola transacción.

No hay captura de transportista, destino libre ni tercer escaneo de retiro. La recepción que ya tenía el traslado en Tienda sigue disponible. Esta integración cubre los traslados virtuales QR; no sustituye otros formularios de traslado.

## Telegram y recuperación

El álbum incluye documento, responsables, destino, hora de Bolivia, material y referencia de evidencia. El tema se reserva en el servidor por lote; el navegador no decide a dónde enviar. VTD conserva sus RPC, configuración, bucket y tema. El worker comparte código de envío con opciones cuyo valor por defecto mantiene la integración VTD.

Las fotos usan un bucket privado nuevo (`evidencias_operaciones`), con carga inmutable permitida únicamente al responsable de esa captura y versión. El navegador convierte JPEG, PNG y WebP a JPEG de hasta 1 MiB. Confirmar exige que todas las fotos estén subidas.

Los reintentos de confirmación usan el mismo lote. Si se pierde la respuesta, la app consulta primero el retiro o la autorización ya guardados y recupera el resultado. El envío a Telegram continúa desde el servidor aunque se cierre el navegador; una falla de Telegram no revierte la operación ni repite stock.

Se conserva la política de VTD: reintentos con espera para rechazos explícitos, revisión manual de resultados `INCIERTO`, limpieza 48 horas después de confirmar Telegram, y conservación de pendientes/errores/inciertos. Las credenciales del worker son aleatorias, de un uso y cinco minutos de vigencia. La integración no cambia webhooks ni consume `getUpdates`; el respaldo de estos temas en OpenClaw debe configurarse por separado si se desea.

## Publicación coordinada

1. Aplicar `supabase/migrations/20261020124326_evidencias_pedidos_traslados_retiro.sql` después de las migraciones VTD existentes. La nueva integración empieza con `activo=false`.
2. Desplegar `evidencia-operaciones-telegram` con `verify_jwt=false`. Reutiliza el secreto de proyecto `TELEGRAM_BOT_TOKEN`; nunca incorporarlo a Git ni al cliente.
3. Configurar `evidencia_operacion.configuracion.worker_url` con la URL de esta nueva función. Desde una sesión administrativa ejecutar `select evidencia_operacion.invocar('diagnostico')` y consultar la respuesta de `pg_net`: comprueba identidad del bot y acceso al grupo sin publicar mensajes de prueba.
4. Publicar el frontend que incluye esta interfaz. Los clientes anteriores no pueden saltar la exigencia de fotos del traslado una vez activada; deben actualizarse.
5. Activar mediante `update evidencia_operacion.configuracion set activo=true, habilitado_desde=now() where id`. La fecha de corte evita imponer el nuevo paso a preparaciones/traslados creados antes de la activación. El cron `evidencia-operaciones-telegram` revisa la cola cada minuto.

Desactivar esta configuración no altera la configuración de VTD. Las confirmaciones y enlaces ya registrados se conservan. La activación no se realiza automáticamente por aplicar la migración.

## Validación local

`npm test`, `npm run test:qr`, `npm run build` y ESLint de los archivos modificados. Las pruebas de PostgreSQL corren en memoria: separación de personas/sucursales, entregas parciales, idempotencia, stock, permisos, fotos obligatorias, temas, credenciales de un uso y retención. Las pruebas de interfaz incluyen respuesta perdida al retirar; las del worker verifican el bucket y ambos temas sin publicar en Telegram real.
