-- Entregas paralelas por sucursal (2026-11-10)
--
-- Problema: un pedido sólo podía tener UNA entrega activa en total. Si Tienda abría
-- una entrega para las líneas especiales (compra rápida), Almacén Central quedaba
-- bloqueado con "Este pedido tiene una entrega en preparación en otra sucursal" para
-- todas sus líneas hasta que Tienda despachara (caso PED-2026-00826, Maricela Pinto).
--
-- Cambio:
--   1. lineas_actuales(pedido, sucursal) deja de ofrecer las líneas que ya están
--      vigentes en una entrega activa de OTRA sucursal. Así cada línea vive en una sola
--      entrega activa y no puede despacharse dos veces. Las líneas sin origen
--      (sucursal_origen_id null: especiales/personalizadas) las toma la primera
--      sucursal que abra entrega; se liberan cuando esa entrega se despacha o se anula.
--   2. operar(): se quita el bloqueo global. Si a la sucursal no le queda nada que
--      preparar porque otra sucursal tiene sus líneas, el mensaje lo dice con nombre.
--   3. El índice único pasa de (pedido_id) a (pedido_id, sucursal_id): sigue habiendo
--      una sola entrega activa por pedido Y sucursal.
--
-- operar() en producción NO coincide con la última migración del repo que la define
-- (20261013143239: 18 503 caracteres; producción: 19 670). Por eso se parchea la
-- definición en vivo con reemplazos exactos, con guardas de hash: si cualquiera de las
-- dos funciones cambió desde el diagnóstico, la migración aborta sin tocar nada.
--
-- Permisos: ambas funciones son internas ({postgres=X/postgres}); la app entra por
-- public.operar_preparacion_pedido. CREATE OR REPLACE conserva el ACL; igual se
-- revoca explícitamente para que no queden expuestas.

begin;

do $migracion$
declare
  v_def text;
  v_viejo text;
  v_nuevo text;
  v_n integer;
begin
  -- ── 1. lineas_actuales ───────────────────────────────────────────────────────
  if (select md5(prosrc) from pg_proc where oid='almacen_operaciones.lineas_actuales(bigint,bigint)'::regprocedure)
     <> 'dfd062cb9595d69ae26d7fc4c6da3832' then
    raise exception 'lineas_actuales cambió desde el diagnóstico del 2026-11-10; revisar antes de aplicar.';
  end if;
  v_def := pg_get_functiondef('almacen_operaciones.lineas_actuales(bigint,bigint)'::regprocedure);
  v_viejo := E'    and l.cantidad_base > l.cantidad_despachada\n  order by l.id;';
  v_nuevo := E'    and l.cantidad_base > l.cantidad_despachada\n'
          || E'    -- Línea tomada por una entrega activa de otra sucursal: no se ofrece aquí.\n'
          || E'    and not exists(select 1 from public.almacen_preparacion_linea ol\n'
          || E'      join public.almacen_preparacion ot on ot.id=ol.preparacion_id\n'
          || E'      where ol.pedido_linea_id=l.id and ol.vigente and ot.pedido_id=p_pedido\n'
          || E'        and ot.sucursal_id<>p_sucursal\n'
          || E'        and ot.estado in (''PREPARANDO'',''PREPARADO'',''REVISANDO'',''VERIFICADO''))\n'
          || E'  order by l.id;';
  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_n <> 1 then raise exception 'lineas_actuales: el fragmento a reemplazar aparece % veces (se esperaba 1).', v_n; end if;
  execute replace(v_def, v_viejo, v_nuevo);

  -- ── 2. operar ────────────────────────────────────────────────────────────────
  if (select md5(prosrc) from pg_proc where oid='almacen_operaciones.operar(bigint,bigint,bigint,text,integer,jsonb)'::regprocedure)
     <> '907a890769877c020bb0575fe0c1b80d' then
    raise exception 'operar cambió desde el diagnóstico del 2026-11-10; revisar antes de aplicar.';
  end if;
  v_def := pg_get_functiondef('almacen_operaciones.operar(bigint,bigint,bigint,text,integer,jsonb)'::regprocedure);

  -- 2a. variable para el nombre de la sucursal que retiene las líneas
  v_viejo := E'  v_auto boolean := p_accion=''escanear'';\n';
  v_nuevo := E'  v_auto boolean := p_accion=''escanear'';\n  v_sucursal_retiene text;\n';
  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_n <> 1 then raise exception 'operar (declare): el fragmento aparece % veces (se esperaba 1).', v_n; end if;
  v_def := replace(v_def, v_viejo, v_nuevo);

  -- 2b. bloqueo global → mensaje sólo cuando otra sucursal retiene las líneas
  v_viejo := E'      if exists(select 1 from public.almacen_preparacion where pedido_id=p_pedido_id and estado in (''PREPARANDO'',''PREPARADO'',''REVISANDO'',''VERIFICADO'')) then\n'
          || E'        raise exception ''Este pedido tiene una entrega en preparación en otra sucursal.'';\n'
          || E'      end if;\n'
          || E'      if not exists(select 1 from almacen_operaciones.lineas_actuales(p_pedido_id,p_sucursal_id)) then\n'
          || E'        raise exception ''No hay líneas pendientes para preparar en esta sucursal.'';\n'
          || E'      end if;\n';
  v_nuevo := E'      if not exists(select 1 from almacen_operaciones.lineas_actuales(p_pedido_id,p_sucursal_id)) then\n'
          || E'        select s.nombre into v_sucursal_retiene\n'
          || E'          from public.almacen_preparacion_linea ol\n'
          || E'          join public.almacen_preparacion ot on ot.id=ol.preparacion_id\n'
          || E'          join public.sucursal s on s.id=ot.sucursal_id\n'
          || E'          join public.pedido_linea l on l.id=ol.pedido_linea_id\n'
          || E'          where ot.pedido_id=p_pedido_id and ot.sucursal_id<>p_sucursal_id and ol.vigente\n'
          || E'            and ot.estado in (''PREPARANDO'',''PREPARADO'',''REVISANDO'',''VERIFICADO'')\n'
          || E'            and (l.sucursal_origen_id is null or l.sucursal_origen_id=p_sucursal_id)\n'
          || E'            and l.cantidad_base>l.cantidad_despachada\n'
          || E'          order by ot.id limit 1;\n'
          || E'        if v_sucursal_retiene is not null then\n'
          || E'          raise exception ''Las líneas pendientes de esta sucursal ya están en una entrega activa de %. Se liberan cuando esa entrega se despache o se anule.'', v_sucursal_retiene;\n'
          || E'        end if;\n'
          || E'        raise exception ''No hay líneas pendientes para preparar en esta sucursal.'';\n'
          || E'      end if;\n';
  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_n <> 1 then raise exception 'operar (crear): el fragmento aparece % veces (se esperaba 1).', v_n; end if;
  execute replace(v_def, v_viejo, v_nuevo);
end
$migracion$;

revoke all on function almacen_operaciones.lineas_actuales(bigint,bigint) from public, anon, authenticated;
revoke all on function almacen_operaciones.operar(bigint,bigint,bigint,text,integer,jsonb) from public, anon, authenticated;

-- ── 3. Una entrega activa por pedido Y sucursal ─────────────────────────────────
drop index public.almacen_preparacion_activa_idx;
create unique index almacen_preparacion_activa_idx on public.almacen_preparacion(pedido_id, sucursal_id)
  where estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO');

commit;
