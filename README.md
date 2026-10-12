# React + Vite

## Fichas digitales y etiquetas de almacén

- En **Catálogo → Fichas y etiquetas** se seleccionan productos y se imprimen individualmente o por lote. En el detalle de cada producto está el botón **Ficha y etiqueta**.
- Cada QR abre `/productos/:id/ficha?sucursal=:id` con la sesión y los permisos existentes. El enlace conserva el producto y la sucursal; las cantidades y ubicaciones se consultan al abrir o pulsar **Actualizar**.
- La ficha muestra existencias por ubicación, reservas globales de pedidos, disponible de la sucursal, presentaciones, movimientos y el último conteo conciliado aplicado. Una consulta fallida o la ausencia de registro no se representan como stock cero. Las sucursales con control libre se indican como pendientes de validación física.
- Hay diez diseños ROARI: Compacto, Estándar, Ficha grande, A6, Mini, Estantería, Caja y bulto, Ubicación, QR rápido y Control de lote. Permiten dimensiones personalizadas, estilos ROARI/blanco y negro/minimalista, hoja A4 o rollo y giro automático para aprovechar la hoja. Los formatos guardados anteriormente conservan sus medidas y opciones.
- Cada selección tiene un apartado **Presentación**, con nombre, equivalencia en la unidad base y códigos de barras exclusivos de esa presentación. **Añadir otra presentación** permite imprimir unidad, paquete o caja del mismo producto en un lote. El QR conserva la presentación elegida y la ficha digital la identifica al abrir.
- El diseño **Ubicación** selecciona lugares registrados de la sucursal y abre `/ubicaciones/:id/ficha?sucursal=:id`, con sus productos asignados y existencias registradas. La consulta distingue ausencia de registro de cero y advierte consultas incompletas.
- **Control de lote** permite anotar lote y fecha para imprimir: estos campos no registran entradas ni trazabilidad en la base de datos. La equivalencia de cajas siempre procede de la presentación registrada.
- Los códigos de barras pueden usar selección automática, Code 128 o EAN-13; EAN-13 exige un dígito de control válido. Los QR y el contenido se comprueban antes de habilitar la impresión. **Imprimir 1 prueba** genera una sola etiqueta antes del lote. Foto y campos secundarios son opcionales; las cantidades de stock se consultan en la ficha digital.
- En **Dirección de Almacén para el QR** debe figurar una dirección accesible desde los celulares. Puede preconfigurarse con `VITE_PUBLIC_APP_URL`; no usar `localhost` para etiquetas del almacén.
- La impresión usa milímetros y bloquea etiquetas cuyo contenido no cabe. Elegir escala **100 %**, desactivar encabezados y comprobar una primera etiqueta con la impresora real. El diálogo de impresión permite guardar como PDF.
- Esta función usa consultas existentes y no requiere migraciones nuevas ni cambios en las cantidades. La migración incluida en el ZIP del proyecto es independiente de esta función.

Validación: `npm run test` y `npm run build`.

## Operaciones para celular

- **Movimientos → Operaciones móvil**, el acceso rápido **Operaciones móvil** o `/operaciones` abren la pantalla de escaneo, tareas e historial. En cada pedido aparece **Preparar y revisar**.
- Se reutiliza el QR de Seller `/pedidos/:id`, incluso si contiene otro dominio. Sólo se extrae el ID; no se navega al sitio leído. Las notas de entrega (`?ne=`) y los códigos PDV pertenecen a flujos diferentes y no abren una nueva preparación. El ID también se puede ingresar sin cámara.
- Flujo: **Tomar preparación → guardar cada línea → Terminar preparación → Tomar revisión → comprobar producto y cantidad → Confirmar revisión**. Se registran los responsables reales de la sesión, las observaciones, el método visual/escaneo y los eventos. El revisor puede ser otra persona o quien preparó.
- Las cantidades de entrada pueden contarse por presentación o en unidades base. En una entrega parcial hay que indicar el motivo del faltante; la revisión cubre sólo lo preparado. El QR de producto comprueba su identidad, y un QR o barras de presentación deben corresponder al empaque de la línea. La cantidad se confirma aparte. **Ingresar código** permite usar barras sin cámara.
- **Abrir pedido y despacho** muestra el resumen de esta preparación y sus cantidades dentro del despacho existente. El operario confirma allí las cantidades y ubicaciones. Esta versión guarda el checklist y no genera picks, reserva existencias ni sustituye el despacho que descuenta stock.
- Cambios del pedido bloquean finalizar hasta **Actualizar preparación**. Las líneas afectadas pierden su confirmación; las demás conservan su avance. La versión del registro evita sobrescribir cambios de otro celular. Un pedido cancelado/completado no puede confirmarse. Reabrir, reasignar o anular exige un motivo y queda auditado.
- Hay una entrega activa por pedido. Después de despachar las cantidades verificadas se puede preparar la siguiente; las anteriores permanecen en el historial. Cada tarea corresponde a una sucursal física. Perfiles activos `admin`, `gerente`, `almacenero` y `operario` tienen acceso según su sucursal asignada.
- Migraciones nuevas: `supabase/migrations/20261010003344_operaciones_movil_pedidos.sql` y `supabase/migrations/20261010005005_fix_operaciones_nueva_entrega.sql`. Crean sólo tablas/RPC de preparación, con RLS y escritura auditada; no modifican funciones de despacho, stock ni pedidos. El motor privilegiado está en `almacen_operaciones`, que no debe exponerse en la Data API. No ejecutar indiscriminadamente todas las migraciones históricas sobre una base existente.
- La cámara necesita HTTPS y permiso en el celular. Para la prueba física, abrir la dirección publicada de Almacén, escanear un pedido y una etiqueta de presentación, y comparar las cantidades con los artículos preparados.

QA de base: `db/tests/operaciones_movil_rollback.sql` valida cantidades, entrega parcial, QR, responsables, cambios de Seller, nueva entrega, acceso por sucursal y stock intacto, dentro de una transacción que termina en `ROLLBACK`.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
