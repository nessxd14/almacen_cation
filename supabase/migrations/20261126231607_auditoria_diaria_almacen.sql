-- Auditoría diaria móvil: agenda por sucursal, captura ciega y reconteo por Kardex.
-- Requiere 20261019152652_conteo_fisico_controlado y 20261021155549_reportes_turno_almacen.
-- Dependencias presentes en origin/main. Esta migración queda pendiente de ensayo en Supabase y aplicación.
create schema auditoria_almacen;
revoke all on schema auditoria_almacen from public, anon, authenticated;

create table auditoria_almacen.jornada (
  sucursal_id bigint not null references public.sucursal(id),
  fecha date not null,
  primary key (sucursal_id, fecha)
);

create table auditoria_almacen.item (
  id bigint generated always as identity primary key,
  sucursal_id bigint not null,
  fecha date not null,
  producto_id bigint not null references public.producto(id),
  ubicacion_id bigint not null references public.ubicacion(id),
  -- 1 arrastre, 2 movimiento, 3 cíclico. El origen inicial conserva el orden de la lista.
  origen smallint not null check (origen between 1 and 3),
  pendiente_desde date not null,
  captura_id uuid,
  foreign key (sucursal_id, fecha) references auditoria_almacen.jornada,
  unique (sucursal_id, fecha, producto_id, ubicacion_id)
);
create index auditoria_item_recorrido on auditoria_almacen.item (sucursal_id, fecha, origen, id);
create index auditoria_item_historial on auditoria_almacen.item (sucursal_id, producto_id, ubicacion_id, fecha desc);

create table auditoria_almacen.captura (
  id uuid primary key,
  item_id bigint not null references auditoria_almacen.item(id),
  usuario_id uuid not null references public.perfil(id),
  contado_en timestamptz not null,
  cantidad numeric not null check (cantidad >= 0 and cantidad < 1000000000000 and cantidad = round(cantidad, 4)),
  esperado numeric not null,
  version_movimiento bigint not null,
  unique (item_id, id)
);
alter table auditoria_almacen.item
  add foreign key (id, captura_id) references auditoria_almacen.captura(item_id, id);

create table auditoria_almacen.movimiento_dia (
  fecha date not null,
  ubicacion_id bigint not null,
  producto_id bigint not null,
  version bigint not null,
  primary key (fecha, ubicacion_id, producto_id)
);
alter table auditoria_almacen.jornada enable row level security;
alter table auditoria_almacen.item enable row level security;
alter table auditoria_almacen.captura enable row level security;
alter table auditoria_almacen.movimiento_dia enable row level security;
revoke all on all tables in schema auditoria_almacen from public, anon, authenticated;
revoke all on all sequences in schema auditoria_almacen from public, anon, authenticated;

-- La escritura se revierte junto con el Kardex. Un contador por par y día
-- detecta incluso movimientos de igual hora, movimientos netos cero y un ID
-- reservado por otra transacción antes de que se guardara el conteo.
create function auditoria_almacen.marcar_movimiento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into auditoria_almacen.movimiento_dia as m (fecha, ubicacion_id, producto_id, version)
  select (clock_timestamp() at time zone 'America/La_Paz')::date, new.ubicacion_id, new.producto_id, 1
  from public.ubicacion u where u.id = new.ubicacion_id and not u.excluye_disponible
  on conflict (fecha, ubicacion_id, producto_id) do update set version = m.version + 1;
  return new;
end;
$$;
revoke all on function auditoria_almacen.marcar_movimiento() from anon, public;
grant execute on function auditoria_almacen.marcar_movimiento() to authenticated, service_role;
create trigger auditoria_marcar_movimiento after insert on public.kardex_transacciones
for each row execute function auditoria_almacen.marcar_movimiento();

create view auditoria_almacen.estado with (security_invoker = true) as
select i.*, c.contado_en, c.cantidad, c.esperado,
  coalesce(m.version, 0) as version_movimiento,
  case
    when c.id is null then 'PENDIENTE'
    when c.version_movimiento <> coalesce(m.version, 0) then 'RECONTEO'
    when c.cantidad = c.esperado then 'VERIFICADO'
    else 'DIFERENCIA'
  end as estado
from auditoria_almacen.item i
left join auditoria_almacen.captura c on c.id = i.captura_id
left join auditoria_almacen.movimiento_dia m
  on m.fecha = i.fecha and m.ubicacion_id = i.ubicacion_id and m.producto_id = i.producto_id;
revoke all on auditoria_almacen.estado from public, anon, authenticated;

create function auditoria_almacen.operar(p_accion text, p_sucursal_id bigint, p_datos jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor public.perfil%rowtype;
  par auditoria_almacen.item%rowtype;
  previa auditoria_almacen.captura%rowtype;
  ahora timestamptz := clock_timestamp();
  dia date := (ahora at time zone 'America/La_Paz')::date;
  inicio timestamptz := dia::timestamp at time zone 'America/La_Paz';
  nueva boolean;
  item_id bigint := (p_datos->>'item_id')::bigint;
  cursor_id bigint := (p_datos->>'cursor')::bigint;
  cursor_origen smallint;
  solicitud uuid;
  cantidad_contada numeric;
  anterior uuid;
  saldo numeric;
  version_actual bigint;
  estadisticas jsonb;
  pagina jsonb;
  siguiente bigint;
  busqueda text := lower(btrim(coalesce(p_datos->>'busqueda', '')));
  filtro text := coalesce(p_datos->>'filtro', 'todos');
  filtro_producto bigint := (p_datos->>'producto_id')::bigint;
  filtro_ubicacion bigint := (p_datos->>'ubicacion_id')::bigint;
begin
  select * into actor from public.perfil where id = auth.uid() and activo;
  if not found or actor.rol not in ('admin','gerente','almacenero','operario') then
    raise exception 'Tu perfil no tiene acceso a Auditoría diaria.' using errcode = '42501';
  end if;
  if p_sucursal_id is null or (actor.sucursal_id is not null and actor.sucursal_id <> p_sucursal_id)
    or not exists (select 1 from public.sucursal where id = p_sucursal_id and tipo <> 'virtual' and activo) then
    raise exception 'Sucursal no disponible para tu perfil.' using errcode = '42501';
  end if;
  if p_accion is null or p_accion not in ('listar','detalle','contar') then
    raise exception 'Acción de auditoría no válida.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_datos) is distinct from 'object' then
    raise exception 'Datos de auditoría no válidos.' using errcode = '22023';
  end if;
  if char_length(busqueda) > 120 or filtro not in ('todos','abiertos','verificados','diferencias') then
    raise exception 'Filtro de auditoría no válido.' using errcode = '22023';
  end if;

  if p_accion = 'listar' and cursor_id is null then
    insert into auditoria_almacen.jornada values (p_sucursal_id, dia) on conflict do nothing;
    nueva := found;
    perform 1 from auditoria_almacen.jornada j
      where j.sucursal_id = p_sucursal_id and j.fecha = dia for update;

    insert into auditoria_almacen.item (sucursal_id, fecha, producto_id, ubicacion_id, origen, pendiente_desde)
    select p_sucursal_id, dia, e.producto_id, e.ubicacion_id, 1, e.pendiente_desde
    from auditoria_almacen.estado e join public.ubicacion u on u.id = e.ubicacion_id
    where e.sucursal_id = p_sucursal_id and e.estado <> 'VERIFICADO'
      and not u.excluye_disponible and u.sucursal_id = p_sucursal_id
      and e.fecha = (select max(j.fecha) from auditoria_almacen.jornada j where j.sucursal_id = p_sucursal_id and j.fecha < dia)
    order by e.pendiente_desde, e.id
    on conflict do nothing;

    insert into auditoria_almacen.item (sucursal_id, fecha, producto_id, ubicacion_id, origen, pendiente_desde)
    select p_sucursal_id, dia, m.producto_id, m.ubicacion_id, 2, dia
    from (
      select k.producto_id, k.ubicacion_id from public.kardex_transacciones k where k.creado_en >= inicio and k.creado_en < ahora
      union
      select v.producto_id, v.ubicacion_id from auditoria_almacen.movimiento_dia v where v.fecha = dia
    ) m join public.ubicacion u on u.id = m.ubicacion_id
    where u.sucursal_id = p_sucursal_id and not u.excluye_disponible
    order by m.ubicacion_id, m.producto_id
    on conflict do nothing;

    if nueva then
      insert into auditoria_almacen.item (sucursal_id, fecha, producto_id, ubicacion_id, origen, pendiente_desde)
      select p_sucursal_id, dia, c.producto_id, c.ubicacion_id, 3, dia
      from reportes_almacen.candidatos(p_sucursal_id, inicio, ahora) c
      left join lateral (
        select e.contado_en from auditoria_almacen.estado e
        where e.sucursal_id = p_sucursal_id and e.producto_id = c.producto_id and e.ubicacion_id = c.ubicacion_id
          and e.fecha < dia and e.estado = 'VERIFICADO'
        order by e.fecha desc limit 1
      ) ult on true
      where not exists (
        select 1 from auditoria_almacen.item i where i.sucursal_id = p_sucursal_id and i.fecha = dia
          and i.producto_id = c.producto_id and i.ubicacion_id = c.ubicacion_id
      ) and coalesce(greatest(c.ultimo_conteo, ult.contado_en), '-infinity'::timestamptz) <= ahora - make_interval(days => c.frecuencia_dias)
      order by greatest(c.ultimo_conteo, ult.contado_en) asc nulls first, c.ubicacion_id, c.producto_id
      limit 10
      on conflict do nothing;
    end if;
  end if;

  if p_accion in ('detalle','contar') then
    select i.* into par from auditoria_almacen.item i join public.ubicacion u on u.id = i.ubicacion_id
      where i.id = item_id and i.sucursal_id = p_sucursal_id and i.fecha = dia
        and u.sucursal_id = p_sucursal_id and not u.excluye_disponible;
    if not found then
      raise exception 'El ítem no está en la jornada actual. Actualiza la lista.' using errcode = '22023';
    end if;
  end if;

  if p_accion = 'contar' then
    solicitud := (p_datos->>'solicitud')::uuid;
    cantidad_contada := (p_datos->>'cantidad')::numeric;
    anterior := (p_datos->>'captura_id')::uuid;
    if solicitud is null or cantidad_contada is null or not (cantidad_contada >= 0 and cantidad_contada < 1000000000000 and cantidad_contada = round(cantidad_contada, 4))
      or p_datos->>'version_movimiento' is null then
      raise exception 'Ingresa una cantidad válida, con hasta cuatro decimales.' using errcode = '22023';
    end if;

    -- Comparte el candado de ubicación con conteo_proteger_kardex. Se suelta
    -- al confirmar la captura. No inmoviliza la ubicación durante el recorrido.
    perform 1 from public.ubicacion u where u.id = par.ubicacion_id and u.sucursal_id = p_sucursal_id and not u.excluye_disponible for update;
    if not found then
      raise exception 'La ubicación ya no está disponible.' using errcode = '42501';
    end if;
    select * into par from auditoria_almacen.item i where i.id = item_id for update;
    ahora := clock_timestamp();
    if (ahora at time zone 'America/La_Paz')::date <> dia then
      raise exception 'Comenzó otra jornada. Actualiza la lista y vuelve a contar.' using errcode = '40001';
    end if;

    select * into previa from auditoria_almacen.captura c where c.id = solicitud;
    if found then
      if previa.item_id <> par.id or previa.usuario_id <> actor.id or previa.cantidad <> cantidad_contada then
        raise exception 'La solicitud ya se usó para otra captura.' using errcode = '22023';
      end if;
    else
      select coalesce((select m.version from auditoria_almacen.movimiento_dia m
        where m.fecha = dia and m.ubicacion_id = par.ubicacion_id and m.producto_id = par.producto_id), 0) into version_actual;
      if par.captura_id is distinct from anterior
        or version_actual <> (p_datos->>'version_movimiento')::bigint then
        raise exception 'El ítem cambió mientras contabas. Actualiza y vuelve a contar.' using errcode = '40001';
      end if;
      if exists (select 1 from auditoria_almacen.captura c where c.id = par.captura_id
        and c.version_movimiento = version_actual and c.cantidad = c.esperado) then
        raise exception 'Este ítem ya está verificado.' using errcode = '22023';
      end if;
      select coalesce((select s.cantidad_base from public.stock_actual s
        where s.producto_id = par.producto_id and s.ubicacion_id = par.ubicacion_id), 0) into saldo;
      insert into auditoria_almacen.captura (id, item_id, usuario_id, contado_en, cantidad, esperado, version_movimiento)
      values (solicitud, par.id, actor.id, ahora, cantidad_contada, saldo, version_actual);
      update auditoria_almacen.item set captura_id = solicitud where id = par.id;
    end if;
  end if;

  if cursor_id is not null then
    select i.origen into cursor_origen from auditoria_almacen.item i
      where i.id = cursor_id and i.sucursal_id = p_sucursal_id and i.fecha = dia;
    if not found then
      raise exception 'La lista cambió. Actualiza para cargar la jornada vigente.' using errcode = '40001';
    end if;
  end if;

  select jsonb_build_object('total', count(*),
    'arrastrados', count(*) filter (where e.origen = 1),
    'movimientos', count(*) filter (where e.origen = 2),
    'ciclicos', count(*) filter (where e.origen = 3),
    'verificados', count(*) filter (where e.estado = 'VERIFICADO'),
    'reconteos', count(*) filter (where e.estado = 'RECONTEO'),
    'diferencias', count(*) filter (where e.estado = 'DIFERENCIA'))
  into estadisticas from auditoria_almacen.estado e join public.ubicacion u on u.id = e.ubicacion_id
  where e.sucursal_id = p_sucursal_id and e.fecha = dia and u.sucursal_id = p_sucursal_id and not u.excluye_disponible;

  with hoja as (
    select e.id, e.origen, e.producto_id, e.ubicacion_id, e.pendiente_desde, e.estado,
      e.captura_id, e.contado_en, e.cantidad, e.esperado, e.version_movimiento::text as version_movimiento,
      p.nombre, p.sku_interno as sku, p.unidad_base, p.imagen_url,
      coalesce(pr.factor_unidad_base, 1) as factor, pr.nombre as presentacion,
      concat_ws(' / ', u.codigo_zona, nullif(concat_ws(' ',u.estante,u.nivel),''),u.compartimiento) as ubicacion
    from auditoria_almacen.estado e
    join public.producto p on p.id = e.producto_id
    join public.ubicacion u on u.id = e.ubicacion_id
    left join lateral (
      select x.nombre, x.factor_unidad_base from public.presentacion x
      where x.producto_id = p.id and x.activo and x.factor_unidad_base > 1
      order by x.factor_unidad_base desc, x.id limit 1
    ) pr on true
    where e.sucursal_id = p_sucursal_id and e.fecha = dia and u.sucursal_id = p_sucursal_id and not u.excluye_disponible
      and (case when p_accion = 'listar' then
        (cursor_id is null or (e.origen,e.id) > (cursor_origen,cursor_id))
        and (filtro_producto is null or e.producto_id = filtro_producto)
        and (filtro_ubicacion is null or e.ubicacion_id = filtro_ubicacion)
        and (busqueda = '' or strpos(lower(concat_ws(' ', p.sku_interno, p.nombre, u.codigo_zona, u.estante, u.nivel, u.compartimiento)), busqueda) > 0)
        and (filtro = 'todos' or (filtro = 'abiertos' and e.estado <> 'VERIFICADO')
          or (filtro = 'verificados' and e.estado = 'VERIFICADO') or (filtro = 'diferencias' and e.estado = 'DIFERENCIA'))
        else e.id = par.id end)
    order by e.origen, e.id limit 51
  ), numerada as (
    select h.*, row_number() over (order by h.origen,h.id) as numero from hoja h
  )
  select coalesce(jsonb_agg(to_jsonb(n) - 'numero' order by n.numero) filter (where n.numero <= 50), '[]'::jsonb),
    case when count(*) > 50 then max(n.id) filter (where n.numero = 50) end
  into pagina, siguiente from numerada n;

  return jsonb_build_object('fecha', dia, 'resumen', estadisticas, 'items', pagina, 'siguiente', siguiente);
end;
$$;
revoke all on function auditoria_almacen.operar(text,bigint,jsonb) from anon, public;
grant usage on schema auditoria_almacen to authenticated, service_role;
grant execute on function auditoria_almacen.operar(text,bigint,jsonb) to authenticated, service_role;

create function public.operar_auditoria_almacen(p_accion text, p_sucursal_id bigint, p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path = '' as $$
  select auditoria_almacen.operar(p_accion, p_sucursal_id, p_datos)
$$;
revoke all on function public.operar_auditoria_almacen(text,bigint,jsonb) from anon, public;
grant execute on function public.operar_auditoria_almacen(text,bigint,jsonb) to authenticated, service_role;
