# Revisión del ZIP actualizado frente al repositorio local

**Estado posterior:** la integración selectiva ya se realizó. Sus validaciones y la conciliación de nombres de migraciones están documentadas en [Integración del ZIP 32](integracion-almacen-zip-32.md). El resto de este informe conserva el diagnóstico previo a la integración.

Fecha: 23 de octubre de 2026.

Archivo revisado: `C:/Users/nessx/Downloads/almacen_cation-main (32).zip`.
SHA-256: `841452c1c3729bb5ffcfe2360bbb60e9ab062946c378789c8aaab0d981c2b048`.
Referencia: estado de trabajo de `D:/Proyectos/almacen-cation` después del formulario de conteo por ubicación base y su versión móvil. La comparación incluye cambios locales y archivos nuevos; no se limita a HEAD.

## Resultado

El ZIP contiene avances de pedidos, traslados, operaciones y presentaciones, pero su módulo de reportes es anterior a las mejoras aprobadas en este chat. Debe integrarse por funcionalidad, conservando el conteo y los movimientos diarios locales. Reemplazar todo el repositorio por el ZIP produciría regresiones.

| Comparación de archivos | Cantidad |
| --- | ---: |
| Archivos del ZIP | 256 |
| Iguales al repositorio, normalizando CRLF/LF | 198 |
| Presentes en ambos, con contenido diferente | 32 |
| Presentes solamente en el ZIP | 26 |
| Presentes solamente en el repositorio local | 12 |

El inventario completo y las diferencias están en `.revision-zip-32.local/comparison.json` y `.revision-zip-32.local/diff/`. La copia extraída se conserva en `.revision-zip-32.local/node_modules/almacen_cation-main/` para que la suite normal del repositorio no descubra y ejecute las pruebas archivadas. No contiene `.git` y no reemplaza archivos de la aplicación.

## Hallazgos de compatibilidad

### P1 · El ZIP elimina el flujo de conteo rápido aprobado

En [ReportesAlmacenApp.jsx del ZIP](D:/Proyectos/almacen-cation/.revision-zip-32.local/node_modules/almacen_cation-main/src/ReportesAlmacenApp.jsx:150), el formulario editable sólo ofrece transcribir todos los renglones y sus horas desde el papel. No importa ni renderiza `ConteoRapidoTurno`.

El ZIP no contiene `src/ConteoRapidoTurno.jsx`, `src/conteo-turno.css` ni `src/lib/recorridoTurno.js`; además, su `src/lib/reporteTurno.js` no exporta las funciones de captura en vivo y corrección con hora original. Sustituir esos archivos quitaría el recorrido Planta Baja/Hueco/Garaje, la captura compacta para móvil, el guardado por producto y la confirmación de empaques. También recuperaría la clave por versión del componente de detalle, que desmonta su estado después de guardar y es incompatible con conservar los borradores del recorrido actual.

Acción de integración: conservar el conjunto local de conteo, sus estilos, auxiliares y pruebas; no reemplazar el módulo por la versión del ZIP.

### P1 · Movimientos diarios vuelve a un resumen sin desglose

El [componente Diario del ZIP](D:/Proyectos/almacen-cation/.revision-zip-32.local/node_modules/almacen_cation-main/src/ReportesAlmacenApp.jsx:196) sólo presenta una tabla de saldos y actividad fuera de horario. No hay acceso al detalle por producto ni selector Página/Panel lateral/Ventana.

Faltan `MovimientosDiarios.jsx`, `MovimientosReporte.jsx` y sus pruebas. La versión del ZIP de `src/lib/reportesAlmacen.js` tampoco contiene `movimientosProductoDia`, y su CSS de reportes no incluye las presentaciones nuevas ni los colores de movimientos. Copiar sólo los componentes locales encima de ese auxiliar antiguo tampoco basta: deben conservarse juntos.

Acción de integración: mantener la implementación local completa de movimientos diarios y sus auxiliares, estilos y pruebas.

### P2 · El ZIP no contiene todo el historial local de Caja

No incluye `supabase/migrations/20261022140815_caja_liberar_tras_cobro.sql` ni `db/tests/caja-cobro-liberado.integration.mjs`. Esto importa si el ZIP se usa para sustituir o reconstruir todo el repositorio: se perdería esa parte del historial de migraciones y su verificación.

La omisión del archivo no demuestra que una base remota haya perdido un cambio ya aplicado. Esta revisión no consultó ni alteró la base del negocio.

Acción de integración: conservar la migración y la prueba local junto con las migraciones que aporta el ZIP.

## Cambios que sí aporta el ZIP

- Pedidos con alistador y verificador que retira: cantidades editables por presentación/base, diferencias conservadas, destino, fotos por etapa y confirmación transaccional de retiro/salida.
- Traslados con QR: nueva ruta `/operaciones/traslados/:id`, alistado y recepción por personas diferentes, fotos y movimiento de stock al recibir. Incluye migración, pruebas y tratamiento de documentos anteriores.
- Evidencias de pedidos y traslados: cliente y componente nuevos, cola y worker propios; el worker de VTD se adapta para reutilizar el transporte con RPC y bucket configurables.
- Operaciones directas: incorpora Salida en la interfaz, valida stock disponible, distingue su color y permite ampliar las opciones de ubicaciones sin stock cuando corresponde.
- VTD: permite informar faltantes a Caja y actualizar la consulta antes de continuar la entrega.
- Productos y presentaciones: unidad base con atajos, presentaciones encadenadas, precios por presentación y comprobación de documentos abiertos antes de desactivar.

La interfaz de presentaciones nueva depende de columnas como `contiene_presentacion_id`, `contiene_cantidad`, precios por presentación y de `v_presentacion_precio`, además de los triggers que describe su código. No encontré sus definiciones en las migraciones SQL incluidas en el ZIP. Antes de publicar esa funcionalidad debe verificarse que el esquema de destino ya las tiene o incorporarse su migración. Las pruebas de ese editor usan respuestas simuladas y no certifican ese esquema remoto.

Los circuitos nuevos de pedidos/traslados también requieren sus migraciones, worker y configuración de activación. Las instrucciones incluidas en los documentos del ZIP se revisaron como información del archivo; no se ejecutaron despliegues ni activaciones por estar descritos allí.

## Verificación realizada

- Compilación de producción del ZIP: correcta, usando los paquetes ya instalados y variables públicas ficticias. Conserva el aviso de paquetes JavaScript grandes.
- Suite original del ZIP: **49 archivos, 422 pruebas aprobadas**.
- `db/tests/flujos-qr.integration.mjs` del ZIP: aprobado en PostgreSQL aislado en memoria, incluidos pedidos de dos actores, traslados QR, evidencias, versiones, permisos, rollback y ausencia de movimientos duplicados en sus escenarios sintéticos.
- Dos comprobaciones adicionales de compatibilidad ejecutaron el `ReportesAlmacenApp.jsx` original del ZIP con los flujos aprobados aquí. Ambas fallaron por ausencia del conteo rápido y de las tres presentaciones de movimientos. Su reproducción se conserva como `compatibilidad-reportes.repro.jsx`, fuera de los patrones de la suite normal; son evidencia de incompatibilidad, no pruebas fallidas añadidas al producto.

La compilación y las pruebas no equivalen a una validación de despliegue, de la configuración real de Supabase/Telegram ni de una entrega física entre usuarios. No se modificaron fuentes de la aplicación, migraciones activas, existencias, documentos del negocio ni servicios externos durante esta revisión.

## Integración propuesta

1. Conservar el módulo local de reportes, conteo rápido, recorridos por ubicación, detalle de movimientos y todas sus pruebas.
2. Incorporar por separado los cambios del ZIP de pedidos/traslados/evidencias, operaciones y productos. En `App.jsx`, combinar únicamente el import y la ruta nueva de traslados con la versión local actual.
3. Mantener la unión completa de migraciones y comprobar las dependencias del modelo de presentaciones antes de publicar.
4. Ejecutar la suite combinada y revisar los flujos en móvil. Realizar cualquier despliegue y activación como una acción posterior explícitamente solicitada.
