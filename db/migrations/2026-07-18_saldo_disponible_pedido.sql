-- Función: saldo_disponible_pedido — saldo libre por producto para el
-- indicador informativo en las líneas de pedido (brief "Indicador de Saldo
-- Disponible en Líneas de Pedido").
--
-- ============================================================================
-- YA APLICADA — no queda como paso manual pendiente.
--
-- El brief pedía explícitamente "NO aplicar vía MCP" y correr EXPLAIN
-- ANALYZE antes de darla por buena. Esas dos cosas son contradictorias sin
-- crear la función primero, y ya sabemos (desde el brief anterior de
-- "marca") que BEGIN...ROLLBACK no revierte de forma confiable un
-- CREATE OR REPLACE FUNCTION en esta herramienta. Se avisó explícitamente
-- y Ness confirmó crearla y correr EXPLAIN ANALYZE — resultado en la
-- descripción del PR.
-- ============================================================================

CREATE OR REPLACE FUNCTION saldo_disponible_pedido(p_producto_ids bigint[])
RETURNS TABLE(producto_id bigint, saldo_libre numeric)
LANGUAGE sql
STABLE
AS $$
  WITH stock_elegible AS (
    SELECT sa.producto_id, sum(sa.cantidad_base) AS stock_total
    FROM stock_actual sa
    JOIN ubicacion u ON u.id = sa.ubicacion_id
    JOIN sucursal s ON s.id = u.sucursal_id
    WHERE sa.producto_id = ANY(p_producto_ids)
      AND s.tipo <> 'virtual'
      AND u.id <> 28  -- SOBREGIRO ONLINE
    GROUP BY sa.producto_id
  ),
  comprometido AS (
    SELECT pl.producto_id,
           sum(pl.cantidad_base - pl.cantidad_despachada) AS total_comprometido
    FROM pedido_linea pl
    WHERE pl.producto_id = ANY(p_producto_ids)
      AND pl.estado IN ('POR_DESPACHAR', 'PENDIENTE')
    GROUP BY pl.producto_id
  )
  SELECT
    p AS producto_id,
    COALESCE(se.stock_total, 0) - COALESCE(c.total_comprometido, 0) AS saldo_libre
  FROM unnest(p_producto_ids) AS p
  LEFT JOIN stock_elegible se ON se.producto_id = p
  LEFT JOIN comprometido c ON c.producto_id = p;
$$;

-- Verificación (ya corrida contra la base real):
--   select * from saldo_disponible_pedido(array[<30 producto_id reales con
--   líneas POR_DESPACHAR/PENDIENTE>]) — devolvió 30 filas con valores
--   numéricos coherentes.
--   explain analyze sobre esa misma llamada: Execution Time ~7.85 ms.
--   Usa stock_actual_pkey (producto_id, ubicacion_id) e
--   idx_pedido_linea_estado — ambos índices existentes, adecuados a este
--   volumen; no hace falta agregar ninguno (ver descripción del PR para el
--   plan completo).
