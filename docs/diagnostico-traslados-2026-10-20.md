# Diagnóstico de traslados: Almacén y Seller

Revisión del 20 de octubre de 2026 (America/La_Paz). Seller corresponde al proyecto `pos-cation`.

Se revisó el código local de Almacén (`241f1ef`, con cambios previos) y Seller (`d26f618`), y se consultaron en lectura las funciones, políticas y datos actuales de `supabase_db_almacen_roari`. No se despacharon, recibieron ni corrigieron documentos reales. La versión desplegada de las interfaces no se verificó mediante navegador; los hallazgos de pantalla corresponden al código local.

## Situación actual

| Estado | Solicitudes | Observación |
| --- | ---: | --- |
| Solicitado | 18 | 203 líneas, 133 productos |
| En tránsito | 42 | 39 llevan más de 7 días desde el despacho |
| Recibido | 2 | Sólo dos recepciones registradas en todo el historial consultado |
| Rechazado | 4 | |
| Cancelado | 13 | Incluye cierres sin envío y tandas sustituidas |

De las 203 líneas pendientes, 179 tienen stock suficiente **individualmente** y 24 no tienen stock despachable. Ninguna carece de presentación base activa. Al agrupar la demanda de todas las solicitudes, 4 productos adicionales tienen stock insuficiente para cubrirlas simultáneamente: las 179 líneas no equivalen a una promesa de despacho conjunto. No hay conteos controlados abiertos que estén bloqueando ubicaciones actualmente.

Ocho solicitudes tienen todas sus líneas cubiertas individualmente por stock. Tres no tienen stock en ninguna línea: `TRA-2026-00056`, `TRA-2026-00058` y `TRA-2026-00078`. Las otras siete mezclan líneas con stock y sin stock. Estos datos describen el saldo del sistema al consultar; no prueban disponibilidad física ni por qué una persona dejó de operar.

## Flujo existente

1. Seller crea `solicitud_traslado` y sus líneas. Todavía no mueve stock.
2. Almacén despacha: puede editar cantidades, rechazar líneas o mandarlas a faltante. Seller de escritorio también ofrece un despacho, pero completo y sin decisiones por línea.
3. La función de despacho descuenta origen **y acredita destino inmediatamente**, dejando el documento en `EN_TRANSITO`. El stock de destino ya queda registrado antes de la recepción física.
4. La recepción confirma lo que llegó; si llegó menos, ajusta el faltante en destino. No vuelve a acreditar el traslado completo.
5. Los faltantes de despacho generan otra solicitud. La reversión está limitada a una ventana de 30 minutos; después se propone una devolución.

Hay además un flujo móvil de traslado virtual con carrito, QR y verificación por otra persona. Es independiente de las solicitudes normales de Seller: éstas no se convierten automáticamente en carritos móviles. Actualmente no hay documentos `TRASLADO_VIRTUAL` en la base consultada.

## Hallazgos prioritarios

### 1. El vendedor no tiene acceso operativo a traslados desde Seller

El rol `vendedor` es enviado a `/piso`, cuya interfaz permite armar pedidos para Caja, pero no solicitar, seguir ni recibir traslados. Además, el permiso de acceso a la bandeja exige `orders_dispatch` o `retail_sale`; el vendedor no tiene ninguno. Es una restricción explícita del diseño actual, pero constituye un obstáculo si se espera que el vendedor participe en los traslados.

Evidencia: [redirección](D:/Proyectos/pos-cation/src/pages/PosPage.tsx:94), [acceso al módulo](D:/Proyectos/pos-cation/src/pages/PosPage.tsx:62), [permisos del vendedor](D:/Proyectos/pos-cation/src/application/auth/AuthSessionProvider.ts:12), [interfaz de Piso](D:/Proyectos/pos-cation/src/features/piso/PedidoPisoApp.tsx:34).

Corrección propuesta: incorporar una entrada de traslados en Piso, con solicitud, seguimiento y recepción según responsabilidad y sucursal. No hace falta conceder acceso al POS completo para resolverlo.

### 2. Seller informa despacho exitoso aunque no haya salido nada

El repositorio descarta el JSON de `despachar_traslado`: pierde las líneas bloqueadas por stock, los parciales y el identificador de la nueva tanda. Después, la pantalla anuncia incondicionalmente «despachado».

Caso reproducido en PostgreSQL aislado: solicitar 200 con stock de 100 devuelve una respuesta RPC sin error, cancela la solicitud original, crea una nueva tanda y no mueve stock. Seller toma esa respuesta como éxito de despacho. En un caso mixto tampoco explica cuáles líneas efectivamente salieron.

Evidencia: [RPC y respuesta descartada](D:/Proyectos/pos-cation/src/infrastructure/supabase/TransferRepository.supabase.ts:182), [mensaje de éxito](D:/Proyectos/pos-cation/src/features/transfers/TransfersPage.tsx:99), [comportamiento de la función vigente](D:/Proyectos/almacen-cation/db/migrations/2026-09-25_fix_traslados_lineas_colgadas.sql:89).

Corrección propuesta: conservar el resultado del RPC, mostrar resumen de salida y bloqueos, y enlazar la tanda nueva antes de dar la operación por atendida.

### 3. La recepción está acumulada y las líneas antiguas no se pueden resolver desde su solicitud

Hay 42 documentos en tránsito y sólo 2 recibidos en el historial. Ese estado no demuestra que la mercadería siga físicamente en camino: puede ser recepción sin registrar. No se debe confirmar masivamente sin contrastar lo entregado.

Doce traslados antiguos contienen 50 líneas todavía `POR_DESPACHAR` aunque la cabecera está `EN_TRANSITO`. La función actual ya evita crear ese problema en despachos nuevos, pero no reparó las filas históricas. La recepción sólo procesa `DESPACHADA`; intentar despachar la cabecera antigua falla por su estado. Almacén advierte que esas líneas no salieron, pero no ofrece una acción para recuperar ese saldo. Seller ni siquiera conserva el estado por línea en su modelo.

| Traslado | Líneas que nunca salieron |
| --- | ---: |
| TRA-2026-00010 | 1 |
| TRA-2026-00017 | 2 |
| TRA-2026-00018 | 6 |
| TRA-2026-00020 | 1 |
| TRA-2026-00021 | 1 |
| TRA-2026-00024 | 6 |
| TRA-2026-00027 | 10 |
| TRA-2026-00028 | 1 |
| TRA-2026-00029 | 3 |
| TRA-2026-00031 | 2 |
| TRA-2026-00032 | 2 |
| TRA-2026-00033 | 15 |

Evidencia: [recepción sólo de lo despachado](D:/Proyectos/almacen-cation/db/migrations/2026-09-25_fix_traslados_lineas_colgadas.sql:218), [modelo de Seller sin estado de línea](D:/Proyectos/pos-cation/src/application/shared/models.ts), [mapeo de líneas](D:/Proyectos/pos-cation/src/infrastructure/supabase/TransferRepository.supabase.ts:41).

Corrección propuesta: mostrar antigüedad y responsable de recepción; recuperar las 50 líneas mediante una operación trazable que no vuelva a mover lo ya despachado. Se necesita revisar qué se entregó realmente antes de regularizar cada cabecera.

### 4. Almacén permite despachar más de lo solicitado

La pantalla valida cantidades negativas o cero, pero no establece un máximo solicitado. La función de base de datos tampoco compara el despacho con el pedido.

Caso reproducido en PostgreSQL aislado: solicitud de 5, payload de despacho de 8 y stock suficiente. La operación registra `cantidad_despachada=8` y mueve las 8 unidades. No se detectó este caso como incidencia histórica en esta revisión; se confirmó que el sistema lo permite.

Evidencia: [validación de pantalla](D:/Proyectos/almacen-cation/src/TrasladosApp.jsx:287), [input sin máximo](D:/Proyectos/almacen-cation/src/TrasladosApp.jsx:460), [validación SQL](D:/Proyectos/almacen-cation/db/migrations/2026-09-25_fix_traslados_lineas_colgadas.sql:74).

Corrección propuesta: limitar en base de datos y pantalla la cantidad al saldo solicitado. Si se necesita ampliar el pedido, hacerlo mediante una acción explícita y trazable.

## Otros puntos que dificultan operar

- **Errores silenciosos en Almacén:** la carga de solicitudes y líneas ignora `error`; una consulta fallida puede terminar en «Sin solicitudes» o una tarjeta sin productos. La consulta de stock también ignora errores. [Carga](D:/Proyectos/almacen-cation/src/TrasladosApp.jsx:672), [stock](D:/Proyectos/almacen-cation/src/lib/operaciones.js:863).
- **Recepción de Seller sin manejo visible de errores ni estado ocupado:** el callback descarta la promesa y la función no captura el fallo. Si la base rechaza la recepción, el usuario puede quedarse sin explicación. Tampoco se filtran líneas por estado, porque el modelo no lo conserva. [Recepción](D:/Proyectos/pos-cation/src/features/transfers/TransfersPage.tsx:151), [callback](D:/Proyectos/pos-cation/src/features/transfers/TransfersPage.tsx:180).
- **Devoluciones con dirección fija:** «Nueva solicitud» permite elegir devolución, pero siempre envía origen 1 y destino 2. «Registrar devolución» siempre precarga 2 → 1, incluso si el traslado original iba en sentido contrario, e incluye todas las líneas sin filtrar por estado. [Formulario](D:/Proyectos/pos-cation/src/features/transfers/TransfersPage.tsx:350), [devolución](D:/Proyectos/pos-cation/src/features/transfers/TransfersPage.tsx:124).
- **Borradores de Almacén pierden decisiones:** guardan cantidades, pero no las acciones Rechazar/Faltante. Al reabrir se reinician todas a Despachar. [Guardado](D:/Proyectos/almacen-cation/src/TrasladosApp.jsx:265), [reinicio](D:/Proyectos/almacen-cation/src/TrasladosApp.jsx:219).
- **Filtro de venta aplicado al traslado:** catálogo y escaneo de Seller validan presentaciones vendibles en Tienda incluso estando en modo traslado. Un código de presentación exclusiva de Almacén puede rechazarse antes de solicitar el movimiento. Hay una presentación activa marcada como no vendible en Tienda; ninguna línea pendiente usa esa presentación. [Catálogo](D:/Proyectos/pos-cation/src/components/ProductCatalog.tsx:38), [validación](D:/Proyectos/pos-cation/src/lib/presentacionAlAgregar.ts:16).
- **Paginación de Almacén pendiente:** pide todas las líneas de una pestaña en una sola consulta. Actualmente hay 836 en tránsito y 203 solicitadas; no se demostró truncamiento actual por un límite de 1000. Es un riesgo al crecer y ante errores parciales. Seller ya pagina las líneas y cuenta con pruebas para ese caso. [Consulta de Almacén](D:/Proyectos/almacen-cation/src/TrasladosApp.jsx:675), [paginación de Seller](D:/Proyectos/pos-cation/src/infrastructure/supabase/TransferRepository.supabase.ts:82).

## Comprobaciones y límites

- Las funciones vigentes de despacho y recepción coinciden con la corrección local del 25 de septiembre. No es una corrección que falte aplicar a producción.
- El stock despachable excluye ubicaciones virtuales/excluidas y sólo suma saldos positivos. No se encontró el bloqueo antiguo por sumar negativos virtuales en la función vigente.
- Las sucursales físicas tienen ubicación de recepción y `authenticated` puede ejecutar los RPC revisados. Las políticas de las tablas de traslados permiten operar a ese rol. No aparece un bloqueo general de esos RPC; la restricción del vendedor identificada está en la interfaz y sus permisos de módulo.
- El conteo controlado puede impedir movimientos durante un conteo abierto, pero no había ninguno abierto al consultar.
- Pasaron 39 pruebas de helpers de Almacén y 26 pruebas de Seller (paginación, impresión y acceso de Piso). Inicialmente Vitest falló por permisos del directorio temporal; pasó usando un directorio temporal dentro de cada repositorio.
- Tres reproducciones aisladas confirmaron: falta de stock con cancelación y nueva tanda, exceso de despacho permitido, y parcial 4/10 que conserva saldo 6 en una tanda nueva. La base productiva sólo recibió consultas de lectura.
- No se revisaron sesiones individuales ni se determinó quién omitió una recepción. Los datos de antigüedad describen documentos, no atribuyen responsabilidad.

## Orden recomendado

1. Resolver la participación del vendedor y la recepción desde Piso.
2. Mostrar en Seller el resultado real de cada despacho, los estados por línea y los enlaces entre tandas.
3. Incorporar el límite de cantidad en el despacho y errores visibles en ambas interfaces.
4. Conciliar los 42 documentos en tránsito con entregas reales y recuperar el saldo de las 50 líneas históricas.
5. Corregir devoluciones, conservación de borradores y paginación de Almacén.

El principal obstáculo no parece ser exclusivamente stock: también falta acceso del vendedor, seguimiento entre interfaces y cierre de recepción. La acumulación observada respalda priorizar ese recorrido completo.
