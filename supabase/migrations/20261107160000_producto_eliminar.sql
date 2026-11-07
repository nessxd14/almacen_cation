-- Botón "Eliminar producto" del Catálogo (ALMACEN ROARI).
-- Eliminar = dar de baja (activo = false): reversible y sin romper el
-- historial (kardex, ventas, pedidos y cotizaciones siguen apuntando al id).
-- Solo admin/gerente (app_es_admin). Bloquea si el producto está en un
-- pedido abierto, un traslado en curso o una solicitud de compra activa.

CREATE OR REPLACE FUNCTION public.producto_eliminar(p_producto_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_activo   boolean;
  v_pedidos  text;
  v_traslados text;
  v_compras  int;
  v_stock    numeric;
BEGIN
  IF NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador o gerente puede eliminar productos'
      USING errcode = '42501';
  END IF;

  SELECT activo INTO v_activo FROM producto WHERE id = p_producto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto % no existe', p_producto_id USING errcode = 'P0002';
  END IF;
  IF NOT v_activo THEN
    RETURN jsonb_build_object('ok', true, 'ya_inactivo', true);
  END IF;

  SELECT string_agg(DISTINCT coalesce(pe.numero::text, '#' || pe.id::text), ', ')
    INTO v_pedidos
  FROM pedido pe
  WHERE pe.estado = 'ABIERTO'
    AND (
      EXISTS (SELECT 1 FROM pedido_item pi
              WHERE pi.pedido_id = pe.id AND pi.producto_id = p_producto_id AND pi.estado = 'VIGENTE')
      OR EXISTS (SELECT 1 FROM pedido_linea pl
              WHERE pl.pedido_id = pe.id AND pl.producto_id = p_producto_id
                AND pl.estado IN ('PENDIENTE', 'POR_COMPRAR', 'POR_DESPACHAR'))
    );
  IF v_pedidos IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede eliminar: está en pedidos abiertos (%)', v_pedidos
      USING errcode = 'P0001';
  END IF;

  SELECT string_agg(DISTINCT coalesce(st.numero::text, '#' || st.id::text), ', ')
    INTO v_traslados
  FROM solicitud_traslado st
  JOIN solicitud_traslado_linea stl ON stl.solicitud_id = st.id
  WHERE stl.producto_id = p_producto_id
    AND st.estado IN ('SOLICITADO', 'EN_TRANSITO');
  IF v_traslados IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede eliminar: está en traslados en curso (%)', v_traslados
      USING errcode = 'P0001';
  END IF;

  SELECT count(*) INTO v_compras
  FROM compra_solicitud
  WHERE producto_id = p_producto_id AND estado IN ('SOLICITADA', 'COMPRADA');
  IF v_compras > 0 THEN
    RAISE EXCEPTION 'No se puede eliminar: tiene % solicitud(es) de compra activas', v_compras
      USING errcode = 'P0001';
  END IF;

  -- Stock físico que queda "dormido" (informativo: no bloquea).
  SELECT coalesce(sum(sa.cantidad_base), 0) INTO v_stock
  FROM stock_actual sa
  JOIN ubicacion u ON u.id = sa.ubicacion_id
  WHERE sa.producto_id = p_producto_id AND NOT coalesce(u.excluye_disponible, false);

  UPDATE producto SET activo = false, actualizado_en = now() WHERE id = p_producto_id;

  RETURN jsonb_build_object('ok', true, 'ya_inactivo', false, 'stock_restante', v_stock);
END;
$function$;

REVOKE ALL ON FUNCTION public.producto_eliminar(bigint) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.producto_eliminar(bigint) TO authenticated, service_role;
