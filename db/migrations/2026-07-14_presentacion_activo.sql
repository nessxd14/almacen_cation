-- Migración: columna `activo` en `presentacion`, para poder desactivar (en
-- vez de borrar) presentaciones que ya tienen historial en el Kardex.
-- Proyecto Supabase Cloud: supabase_db_almacen_roari (ref zxoxougwgstrarwymlvd).
-- NO aplicada automáticamente — revisar y ejecutar manualmente desde el SQL
-- Editor de Supabase, validando primero en BEGIN … ROLLBACK.
--
-- ============================================================================
-- IMPORTANTE — aplicar ANTES de usar/mergear el frontend de este brief.
-- El selector de presentación de Entrada en OperacionesApp ahora filtra
-- `.eq("activo", true)`, y el panel de edición de producto ahora hace
-- SELECT/UPDATE sobre esta columna. Si esta migración no se aplicó todavía,
-- esas dos pantallas van a fallar (columna inexistente) para TODOS los
-- productos, no solo los que tengan presentaciones extra.
-- ============================================================================
--
-- Contexto (confirmado contra la base viva, 2026-07-14):
--   - `presentacion` no tiene columna `activo` hoy.
--   - 0 movimientos de kardex_transacciones referencian hoy una presentación
--     no-base (columna `kardex_transacciones.presentacion_id` existe) — pero
--     eso va a cambiar en cuanto se usen las presentaciones de paquete, de
--     ahí la necesidad de "desactivar" en vez de "borrar siempre".
--
-- ----------------------------------------------------------------------------

begin;

alter table presentacion add column if not exists activo boolean not null default true;

-- Verificación (debe mostrar la columna nueva, todo en true para lo ya
-- existente — nada se desactiva por esta migración, solo se agrega la
-- posibilidad de hacerlo desde la UI).
select id, producto_id, nombre, es_base, activo from presentacion order by producto_id, es_base desc limit 10;

-- Revisar el resultado de arriba, y si está todo bien:
--   COMMIT;
-- si algo no cuadra:
--   ROLLBACK;
commit;
