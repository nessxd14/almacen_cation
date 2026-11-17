-- ENSAYO: ejecutar completo; ENSAYO OK es una excepción intencional.
-- No aplicar la migración hasta que Ness revise estos resultados.
begin;

-- Historial global: página por cursor y saldo histórico sólo para sus filas.
-- Requiere el esquema base y idx_kardex_prod_ubic (producto_id, ubicacion_id),
-- presentes en producción y verificados por lectura de catálogos el 2026-11-16.
-- Migración nueva: pendiente de ensayo/revisión de Ness y aplicación en Supabase.
-- No modifica la vista existente, Kardex, stock, triggers ni índices.
create function public.obtener_historial_global(
  p_sucursal_id bigint,
  p_tipo text default null,
  p_busqueda text default null,
  p_limit integer default 50,
  p_antes_creado_en timestamptz default null,
  p_antes_id bigint default null
)
returns table (
  id bigint, producto_id bigint, cantidad numeric, tipo_movimiento text,
  referencia text, motivo text, fecha_efectiva date, creado_por text,
  creado_en timestamptz, traslado_grupo_id bigint,
  producto jsonb, ubicacion jsonb, saldo_base numeric,
  stock_disponible_actual numeric
)
language plpgsql stable security invoker
set search_path = ''
as $function$
declare
  v_sucursal_perfil bigint;
  v_tipo public.tipo_movimiento := nullif(btrim(p_tipo), '')::public.tipo_movimiento;
  v_busqueda text := nullif(lower(btrim(p_busqueda)), '');
begin
  if p_sucursal_id is null or p_sucursal_id <= 0 then
    raise exception 'Indica una sucursal válida' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'El tamaño de página debe estar entre 1 y 200' using errcode = '22023';
  end if;
  if (p_antes_creado_en is null) <> (p_antes_id is null)
      or p_antes_id <= 0 then
    raise exception 'El cursor requiere fecha de registro e id válidos' using errcode = '22023';
  end if;

  -- INVOKER conserva los grants y RLS del llamador. También respeta la
  -- sucursal fija del perfil; un perfil sin sucursal puede elegir como en UI.
  if current_user <> 'service_role' then
    select pf.sucursal_id into v_sucursal_perfil
      from public.perfil pf where pf.id = auth.uid() and pf.activo;
    if not found then
      raise exception 'Se requiere un perfil activo' using errcode = '42501';
    end if;
    if v_sucursal_perfil is not null and v_sucursal_perfil <> p_sucursal_id then
      raise exception 'Sin acceso al historial de esta sucursal' using errcode = '42501';
    end if;
  end if;

  return query
  with pagina as materialized (
    select k.id, k.producto_id, k.ubicacion_id, k.creado_en
      from public.kardex_transacciones k
      join public.ubicacion u on u.id = k.ubicacion_id
     where u.sucursal_id = p_sucursal_id
       and (v_tipo is null or k.tipo_movimiento = v_tipo)
       and (p_antes_creado_en is null
            or (k.creado_en, k.id) < (p_antes_creado_en, p_antes_id))
       and (v_busqueda is null
            or strpos(lower(coalesce(k.referencia, '')), v_busqueda) > 0
            or exists (
              select 1 from public.producto pr where pr.id = k.producto_id
                and (strpos(lower(coalesce(pr.nombre, '')), v_busqueda) > 0
                  or strpos(lower(coalesce(pr.sku_interno, '')), v_busqueda) > 0
                  or strpos(lower(coalesce(pr.marca, '')), v_busqueda) > 0)
            ))
     order by k.creado_en desc, k.id desc
     limit p_limit
  )
  select k.id, k.producto_id, k.cantidad, k.tipo_movimiento::text,
         k.referencia::text, k.motivo::text, k.fecha_efectiva, k.creado_por::text,
         k.creado_en, k.traslado_grupo_id,
         jsonb_build_object('id', pr.id, 'nombre', pr.nombre,
           'sku_interno', pr.sku_interno, 'marca', pr.marca,
           'imagen_url', pr.imagen_url, 'unidad_base', pr.unidad_base),
         jsonb_build_object('id', u.id, 'codigo_zona', u.codigo_zona,
           'estante', u.estante, 'nivel', u.nivel,
           'compartimiento', u.compartimiento, 'sucursal_id', u.sucursal_id),
         historico.saldo, disponible.saldo
    from pagina m
    join public.kardex_transacciones k on k.id = m.id
    join public.producto pr on pr.id = m.producto_id
    join public.ubicacion u on u.id = m.ubicacion_id
    cross join lateral (
      -- El filtro de tipo, búsqueda y cursor sólo selecciona la página.
      -- El saldo incluye todos los movimientos hasta (creado_en, id),
      -- incluso AJUSTE sin presentación y registros con fecha efectiva anterior.
      select coalesce(sum(h.cantidad), 0) as saldo
        from public.kardex_transacciones h
       where h.producto_id = m.producto_id and h.ubicacion_id = m.ubicacion_id
         and (h.creado_en, h.id) <= (m.creado_en, m.id)
    ) historico
    cross join lateral (
      select coalesce(sum(s.cantidad_base), 0) as saldo
        from public.stock_actual s
        join public.ubicacion su on su.id = s.ubicacion_id
       where s.producto_id = m.producto_id and su.sucursal_id = p_sucursal_id
         and su.excluye_disponible = false
    ) disponible
   order by m.creado_en desc, m.id desc;
end;
$function$;

revoke all on function public.obtener_historial_global(bigint, text, text, integer, timestamptz, bigint) from anon, public;
grant execute on function public.obtener_historial_global(bigint, text, text, integer, timestamptz, bigint) to authenticated, service_role;

-- Fragmento de generación del ensayo: se integra después de la migración.
-- No ejecutar por separado. El archivo final incluye BEGIN y ROLLBACK.
do $ensayo$
declare
  v_sucursal bigint;
  v_actor uuid;
  v_filas integer;
  v_diferencias integer;
  v_cursor_fecha timestamptz;
  v_cursor_id bigint;
  v_plan_anterior jsonb;
  v_plan_nuevo jsonb;
begin
  select u.sucursal_id, pf.id into v_sucursal, v_actor
    from public.ubicacion u
    join public.perfil pf on pf.activo
      and (pf.sucursal_id is null or pf.sucursal_id = u.sucursal_id)
   where exists (select 1 from public.kardex_transacciones k where k.ubicacion_id = u.id)
   order by (pf.sucursal_id is null) desc, u.id, pf.id limit 1;
  if v_actor is null then
    raise exception 'ENSAYO SIN DATOS: se requiere un perfil activo y una sucursal con movimientos';
  end if;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  with nueva as materialized (
    select * from public.obtener_historial_global(v_sucursal, null, null, 50)
  ), esperada as (
    select k.id from public.kardex_transacciones k
      join public.ubicacion u on u.id = k.ubicacion_id
     where u.sucursal_id = v_sucursal order by k.creado_en desc, k.id desc limit 50
  )
  select count(*) into v_diferencias from esperada e full join nueva n on n.id = e.id
   where e.id is null or n.id is null;
  if v_diferencias <> 0 then
    raise exception 'ENSAYO FALLÓ: % diferencias al seleccionar la primera página', v_diferencias;
  end if;

  with nueva as materialized (
    select * from public.obtener_historial_global(v_sucursal, null, null, 50)
  )
  select count(*) into v_diferencias from nueva n
    left join public.v_kardex_movimientos v on v.id = n.id
   where n.saldo_base is distinct from v.saldo_base
      or n.stock_disponible_actual is distinct from (
        select coalesce(sum(s.cantidad_base), 0) from public.stock_actual s
          join public.ubicacion u on u.id = s.ubicacion_id
         where s.producto_id = n.producto_id and u.sucursal_id = v_sucursal
           and u.excluye_disponible = false
      );
  if v_diferencias <> 0 then
    raise exception 'ENSAYO FALLÓ: % diferencias de saldo histórico o stock actual', v_diferencias;
  end if;

  select n.creado_en, n.id into v_cursor_fecha, v_cursor_id
    from public.obtener_historial_global(v_sucursal, null, null, 50) n
   order by n.creado_en, n.id limit 1;
  with nueva as materialized (
    select * from public.obtener_historial_global(v_sucursal, 'SALIDA', null, 50, v_cursor_fecha, v_cursor_id)
  ), esperada as (
    select k.id from public.kardex_transacciones k
      join public.ubicacion u on u.id = k.ubicacion_id
     where u.sucursal_id = v_sucursal and k.tipo_movimiento = 'SALIDA'
       and (k.creado_en, k.id) < (v_cursor_fecha, v_cursor_id)
     order by k.creado_en desc, k.id desc limit 50
  )
  select count(*) into v_diferencias from esperada e full join nueva n on n.id = e.id
   where e.id is null or n.id is null;
  if v_diferencias <> 0 then
    raise exception 'ENSAYO FALLÓ: % diferencias con cursor y tipo', v_diferencias;
  end if;

  execute format($sql$explain (analyze, buffers, format json)
    select v.* from public.v_kardex_movimientos v where v.id in (
      select k.id from public.kardex_transacciones k
        join public.ubicacion u on u.id = k.ubicacion_id
       where u.sucursal_id = %L order by k.creado_en desc, k.id desc limit 50
    )$sql$, v_sucursal) into v_plan_anterior;
  execute format('explain (analyze, buffers, format json) select * from public.obtener_historial_global(%L,null,null,50)', v_sucursal)
    into v_plan_nuevo;
  select count(*) into v_filas from public.obtener_historial_global(v_sucursal, null, null, 50);

  -- La excepción es el resultado esperado y aborta TODO el ensayo, incluida
  -- la función. Revisar las métricas; los tiempos varían por caché y entorno.
  raise exception 'ENSAYO OK: %', jsonb_build_object(
    'sucursal_id', v_sucursal, 'filas_primera_pagina', v_filas,
    'diferencias', v_diferencias, 'work_mem', current_setting('work_mem'),
    'anterior', jsonb_build_object('ms', v_plan_anterior->0->'Execution Time',
      'temp_read_blocks', v_plan_anterior->0->'Plan'->'Temp Read Blocks',
      'temp_written_blocks', v_plan_anterior->0->'Plan'->'Temp Written Blocks'),
    'nueva', jsonb_build_object('ms', v_plan_nuevo->0->'Execution Time',
      'temp_read_blocks', v_plan_nuevo->0->'Plan'->'Temp Read Blocks',
      'temp_written_blocks', v_plan_nuevo->0->'Plan'->'Temp Written Blocks')
  );
end;
$ensayo$;

rollback;
