# Alistado simple y envíos pendientes

## Reglas confirmadas

Almacén tiene prioridad. La aplicación propone su stock positivo en la sucursal de la tarea y calcula el faltante de compra. Confirmar una propuesta significa confirmar el material físico; consultar el pedido no confirma cantidades ni mueve stock.

La solicitud de compra se crea al iniciar el nuevo envío, en la misma transacción. Se reutiliza la solicitud activa de la línea. Las solicitudes automáticas que siguen en estado SOLICITADA se ajustan al faltante todavía sin conseguir. Las compras previas o ya comprometidas conservan su gestión en Compras y no se duplican ni se cancelan automáticamente.

| Pedido | Almacén preparado | Externo preparado | Sale | Sigue por conseguir |
| --- | --- | --- | --- | --- |
| 100 | 100 | 0 | 100 | 0 |
| 100 | 60 | 40 | 100 | 0 |
| 100 | 0 | 100 | 100 | 0 |
| 100 | 60 | 0 | 60 | 40 |
| 100 | 30 | 20 | 50 | 50 |
| 10 | 0 | 8 | 8 | 2 |
| 100 | 0 | 0 | 0 | 100 |

El material externo debe estar conseguido y físicamente preparado. Una solicitud de compra no cuenta como material alistado. Tienda conserva su procedencia separada cuando corresponde.

**Cero y cero:** la línea no sale y sigue pendiente. El alistador no rechaza ni cancela la venta. La decisión comercial pertenece al vendedor o gerente en su flujo existente. Si todas las líneas están en cero, no se puede enviar una tanda vacía a verificación.

**Diferencias:** el verificador devuelve la línea con un motivo. La tarea vuelve al almacenero, se invalida solamente la confirmación de esa línea y se conservan las otras comprobaciones. El almacenero corrige cantidad y reparto, adjunta la evidencia correspondiente y vuelve a enviar. El servidor impide que el verificador modifique directamente la cantidad alistada.

**Salida:** fotos y destino siguen siendo obligatorios. Solo la parte declarada de Almacén descuenta inventario; preparar no descuenta. El cierre conserva sus protecciones ante doble toque y respuesta perdida. Verificar salida no acredita recepción del cliente.

**Nuevo envío:** el mismo pedido y QR conservan únicamente las cantidades pendientes. La ficha de un envío histórico muestra el pendiente a su cierre, para no presentarlo como saldo actual después de otros envíos.

## Interfaz

Se conserva el diseño oscuro, acento violeta y tarjetas de producto. El tema abarca el inicio de escaneo, listas, alistado, formularios, verificación, evidencia, avisos, cierre e historial del circuito de pedidos. Los resúmenes distinguen lo que sale de lo pendiente y no marcan como verificados productos sin comprobación.

## Asistente en tres pasos

- Alistado: **Productos → Fotos → Confirmar**.
- Verificación y salida: **Revisar → Fotos y destino → Confirmar salida**.

El indicador permanece visible durante el desplazamiento. Cada producto tiene un contador independiente. No se pueden saltar etapas: todas las líneas deben quedar declaradas, debe haber material alistado y debe adjuntarse al menos una foto. El verificador reconoce por separado las líneas de cantidad cero; no se incluyen como material saliente. El último paso exige además un destino válido y la confirmación de evidencia del servidor.

Volver conserva productos, fotos y destino. Editar desde el resumen abre la línea elegida. Una línea invalidada devuelve el asistente al paso de productos. La confirmación se ejecuta solo en el último paso, bloquea el doble toque y permite reintentar sin perder el avance. Los contratos anteriores mantienen su interfaz y controles existentes.

La demostración interactiva local está en `.local/qa-alistado/asistente/index.html`, con casos normal, parcial 0+8 de 10, mixto 6+2 y cero. Reutiliza los componentes del producto con un cliente ficticio aislado. Permite probar fotos, devolución, resumen y cierre; no envía datos a Supabase ni Telegram. Incluye una foto de ejemplo y un control para simular un fallo de confirmación.

## Instalación de esta versión

- Migración preparada: `supabase/migrations/20261028215041_alistado_origen_automatico.sql`.
- Depende de la versión anterior `20261028131324_pedidos_tarjetas_origen_posterior.sql` y su cadena existente. No ejecutar todo el histórico sobre una base ya instalada.
- La migración inicial agrega indicadores con valor inicial falso. El nuevo circuito se activa en nuevas tareas flexibles y se anuncia al frontend con `alistado_simple: true`.
- La migración `20261029131809_activar_alistado_pedidos_abiertos.sql` lo extiende a todas las tandas activas de pedidos abiertos que aún no registraron su salida. Conserva cantidades, revisiones, responsables, versiones y fotos. No reabre salidas, cancelados ni pedidos completados.
- Las tandas convertidas se identifican con `alistado_migrado`. Si ya estaban en verificación, el alistador puede completar el origen sin repetir la revisión ni invalidar las fotos; el origen es obligatorio antes de salir. Las líneas confirmadas aún en alistado que carezcan de origen vuelven a aparecer para completar su distribución. Las diferencias que ya había registrado el verificador se conservan.
- La activación calcula los faltantes de compra sin duplicar solicitudes previas ni modificar compras ya comprometidas. No confirma cantidades ni mueve inventario.
- El frontend mantiene compatibilidad con las tareas del contrato anterior. Sus orígenes pendientes siguen visibles.
- Las funciones auxiliares quedan privadas; se mantiene el punto de entrada autenticado y se revoca el acceso directo al motor anterior para evitar saltarse las nuevas comprobaciones.
- Para activar el circuito completo se publica el frontend y se aplican la migración inicial y la activación de pedidos abiertos. La publicación de código por sí sola no convierte las tandas existentes.

Activación de producción del 29 de octubre: ambas migraciones aplicadas y frontend publicado con el PR #120. Las ocho tandas activas usan el alistado nuevo, incluidas las 165 líneas revisadas de la tanda 63. Se conservaron exactamente las líneas, cantidades, revisiones, versiones y fotos; no cambió el número de movimientos de Kardex. La activación creó tres solicitudes de compra por faltantes y el asesor de seguridad no añadió avisos. El CHECK de `pedido_evento.accion` conserva sus acciones previas y admite `COMPRA_ALISTADO_AUTOMATICA` y `REEMPLAZO_MATERIAL`.

## Verificación

```powershell
npm test
npm run test:qr
npm run build
npx eslint src/PedidoTarjetas.jsx src/CantidadOrigenPedido.jsx src/ResumenEnvioPedido.jsx src/lib/envioPedido.js src/OperacionesMovilApp.jsx
```

Las pruebas de integración crean PostgreSQL aislado en memoria con PGlite. Comprueban el reparto mixto, 0+8 de 10, cero pendiente, compras sin duplicar, devolución de línea, permisos, fotos, segundo envío y cierre idempotente. También conservan la validación de los circuitos anteriores de pedidos, VTD y traslados.

Las vistas de diseño generadas con datos ficticios están en `.local/qa-alistado/`. Son capturas HTML estáticas; sus botones no registran operaciones. No incluyen credenciales ni se incorporan a la aplicación compilada.

Resultado local: 62 archivos de prueba y 538 pruebas aprobadas; integración QR y contratos anteriores aprobados; ESLint de los archivos modificados sin errores. Compilación completa verificada con URL y clave ficticias de entorno para evitar que la ausencia de configuración elimine rutas durante la optimización. El bundle de comprobación no está configurado para producción.
