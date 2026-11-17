# Historial global paginado — preparación del 16 de noviembre de 2026

Estado: preparado localmente en `codex/optimizar-historial-global`, sobre `origin/main` (`c7c336a`). No aplicado ni desplegado en Supabase.

**Bloquea merge/despliegue:** la migración `20261117004040_historial_global_paginado.sql` debe pasar el ensayo, recibir revisión de Ness, aplicarse con su autorización y verificarse en otra sesión antes de publicar el frontend que la llama.

## Problema y alcance

El historial global de `src/HistorialApp.jsx` leía hasta 500 movimientos y luego consultaba `v_kardex_movimientos` para obtener sus saldos. Esa vista calcula una ventana por producto y ubicación antes de filtrar los ids. También había una lectura separada de `stock_actual`; la búsqueda de productos, SKU, marca y referencia se limitaba a las 500 filas ya recibidas.

La nueva RPC `obtener_historial_global(bigint,text,text,integer,timestamptz,bigint)` filtra por sucursal, tipo y búsqueda; materializa una página pequeña de ids; y sólo después obtiene los detalles, el saldo histórico y el stock disponible actual. Reutiliza `idx_kardex_prod_ubic`; no añade índices, cron, snapshots ni escrituras.

El saldo histórico suma todos los tipos de movimiento del mismo producto y ubicación hasta `(creado_en,id)`, inclusive. Conserva ajustes sin presentación y el criterio por fecha de registro, incluso cuando `fecha_efectiva` sea anterior. El stock disponible actual suma las ubicaciones de esa sucursal con `excluye_disponible = false` y se muestra con esa etiqueta; no se usa para reconstruir el saldo histórico.

El cliente muestra páginas de 50, solicita una fila adicional para detectar si hay más y continúa por cursor `(creado_en,id)`. Conserva los microsegundos del timestamp recibido, sin convertirlo a `Date`. Busca antes de paginar y trata `%` y `_` como texto literal. La RPC existente del panel de un solo producto sigue igual.

## Acceso y consistencia

La función es `STABLE SECURITY INVOKER`, con `search_path` fijo y nombres de esquema explícitos: conserva los permisos y RLS de las tablas. Sólo `authenticated` y `service_role` reciben ejecución; se revoca explícitamente a `anon` y `public`. Para una sesión de usuario exige perfil activo y respeta su sucursal asignada; un perfil sin sucursal puede elegir, igual que el selector actual. No se introduce una excepción por rol de negocio.

Selección, saldo histórico y stock actual se obtienen dentro de la misma lectura. Los autores y el chip VTD mantienen sus consultas auxiliares existentes. Una inserción reciente no desplaza el cursor de las páginas anteriores. Cada página posterior puede reflejar nuevo stock disponible actual, porque esa columna representa el stock al consultar esa página.

## Validación local

- `npm run build`: correcto.
- `npm test`: 69 archivos, 593 pruebas correctas, incluidas seis pruebas del componente de historial.
- `npm run test:historial`: PGlite en memoria; no lee credenciales ni admite conexión externa. Verifica equivalencia de todos los saldos contra la vista, más de 1.000 filas, empates de timestamp, ajustes sin presentación, fechas efectivas anteriores, ubicaciones excluidas, sucursales, búsqueda fuera de las primeras 500 filas, permisos/RLS y rollback del ensayo.
- `npx eslint src/HistorialApp.jsx src/HistorialApp.test.jsx`: correcto.
- `npm run lint`: falla con 10 errores y una advertencia en archivos sin cambios: `AdminApp.jsx`, `CatalogoApp.jsx`, `FaltantesApp.jsx`, `PedidosApp.jsx`, `PreciosApp.jsx`, `PromocionHuerfanos.jsx` y `RevisionCapturas.jsx`.

Una ejecución local de control con 21.114 movimientos, página de 50 y `work_mem = 64kB` dio:

| Consulta | Ejecución | Bloques temporales escritos | Bloques temporales leídos |
| --- | ---: | ---: | ---: |
| Vista anterior, mismos ids de página | 293,322 ms | 15 | 14 |
| RPC nueva, selección y datos de página | 22,213 ms | 0 | 0 |

Los tiempos varían entre ejecuciones. Son datos sintéticos de PGlite, no una medición de producción ni una garantía de resolver la alerta de Disk IO. La agregación histórica sigue leyendo el historial del producto y ubicación de cada fila; una partición individual muy grande requiere medir su coste en destino. La búsqueda textual también debe examinar candidatos. No se añadió un índice sin evidencia de su beneficio.

La consulta con `service_role` filtrada por tipo/fecha del diagnóstico y otros consumidores de la vista no cambian automáticamente: esta preparación conecta únicamente el historial global de Almacén. El catálogo del dashboard de Supabase y `dash_salud()` quedan fuera del cambio.

## Ensayo y aplicación

1. Abrir `supabase/ensayos/20261117004040_historial_global_paginado_ENSAYO.sql` en el SQL Editor y ejecutar el archivo completo. Crea la función dentro de `BEGIN`, compara ids y saldos con la referencia y mide ambos planes con `EXPLAIN (ANALYZE, BUFFERS)` sobre 50 filas.
2. El resultado esperado es un error deliberado `ENSAYO OK: {...}` con sucursal, diferencias y métricas. La excepción aborta toda la transacción. Si el editor deja abierta la transacción abortada, ejecutar `ROLLBACK;`. No interpretar ese error esperado como un fallo ni ejecutar `COMMIT`.
3. En otra sesión, comprobar que la función no quedó creada:

   ```sql
   select p.oid::regprocedure::text as firma
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'obtener_historial_global';
   ```

   Debe devolver cero filas antes de aplicar. Si ya existe, revisar su definición y el historial de migraciones; no eliminarla ni volver a crearla sin revisar.
4. Ness revisa el JSON del ensayo. Sólo después aplica `supabase/migrations/20261117004040_historial_global_paginado.sql`, o autoriza expresamente su aplicación por el agente.
5. Verificar en otra sesión la firma, que `prosecdef` sea `false`, el `search_path` y los grants:

   ```sql
   select p.oid::regprocedure::text as firma, p.prosecdef, p.proconfig,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ejecuta,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_ejecuta,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_ejecuta
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'obtener_historial_global';
   ```

   Se espera una sola firma, `prosecdef = false`, y permisos `false / true / true`. Probar además la RPC desde una sesión de usuario activo, su sucursal, búsqueda, tipo y carga de otra página. Publicar el frontend después de esta verificación y comparar la evolución de I/O y memoria en la misma franja de uso.
