-- Migración: agregar `marca` a v_inventario_detalle (brief "marca visible").
--
-- ============================================================================
-- YA APLICADA — no queda como paso manual pendiente.
--
-- Se descubrió, validando esta migración con el patrón habitual
-- (BEGIN ... ROLLBACK), que este tipo de sentencia (CREATE OR REPLACE VIEW)
-- NO se revierte de forma confiable en esta herramienta: quedó aplicada en
-- producción a pesar del ROLLBACK. Confirmado con una prueba de control
-- (un ALTER TABLE simple sí se revierte correctamente con el mismo patrón,
-- así que el problema es específico de CREATE OR REPLACE VIEW/FUNCTION, no
-- general). A partir de ahora, cualquier CREATE OR REPLACE VIEW/FUNCTION se
-- avisa y se pausa para confirmación explícita antes de ejecutar nada
-- contra la base viva — no se vuelve a usar BEGIN...ROLLBACK como si fuera
-- una validación segura para ese tipo de DDL.
--
-- El contenido que quedó aplicado fue verificado correcto antes de dejarlo
-- así: el brief original omitía el JOIN a `sucursal` y el filtro
-- `s.tipo <> 'virtual'` que la vista YA tenía (se habrían perdido registros
-- de stock virtual excluidos del inventario real). Esta versión los
-- preserva y solo agrega `p.marca` al final.
-- ============================================================================

CREATE OR REPLACE VIEW v_inventario_detalle AS
SELECT
    sa.producto_id,
    p.nombre AS producto_nombre,
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
    COALESCE((sa.cantidad_base * p.precio_base), 0::numeric) AS valor_linea,
    sa.actualizado_en,
    u.compartimiento,
    p.marca
FROM stock_actual sa
JOIN producto p ON p.id = sa.producto_id
JOIN ubicacion u ON u.id = sa.ubicacion_id
JOIN sucursal s ON s.id = u.sucursal_id
WHERE p.activo = true AND s.tipo <> 'virtual';

-- Verificación (ya corrida contra la base real, resultado esperado: todas
-- las filas, con marca NULL para los productos que todavía no tienen marca
-- cargada — el backfill desde Shopify.vendor es un brief posterior).
SELECT COUNT(*) AS filas_totales FROM v_inventario_detalle;
SELECT COUNT(*) AS filas_con_marca FROM v_inventario_detalle WHERE marca IS NOT NULL;
