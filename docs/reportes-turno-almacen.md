# Reportes de almacén y entrega de turnos

Implementado el 21 de octubre de 2026. Migración aplicada en `supabase_db_almacen_roari`: `20261021155549_reportes_turno_almacen`. El archivo se creó con la CLI y su versión se alineó con el historial remoto. La interfaz está en el repositorio local; este trabajo no publica el sitio.

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
