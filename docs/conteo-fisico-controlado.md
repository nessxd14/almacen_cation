# Conteo físico controlado · primera etapa

Implementado el 19 de octubre de 2026 en Almacén. Migración aplicada a `supabase_db_almacen_roari`: `20261019152652_conteo_fisico_controlado`. El nombre del archivo se alineó con la versión devuelta por el historial remoto después de crear el archivo con la CLI.

## Resultado

Conteo y Conciliación usan el mismo flujo. Permite definir alcance, retomar sesiones, capturar por presentación, completar rondas independientes, revisar diferencias y aplicar un único saldo por producto y ubicación.

El motor está en `inventario_control`, esquema privado que no debe añadirse a los esquemas expuestos de la Data API. `public.operar_conteo` es un wrapper SECURITY INVOKER. El motor privilegiado valida identidad, perfil activo, rol y sucursal en cada llamada; las tablas privadas no conceden acceso directo a authenticated ni anon.

## Recorrido para el piloto

1. Coordinar una ubicación pequeña con quienes reciben y despachan. Seleccionar **Nuevo conteo** y definir ubicación, propósito y alcance.
2. Elegir **Toda la ubicación** para cubrir las existencias y asignaciones conocidas. El alcance parcial exige seleccionar productos. En ambos casos la ubicación completa queda bloqueada para movimientos hasta aplicar o cancelar.
3. Iniciar y tomar una ronda. SIMPLE requiere una persona y revisión de supervisión. DOBLE_CIEGO requiere dos usuarios distintos; cada ronda pertenece a un dispositivo y no muestra el esperado ni las capturas de la otra persona.
4. Contar cajas cerradas y unidades sueltas como mercancía distinta. Cada presentación conserva su factor al confirmar. Dos cajas de doce y tres unidades generan 27 unidades base. El QR identifica la presentación; un QR sin presentación exige elegir el empaque. Una etiqueta de otra sucursal se rechaza.
5. Registrar cero cuando se haya comprobado que no hay mercancía. No contado y cero son estados distintos. Una captura incorrecta se anula con motivo y se vuelve a cargar; el registro anterior se conserva.
6. Adjuntar foto. La cola IndexedDB confirma persistencia al terminar la transacción y conserva foto, UUID y error si falta red. Reintenta sin duplicar capturas ni reemplazar fotos ya confirmadas.
7. Finalizar cada ronda con el recorrido y la sincronización confirmados. El servidor compara el manifiesto de UUID con las capturas vigentes, exige cobertura y rechaza capturas tardías.
8. En Conciliación, supervisión ve esperado al corte, ambas rondas y diferencia. Debe aprobar cada producto con causa/revisión. Las diferencias requieren confirmar un reconteo físico. Puede revisar una aprobación antes de aplicar.
9. Aplicar el conteo. La revisión usa versión para detectar cambios concurrentes. La aplicación comprueba el corte, escribe un ajuste por producto cuando existe diferencia, conserva el vínculo al conteo y libera la ubicación. Un reintento no duplica ajustes.

Cancelar conserva las observaciones y su motivo y libera la ubicación sin regularizar existencias. No se libera automáticamente una sesión abandonada: el creador o supervisión deben cancelarla expresamente.

## Corte y operaciones simultáneas

La creación y cada movimiento del Kardex se serializan sobre la fila de ubicación. Se conservan saldo y último movimiento por producto al establecer el corte. Durante el conteo se rechazan entradas, salidas y escrituras directas del saldo; tampoco se permite vaciar stock_actual con TRUNCATE.

La aplicación sólo permite los movimientos exactos de sus conciliaciones dentro de su transacción. Si una operación empezó antes de una aplicación y esperó el candado, debe reiniciarse para validar disponibilidad con el nuevo saldo. Esto evita descontar usando una validación anterior al conteo. Las operaciones que abarcan varias ubicaciones mantienen el comportamiento transaccional de PostgreSQL: un conflicto de candados puede requerir reintentar la operación completa; no se confirma parcialmente.

No se implementa compensación de actividad mientras se cuenta. Esta versión exige inmovilización de la ubicación. Las pruebas usan PostgreSQL aislado en memoria; no sustituyen una prueba de carga con varias conexiones reales ni la comprobación física.

## Cobertura y verificación

El control ESTRICTO se activa al aplicar, cuando todas las ubicaciones físicas conocidas del producto en la sucursal tienen una verificación aplicada. Una captura suelta no valida toda la sucursal. No se cambió retroactivamente el modo de control de productos existentes ni se regularizaron automáticamente los negativos históricos.

La ficha consulta también las verificaciones sin diferencia: no se crea un movimiento de cantidad cero para simular un ajuste. Las verificaciones conservan sesión, aprobación, actor y fecha aunque no produzcan Kardex.

El esquema histórico recibe el espejo de sesión/conciliación que necesitan las fichas y las referencias de Kardex. Triggers impiden modificar estos espejos mediante el cliente; políticas RLS restrictivas evitan filtrar las cantidades por las antiguas políticas permisivas. Las fotos nuevas usan `conteos_controlados`, privado: cada contador puede subir y leer sus evidencias; supervisión puede leer las fotos de ambas rondas después del cierre de captura. No se concede UPDATE ni DELETE de fotos.

## Datos anteriores

Las 36 sesiones anteriores y sus capturas se conservan. No tienen un corte verificable y no se importan como nuevas existencias. Las funciones anteriores de conciliación/aplicación devuelven una indicación para iniciar el flujo controlado. `marcar_inventariado` deja de poder ejecutarse desde authenticated para evitar la activación prematura del control estricto.

La pantalla detecta las capturas locales pendientes en `conteo_wms` del usuario o de la supervisión autorizada y permite descargar un JSON con datos y fotos. La lectura y descarga no eliminan esa cola. El nuevo motor usa una cola separada; las observaciones antiguas deben revisarse y recontarse con un corte actual.

La migración conservó estos valores verificados antes y después:

| Comprobación | Antes | Después |
| --- | ---: | ---: |
| Filas de stock_actual | 2441 | 2441 |
| Filas de Kardex | 11078 | 11078 |
| Sesiones históricas | 36 | 36 |
| Sesiones históricas cerradas | 0 | 0 |
| Huella de cantidades por producto/ubicación | `61d1cce0358f0afc5544f290f8782eb6` | Igual |
| Sesiones nuevas creadas por la migración | — | 0 |

La lectura autenticada del listado se comprobó en la base conectada y devolvió cero sesiones nuevas y 36 históricas conservadas. No se registraron conteos físicos de prueba en el negocio.

## Pruebas

```powershell
npm run test:conteo
npm run test:qr
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2
npm run build
```

`db/tests/conteo-controlado.fixture.json` contiene únicamente estructura, tipos y funciones obtenidos por lectura del esquema real, sin filas del negocio. El integrador recrea tipos, columnas, restricciones y triggers y usa datos sintéticos. Storage se representa con sus tablas mínimas y RLS para comprobar los permisos; no ejecuta el servicio real de carga de archivos.

Se cubren: suma de presentaciones, cero frente a ausencia, rondas con distintos empaques, personas distintas, fotos privadas, capturas tardías, manifiesto incompleto, idempotencia, cancelación, cambios de versión, cambios del corte, transacciones anteriores a la aplicación, artículos sin catálogo y cobertura de ubicaciones antes de activar ESTRICTO. La suite existente de pedidos/Caja/despachos también pasó.

Las pantallas de inicio, captura, revisión y pendientes se renderizaron con datos ficticios. Se verificaron en navegador a 390 y 1280 px sin desbordamiento horizontal. Evidencia local ignorada por Git: `.conteo-qa.local/`.

El lint de todos los archivos modificados pasó. `npm run lint` del repositorio completo sigue señalando 19 errores y 1 aviso en archivos que este trabajo no modificó, entre ellos AdminApp, CatalogoApp, EditarProducto y TrasladosApp. No se cambiaron esas pantallas para resolver incidencias ajenas al conteo.

## Revisión de permisos

Los asesores se consultaron antes y después. Los avisos de search_path mutable bajaron de 61 a 58, y los endpoints públicos SECURITY DEFINER ejecutables por authenticated bajaron de 115 a 114. Los demás avisos previos permanecieron iguales.

Los cinco avisos informativos nuevos de RLS sin política corresponden exclusivamente a las tablas privadas del motor: no tienen grants a clientes y RLS deniega acceso por defecto. El acceso está limitado a las operaciones autorizadas; no son tablas expuestas que requieran acceso directo. [Descripción del asesor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Estado de entrega y siguientes etapas

### Interfaz de declaración por producto · 21 de octubre de 2026

El inicio ofrece declarar existencias iniciales, verificar una ubicación o verificar productos específicos. Se conserva la elección de una persona o dos rondas independientes y el bloqueo de toda la ubicación, incluso en alcances parciales.

Durante la captura, la lista permite abrir pendientes, consultar los productos ya contados y buscar por nombre, SKU o código de barras. El escáner selecciona la presentación de la etiqueta y abre la ficha del producto. Cada ficha reúne sus presentaciones activas para contar empaques cerrados y unidades sueltas a la vez. El total representa toda la existencia física de ese producto en esa ubicación, no un ingreso adicional. El esperado continúa oculto durante la captura.

**Guardar y siguiente** persiste todas las presentaciones en una sola transacción IndexedDB antes de pasar al siguiente pendiente. Una foto del producto respalda las capturas de sus presentaciones; cada captura conserva su UUID y foto privada en el servicio existente. La sincronización puede confirmar cada presentación por separado: mientras quede alguna pendiente, el producto sigue por sincronizar y la ronda no se puede finalizar. Reintentar no vuelve a generar la declaración. Un fallo local conserva cantidades y foto en el formulario para reintentar; no se anuncia guardado durable.

Los campos vacíos no declaran cero. **Verifiqué: no hay este producto** prepara el cero explícito y sigue requiriendo evidencia. Los borradores se conservan al alternar entre productos durante la misma sesión de pantalla y bloquean la finalización hasta guardarlos o descartarlos; no son persistencia offline hasta pulsar Guardar. Una declaración vigente se consulta sin ofrecer otra carga aditiva: para reemplazar el total hay que anular sus capturas con motivo y volver a declarar el producto completo.

Supervisión dispone de una tabla con filtros por productos pendientes, diferencias y todos, y abre una ficha de aprobación a la vez. Guardar no cambia stock; únicamente **Aplicar conteo y liberar ubicación**, después de las aprobaciones, establece las nuevas existencias. No se cambió el contrato ni la migración del motor y no se ajustaron datos reales durante la implementación.

Validación de esta actualización: pruebas de captura mixta, cero explícito, persistencia por lote, fallo local, sincronización parcial y reconexión, avance al siguiente producto, bloqueo de duplicados, borradores y artículos sin catálogo; además del integrador PostgreSQL aislado existente. Las pantallas con datos sintéticos se verifican a 320, 390 y 1280 px. La comprobación de cámara y operación con usuarios reales corresponde al piloto físico.

La migración está aplicada. La interfaz está implementada y compilada en el repositorio local; este trabajo no publicó un despliegue de Almacén. Antes del uso operativo general hay que publicar esta interfaz y hacer el piloto físico de una ubicación con usuarios reales, incluyendo cámara, reconexión y supervisión.

Quedan para una etapa posterior: tolerancias por cantidad/valor a costo, programación de conteos ABC, métricas de exactitud, clasificación estructurada de causas, compensación de movimientos concurrentes y diagnóstico individual de los 11 negativos ESTRICTO encontrados en la revisión inicial.

## Referencias de diseño

- [Oracle · Physical Inventory](https://docs.oracle.com/cd/E26401_01/doc.122/e48820/T291651T292528.htm): alcance, referencia temporal, revisión y aplicación.
- [Oracle · Cycle Counting](https://docs.oracle.com/cd/E26401_01/doc.122/e48820/T291651T292438.htm): reconteos y tolerancias; planificación ABC para la siguiente etapa.
- [Microsoft · Cycle counting](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/cycle-counting): trabajo de conteo, captura y resolución de diferencias.
- [Supabase · RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): grants y políticas que restringen el acceso a las filas.
