# Alistado y despacho de pedidos

## Preparación con QR

Desde **Pedidos y despachos → Escanear pedido**, o desde **Preparar y revisar** en un pedido, se conserva la lectura del QR existente.

Cada producto tiene un estado explícito:

- **Sin alistar**: todavía no hay una declaración guardada para esta línea.
- **Completo**: se confirmó toda la cantidad pendiente. El botón **Completo** la registra directamente, en unidades base según su presentación.
- **Con faltante**: se guardó una cantidad mayor a cero e inferior a lo pedido, junto con un motivo.
- **No alistado**: se guardaron cero unidades y un motivo. Se distingue del producto que aún no se trabajó.

**Registrar faltante** pide la cantidad realmente alistada; **No se alistó** propone cero. Los motivos frecuentes son editables. Un error conserva los datos del formulario. **Editar preparación** permite corregir una línea durante el alistado.

El buscador encuentra nombre, SKU, presentación o motivo. Los filtros muestran los contadores de cada estado. Una línea no confirmada no se presenta como faltante ni como entrega parcial.

**Confirmar el resto completo** conserva su resumen previo y no cambia las cantidades ni observaciones de los faltantes ya guardados. Para terminar se deben registrar todas las líneas y tener alguna cantidad alistada. La verificación conserva la comprobación de identidad por QR/barras y la entrada independiente de la cantidad; también se mantiene la revisión visual y la separación de responsables.

## Despacho

El detalle muestra cantidades pedidas, despachadas y pendientes sin abrir cada producto. Se puede buscar y filtrar por productos pendientes, compras, entregados y cerrados.

Las casillas y **Añadir a la salida** preparan la selección. Se conservan las ubicaciones y cantidades editadas al abrir/cerrar o filtrar las líneas. **Seleccionar productos visibles** sólo incorpora lo visible y mantiene otras selecciones; si hay seleccionados fuera del filtro se indica antes de continuar.

**Revisar salida** muestra todos los productos seleccionados, sus ubicaciones, la cantidad que saldrá y la que seguirá pendiente. Se debe confirmar la comprobación física para registrar la salida. No permite omitir silenciosamente líneas sin pick, sin cantidad, en cálculo, con errores o con cantidades inválidas. Un fallo del servidor conserva el resumen para reintentar. La excepción de despacho sobre turno FIFO mantiene su flujo existente con motivo obligatorio.

Al llegar desde un checklist, el resumen incluye también los productos no alistados y sus motivos. Las cantidades de preparación sirven de referencia: se asignan explícitamente las ubicaciones y cantidades de la salida; el resumen no genera movimientos de stock.

## Alcance y validación

Se reutilizan las RPC, los permisos, las versiones y la auditoría existentes. No requiere una migración ni modifica el flujo VTD de Caja/Almacén. Preparar y verificar sólo guardan el checklist; confirmar el despacho registra la salida.

Validar con `npm test` y `npm run build`. La prueba visual local usa datos ficticios y cubre escritorio, celular, filtros, guardado de ceros con motivo, cantidades parciales, revisión antes del lote y reintento de un error de despacho.
