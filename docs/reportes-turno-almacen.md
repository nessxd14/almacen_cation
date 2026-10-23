# Reportes de almacén y entrega de turnos

Implementado el 21 de octubre de 2026. Migración aplicada en `supabase_db_almacen_roari`: `20261021155549_reportes_turno_almacen`. El archivo se creó con la CLI y su versión se alineó con el historial remoto. La interfaz está en el repositorio local; este trabajo no publica el sitio.

## Captura rápida para operarios · 22 de octubre de 2026

Durante el horario del turno, el reporte abre **Conteo rápido**: muestra un producto por ubicación, campos grandes para empaques y sueltas y **Guardar y siguiente**. La hora física se toma al confirmar cada producto. Si solo se escribe uno de los dos campos, el complementario equivale a cero; ambos vacíos nunca declaran cero. **No hay · Guardar cero** confirma y guarda cero en una acción; si había una cantidad positiva escrita, primero pide confirmar su reemplazo. Una observación es opcional; **No puedo contar** permite elegir un motivo frecuente o escribir otro y conserva cantidades y hora nulas.

Cada guardado envía únicamente su renglón al motor existente, con la versión actual del reporte. Al confirmar el servidor, actualiza el avance y continúa con pendientes de la misma ubicación y después de la misma zona; al terminar la ubicación base muestra el resumen y espera a que el operario continúe a la siguiente. Los demás borradores permanecen en pantalla y un fallo conserva lo escrito sin avanzar. No hay guardado automático ni persistencia sin conexión: se debe esperar la confirmación antes de salir. Los cambios sin guardar impiden comparar, cambiar a papel o actualizar el alcance, y mantienen la advertencia al salir/recargar.

**Corregir último conteo** recupera la cantidad guardada, conserva la hora física original y vuelve al producto que el operario estaba contando, con su borrador intacto. Al abrir un producto contado se muestra primero su declaración; **Corregir cantidad** conserva la hora y **Volver a contar ahora** inicia una captura vacía con una hora nueva. Ambas siguen la auditoría del motor existente. Enter en empaques avanza a sueltas sin guardar una captura parcial.

El avance distingue contados, pendientes con motivo y productos por recorrer. El resumen final permite revisar los pendientes antes de **Confirmar captura y comparar**. Esa acción actualiza el alcance automáticamente: si aparecen renglones sin contar, regresa al recorrido; si está completo, compara usando la nueva versión. Durante el recorrido no se presenta una acción de comparación prematura.

**Ver recorrido** permite filtrar por ubicación, buscar por nombre/SKU y volver a productos contados. **Escanear QR** identifica productos o ubicaciones del alcance, rechaza una sucursal distinta y exige elegir ubicación si el producto está en varias. La etiqueta no cambia la equivalencia congelada del renglón. Los códigos de barras se pueden buscar por su SKU cuando corresponda; el lector de esta pantalla admite los QR de fichas del almacén.

Fuera del horario del turno se conserva **Transcribir papel**, con la hora real anotada. El modo en vivo rechaza asignar la hora actual a una fecha o turno anterior. En móvil se priorizan cantidad y avance; impresión y actualización del alcance están en **Opciones del reporte**.

**Movimientos diarios → Ver movimientos** abre el desglose del producto/ubicación al mismo corte del resumen. Muestra hora de Bolivia, tipo, cantidad con signo, referencia, motivo y autor (UUID o correo). Permite filtrar mañana/tarde/fuera de horario y tipo. Calcula los saldos antes de filtrar, de modo que un filtro no altera la historia. Solo muestra saldos por movimiento cuando el detalle completo coincide con el resumen; si no coincide pide actualizar. La consulta conserva RLS y filtra además la sucursal. Un máximo de 1000 movimientos y el conteo total advierten consultas incompletas, incluso si el servidor impone un límite menor.

El respaldo del reporte usa el mismo desglose y abre por defecto **Durante el turno**; separa **Después del turno** y marca la actividad posterior al conteo físico. Mantiene la advertencia de límite de la consulta existente. Estas mejoras no requieren una migración nueva y no publican el sitio.

## Formulario por ubicación base · 23 de octubre de 2026

La captura rápida usa la presentación compacta aprobada. En escritorio, **Tu recorrido** está a la izquierda; en móvil pasa arriba, con botones táctiles y el formulario en una columna. El diseño se adapta al ancho disponible del módulo, incluso si la pantalla es grande pero hay una barra lateral abierta. Los campos de cantidades admiten teclado numérico/decimal y la acción principal incluye el espacio seguro inferior del dispositivo.

Las bases provienen del primer componente de la ubicación conservada en el reporte (`codigo_zona / mueble / compartimiento`). **Planta Baja**, **Hueco** y **Garaje** aparecen primero, seguidas de otras zonas del documento. Dentro de cada base se ordenan naturalmente mueble y compartimiento (2 antes de 10). No se crean zonas ficticias ni se suman las declaraciones de un producto en lugares diferentes. Los números originales de renglón y las equivalencias se conservan.

Se muestran botones de ubicación con su avance, un producto a la vez y **Empaques completos / Unidades sueltas**, calculando el total en unidad base. Si el factor es uno, se captura una cantidad única, incluidos materiales por peso con hasta cuatro decimales. Cuando se declaran empaques positivos es obligatorio confirmar **Verifiqué los empaques completos y su presentación**. La constancia se guarda en la observación auditada del mismo renglón con el prefijo `[Empaques verificados]`; no es una aprobación de existencias ni un ajuste. Cambiar la cantidad de empaques exige confirmar nuevamente. Las correcciones reemplazan esa constancia sin duplicarla y conservan la hora física original.

El guardado avanza primero dentro de la misma ubicación y luego por las demás ubicaciones de la base. Al terminar una base, presenta las cantidades declaradas y los pendientes con motivo antes de **Continuar en…**. Se puede elegir otra base o ubicación sin perder borradores. La captura sigue siendo ciega: la comparación real con el saldo a la hora física se realiza al confirmar el recorrido completo mediante el motor existente. No se muestran coincidencias estimadas durante la captura.

No se requieren migraciones ni cambios de permisos para este formulario. La verificación de escritorio y móvil usa datos sintéticos; las capturas están en `.reportes-qa.local/conteo-bases-*.png`.

## Presentación del detalle diario · 23 de octubre de 2026

**Movimientos diarios** ofrece el selector **Ver detalle en** en la cabecera: **Página**, **Panel lateral** y **Ventana**. Página es la opción inicial y muestra el detalle en una vista propia dentro del módulo, con **Volver a movimientos diarios**. Panel lateral mantiene la lista y el detalle en paralelo cuando hay ancho suficiente; en celular o en un contenedor estrecho muestra únicamente el detalle. Ventana abre un diálogo nativo con cierre, Escape, control de foco y bloqueo del fondo.

El selector también está disponible con el detalle abierto. Cambiar de presentación conserva producto, periodo y tipo de movimiento, y reutiliza la consulta que ya está cargada. Al cerrar se recuperan la búsqueda, la posición de la lista y el foco en el producto que se abrió. El panel permite seleccionar otro producto sin cerrar primero el anterior. La preferencia se guarda en este navegador por usuario; si el almacenamiento está bloqueado, sigue funcionando durante la consulta.

La búsqueda filtra nombre, SKU y ubicación. El resumen usa verde para entradas, rojo para salidas y ámbar para ajustes. En el detalle, etiqueta, icono y cantidad identifican el tipo: entrada verde, salida roja, ajuste ámbar, traslado azul e inventario inicial violeta. El signo de la cantidad se conserva: un ajuste negativo sigue siendo ámbar. Se mantienen las comprobaciones de corte, límites y coincidencia del saldo del desglose. La actividad fuera de horario queda en un apartado desplegable de la lista. No hay cambios en la base de datos ni publicación del sitio.

## Recorrido operativo

1. Abrir **Existencias → Reportes de turno** y seleccionar fecha y sucursal. Los horarios se interpretan en `America/La_Paz`: mañana 07:30-12:30 y tarde 14:30-21:30. No se generan turnos futuros.
2. **Generar hoja de conteo** crea un único folio por sucursal/fecha/turno, con responsable, productos y ubicaciones. Incluye todos los pares producto/ubicación con movimiento conocido en el turno, pendientes de reportes anteriores y hasta diez pares sin movimiento cuyo conteo cíclico esté vencido. Se pueden agregar productos del inventario y sus asignaciones por búsqueda.
3. **Imprimir / Guardar PDF** abre el diálogo del navegador, con A4 horizontal. Allí se puede imprimir o elegir **Guardar como PDF**. El contenido no muestra saldos del sistema, cantidades declaradas ni diferencias. El folio, revisión, número de renglón y equivalencia se repiten por página; la hoja de recepción conserva los números originales de sus pendientes. Se recomienda escala 100 % y desactivar los encabezados/pies que añade el navegador.
4. Recorrer el almacén y escribir empaques completos, sueltas en la unidad base, hora real y observaciones. Un cero confirma existencia vacía; una casilla vacía representa un pendiente. El factor y nombre de empaque proceden de la presentación activa de mayor factor (mínimo 1), y quedan congelados con el renglón. Cuando el factor es 1 se captura toda la cantidad en sueltas/base.
5. Abrir el mismo folio y transcribir en el mismo orden. **Guardar cantidades del papel** guarda el borrador en el servidor, con versión y auditoría de cada captura. Las cantidades no guardadas permanecen en pantalla si una llamada falla. Volver advierte si hay cambios; cerrar/recargar la página también. No se anuncia captura sin conexión ni guardado automático: guardar antes de cambiar de módulo.
6. Antes de comparar, usar **Actualizar alcance del turno** para agregar productos movidos después de imprimir. Los renglones existentes mantienen su número; actualizar no asigna otros diez cíclicos. Reimprimir si cambia el recorrido. Al entregar, el servidor comprueba nuevamente que ningún producto movido haya quedado fuera.
7. **Confirmar captura y comparar** fija la comparación y pasa de BORRADOR a REVISION. Se muestran cantidades físicas, equivalencias, saldo a la hora física y diferencia. Los ítems que no se pudieron contar exigen un motivo. Para corregir una transcripción se debe reabrir antes de entregar, con motivo y conservación de la comparación anterior en auditoría.
8. Después de revisar las diferencias, redactar las instrucciones para el siguiente turno y **Confirmar arqueo y entregar**. Solo puede hacerlo el responsable, al terminar el horario, con los conteos o motivos de pendientes completos. Si hay diferencias, la observación de entrega es obligatoria. Si existe el reporte del turno anterior, tiene que estar recibido. Los movimientos históricos no pueden haber alterado la referencia desde la comparación.
9. En **Recibir turno**, otra persona lee la entrega y puede imprimir la hoja de pendientes. Verifica cada pendiente, registra cantidades, hora y observación, y después deja la constancia de recepción. El servidor señala cuántos movimientos hubo desde el cierre hasta esa verificación; no atribuye automáticamente responsabilidades. Recibir no resuelve diferencias ni ajusta stock.
10. Las diferencias permanecen visibles y se vuelven a seleccionar en recorridos siguientes. **Abrir conteo controlado** envía producto/ubicación al motor existente. Supervisión puede **Vincular resolución** únicamente a una sesión aplicada después de la entrega, en el mismo producto, ubicación y sucursal. Esa aplicación mantiene la aprobación y bloqueo propios del motor existente.

## Cortes y saldos

Cada comparación usa la fecha/hora física anotada, validada dentro del turno y nunca futura. El esperado se reconstruye con el saldo actual menos los movimientos registrados posteriores a esa hora. Así se conserva el saldo inicial legado sin asumir que todo el Kardex histórico suma el stock actual. Por ejemplo, si se contaron 105 unidades a las 12:00 frente a 107 esperadas, una salida posterior no convierte esa diferencia en otra cantidad al digitar.

El reporte operativo no bloquea ubicaciones ni sustituye un inventario controlado. Es necesario coordinar el recorrido con las personas que mueven mercancía, registrar la hora real y revisar los respaldos si hubo actividad simultánea. El cálculo depende de la fecha de registro `creado_en`, no de la fecha efectiva editada de un documento. Una transacción que aún no hubiera confirmado o una modificación manual posterior del saldo histórico requiere investigación; la hoja no certifica por sí sola el instante físico ni la exactitud del Kardex.

**Movimientos diarios** muestra inicial, entradas, salidas, ajustes y saldo por producto/ubicación, sin sumar unidades incompatibles ni saldos finales de turnos. Usa intervalos diarios semiabiertos y presenta por separado actividad antes de 07:30, entre 12:30 y 14:30 y desde 21:30, con referencia y autor registrado. La lista de actividad fuera de horario y el detalle de respaldos tienen un máximo de 1000 movimientos por consulta, indicado en la interfaz; el resumen calcula sobre todos los movimientos del periodo.

El alcance inicial comprende ubicaciones operativas de inventario disponible (`ubicacion.excluye_disponible=false`) de sucursales físicas activas. No certifica ubicaciones excluidas ni todo el inventario virtual.

## Conteo periódico

**Plan cíclico** permite consultar última declaración, movimientos y diferencias abiertas. La frecuencia inicial es de treinta días; admin/gerente pueden configurar entre 1 y 365 por producto/ubicación, por ejemplo 1/7/30 días según riesgo. No se implementa clasificación ABC por valor ni costos monetarios. El plan consulta hasta 5000 pares y muestra hasta cien coincidencias por filtro; la frecuencia no garantiza cobertura si la capacidad física de contar es insuficiente. Hay que adecuarla al volumen y al número de recorridos.

## Datos y permisos

Las tablas `turno`, `linea`, `plan` y `evento` tienen RLS y carecen de grants directos a clientes. El esquema `reportes_almacen` es privado y no debe añadirse a la Data API. El wrapper público `operar_reporte_almacen` es SECURITY INVOKER; la operación privilegiada privada comprueba usuario, perfil activo, rol y sucursal en cada llamada. Anon no puede ejecutar el endpoint. Solo admin, gerente, almacenero y operario ven el módulo.

Solo el creador modifica, compara, reabre o entrega su reporte. La recepción exige una persona diferente, y no permite mezclar verificaciones de distintos receptores. Todas las mutaciones validan versión para evitar sobrescrituras concurrentes. Generar una hoja es idempotente mediante UUID; no se duplican folios. Se conservan snapshots de producto, ubicación, equivalencia y cantidades. No hay borrado de reportes ni modificación de declaraciones después de entregarlas.

La migración agrega tablas, funciones y un índice temporal del Kardex. No escribe existencias, ajustes ni movimientos, y no crea reportes ficticios en la base del negocio. Antes y después de aplicar se verificó: 2454 filas de stock, huella `64e806dbc63b2ab1647e6b7cc37824e9`, 11440 filas de Kardex, último ID 13914 y cero reportes nuevos. Las consultas autenticadas de listado, plan y resumen se comprobaron sin crear datos. Los asesores de seguridad no añadieron avisos respecto a la lectura previa.

## Verificación

```powershell
npm run test:reportes
npm run test:conteo
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=2
npm run build
```

La integración de PostgreSQL usa PGlite y estructura ya existente, con filas sintéticas. Comprueba separación de cantidades pendientes/cero, equivalencias, saldo a hora física frente a movimientos posteriores, actualización de alcance sin renumerar, creación idempotente, versiones, transcripción, comparación previa a entrega, recepción por otra persona, pendientes que continúan abiertos, frecuencia por ubicación y autorización por sucursal/rol. Comprueba que entregar/recibir no escriba stock.

Las pruebas de interfaz y unidades cubren transcripción, cantidades incompletas, preservación de campos ante errores, impresión ciega y hojas de pendientes. Se revisaron pantallas a 1280 y 390 px y un PDF de varias páginas con datos sintéticos. La evidencia está en `.reportes-qa.local/`, ignorada por Git. Falta el piloto físico con impresora y usuarios reales; las pruebas automáticas no lo sustituyen.
