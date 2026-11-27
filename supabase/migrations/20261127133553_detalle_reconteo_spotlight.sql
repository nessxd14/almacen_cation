-- Conserva el movimiento que avanzó la versión del Kardex para cada ubicación y producto.
alter table auditoria_almacen.movimiento_dia
  add column ultimo_movimiento_en timestamptz,
  add column ultimo_tipo_movimiento text,
  add column ultima_cantidad numeric;

create or replace function auditoria_almacen.marcar_movimiento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  registrado_en timestamptz := clock_timestamp();
begin
  insert into auditoria_almacen.movimiento_dia as m
    (fecha, ubicacion_id, producto_id, version, ultimo_movimiento_en, ultimo_tipo_movimiento, ultima_cantidad)
  select (registrado_en at time zone 'America/La_Paz')::date, new.ubicacion_id, new.producto_id, 1,
    registrado_en, new.tipo_movimiento::text, new.cantidad
  from public.ubicacion u
  where u.id = new.ubicacion_id and not u.excluye_disponible
  on conflict (fecha, ubicacion_id, producto_id) do update
  set version = m.version + 1,
    ultimo_movimiento_en = excluded.ultimo_movimiento_en,
    ultimo_tipo_movimiento = excluded.ultimo_tipo_movimiento,
    ultima_cantidad = excluded.ultima_cantidad;
  return new;
end;
$$;

-- La lista existente valida el perfil y la sucursal antes de consultar los movimientos.
-- Se enriquece solo la página autorizada y únicamente los reconteos de la versión leída.
create function auditoria_almacen.listar_spotlight(p_sucursal_id bigint, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  jornada jsonb := auditoria_almacen.operar('listar', p_sucursal_id, p_datos);
  items jsonb;
begin
  select coalesce(jsonb_agg(
    case when m.ultimo_movimiento_en is null then e.item
      else e.item || jsonb_build_object('ultimo_movimiento', jsonb_build_object(
        'tipo', m.ultimo_tipo_movimiento, 'cantidad', m.ultima_cantidad, 'registrado_en', m.ultimo_movimiento_en))
    end order by e.orden), '[]'::jsonb)
  into items
  from jsonb_array_elements(jornada->'items') with ordinality e(item, orden)
  left join auditoria_almacen.movimiento_dia m on e.item->>'estado' = 'RECONTEO'
    and m.fecha = (jornada->>'fecha')::date
    and m.ubicacion_id = (e.item->>'ubicacion_id')::bigint
    and m.producto_id = (e.item->>'producto_id')::bigint
    and m.version = (e.item->>'version_movimiento')::bigint;

  return jsonb_set(jornada, '{items}', items);
end;
$$;
revoke all on function auditoria_almacen.listar_spotlight(bigint,jsonb) from public, anon;
grant execute on function auditoria_almacen.listar_spotlight(bigint,jsonb) to authenticated, service_role;

create or replace function public.operar_auditoria_almacen(
  p_accion text, p_sucursal_id bigint, p_datos jsonb default '{}'
) returns jsonb
language sql security invoker set search_path = '' as $$
  select case when p_accion = 'listar' and p_datos->>'filtro' = 'abiertos'
    and p_datos->'incluir_movimiento' = 'true'::jsonb
    then auditoria_almacen.listar_spotlight(p_sucursal_id, p_datos)
    else auditoria_almacen.operar(p_accion, p_sucursal_id, p_datos)
  end
$$;
