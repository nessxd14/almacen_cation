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
