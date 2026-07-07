-- Migración: venta online descuenta ubicación física real, no la sucursal
-- virtual Shopify.
-- Proyecto Supabase Cloud: supabase_db_almacen_roari (ref zxoxougwgstrarwymlvd).
-- NO aplicada automáticamente — revisar y ejecutar manualmente desde el SQL
-- Editor de Supabase, validando primero en BEGIN … ROLLBACK.
--
-- ============================================================================
-- PASO 0 — Evidencia recogida contra la base viva (2026-07-07)
-- ============================================================================
--
-- 0a. Diagnóstico confirmado:
--     - sucursal id=1 'Almacén Central' (fisica, visible_online=true),
--       id=2 'Tienda' (fisica, visible_online=false),
--       id=3 'Shopify' (virtual, visible_online=true).
--     - ubicacion id=20 (SHOPIFY › Virtual, sucursal_id=3) es la que hoy
--       recibe TODA la venta/refund online vía WMS_UBICACION_SHOPIFY.
--     - stock_actual en sucursal_id=3: 39 filas, todas negativas,
--       total −1160.0000 base. kardex_transacciones contra esa sucursal:
--       41 movimientos, ventana 2026-07-04 → 2026-07-07 (pruebas).
--     - stock_actual en sucursal_id=1 (Almacén Central): 162 filas,
--       +284453.0000 base — nunca se descontó por venta online, coherente
--       con el diagnóstico (el faltante de -1160 en la virtual es stock que
--       "debería" haber salido de acá).
--     - Firmas confirmadas (sin cambios):
--       registrar_salida(p_presentacion_id, p_ubicacion_id, p_cantidad_pres,
--         p_referencia, p_usuario default null, p_fecha default current_date,
--         p_idempotencia default null, p_permitir_sobregiro default false) RETURNS bigint
--       registrar_entrada(p_presentacion_id, p_ubicacion_id, p_cantidad_pres,
--         p_referencia, p_usuario default null, p_fecha default current_date,
--         p_costo_unitario default null, p_idempotencia default null) RETURNS bigint
--       shopify_presentacion_base(p_variant_id text, p_sku text) RETURNS bigint
--       (ya existe, migración 2026-06-29; devuelve la presentación base).
--     - kardex_transacciones.idempotencia_clave: UNIQUE (uq_kardex_idem);
--       duplicado -> registrar_salida/entrada devuelven el id existente.
--     - No existían registrar_salida_online / registrar_entrada_online antes
--       de esta migración (verificado contra pg_proc).
--
-- 0b. Desviación de diseño respecto al brief (documentada, no silenciosa):
--     el brief lista registrar_salida_online(p_presentacion_id,
--     p_cantidad_pres, p_referencia, p_idempotencia) sin parámetro de
--     ubicación default. Postgres no puede leer variables de entorno de la
--     Edge Function directamente, así que WMS_UBICACION_ONLINE_DEFAULT tiene
--     que llegar como parámetro explícito — igual que hoy UBICACION_ID llega
--     como p_ubicacion_id. Se agrega `p_ubicacion_default bigint` como
--     último parámetro de registrar_salida_online y registrar_entrada_online;
--     la Edge Function lo pasa desde su propio env var (ver Parte 2). No
--     cambia el comportamiento descrito en el brief, solo cómo el dato
--     "cuál es la ubicación default" llega hasta la función SQL.
--
-- 0c. Idempotencia por línea × ubicación (criterio del brief): la clave
--     compuesta `p_idempotencia || ':' || ubicacion_id` solo garantiza
--     no-duplicación si un reintento del mismo webhook recalcula el pick
--     con exactamente las mismas ubicaciones (lo esperable si el reintento
--     llega segundos después, antes de que cambie el stock). Si el stock
--     cambia entre el intento original y un reintento tardío, el pick podría
--     repartirse distinto y generar una fila nueva. Riesgo aceptado tal como
--     lo plantea el brief; no se resuelve acá (requeriría snapshot del pick
--     por order+line, fuera de alcance).
--
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- PASO 1 — registrar_salida_online: pick por mayor stock sobre ubicaciones
-- físicas online-visibles; el faltante cae en la ubicación default con
-- sobregiro permitido (visible sobre stock real, no escondido en la virtual).
-- ----------------------------------------------------------------------------
create or replace function registrar_salida_online(
  p_presentacion_id   bigint,
  p_cantidad_pres     numeric,
  p_referencia        text,
  p_idempotencia      text,
  p_ubicacion_default bigint
) returns jsonb
language plpgsql
as $$
declare
  v_producto_id  bigint;
  v_restante     numeric := p_cantidad_pres;
  v_candidata    record;
  v_tomar        numeric;
  v_kardex_id    bigint;
  v_asignaciones jsonb := '[]'::jsonb;
begin
  if p_cantidad_pres <= 0 then
    raise exception 'p_cantidad_pres debe ser positiva';
  end if;

  select producto_id into v_producto_id from presentacion where id = p_presentacion_id;
  if v_producto_id is null then
    raise exception 'Presentación % no existe', p_presentacion_id;
  end if;

  -- mismo pool que v_disponible_shopify: físicas, online-visibles, con stock.
  for v_candidata in
    select sa.ubicacion_id, sa.cantidad_base
    from stock_actual sa
    join ubicacion u on u.id = sa.ubicacion_id
    join sucursal s  on s.id = u.sucursal_id
    where s.tipo = 'fisica'
      and s.visible_online = true
      and sa.producto_id = v_producto_id
      and sa.cantidad_base > 0
    order by sa.cantidad_base desc
  loop
    exit when v_restante <= 0;
    v_tomar := least(v_restante, v_candidata.cantidad_base);

    select registrar_salida(
      p_presentacion_id    => p_presentacion_id,
      p_ubicacion_id       => v_candidata.ubicacion_id,
      p_cantidad_pres      => v_tomar,
      p_referencia         => p_referencia,
      p_usuario            => 'shopify',
      p_idempotencia       => p_idempotencia || ':' || v_candidata.ubicacion_id,
      p_permitir_sobregiro => false
    ) into v_kardex_id;

    v_asignaciones := v_asignaciones || jsonb_build_object(
      'ubicacion_id', v_candidata.ubicacion_id,
      'cantidad_base', v_tomar,
      'kardex_id', v_kardex_id
    );
    v_restante := v_restante - v_tomar;
  end loop;

  -- faltante: sobregiro explícito sobre la ubicación default (física, real).
  if v_restante > 0 then
    if p_ubicacion_default is null then
      raise exception 'p_ubicacion_default es obligatorio para cubrir el faltante (%)', v_restante;
    end if;

    select registrar_salida(
      p_presentacion_id    => p_presentacion_id,
      p_ubicacion_id       => p_ubicacion_default,
      p_cantidad_pres      => v_restante,
      p_referencia         => p_referencia,
      p_usuario            => 'shopify',
      p_idempotencia       => p_idempotencia || ':' || p_ubicacion_default,
      p_permitir_sobregiro => true
    ) into v_kardex_id;

    v_asignaciones := v_asignaciones || jsonb_build_object(
      'ubicacion_id', p_ubicacion_default,
      'cantidad_base', v_restante,
      'kardex_id', v_kardex_id,
      'sobregiro', true
    );
  end if;

  return v_asignaciones;
end;
$$;

-- ----------------------------------------------------------------------------
-- PASO 2 — registrar_entrada_online: refunds/restock a la ubicación default.
-- ----------------------------------------------------------------------------
create or replace function registrar_entrada_online(
  p_presentacion_id   bigint,
  p_cantidad_pres     numeric,
  p_referencia        text,
  p_idempotencia      text,
  p_ubicacion_default bigint
) returns bigint
language plpgsql
as $$
declare
  v_kardex_id bigint;
begin
  if p_cantidad_pres <= 0 then
    raise exception 'p_cantidad_pres debe ser positiva';
  end if;
  if p_ubicacion_default is null then
    raise exception 'p_ubicacion_default es obligatorio';
  end if;

  select registrar_entrada(
    p_presentacion_id => p_presentacion_id,
    p_ubicacion_id    => p_ubicacion_default,
    p_cantidad_pres   => p_cantidad_pres,
    p_referencia      => p_referencia,
    p_usuario         => 'shopify',
    p_idempotencia    => p_idempotencia
  ) into v_kardex_id;

  return v_kardex_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- PASO 3 — v_inventario_detalle: excluir sucursales virtuales del conteo.
-- Mismas columnas/orden que antes (create or replace es seguro); Tienda
-- (física, visible_online=false) se mantiene — es stock físico real.
-- ----------------------------------------------------------------------------
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
  u.compartimiento
from stock_actual sa
join producto p  on p.id = sa.producto_id
join ubicacion u on u.id = sa.ubicacion_id
join sucursal s  on s.id = u.sucursal_id
where p.activo = true
  and s.tipo <> 'virtual';

commit;

-- ============================================================================
-- PASO 4 — Verificación post-migración (ejecutar manualmente)
-- ============================================================================

-- 4a. Funciones y vista presentes:
-- select proname from pg_proc where proname in ('registrar_salida_online','registrar_entrada_online');
-- select count(*) from v_inventario_detalle; -- ya no debe incluir filas de sucursal_id=3

-- 4b. Prueba funcional (en transacción con ROLLBACK): descuenta un producto
--     con stock en Almacén Central usando la ubicación real, no la virtual.
--     Elige el producto/ubicación dinámicamente. ROLLBACK al final.
--
-- begin;
-- do $$
-- declare
--   v_producto_id     bigint;
--   v_presentacion_id bigint;
--   v_ubicacion_id    bigint;
--   v_stock_antes     numeric;
--   v_stock_despues   numeric;
--   v_resultado       jsonb;
-- begin
--   select sa.producto_id, sa.ubicacion_id, sa.cantidad_base
--     into v_producto_id, v_ubicacion_id, v_stock_antes
--   from stock_actual sa
--   join ubicacion u on u.id = sa.ubicacion_id
--   where u.sucursal_id = 1 and sa.cantidad_base >= 1
--   order by sa.cantidad_base desc
--   limit 1;
--
--   select id into v_presentacion_id
--   from presentacion where producto_id = v_producto_id and es_base limit 1;
--
--   v_resultado := registrar_salida_online(
--     v_presentacion_id, 1, 'Test online (rollback)', 'test:online:rollback', v_ubicacion_id
--   );
--   raise notice 'asignaciones: %', v_resultado;
--   assert jsonb_array_length(v_resultado) = 1, 'FALLO: se esperaba 1 asignación (había stock suficiente)';
--   assert (v_resultado->0->>'ubicacion_id')::bigint = v_ubicacion_id,
--     'FALLO: debería haber tomado de la ubicación de mayor stock (real), no de la virtual';
--
--   select cantidad_base into v_stock_despues
--   from stock_actual where producto_id = v_producto_id and ubicacion_id = v_ubicacion_id;
--   assert v_stock_despues = v_stock_antes - 1, 'FALLO: el stock de la ubicación real no bajó en 1';
--
--   raise notice 'OK: la venta online descontó ubicación física real (%), no la virtual', v_ubicacion_id;
-- end $$;
-- rollback;
--
-- Criterio de éxito: la asignación apunta a una ubicación con sucursal física
-- (no la id=20/Shopify virtual) y el stock de esa ubicación bajó en la
-- cantidad vendida. Todo dentro del ROLLBACK, no debe persistir nada.

-- ============================================================================
-- PASO 5 — Reconciliación del -1160 en la virtual (PASO MANUAL, gated)
-- ============================================================================
-- Los 41 movimientos son de la ventana de pruebas (04-07 jul). Si esas
-- órdenes NO despacharon mercadería física real, Almacén ya está correcto y
-- solo hay que llevar la virtual a 0 con ENTRADAs compensatorias (Kardex
-- append-only, no se borra nada). Revisar el SELECT de conteo ANTES de
-- decidir COMMIT — si alguna fila fue venta real que sí despachó, hay que
-- bajar Almacén por esa cantidad aparte (no lo hace este bloque).
--
-- Validar primero:
-- select sa.producto_id, p.nombre, sa.cantidad_base
-- from stock_actual sa join producto p on p.id = sa.producto_id
-- join ubicacion u on u.id = sa.ubicacion_id
-- where u.sucursal_id = 3 and sa.cantidad_base < 0
-- order by sa.cantidad_base asc;
--
-- begin;
-- select registrar_entrada(
--   p_presentacion_id => (select id from presentacion
--                         where producto_id = sa.producto_id and es_base limit 1),
--   p_ubicacion_id    => sa.ubicacion_id,
--   p_cantidad_pres   => (- sa.cantidad_base),           -- lleva la fila a 0
--   p_referencia      => 'RECON cierre virtual Shopify (pruebas 04-07 jul)',
--   p_usuario         => 'reconciliacion',
--   p_idempotencia    => 'recon:virt-shopify:'||sa.ubicacion_id||':'||sa.producto_id
-- )
-- from stock_actual sa
-- join ubicacion u on u.id = sa.ubicacion_id
-- where u.sucursal_id = 3 and sa.cantidad_base < 0;
--
-- -- verificar que la virtual quedó en 0 antes de commitear:
-- -- select count(*) from stock_actual sa join ubicacion u on u.id=sa.ubicacion_id
-- -- where u.sucursal_id = 3 and sa.cantidad_base <> 0;  -- debe ser 0
-- commit; -- (o rollback si algo no cuadra)
--
-- Opcional, una vez cerrada y confirmado que ninguna ruta la usa más:
-- update sucursal set activo = false where id = 3;
