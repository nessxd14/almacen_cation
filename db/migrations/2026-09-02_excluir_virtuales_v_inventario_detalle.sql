-- Migración: excluir ubicaciones virtuales (VENTAS DIRECTAS, SOBREGIRO
-- ONLINE) de v_inventario_detalle.
-- Proyecto Supabase Cloud: supabase_db_almacen_roari (ref zxoxougwgstrarwymlvd).
-- NO aplicada automáticamente — revisar y ejecutar manualmente desde el SQL
-- Editor de Supabase.
--
-- ============================================================================
-- PASO 0 — Evidencia recogida contra la base viva (2026-09-02)
-- ============================================================================
--
-- 0a. Brief "Totales de Almacén Central y Tienda" (2026-09-02): el detalle
--     de inventario por estante mezcla, dentro de la sucursal Almacén
--     Central, dos contadores virtuales (no son estantes físicos, solo
--     acumulan salidas y por eso siempre están en negativo):
--       - id=31 'VENTAS DIRECTAS' (creada 2026-08-26 13:15:21)
--       - id=28 'SOBREGIRO ONLINE'
--     Ambas son sucursal_id = Almacén Central, s.tipo = 'fisica', así que
--     el filtro actual `s.tipo <> 'virtual'` no las excluye.
--
-- 0b. `ubicacion.excluye_disponible` YA EXISTE en la base (agregada fuera de
--     este repo de migraciones) y ya está en `true` para ambas filas y en
--     `false` para el resto de ubicaciones físicas reales (HUECO, PLANTA
--     BAJA, PLANTA ARRIBA, PLANTA GARRAGE, SECTOR ARTE, SALÓN, SHOPIFY).
--     Verificado con:
--       select id, codigo_zona, excluye_disponible from ubicacion order by id;
--     No hace falta agregar la columna ni backfill — solo falta que
--     v_inventario_detalle la use.
--
-- 0c. Definición viva de v_inventario_detalle (vía pg_get_viewdef) ya trae
--     `u.sucursal_id` y `s.nombre AS sucursal_nombre` además de las columnas
--     documentadas en 2026-07-17_marca_en_v_inventario_detalle.sql (esas dos
--     columnas se agregaron fuera de este repo de migraciones). Esta
--     migración las preserva tal cual junto con el resto; el único cambio es
--     agregar `AND u.excluye_disponible = false` al WHERE.
--
-- 0d. Los totales agregados (v_inventario_resumen, usado en los reportes
--     generales) ya filtran solo cantidades positivas y no se ven afectados
--     por este bug — el problema es únicamente de v_inventario_detalle
--     (desglose fila por fila).
-- ============================================================================

begin;

create or replace view v_inventario_detalle as
select
    sa.producto_id,
    p.nombre as producto_nombre,
    p.sku_interno,
    p.precio_base,
    p.unidad_base,
    p.imagen_url,
    p.shopify_variant_id,
    sa.ubicacion_id,
    u.codigo_zona,
    u.estante,
    u.nivel,
    sa.cantidad_base,
    coalesce(sa.cantidad_base * p.precio_base, 0::numeric) as valor_linea,
    sa.actualizado_en,
    u.compartimiento,
    p.marca,
    u.sucursal_id,
    s.nombre as sucursal_nombre
from stock_actual sa
join producto p  on p.id = sa.producto_id
join ubicacion u on u.id = sa.ubicacion_id
join sucursal s  on s.id = u.sucursal_id
where p.activo = true
  and s.tipo <> 'virtual'
  and u.excluye_disponible = false;

commit;

-- ============================================================================
-- PASO 1 — Verificación post-migración (ejecutar manualmente)
-- ============================================================================
--
-- 1a. VENTAS DIRECTAS y SOBREGIRO ONLINE ya no aparecen en el detalle:
-- select count(*) from v_inventario_detalle where ubicacion_id in (28, 31); -- debe ser 0
--
-- 1b. El resto de ubicaciones físicas de Almacén Central y Tienda no
--     cambian de cantidad (solo se quitan filas de las dos ubicaciones
--     virtuales, no se altera stock_actual):
-- select ubicacion_id, codigo_zona, count(*), sum(cantidad_base)
-- from v_inventario_detalle
-- group by ubicacion_id, codigo_zona
-- order by codigo_zona;
--
-- 1c. Los totales por sucursal (excluyendo virtuales) siguen coincidiendo
--     con v_inventario_resumen:
-- select s.nombre, count(distinct sa.producto_id) as productos, sum(sa.cantidad_base) as unidades,
--        sum(sa.cantidad_base * p.precio_base) as valor
-- from v_inventario_detalle sa
-- join producto p on p.id = sa.producto_id
-- join ubicacion u on u.id = sa.ubicacion_id
-- join sucursal s on s.id = u.sucursal_id
-- group by s.nombre;
