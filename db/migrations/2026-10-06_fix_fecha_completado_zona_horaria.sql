-- =====================================================================
-- 2026-10-06_fix_fecha_completado_zona_horaria.sql
-- Proyecto: supabase_db_almacen_roari (zxoxougwgstrarwymlvd)
--
-- Arregla:
--  Entre las 20:00 y las 23:59 (hora Bolivia) no se podía completar ningún
--  pedido no-TIENDA: el despacho de la última línea o el cierre de tanda
--  fallaban con "Fecha de entrega inválida" y se revertía todo.
--
--  Causa: recalcular_estado_pedido anotaba fecha_completado con
--  current_date. La base corre en UTC, así que desde las 20:00 de Bolivia
--  current_date ya es el día siguiente. El trigger hermes_entrega_atomica
--  pasa esa fecha a hermes.sincronizar_entrega_pedido, que rechaza fechas
--  futuras respecto a America/La_Paz.
--
--  Cambio: fecha_completado se calcula con
--  (now() at time zone 'America/La_Paz')::date, el mismo criterio que ya
--  usa hermes.sincronizar_entrega_pedido para validar. Es el único cambio;
--  el resto de la función queda igual.
--
-- Firma SIN cambio (CREATE OR REPLACE reemplaza, no crea overload):
--   recalcular_estado_pedido(bigint)
--
-- Detectado con el pedido 706 (PED-2026-00621) la noche del 2026-10-05.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.recalcular_estado_pedido(p_pedido_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_estaba_completado boolean; v_queda_completado boolean; v_categoria categoria_pedido;
begin
  select (estado = 'COMPLETADO'), categoria into v_estaba_completado, v_categoria
    from pedido where id = p_pedido_id;

  update pedido p
     set estado = case
           when not exists (
             select 1 from pedido_linea pl
             where pl.pedido_id = p.id
               and pl.estado not in ('DESPACHADA', 'COMPRADO_DIRECTO', 'RETIRADA', 'RECHAZADO', 'CAMBIADA')
           ) then 'COMPLETADO'::estado_pedido
           when p.estado = 'COMPLETADO' then 'ABIERTO'::estado_pedido
           else p.estado
         end
   where p.id = p_pedido_id
     and p.estado <> 'CANCELADO';

  select (estado = 'COMPLETADO') into v_queda_completado from pedido where id = p_pedido_id;

  if v_queda_completado and not coalesce(v_estaba_completado, false) and v_categoria <> 'TIENDA' then
    -- Fecha de Bolivia, no la del servidor (UTC): de noche current_date ya
    -- es mañana y Hermes rechaza la entrega por fecha futura.
    insert into pendiente_sync_hermes_despacho (pedido_id, fecha_completado)
    values (p_pedido_id, (now() at time zone 'America/La_Paz')::date)
    on conflict (pedido_id) do update
      set fecha_completado = excluded.fecha_completado, sincronizado_en = null, intentos = 0, ultimo_error = null;
  end if;
end;
$function$;

-- Regla permanente del proyecto: toda función nace con EXECUTE para
-- PUBLIC/anon en Supabase, así que se revoca y se otorga en el mismo archivo.
REVOKE ALL ON FUNCTION public.recalcular_estado_pedido(bigint) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.recalcular_estado_pedido(bigint) TO authenticated, service_role;

-- Verificación: debe devolver usa_fecha_bolivia = true, usa_current_date = false
-- y una sola firma.
SELECT p.oid::regprocedure::text AS firma,
       pg_get_functiondef(p.oid) ILIKE '%America/La_Paz%' AS usa_fecha_bolivia,
       pg_get_functiondef(p.oid) ~* 'current_date'        AS usa_current_date,
       p.proacl::text                                     AS permisos
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'recalcular_estado_pedido';
