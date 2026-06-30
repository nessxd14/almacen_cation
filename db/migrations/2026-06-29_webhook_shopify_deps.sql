-- Dependencias SQL para Webhooks Shopify (Edge Functions)
-- Proyecto: supabase_db_almacen_roari (zxoxougwgstrarwymlvd)
--
-- Crea las dependencias que las Edge Functions `shopify-webhook` y
-- `shopify-stock-push` esperan pero que no existían:
--   1. webhook_evento        (dedup por X-Shopify-Event-Id)
--   2. shopify_salida()      (orders/paid  -> registrar_salida)
--   3. shopify_devolucion()  (refunds/create -> registrar_entrada)
--   4. v_disponible_shopify  (stock total por variante para stock-push)
--
-- NO aplicar automáticamente. Revisar y aplicar desde el SQL Editor de Supabase.
--
-- ============================================================================
-- PASO 0 — Evidencia de inspección contra la base live (2026-06-30)
-- ============================================================================
--
-- 0a/0b. Firmas REALES (difieren de las asumidas en el brief: llevan p_fecha,
--        registrar_entrada lleva p_costo_unitario, y NINGUNA tiene p_motivo).
--        Por eso abajo se invoca con notación nombrada (=>).
--
--   registrar_salida(
--     p_presentacion_id bigint, p_ubicacion_id bigint, p_cantidad_pres numeric,
--     p_referencia text, p_usuario varchar DEFAULT NULL, p_fecha date DEFAULT CURRENT_DATE,
--     p_idempotencia text DEFAULT NULL, p_permitir_sobregiro boolean DEFAULT false
--   ) RETURNS bigint
--
--   registrar_entrada(
--     p_presentacion_id bigint, p_ubicacion_id bigint, p_cantidad_pres numeric,
--     p_referencia text, p_usuario varchar DEFAULT NULL, p_fecha date DEFAULT CURRENT_DATE,
--     p_costo_unitario numeric DEFAULT NULL, p_idempotencia text DEFAULT NULL
--   ) RETURNS bigint
--
--   Idempotencia: ambas usan kardex_transacciones.idempotencia_clave (UNIQUE).
--   En duplicado DEVUELVEN el id de kardex existente (no NULL) -> idempotente.
--   creado_por se resuelve vía app_usuario(p_usuario), que sólo hace coalesce
--   (no valida usuarios) -> pasar 'shopify_webhook' es seguro.
--
-- 0c. producto: shopify_variant_id (varchar), shopify_inventory_item_id (varchar),
--     sku_interno (varchar), activo (bool), id (bigint)   -> OK
-- 0d. presentacion: es_base (bool), factor_unidad_base (numeric),
--     producto_id (bigint), id (bigint)                   -> OK
--     stock_actual: producto_id, ubicacion_id (bigint), cantidad_base (numeric) -> OK
-- 0e. webhook_evento / shopify_salida / shopify_devolucion / v_disponible_shopify
--     -> 0 rows (no existían). Este archivo los crea.
-- ============================================================================


-- === PASO 1: webhook_evento ===
-- Tabla de deduplicación. La Edge Function inserta el event_id antes de procesar;
-- si ya existe, ignora el evento.
CREATE TABLE IF NOT EXISTS webhook_evento (
  event_id    TEXT PRIMARY KEY,
  topic       TEXT,
  recibido_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE webhook_evento IS 'Dedup de webhooks Shopify por X-Shopify-Event-Id';


-- === HELPER: shopify_presentacion_base() ===
-- Resolución compartida producto -> presentación base, usada por shopify_salida()
-- y shopify_devolucion() (el brief sugiere extraerla para no duplicar lógica).
-- Resuelve por shopify_variant_id; si falla, por sku_interno.
CREATE OR REPLACE FUNCTION shopify_presentacion_base(
  p_variant_id TEXT,
  p_sku        TEXT
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_producto_id BIGINT;
  v_pres_id     BIGINT;
BEGIN
  SELECT id INTO v_producto_id
    FROM producto
   WHERE shopify_variant_id = p_variant_id;

  IF v_producto_id IS NULL AND p_sku IS NOT NULL THEN
    SELECT id INTO v_producto_id
      FROM producto
     WHERE sku_interno = p_sku;
  END IF;

  IF v_producto_id IS NULL THEN
    RAISE EXCEPTION 'Variante Shopify % no mapeada en WMS', p_variant_id;
  END IF;

  SELECT id INTO v_pres_id
    FROM presentacion
   WHERE producto_id = v_producto_id
     AND es_base = TRUE
   LIMIT 1;

  IF v_pres_id IS NULL THEN
    RAISE EXCEPTION 'Producto % sin presentación base (es_base = TRUE)', v_producto_id;
  END IF;

  RETURN v_pres_id;
END;
$$;


-- === PASO 2: shopify_salida() ===
-- orders/paid -> SALIDA en el Kardex. Idempotencia anclada en order_id + line_item_id.
CREATE OR REPLACE FUNCTION shopify_salida(
  p_variant_id   TEXT,
  p_sku          TEXT,
  p_ubicacion_id INTEGER,
  p_cantidad     INTEGER,
  p_order_id     BIGINT,
  p_line_item_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_pres_id BIGINT;
  v_key     TEXT;
BEGIN
  v_pres_id := shopify_presentacion_base(p_variant_id, p_sku);
  v_key     := 'shopify-sale-' || p_order_id || '-' || p_line_item_id;

  RETURN registrar_salida(
    p_presentacion_id    => v_pres_id,
    p_ubicacion_id       => p_ubicacion_id,
    p_cantidad_pres      => p_cantidad,
    p_referencia         => 'Shopify Order #' || p_order_id,
    p_usuario            => 'shopify_webhook',
    p_idempotencia       => v_key,
    p_permitir_sobregiro => TRUE  -- ventas no deben fallar por stock; se corrige con conteo
  );
END;
$$;


-- === PASO 3: shopify_devolucion() ===
-- refunds/create (o cancelación con restock) -> ENTRADA en el Kardex.
-- Idempotencia anclada en refund_id + line_item_id.
CREATE OR REPLACE FUNCTION shopify_devolucion(
  p_variant_id   TEXT,
  p_sku          TEXT,
  p_ubicacion_id INTEGER,
  p_cantidad     INTEGER,
  p_refund_id    BIGINT,
  p_line_item_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_pres_id BIGINT;
  v_key     TEXT;
BEGIN
  v_pres_id := shopify_presentacion_base(p_variant_id, p_sku);
  v_key     := 'shopify-return-' || p_refund_id || '-' || p_line_item_id;

  RETURN registrar_entrada(
    p_presentacion_id => v_pres_id,
    p_ubicacion_id    => p_ubicacion_id,
    p_cantidad_pres   => p_cantidad,
    p_referencia      => 'Shopify Refund #' || p_refund_id,
    p_usuario         => 'shopify_webhook',
    p_idempotencia    => v_key
  );
END;
$$;


-- === PASO 4: v_disponible_shopify ===
-- Alimenta shopify-stock-push (inventorySetQuantities). Shopify tiene 1 Location;
-- el WMS tiene N ubicaciones -> se SUMA el stock de todas las ubicaciones por
-- variante. El shopify_location_id NO está aquí: lo inyecta la Edge Function
-- desde un secret de Supabase.
CREATE OR REPLACE VIEW v_disponible_shopify AS
SELECT
  p.id                               AS producto_id,
  p.shopify_variant_id,
  p.shopify_inventory_item_id,
  COALESCE(SUM(sa.cantidad_base), 0) AS disponible_variante
FROM producto p
LEFT JOIN stock_actual sa ON sa.producto_id = p.id
WHERE p.activo = TRUE
  AND p.shopify_variant_id IS NOT NULL
  AND p.shopify_inventory_item_id IS NOT NULL
GROUP BY p.id, p.shopify_variant_id, p.shopify_inventory_item_id;


-- ============================================================================
-- PASO 5 — Verificación post-migración (ejecutar manualmente tras aplicar)
-- ============================================================================
-- SELECT count(*) FROM webhook_evento;                       -- 0
-- SELECT shopify_salida('999999','TEST',1,1,0,0);            -- ERROR: Variante Shopify 999999 no mapeada en WMS
-- SELECT shopify_devolucion('999999','TEST',1,1,0,0);        -- mismo ERROR
-- SELECT count(*) FROM v_disponible_shopify;                 -- > 0 si hay variantes pobladas
-- SELECT shopify_variant_id, disponible_variante FROM v_disponible_shopify LIMIT 5;
