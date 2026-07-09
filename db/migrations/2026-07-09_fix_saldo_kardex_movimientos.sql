-- Fix: v_kardex_movimientos descartaba silenciosamente movimientos AJUSTE
-- sin presentacion_id, rompiendo la ventana de saldo_base.
-- Proyecto Supabase Cloud: supabase_db_almacen_roari (ref zxoxougwgstrarwymlvd).
--
-- Diagnóstico confirmado contra la base viva (2026-07-09), a raíz de armar
-- la columna "Saldo" en el modal de Movimientos (BRIEF_saldo_movimientos_v2):
--   - kardex_transacciones: 645 filas totales; v_kardex_movimientos solo
--     exponía 423 (222 de menos), exactamente las filas AJUSTE con
--     presentacion_id = null (222 filas, comprobado con
--     `select tipo_movimiento, count(*) from kardex_transacciones
--      where presentacion_id is null group by tipo_movimiento`).
--   - La vista hacía `JOIN presentacion pr ON pr.id = kt.presentacion_id`
--     (inner join). Como el AJUSTE no siempre registra presentacion_id,
--     esas filas desaparecían de la vista por completo — y como saldo_base
--     es una suma por ventana (`sum(kt.cantidad) OVER (PARTITION BY
--     producto_id, ubicacion_id ORDER BY creado_en, id)`), cualquier fila
--     posterior a un AJUSTE faltante arrastraba un acumulado incorrecto
--     para el resto del historial de ese producto+ubicación.
--   - Caso de prueba: producto_id 344, ubicacion_id 23 (única ubicación).
--     kardex_transacciones tiene 5 movimientos (AJUSTE +30, SALIDA -1,
--     SALIDA -10, AJUSTE -18, SALIDA -1 → neto 0, coincide con
--     stock_actual.cantidad_base = 0 para ese producto/ubicación). La vista,
--     al perder los 2 AJUSTE, solo sumaba las 3 SALIDA y mostraba saldo
--     final -12 en vez de 0.
--   - producto_id, ubicacion_id son NOT NULL en kardex_transacciones
--     (verificado contra information_schema.columns); solo presentacion_id
--     es nullable. Los joins a producto y ubicacion no tienen este problema.
--
-- Fix: producto y ubicacion sin cambios; presentacion pasa a LEFT JOIN para
-- no descartar filas. La columna `presentacion` (nombre) queda null en las
-- filas sin presentacion_id (ya lo era conceptualmente), pero la fila y su
-- saldo_base ya no desaparecen del cálculo acumulado.
--
-- Validado contra la base viva (BEGIN…ROLLBACK): con el fix,
-- v_kardex_movimientos pasa a exponer las 645 filas y el saldo final para
-- producto 344 / ubicación 23 da 0, igual que stock_actual. Rollback no dejó
-- rastro.

create or replace view v_kardex_movimientos as
select
  kt.id,
  kt.producto_id,
  kt.presentacion_id,
  kt.ubicacion_id,
  p.nombre as producto,
  p.sku_interno as sku,
  pr.nombre as presentacion,
  (((u.codigo_zona::text || '-'::text) || u.estante::text) || '-'::text || u.nivel::text)
    || coalesce('-'::text || u.compartimiento::text, ''::text) as ubicacion,
  kt.tipo_movimiento,
  kt.cantidad_origen,
  kt.factor_a_base_snap,
  kt.cantidad as cantidad_base,
  sum(kt.cantidad) over (
    partition by kt.producto_id, kt.ubicacion_id
    order by kt.creado_en, kt.id
    rows between unbounded preceding and current row
  ) as saldo_base,
  kt.referencia,
  kt.motivo,
  kt.creado_por,
  kt.fecha_efectiva,
  kt.creado_en
from kardex_transacciones kt
join producto p on p.id = kt.producto_id
left join presentacion pr on pr.id = kt.presentacion_id
join ubicacion u on u.id = kt.ubicacion_id;
