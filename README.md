# React + Vite

## Fichas digitales y etiquetas de almacén

- En **Catálogo → Fichas y etiquetas** se seleccionan productos y se imprimen individualmente o por lote. En el detalle de cada producto está el botón **Ficha y etiqueta**.
- Cada QR abre `/productos/:id/ficha?sucursal=:id` con la sesión y los permisos existentes. El enlace conserva el producto y la sucursal; las cantidades y ubicaciones se consultan al abrir o pulsar **Actualizar**.
- La ficha muestra existencias por ubicación, reservas globales de pedidos, disponible de la sucursal, presentaciones, movimientos y el último conteo conciliado aplicado. Una consulta fallida o la ausencia de registro no se representan como stock cero. Las sucursales con control libre se indican como pendientes de validación física.
- Los formatos incluyen 60 × 40 mm, 100 × 70 mm, A6 y dimensiones personalizadas. Permiten hoja A4 o rollo, márgenes, separación, campos opcionales, foto y códigos de barras de presentaciones existentes. Los formatos personalizados se guardan por usuario en el navegador actual.
- En **Dirección de Almacén para el QR** debe figurar una dirección accesible desde los celulares. Puede preconfigurarse con `VITE_PUBLIC_APP_URL`; no usar `localhost` para etiquetas del almacén.
- La impresión usa milímetros y bloquea etiquetas cuyo contenido no cabe. Elegir escala **100 %**, desactivar encabezados y comprobar una primera etiqueta con la impresora real. El diálogo de impresión permite guardar como PDF.
- Esta función usa consultas existentes y no requiere migraciones nuevas ni cambios en las cantidades. La migración incluida en el ZIP del proyecto es independiente de esta función.

Validación: `npm run test` y `npm run build`.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
