# Operaciones QR: pedidos, VTD y traslado virtual

Estado: migración aplicada al proyecto Supabase `zxoxougwgstrarwymlvd` con autorización del propietario el 12 de octubre de 2026. Tablas, RLS, permisos y RPC comprobados con rol `authenticated`; no se generaron documentos de negocio en esas comprobaciones. La publicación de ambos frontends queda pendiente de integrar sus PRs.

## Recorridos

| Documento | Inicio | Verificación | Salida |
|---|---|---|---|
| Pedido | Almacenero escanea el QR existente de Seller y toma la preparación | Otra persona escanea el mismo QR cuando termina el preparador | Se confirma con el despacho existente; preparar y verificar no descuentan |
| VTD | Caja genera el ticket. El QR nuevo abre `/operaciones/vtd/:ventaId?escanear=1` | Otra persona verifica cada producto y cantidad | El verificador autoriza; exige cobro o pago posterior autorizado y usa el checkout existente una sola vez |
| Traslado virtual | Vendedor elige origen y Tienda destino, escanea las fichas existentes y declara presentación, cantidad y ubicación | Termina el carrito y presenta su QR al almacenero; el verificador confirma el material o devuelve con motivo | Se genera la solicitud existente y se mueve stock desde las ubicaciones declaradas. Tienda confirma recepción y diferencias |

El siguiente escaneo sólo asigna verificación si el alistado está listo. Durante preparación o una verificación activa, las demás personas consultan sin sustituir al responsable. El preparador no puede verificar su propio documento. Los intentos repetidos de autorizar o recibir devuelven la operación ya registrada.

El QR de ubicación establece el lugar de origen dentro del carrito; se valida contra la sucursal y las ubicaciones registradas del producto. La presentación conserva su equivalencia en unidades base. Se exige una ubicación registrada y una presentación activa. El stock admite cuatro decimales en base y el carrito rechaza valores que perderían precisión.

La VTD se entrega completa: ante faltantes, Caja corrige el ticket y el preparador actualiza el checklist. Los cambios de productos, cantidades, presentación o cabecera invalidan la revisión. Continúan siendo legibles las barras antiguas `VTD-AAAA-NNNNN`.

## Corrección de revisión, despacho y cobro — 13 de octubre

Aplicada en Supabase: `20261013143239_fix_cierre_revision_cobro_vtd_pedidos.sql`. Los tres pedidos completados cuyo checklist seguía en `VERIFICADO` quedaron en `DESPACHADO`, con un evento de sincronización por preparación. La aplicación de esta migración no registra cobros ni movimientos de stock.

En Pedido, verificar conserva el checklist. El despacho existente registra las salidas; cuando todas las cantidades preparadas figuran despachadas, el checklist se cierra automáticamente. Un despacho incompleto permanece verificado. Una entrega parcial puede quedar despachada con el pedido todavía abierto; el siguiente escaneo toma la preparación de lo restante.

En VTD, **Caja cobra; Almacén verifica y entrega**. Autorizar la salida completa `venta` y registra Kardex una vez. Si Caja recibe una confirmación atrasada y vuelve a consultar `completar_venta`, recupera la venta completada sin repetir la salida. Una VTD que aún está abierta sigue exigiendo al verificador asignado y el cobro o la marca de pago posterior.

La bandeja de Caja consulta la entrega y se actualiza al volver a la ventana, cada minuto mientras está visible y con el botón de actualización. Cobrar VTD permite ventas abiertas y completadas pendientes de pago; no entrega material ni modifica stock. El recibo conjunto sigue conservando el cambio y los medios de pago.

El servidor guarda la respuesta completa de cada cobro en un caché privado con RLS y sin permisos de lectura/escritura para clientes. El reintento conserva ventas, turno, total, cambio y señal de pago digital pendiente; una solicitud distinta o de otro usuario se rechaza. Para recibos anteriores, se recuperan los movimientos reales comparando la clave literalmente. Si un efectivo antiguo repartido perdió el dato de recibido, su cambio no se reconstruye ni se inventa. La verificación del pago QR/transferencia por el gerente sigue separada de la verificación física.

Validación: 219 pruebas de Almacén, PostgreSQL aislado con las RPC vigentes, 594 pruebas de POS/Caja y su integración financiera, compilación de ambas aplicaciones y lint de los archivos modificados de Caja. Las pruebas incluyen entregas parciales, doble confirmación, stock único, cobro antes/después de entregar, pago posterior, tickets gratuitos, recibos anteriores, pagos mixtos, caja cerrada y rollback ante fallo.

## Acceso y persistencia

La entrada es `/operaciones`; para vendedores, el inicio de Almacén dirige al portal móvil. El perfil `vendedor` y su sucursal Tienda se configuran mediante los perfiles existentes. El vendedor puede armar y corregir su carrito, consultar su avance y presentar el QR. La verificación y autorización de origen requieren `almacenero`, `operario`, `gerente` o `admin`, con la sucursal autorizada. La recepción pertenece a Tienda destino.

Los carritos, checklists y auditoría se guardan en tres tablas con RLS y lectura limitada por responsable/sucursal. Las escrituras pasan por `operar_documento_movil`; el servidor obtiene identidad y rol del perfil activo. No se conceden escrituras directas ni ejecución anónima. El motor con privilegios permanece en el esquema privado `almacen_operaciones`.

La preparación de Pedido utiliza sus tablas existentes. VTD se identifica por `venta.id`; el traslado virtual por `almacen_documento_movil.id`. El QR no identifica a una persona: el responsable proviene de la sesión que escanea.

## Publicación y activación

1. Migración aplicada: `supabase/migrations/20261012195525_flujos_qr_vtd_traslado_virtual.sql`. Los nombres de las tres migraciones de Operaciones coinciden con las versiones registradas en Supabase. Los asesores no reportaron alertas de seguridad ni claves foráneas sin índice en los objetos nuevos. La configuración privada tiene RLS sin políticas porque no concede acceso a clientes; sus índices nuevos aún no tienen uso operativo.
2. Publicar Almacén y Seller/POS. El POS usa `VITE_ALMACEN_URL`; su valor por defecto es `https://almacen-cation.vercel.app`. El QR del traslado utiliza `VITE_PUBLIC_APP_URL` de Almacén, con el mismo valor por defecto.
3. Probar con dos cuentas distintas y un vendedor: cámara HTTPS, tickets térmicos de 58/80 mm, devolución, autorización y recepción.
4. Tras publicar ambos clientes, activar el procedimiento obligatorio para todas las VTD:

```sql
update almacen_operaciones.configuracion_flujos
set exigir_preparacion_vtd = true
where id;
```

Durante la publicación gradual, la configuración comienza en `false` para permitir completar tickets desde los clientes anteriores que todavía no conocen la fase 2. Toda VTD que ya tenga preparación móvil exige verificación aunque esa configuración siga en `false`. Una vez activada, también se bloquea el checkout de tickets que aún no fueron preparados. Cambiar la configuración no mueve stock.

La recepción reutiliza el procedimiento vigente: el traslado acredita la ubicación de recepción al despacharse y la recepción confirma o ajusta faltantes. No agrega el material por segunda vez. Recibir desde el apartado existente también actualiza el estado que muestra la miniapp.

## Verificación local

En Almacén: `npm run test`, `npm run test:qr`, `npm run build`. `test:qr` crea PostgreSQL en memoria con el esquema y los procedimientos de stock inspeccionados, aplica la migración y prueba permisos, separación de personas, modificaciones del ticket, devoluciones, cobro, stock insuficiente, ubicación exacta, reintentos y recepción con diferencias. No usa datos ni conexiones de producción.

En POS: `npm run test` y `npm run build`. Se verifica la URL VTD y se impide imprimir hasta que el QR del ticket actual esté generado y cargado. Las vistas móviles con datos ficticios se revisaron a 320, 375 y 430 px. La lectura física con celulares e impresoras queda para la prueba operativa después de publicar.
