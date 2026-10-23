# Integración del ZIP 32 y mejoras locales

Integración preparada el 23 de octubre de 2026 a partir de `almacen_cation-main (32).zip` y el estado local de Almacén.

## Comportamiento integrado

- Conteo rápido compacto para escritorio y móvil, por ubicación base y mueble/compartimiento. Se conservan Planta Baja, Hueco, Garaje y las demás zonas reales del documento, con cantidades separadas por ubicación, empaques verificados y pendientes con motivo.
- Movimientos diarios con detalle en página, panel lateral o ventana, filtros conservados, autoría, horas de Bolivia y colores por tipo de movimiento.
- Pedidos con alistador y verificador que retira, ajustes por presentación/base, destino y fotos por etapa.
- Traslados por QR con dos responsables y movimiento de existencias al confirmar la recepción.
- Evidencias de pedidos y traslados con cola de envío, recuperación de respuestas perdidas y tratamiento de errores de Telegram.
- Operaciones directas con Entrada, Salida, Traslado y Ajuste; selección explícita de ubicaciones sin stock cuando corresponde.
- Editor de productos con unidad base, presentaciones encadenadas y precios por presentación.
- Conservación de la migración de Caja que libera el carrito después de cobrar y de su prueba de regresión.

`App.jsx` combina la ruta nueva de traslados con los accesos locales existentes. La prueba transaccional de QR ejecuta tanto los circuitos nuevos de pedidos/traslados como la prueba local de Caja. Los archivos de reportes, conteo, movimientos y estilos se contrastaron por SHA-256 con el respaldo anterior a la integración: se conservan intactos.

## Esquema e historial de migraciones

Se realizaron consultas de **sólo lectura** al proyecto de Almacén. Se comprobó que existen las columnas de presentaciones encadenadas, sus precios, la vista `v_presentacion_precio` y los triggers de cadena, nombre base y permisos de precios.

Las tres migraciones del ZIP tenían nombres de versión anteriores a los registrados en la base. Se cotejó su texto con las sentencias guardadas en el historial remoto: coinciden exactamente. Se alinearon los nombres de archivo, las referencias de las pruebas y la documentación; no se ejecutó ni reescribió SQL remoto.

| Migración versionada | MD5 del texto, igual al historial remoto |
| --- | --- |
| `20261020152719_evidencias_pedidos_traslados_retiro.sql` | `f793157b7d9453e19fcea13f53e1506f` |
| `20261021192845_pedidos_dos_responsables_evidencias.sql` | `7d86d80b77b80cb948cf71db29b60c5e` |
| `20261021220732_traslados_qr_entrega_dos_personas.sql` | `6547a4136b557ae3cbd45fa51ecd9b36` |

Estos archivos no deben reaplicarse en la base de Cation por proceder del ZIP. En otra base se debe contrastar primero su historial y sus prerrequisitos. Se conserva además `20261022140815_caja_liberar_tras_cobro.sql`, que no figuraba en el ZIP. Preparar este commit no aplica esa migración ni sustituye la revisión del historial de destino.

## Validación local

- **53 archivos de pruebas y 461 casos aprobados** en la suite del producto. `vitest.config.js` excluye `*.local/` para que las copias de revisión, respaldos y ensayos no dupliquen ni contaminen las pruebas normales.
- **Flujos QR:** migraciones compiladas en PostgreSQL aislado, pedidos, VTD, evidencias, retiro con dos responsables, traslados QR y Caja; rollback, versiones, permisos y movimientos únicos.
- **Conteo controlado:** rondas independientes, declaraciones cero/ausentes, corte, correcciones auditadas, aprobación y cobertura.
- **Reportes por turno:** saldo a la hora física, recepción, pendientes, programación, concurrencia y existencias intactas.
- **Traslados anteriores:** permisos, cantidades parciales, recuperación y recepción sin duplicación.
- **ESLint:** archivos JavaScript/JSX nuevos o modificados del producto y configuración de pruebas, sin errores.
- **Build de producción:** correcto. Permanece el aviso de paquetes JavaScript grandes; no impide generar la aplicación.
- **Navegador:** conteo comprobado a 320, 390, 768 y 1280 px; cálculo de empaques, confirmación, borradores, ubicaciones separadas, cero, motivos, cambio de base y cantidades por peso.
- **Movimientos diarios:** página, panel y ventana comprobados a 320, 390 y 1280 px, con filtros, color de ajuste negativo, Escape, foco y posición de regreso.

Los datos de prueba son sintéticos. No se crearon documentos del negocio ni movimientos reales; tampoco se publicaron frontends, workers ni mensajes de Telegram durante esta integración.

Comprobaciones reproducibles:

```sh
npm test -- --pool=threads --maxWorkers=2
npm run test:qr
npm run test:conteo
npm run test:reportes
node db/tests/traslados.integration.mjs
npm run build
```

## Publicación

La rama de integración se prepara sobre `origin/main` actualizado, commit `7183b0a` (`fix: filtrar ubicaciones con stock y restaurar salidas`). Se conservó exactamente el índice validado al actualizar esa base. El resultado agrega las mejoras locales a las funcionalidades del ZIP que ya están en main, sin volver a introducir los commits antiguos ni eliminar los avances recientes.

El código y sus pruebas quedan preparados para Git. Subir la rama y desplegar servicios son pasos separados. Antes de activar o publicar un circuito, comprobar la configuración del entorno de destino, el worker y las cuentas/dispositivos que harán la entrega física; no volver a ejecutar migraciones ya registradas.
