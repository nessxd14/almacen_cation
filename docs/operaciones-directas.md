# Operaciones directas de inventario

La pantalla **Movimientos → Operaciones** conserva Entrada, Traslado y Ajuste. Usa un formulario ancho con revisión inferior en escritorio; en celular organiza los campos y el resumen en una columna. No sustituye Operaciones móvil ni los documentos de Compras y Traslados.

- Entrada recibe en la sucursal activa. Traslado toma stock de esa sucursal y permite elegir otra ubicación física accesible, mostrando siempre la sucursal. Ajuste actúa sobre una ubicación de la sucursal activa. Cambiar de sucursal descarta cantidades y ubicaciones del formulario.
- Entrada y Traslado muestran la presentación y su equivalencia. Una caja escaneada permanece visible como caja: se envía la cantidad de presentaciones y la función vigente realiza la conversión. Los códigos ambiguos exigen elegir la presentación. Al cambiar de presentación se limpia la cantidad.
- El resumen muestra el saldo actual, el cambio y el resultado previsto. En Traslado incluye ambos saldos. Las cantidades deben representarse con hasta cuatro decimales en la unidad base. Un exceso de origen bloquea registrar.
- Ajuste admite cero y requiere un motivo. Se mantienen los roles existentes: admin, gerente y almacenero. Los permisos del servidor siguen siendo la autoridad.
- Los errores de consulta no se presentan como cero. El registro se bloquea hasta recuperar las consultas necesarias. Antes de enviar se consultan otra vez los saldos; si cambiaron, se muestra el nuevo resultado y se exige revisarlo antes de volver a registrar. La función transaccional sigue validando el movimiento final.
- Los errores permanecen visibles. Las entradas conservan la clave de idempotencia en un reintento del mismo envío; los traslados y ajustes conservan sus funciones existentes. Un fallo posterior de asignación se avisa como movimiento ya registrado, sin anunciar que falló el movimiento de stock.
- La lista inferior sólo muestra lo registrado mientras esta pantalla permanece abierta. **Abrir historial completo** lleva al Kardex persistente. Se retiró la vista de SQL del formulario.

No se requieren migraciones ni cambios de permisos para este rediseño. Validación local: `npm run test`, `npm run build` y ESLint de los archivos modificados. Las pruebas de interfaz usan datos ficticios y no registran movimientos en producción.
