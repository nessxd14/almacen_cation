# Revisión de la lógica del arqueo de material

Revisado el 23 de octubre de 2026. El usuario confirmó que todavía no está definido si el arqueo debe certificar todo el material entregado o ser una revisión parcial. Esta revisión conserva la implementación actual; no cambia reglas, saldos ni datos del negocio.

Se revisaron el alcance, las capturas, el cálculo a la hora física, la comparación, la entrega, la recepción y la continuidad entre turnos. Las cuatro situaciones siguientes se reprodujeron en PostgreSQL aislado con PGlite y datos sintéticos, usando la migración y el motor actuales. La integración existente de reportes también sigue pasando.

## Resultado principal: se está certificando un conteo a una hora, no la entrega física al cierre

**Prioridad alta de definición operativa.** No es un error en la resta del saldo: es una diferencia entre lo que garantiza el cálculo y lo que puede entenderse al leer «Confirmar arqueo y entregar».

Caso reproducido: se cuentan 100 unidades a las 10:00, salen 10 a las 12:10 y quedan 90 al cierre. El reporte conserva declarado=100 y esperado=100 a las 10:00, sin pendiente. Permite entregar y recibir sin una verificación física de recepción; además rechaza la operación `verificar` para esa línea porque la declaración original cuadraba.

Referencias: `supabase/migrations/20261021155549_reportes_turno_almacen.sql`, líneas 241–245, 261–268, 271–292; `src/ReportesAlmacenApp.jsx`, resultado por línea y recepción de pendientes.

Consecuencia: «Cuadra» significa «coincidía al contar». No prueba que las unidades disponibles a las 12:30 se hayan recontado ni que el receptor las haya confirmado. Una diferencia física que aparezca después de contar puede quedar fuera del control, aunque el historial contable esté bien registrado. Los productos no incluidos tampoco quedan certificados: el alcance actual es movimientos del turno, pendientes anteriores y hasta diez cíclicos.

Recomendación: hacer explícito el alcance parcial y separar los estados «Contado a las…», «Con movimientos posteriores» y «Pendiente». Antes de llamar a un documento arqueo de entrega, definir un corte de entrega real y qué verificación se exige sobre los productos que se movieron después del conteo. Un saldo proyectado con movimientos debe identificarse como calculado, no como un segundo conteo físico. La recepción debe permitir registrar una diferencia nueva incluso si la línea original cuadraba.

## Error reproducido: transcribir papel puede cambiar una hora precisa sin cambiar la cantidad

**Prioridad alta.** `horaFormulario` muestra minutos; `formularioLinea` utiliza esa representación y guardar el papel reenvía todos los renglones. No conserva el timestamp original de un renglón sin cambios.

Caso reproducido:

1. Saldo inicial 100 y salida de 10 a las 10:00:20.
2. Captura rápida de 90 a las 10:00:30.123: diferencia cero.
3. Reabrir y guardar la misma cantidad desde papel cambia la hora a las 10:00:00.
4. La comparación reconstruye 100 a esa hora y muestra un faltante falso de 10.

Referencias: `src/lib/reporteTurno.js`, líneas 3–6 y 34–36; `src/ReportesAlmacenApp.jsx`, función `guardar` de la transcripción.

Recomendación: conservar el timestamp exacto de las filas cuya hora no se modificó; distinguir la edición explícita de la hora del simple formato de pantalla. Evitar reenviar renglones no editados o conservar sus valores originales íntegros. Mostrar la precisión disponible si se permite editar una captura que tiene segundos.

## Error reproducido: productos cíclicos vencidos pueden quedar fuera por el orden del límite

**Prioridad media.** Se asigna `row_number` a los candidatos y después se comprueba si están vencidos. Diez candidatos antiguos que todavía no deben contarse pueden ocupar las primeras posiciones y excluir al siguiente candidato que sí está vencido.

Caso reproducido: diez productos contados hace once días con frecuencia de 365 días; otro contado hace tres días con frecuencia de un día. El último está vencido, pero queda en posición once. Al crear el reporte se incluye únicamente un producto con movimiento y ningún cíclico, aunque hay uno vencido.

Referencia: `supabase/migrations/20261021155549_reportes_turno_almacen.sql`, líneas 208–213.

Recomendación: seleccionar primero los cíclicos vencidos; ordenarlos entre sí y aplicar el máximo de diez a ese conjunto. Mantener independientes los productos con movimiento y los pendientes anteriores.

## Bloqueo operativo reproducido: responsable ausente o inactivo

**Prioridad alta.** Solo el creador puede guardar o comparar su borrador. Admin y gerente tampoco pueden asumirlo por las operaciones existentes. A su vez, el siguiente turno no puede entregar mientras el anterior exista y no esté recibido.

Caso reproducido: el responsable crea el reporte de mañana y queda inactivo. Supervisión no puede completarlo ni compararlo. El turno de tarde puede contar y comparar, pero no puede entregar porque el reporte de mañana sigue en borrador. No hay acción de reasignación o cancelación operativa en el endpoint.

Referencias: `supabase/migrations/20261021155549_reportes_turno_almacen.sql`, líneas 205, 225, 242 y 255–259.

Recomendación: una acción de reasignación por supervisión, con motivo obligatorio, responsable anterior/nuevo, auditoría y validación de versión. Debe conservar capturas e historial, y no convertirse en un permiso general para editar reportes entregados.

## Propuesta de criterio para decidir el siguiente cambio

1. Mantener un control parcial por turno para que el recorrido sea viable: productos movidos, pendientes y cíclicos vencidos.
2. Identificar expresamente qué se contó, cuándo y qué material quedó fuera del recorrido.
3. Preparar la entrega con un corte claro y un control adicional sobre productos movidos después de contar. Coordinar ese control con la operación para que no quede obsoleto mientras se termina.
4. Permitir al receptor verificar cualquier ítem del alcance y declarar discrepancias nuevas. «Recibido» confirma la recepción del reporte; no debe interpretarse por sí solo como inventario completo y conforme.
5. Mantener los ajustes de stock en el conteo controlado aprobado; una firma de entrega o recepción no debe regularizar automáticamente existencias.

La definición de corte, cobertura y responsabilidades sigue pendiente. No se ha escogido una obligación de reconteo total ni se ha impuesto un bloqueo del almacén.

## Evidencia local

- `.arqueo-qa.local/repro-arqueo.mjs`: reproduce y afirma los cuatro comportamientos actuales, incluidos los fallos; es una herramienta de auditoría, no una prueba que declare correcto ese comportamiento.
- `.arqueo-qa.local/resultado.json`: resultados de la ejecución.
- `node db/tests/reportes-turno.integration.mjs`: integración existente aprobada. No cubría los fallos de precisión, prioridad cíclica ni reemplazo de responsable de esta revisión.

Las pruebas no consultan ni modifican la base del negocio. No se aplicaron migraciones nuevas ni se publicó el sitio.
