-- Preparación de VTD y solicitudes de traslado virtual.
-- Las declaraciones/checklists no escriben stock; la entrega usa el Kardex existente.
create table public.almacen_documento_movil (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('VTD','TRASLADO_VIRTUAL')),
  venta_id bigint unique references public.venta(id),
  sucursal_origen_id bigint not null references public.sucursal(id),
  sucursal_destino_id bigint references public.sucursal(id),
  traslado_id bigint unique references public.solicitud_traslado(id),
  estado text not null check (estado in ('BORRADOR','PREPARANDO','PREPARADO','REVISANDO','VERIFICADO','DESPACHADO','EN_TRANSITO','RECIBIDO','ANULADO')),
  version integer not null default 1 check (version>0),
  preparador_id uuid not null,
  preparador_nombre text not null,
  revisor_id uuid,
  revisor_nombre text,
  snapshot_cabecera jsonb not null default '{}'::jsonb,
  observacion text not null default '' check (length(observacion)<=1000),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  preparado_en timestamptz,
  verificado_en timestamptz,
  entregado_en timestamptz,
  check ((tipo='VTD' and venta_id is not null and sucursal_destino_id is null) or
    (tipo='TRASLADO_VIRTUAL' and venta_id is null and sucursal_destino_id is not null and sucursal_origen_id<>sucursal_destino_id))
);
create index documento_movil_origen_idx on public.almacen_documento_movil(sucursal_origen_id,actualizado_en desc);
create index documento_movil_destino_idx on public.almacen_documento_movil(sucursal_destino_id,estado);
create index documento_movil_preparador_idx on public.almacen_documento_movil(preparador_id,actualizado_en desc);
create unique index documento_movil_borrador_idx on public.almacen_documento_movil(preparador_id,sucursal_origen_id,sucursal_destino_id)
  where tipo='TRASLADO_VIRTUAL' and estado='BORRADOR';

create table public.almacen_documento_linea (
  id bigint generated always as identity primary key,
  documento_id bigint not null references public.almacen_documento_movil(id),
  venta_linea_id bigint,
  producto_id bigint references public.producto(id),
  presentacion_id bigint references public.presentacion(id),
  ubicacion_origen_id bigint references public.ubicacion(id),
  snapshot jsonb not null,
  vigente boolean not null default true,
  declarada_base numeric not null check (declarada_base>0 and declarada_base<=1e12 and declarada_base<>'NaN'::numeric),
  preparada_base numeric not null default 0 check (preparada_base>=0 and preparada_base<=declarada_base and preparada_base<>'NaN'::numeric),
  confirmada boolean not null default false,
  observacion text not null default '' check(length(observacion)<=1000),
  revisada_base numeric,
  metodo_revision text check (metodo_revision in ('visual','escaneo')),
  codigo_leido text check (length(codigo_leido)<=2048),
  revisor_id uuid,
  revisor_nombre text,
  revisada_en timestamptz,
  check (revisada_base is null or revisada_base=preparada_base),
  unique(documento_id,venta_linea_id)
);
create index documento_linea_producto_idx on public.almacen_documento_linea(producto_id);
create index documento_linea_presentacion_idx on public.almacen_documento_linea(presentacion_id);
create index documento_linea_ubicacion_idx on public.almacen_documento_linea(ubicacion_origen_id);
create unique index documento_linea_carrito_idx on public.almacen_documento_linea(documento_id,producto_id,presentacion_id,ubicacion_origen_id)
  where venta_linea_id is null;

create table public.almacen_documento_evento (
  id bigint generated always as identity primary key,
  documento_id bigint not null references public.almacen_documento_movil(id),
  accion text not null,
  actor_id uuid not null,
  actor_nombre text not null,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
create index documento_evento_documento_idx on public.almacen_documento_evento(documento_id,id desc);
alter table public.almacen_documento_movil enable row level security;
alter table public.almacen_documento_linea enable row level security;
alter table public.almacen_documento_evento enable row level security;
revoke all on public.almacen_documento_movil,public.almacen_documento_linea,public.almacen_documento_evento from public,anon,authenticated;
grant select on public.almacen_documento_movil,public.almacen_documento_linea,public.almacen_documento_evento to authenticated;
create policy documento_movil_lectura on public.almacen_documento_movil for select to authenticated using (
  exists(select 1 from public.perfil p where p.id=(select auth.uid()) and p.activo
    and p.rol in ('admin','gerente','almacenero','operario','vendedor','cajero')
    and (p.id=preparador_id
      or (p.rol in ('admin','gerente') and (p.sucursal_id is null or p.sucursal_id=sucursal_origen_id))
      or (estado<>'BORRADOR' and p.rol in ('almacenero','operario') and (p.sucursal_id is null or p.sucursal_id=sucursal_origen_id))
      or (estado in ('EN_TRANSITO','RECIBIDO') and p.sucursal_id=sucursal_destino_id)))
);
create policy documento_linea_lectura on public.almacen_documento_linea for select to authenticated using (
  exists(select 1 from public.almacen_documento_movil d where d.id=documento_id)
);
create policy documento_evento_lectura on public.almacen_documento_evento for select to authenticated using (
  exists(select 1 from public.almacen_documento_movil d where d.id=documento_id)
);

create function almacen_operaciones.lineas_vtd(p_venta_id bigint)
returns table(linea_id bigint,datos jsonb) language sql stable security invoker set search_path='' as $$
  select l.id,jsonb_build_object('id',l.id,'producto_id',l.producto_id,'nombre',coalesce(p.nombre,l.descripcion),
    'sku',p.sku_interno,'unidad_base',coalesce(p.unidad_base,l.unidad_medida,'unidad'),
    'presentacion_id',l.presentacion_id,'presentacion',pr.nombre,'factor',coalesce(pr.factor_unidad_base,1),
    'producto_activo',coalesce(p.activo,false),'presentacion_activa',coalesce(pr.activo,true),
    'es_personalizado',l.es_personalizado,'cantidad_base',l.cantidad,'pendiente_base',l.cantidad,
    'cantidad_presentacion',l.cantidad_presentacion,'precio_unitario',l.precio_unitario,
    'descripcion',l.descripcion,'preparable',not l.es_personalizado and p.activo and coalesce(pr.activo,true)
      and coalesce(pr.factor_unidad_base,1)>0 and (pr.id is null or pr.producto_id=l.producto_id))
  from public.venta_linea l left join public.producto p on p.id=l.producto_id
  left join public.presentacion pr on pr.id=l.presentacion_id where l.venta_id=p_venta_id order by l.id;
$$;

create function almacen_operaciones.validar_codigo(p_codigo text,p_producto bigint,p_presentacion bigint,p_sucursal bigint)
returns void language plpgsql security invoker set search_path='' as $$
declare v_producto bigint;v_pres bigint;v_n int;v_codigo text:=btrim(coalesce(p_codigo,''));
begin
  if v_codigo='' or length(v_codigo)>2048 then raise exception 'Escanea o ingresa el código del producto.'; end if;
  if v_codigo ~ '^https?://[^/?#]+/productos/[1-9][0-9]*/ficha/?([?#]|$)' or v_codigo ~ '^/productos/[1-9][0-9]*/ficha/?([?#]|$)' then
    v_producto:=(substring(v_codigo from '/productos/([1-9][0-9]*)/ficha'))::bigint;
    if v_codigo ~ '[?&]sucursal=' then
      if v_codigo !~ '[?&]sucursal=[1-9][0-9]*(&|#|$)' or
        (substring(v_codigo from '[?&]sucursal=([1-9][0-9]*)'))::bigint<>p_sucursal then
        raise exception 'La etiqueta pertenece a otra sucursal.';
      end if;
    end if;
    if v_codigo ~ '[?&]presentacion=' then
      if v_codigo !~ '[?&]presentacion=[1-9][0-9]*(&|#|$)' then raise exception 'Presentación de QR inválida.'; end if;
      v_pres:=(substring(v_codigo from '[?&]presentacion=([1-9][0-9]*)'))::bigint;
      if not exists(select 1 from public.presentacion where id=v_pres and producto_id=v_producto and activo) then
        raise exception 'La presentación del QR ya no está disponible.';
      end if;
    end if;
  else
    select count(*),min(pr.producto_id),min(pr.id) into v_n,v_producto,v_pres from public.identificador i
      join public.presentacion pr on pr.id=i.presentacion_id where i.valor=v_codigo and i.activo and pr.activo;
    if v_n<>1 then raise exception 'Código desconocido o ambiguo. Usa el QR de la ficha.'; end if;
  end if;
  if v_producto is distinct from p_producto then raise exception 'El código corresponde a otro producto.'; end if;
  if v_pres is not null and p_presentacion is not null and v_pres<>p_presentacion then
    raise exception 'El código corresponde a otra presentación. Comprueba el empaque.';
  end if;
  if v_pres is not null and p_presentacion is null and not exists(select 1 from public.presentacion where id=v_pres and factor_unidad_base=1) then
    raise exception 'Esta línea se controla en unidades base. Usa su etiqueta de unidad.';
  end if;
end;
$$;

-- Los helpers heredados utilizan nombres de tablas sin esquema. El contexto
-- de invocación fija public antes de pg_temp; estos puentes NO son APIs públicas.
create function almacen_operaciones.entregar_vtd(p_venta bigint,p_actor text)
returns jsonb language sql security invoker set search_path=pg_catalog,public,pg_temp as $$
  select public.completar_venta(p_venta,p_actor);
$$;

create function almacen_operaciones.entregar_carrito(p_documento bigint,p_actor text)
returns bigint language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare d public.almacen_documento_movil%rowtype;v_dest bigint;v_sol bigint;v_json jsonb;l record;k record;v_base bigint;
begin
  select * into d from public.almacen_documento_movil where id=p_documento;
  v_dest:=public.ubicacion_recepcion(d.sucursal_destino_id);
  if v_dest is null then raise exception 'Tienda necesita una ubicación de recepción.'; end if;
  -- Todos los locks se adquieren en el mismo orden que el motor de Kardex.
  for k in select distinct producto_id,ubicacion_id from (
    select producto_id,ubicacion_origen_id as ubicacion_id from public.almacen_documento_linea where documento_id=d.id and vigente
    union all select producto_id,v_dest from public.almacen_documento_linea where documento_id=d.id and vigente
  ) q order by producto_id,ubicacion_id loop
    perform pg_advisory_xact_lock(hashtextextended(k.producto_id::text||':'||k.ubicacion_id::text,0));
  end loop;
  for k in select producto_id,ubicacion_origen_id,sum(declarada_base) as cantidad from public.almacen_documento_linea
    where documento_id=d.id and vigente group by producto_id,ubicacion_origen_id loop
    if coalesce((select cantidad_base from public.stock_actual where producto_id=k.producto_id and ubicacion_id=k.ubicacion_origen_id),0)<k.cantidad then
      raise exception 'Stock insuficiente en la ubicación declarada. Corrige el alistado antes de autorizar.';
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('producto_id',producto_id,'presentacion_id',presentacion_id,
    'cantidad_presentacion',declarada_base/(snapshot->>'factor')::numeric,
    'cantidad_base',declarada_base,'nota','Alistado desde '||(snapshot->>'ubicacion')) order by id)
    into v_json from public.almacen_documento_linea where documento_id=d.id and vigente;
  v_sol:=public.crear_solicitud_traslado('REPOSICION',v_json,d.preparador_nombre,
    d.sucursal_origen_id,d.sucursal_destino_id,'Traslado virtual #'||d.id,d.observacion);
  -- Cada línea de la solicitud corresponde al orden del carrito enviado.
  for l in select c.*,s.id as traslado_linea_id from
    (select c.*,row_number() over(order by c.id) as posicion from public.almacen_documento_linea c where documento_id=d.id and vigente) c
    join (select s.*,row_number() over(order by s.id) as posicion from public.solicitud_traslado_linea s where solicitud_id=v_sol) s using(posicion)
    order by c.producto_id,c.ubicacion_origen_id,c.id loop
    select id into v_base from public.presentacion where producto_id=l.producto_id and es_base and activo and factor_unidad_base=1 order by id limit 1;
    if v_base is null then raise exception 'El producto necesita una presentación base activa de factor 1.'; end if;
    perform public.registrar_traslado(v_base,l.ubicacion_origen_id,v_dest,l.declarada_base,
      'Traslado #'||v_sol||' · virtual #'||d.id,p_actor,(now() at time zone 'America/La_Paz')::date);
    update public.solicitud_traslado_linea set cantidad_despachada=l.declarada_base,estado='DESPACHADA' where id=l.traslado_linea_id;
  end loop;
  update public.solicitud_traslado set estado='EN_TRANSITO',despachado_por=p_actor,despachado_en=now(),
    reversible_hasta=now()+interval '30 minutes',ubicacion_destino_id=v_dest where id=v_sol;
  return v_sol;
end;
$$;

create function almacen_operaciones.recibir_carrito(p_traslado bigint,p_actor text,p_lineas jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,pg_temp as $$
declare v_dest bigint;k record;
begin
  select coalesce(ubicacion_destino_id,public.ubicacion_recepcion(sucursal_destino_id)) into v_dest from public.solicitud_traslado where id=p_traslado for update;
  for k in select distinct producto_id from public.solicitud_traslado_linea where solicitud_id=p_traslado and estado='DESPACHADA' order by producto_id loop
    perform pg_advisory_xact_lock(hashtextextended(k.producto_id::text||':'||v_dest::text,0));
  end loop;
  return public.recibir_traslado(p_traslado,p_actor,p_lineas);
end;
$$;

create function almacen_operaciones.documento_datos(p_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.almacen_documento_movil%rowtype;v public.venta%rowtype;
  cab jsonb;ls jsonb;ev jsonb;cambios jsonb:='[]';actual jsonb;entregada boolean:=false;rec jsonb:='[]';estado_traslado text;
begin
  select * into d from public.almacen_documento_movil where id=p_id;
  if d.tipo='VTD' then
    select * into v from public.venta where id=d.venta_id;
    entregada:=v.estado='COMPLETADA';
    cab:=jsonb_build_object('id',v.id,'numero',coalesce(v.numero,'#'||v.id),'estado',case when v.estado='ABIERTA' then 'ABIERTO' when v.estado='ANULADA' then 'CANCELADO' else 'COMPLETADO' end,
      'tipo','vtd','cliente',(select nombre from public.cliente where id=v.cliente_id),'referencia',v.notas,
      'sucursal_origen_id',d.sucursal_origen_id,'pago',case when exists(select 1 from public.venta_pago where venta_id=v.id) then 'PAGADO' when v.pago_posterior then 'PAGO POSTERIOR AUTORIZADO' when not v.cobro_exigible then 'TICKET HISTÓRICO · COBRO NO EXIGIBLE' else 'POR COBRAR' end);
    actual:=jsonb_build_object('cliente_id',v.cliente_id,'ubicacion_id',v.ubicacion_id,'total',v.total,'descuento_total',v.descuento_total);
    select coalesce(jsonb_agg(x.id),'[]') into cambios from (
      select coalesce(a.linea_id,l.venta_linea_id) as id from almacen_operaciones.lineas_vtd(v.id) a
      full join (select * from public.almacen_documento_linea where documento_id=d.id and vigente) l on a.linea_id=l.venta_linea_id
      where a.datos is distinct from l.snapshot or actual is distinct from d.snapshot_cabecera
    ) x;
  else
    select estado::text into estado_traslado from public.solicitud_traslado where id=d.traslado_id;
    if d.estado='EN_TRANSITO' and estado_traslado='RECIBIDO' then d.estado:='RECIBIDO'; end if;
    if d.estado='EN_TRANSITO' and estado_traslado in ('CANCELADO','RECHAZADO') then d.estado:='ANULADO'; end if;
    entregada:=d.estado in ('EN_TRANSITO','RECIBIDO');
    cab:=jsonb_build_object('id',d.id,'numero','TV-'||d.id,'estado',case when d.estado='ANULADO' then 'CANCELADO' when entregada then 'COMPLETADO' else 'ABIERTO' end,
      'tipo','traslado_virtual','cliente','Destino: '||(select nombre from public.sucursal where id=d.sucursal_destino_id),
      'sucursal_origen_id',d.sucursal_origen_id,'sucursal_destino_id',d.sucursal_destino_id,'referencia',d.observacion,
      'traslado_id',d.traslado_id,'traslado_estado',(select estado from public.solicitud_traslado where id=d.traslado_id));
    select coalesce(jsonb_agg(l.id),'[]') into cambios from public.almacen_documento_linea l
      left join public.producto p on p.id=l.producto_id left join public.presentacion pr on pr.id=l.presentacion_id
      left join public.ubicacion u on u.id=l.ubicacion_origen_id
      where l.documento_id=d.id and l.vigente and (not coalesce(p.activo,false) or not coalesce(pr.activo,false)
        or p.unidad_base is distinct from l.snapshot->>'unidad_base' or pr.producto_id<>l.producto_id or pr.factor_unidad_base is distinct from (l.snapshot->>'factor')::numeric
        or u.sucursal_id is distinct from d.sucursal_origen_id or coalesce(u.excluye_disponible,true));
    if d.traslado_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'nombre',p.nombre,'cantidad_base',l.cantidad_despachada,'cantidad_recibida',l.cantidad_recibida,'unidad_base',p.unidad_base) order by l.id),'[]')
        into rec from public.solicitud_traslado_linea l join public.producto p on p.id=l.producto_id where solicitud_id=d.traslado_id and estado='DESPACHADA';
    end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') into ls from public.almacen_documento_linea l where documento_id=d.id;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]') into ev from
    (select * from public.almacen_documento_evento where documento_id=d.id order by id desc limit 100) e;
  return jsonb_build_object('documento',cab,'tarea',to_jsonb(d),'lineas',ls,'eventos',ev,'cambios',cambios,'entregada',entregada,'recepcion',rec);
end;
$$;

create function almacen_operaciones.operar_documento(p_tipo text,p_id bigint,p_accion text,p_version integer,p_datos jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.perfil%rowtype;d public.almacen_documento_movil%rowtype;v public.venta%rowtype;
  l public.almacen_documento_linea%rowtype;pr public.presentacion%rowtype;prod public.producto%rowtype;ub public.ubicacion%rowtype;
  v_origen bigint;v_destino bigint;v_producto bigint;v_pres bigint;v_ubic bigint;v_linea bigint;
  v_cantidad numeric;v_total numeric;v_factor numeric;v_obs text;v_codigo text;v_n integer;
  es_almacen boolean;es_admin boolean;es_dueno boolean;es_receptor boolean;es_auto boolean:=p_accion='escanear';
  info jsonb;cab jsonb;v_lineas jsonb;v_stock jsonb;v_lista jsonb;v_resultado jsonb;v_cambio boolean;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if actor.id is null or actor.rol not in ('admin','gerente','almacenero','operario','vendedor','cajero') then
    raise exception 'Tu perfil no tiene acceso a estas operaciones.' using errcode='42501';
  end if;
  if p_accion is null or p_accion not in ('contexto','listar','producto','resolver_vtd','crear','consultar','escanear','agregar','editar','quitar','enviar','guardar_preparacion','preparado','tomar_revision','guardar_revision','verificado','sincronizar','devolver','reabrir','anular','autorizar','recibir') then
    raise exception 'Operación no válida.';
  end if;
  if p_accion='contexto' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'nombre',nombre) order by id),'[]') into v_lista from public.sucursal where activo and tipo='fisica';
    return jsonb_build_object('sucursales',v_lista,'sucursal_asignada_id',actor.sucursal_id,'rol',actor.rol);
  end if;
  if p_accion='listar' then
    select coalesce(jsonb_agg(to_jsonb(x) order by actualizado_en desc),'[]') into v_lista from (
      select doc.id,lower(doc.tipo) as tipo,doc.venta_id,doc.sucursal_origen_id,doc.sucursal_destino_id,doc.preparador_id,doc.preparador_nombre,doc.revisor_id,doc.revisor_nombre,case when doc.estado='EN_TRANSITO' and st.estado::text='RECIBIDO' then 'RECIBIDO' when doc.estado='EN_TRANSITO' and st.estado::text in ('CANCELADO','RECHAZADO') then 'ANULADO' else doc.estado end as estado,doc.actualizado_en,
        case when doc.tipo='VTD' then doc.venta_id else doc.id end as documento_id,
        case when doc.tipo='VTD' then coalesce(vent.numero,'#'||doc.venta_id) else 'TV-'||doc.id end as numero,coalesce(c.nombre,s.nombre) as cliente
      from public.almacen_documento_movil doc left join public.venta vent on vent.id=doc.venta_id
        left join public.cliente c on c.id=vent.cliente_id left join public.sucursal s on s.id=doc.sucursal_destino_id left join public.solicitud_traslado st on st.id=doc.traslado_id
      where (doc.preparador_id=actor.id
        or (actor.rol in ('admin','gerente','almacenero','operario') and (actor.sucursal_id is null or actor.sucursal_id=doc.sucursal_origen_id) and (doc.estado<>'BORRADOR' or actor.rol in ('admin','gerente')))
        or (actor.sucursal_id=doc.sucursal_destino_id and doc.estado in ('EN_TRANSITO','RECIBIDO')))
        and (actor.rol in ('vendedor','cajero') or p_datos->>'sucursal_id' is null or doc.sucursal_origen_id=(p_datos->>'sucursal_id')::bigint or doc.preparador_id=actor.id or (doc.sucursal_destino_id=(p_datos->>'sucursal_id')::bigint and doc.estado in ('EN_TRANSITO','RECIBIDO')))
      order by doc.actualizado_en desc limit 100
    ) x;
    return jsonb_build_object('documentos',v_lista);
  end if;
  if p_accion='producto' then
    v_origen:=(p_datos->>'sucursal_id')::bigint;
    if not exists(select 1 from public.sucursal where id=v_origen and activo and tipo='fisica') then raise exception 'Elige una sucursal física de origen.'; end if;
    if actor.rol in ('almacenero','operario') and actor.sucursal_id is not null and actor.sucursal_id<>v_origen then
      raise exception 'El origen no corresponde a tu sucursal.' using errcode='42501';
    end if;
    v_codigo:=btrim(coalesce(p_datos->>'codigo',''));
    if v_codigo<>'' then
      if length(v_codigo)>2048 then raise exception 'Código demasiado largo.'; end if;
      if v_codigo ~ '^https?://[^/?#]+/productos/[1-9][0-9]*/ficha/?([?#]|$)' or v_codigo ~ '^/productos/[1-9][0-9]*/ficha/?([?#]|$)' then
        v_producto:=(substring(v_codigo from '/productos/([1-9][0-9]*)/ficha'))::bigint;
        if v_codigo ~ '[?&]presentacion=[1-9][0-9]*(&|#|$)' then v_pres:=(substring(v_codigo from '[?&]presentacion=([1-9][0-9]*)'))::bigint; end if;
        perform almacen_operaciones.validar_codigo(v_codigo,v_producto,v_pres,v_origen);
      else
        select count(*),min(ip.producto_id),min(ip.id) into v_n,v_producto,v_pres from public.identificador i
          join public.presentacion ip on ip.id=i.presentacion_id where i.valor=v_codigo and i.activo and ip.activo;
        if v_n<>1 then raise exception 'Código desconocido o ambiguo. Usa el QR del producto.'; end if;
      end if;
    else
      v_producto:=(p_datos->>'producto_id')::bigint;v_pres:=(p_datos->>'presentacion_id')::bigint;
    end if;
    select * into prod from public.producto where id=v_producto and activo;
    if not found then raise exception 'El producto ya no está disponible.'; end if;
    if v_pres is not null and not exists(select 1 from public.presentacion where id=v_pres and producto_id=v_producto and activo) then raise exception 'Presentación no disponible.'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'factor',factor_unidad_base,'es_base',es_base) order by es_base desc,id),'[]')
      into v_lineas from public.presentacion where producto_id=v_producto and activo and factor_unidad_base>0;
    select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'nombre',concat_ws(' · ',u.codigo_zona,u.estante,u.nivel,u.compartimiento),'cantidad_base',sa.cantidad_base) order by u.id),'[]')
      into v_stock from public.ubicacion u left join public.stock_actual sa on sa.ubicacion_id=u.id and sa.producto_id=v_producto
      where u.sucursal_id=v_origen and not u.excluye_disponible and (sa.producto_id is not null or exists(select 1 from public.producto_ubicacion pu where pu.producto_id=v_producto and pu.ubicacion_id=u.id));
    return jsonb_build_object('producto',jsonb_build_object('id',prod.id,'nombre',prod.nombre,'sku',prod.sku_interno,'unidad_base',prod.unidad_base),
      'presentacion_id',v_pres,'presentaciones',v_lineas,'ubicaciones',v_stock);
  end if;
  if p_tipo not in ('VTD','TRASLADO_VIRTUAL') or p_tipo is null then raise exception 'Tipo de documento no válido.'; end if;
  if p_tipo='VTD' then
    if actor.rol not in ('admin','gerente','almacenero','operario') then raise exception 'La VTD se prepara y verifica desde Almacén.' using errcode='42501'; end if;
    if p_accion='resolver_vtd' then
      select id into p_id from public.venta where numero=upper(btrim(p_datos->>'numero'));
    end if;
    select * into v from public.venta where id=p_id for update;
    if not found then raise exception 'No se encontró la VTD.'; end if;
    select sucursal_id into v_origen from public.ubicacion where id=v.ubicacion_id;
    if (v.numero is not null and v.numero not like 'VTD-%') or
      (v.numero is null and not exists(select 1 from public.ubicacion where id=v.ubicacion_id and codigo_zona='VENTAS DIRECTAS')) then raise exception 'Este documento no es una VTD.'; end if;
    if not exists(select 1 from public.sucursal where id=v_origen and activo and tipo='fisica') or (actor.sucursal_id is not null and actor.sucursal_id<>v_origen) then
      raise exception 'La VTD pertenece a otra sucursal.' using errcode='42501';
    end if;
    if p_accion='resolver_vtd' then return jsonb_build_object('venta_id',v.id,'sucursal_id',v_origen); end if;
    perform id from public.venta_linea where venta_id=v.id order by id for update;
    select * into d from public.almacen_documento_movil where venta_id=v.id for update;
    if (d.id is null or d.estado='ANULADO') and p_accion in ('crear','escanear') then
      if v.estado<>'ABIERTA' then raise exception 'La VTD ya está completada o anulada.'; end if;
      cab:=jsonb_build_object('cliente_id',v.cliente_id,'ubicacion_id',v.ubicacion_id,'total',v.total,'descuento_total',v.descuento_total);
      if d.id is null then
        insert into public.almacen_documento_movil(tipo,venta_id,sucursal_origen_id,estado,preparador_id,preparador_nombre,snapshot_cabecera)
          values('VTD',v.id,v_origen,'PREPARANDO',actor.id,actor.nombre,cab) returning * into d;
      else
        update public.almacen_documento_movil set estado='PREPARANDO',version=version+1,sucursal_origen_id=v_origen,
          preparador_id=actor.id,preparador_nombre=actor.nombre,snapshot_cabecera=cab,revisor_id=null,revisor_nombre=null,
          preparado_en=null,verificado_en=null,observacion='',actualizado_en=now() where id=d.id returning * into d;
        update public.almacen_documento_linea set vigente=false,preparada_base=0,confirmada=false,
          revisada_base=null,metodo_revision=null,codigo_leido=null,revisor_id=null,revisor_nombre=null,revisada_en=null where documento_id=d.id;
      end if;
      insert into public.almacen_documento_linea(documento_id,venta_linea_id,producto_id,presentacion_id,declarada_base,snapshot)
        select d.id,linea_id,(datos->>'producto_id')::bigint,(datos->>'presentacion_id')::bigint,(datos->>'cantidad_base')::numeric,datos from almacen_operaciones.lineas_vtd(v.id)
        on conflict(documento_id,venta_linea_id) do update set vigente=true,producto_id=excluded.producto_id,presentacion_id=excluded.presentacion_id,
          declarada_base=excluded.declarada_base,snapshot=excluded.snapshot,preparada_base=0,confirmada=false,observacion='',
          revisada_base=null,metodo_revision=null,codigo_leido=null,revisor_id=null,revisor_nombre=null,revisada_en=null;
      insert into public.almacen_documento_evento(documento_id,accion,actor_id,actor_nombre) values(d.id,'PREPARACION_INICIADA',actor.id,actor.nombre);
      return almacen_operaciones.documento_datos(d.id);
    elsif d.id is null then
      if p_accion='consultar' then
        select coalesce(jsonb_agg(jsonb_build_object('id',linea_id,'venta_linea_id',linea_id,'producto_id',datos->'producto_id','presentacion_id',datos->'presentacion_id',
          'snapshot',datos,'declarada_base',datos->'cantidad_base','preparada_base',0,'confirmada',false,'vigente',true) order by linea_id),'[]') into v_lineas from almacen_operaciones.lineas_vtd(v.id);
        return jsonb_build_object('documento',jsonb_build_object('id',v.id,'numero',coalesce(v.numero,'#'||v.id),'tipo','vtd',
          'estado',case when v.estado='ABIERTA' then 'ABIERTO' when v.estado='ANULADA' then 'CANCELADO' else 'COMPLETADO' end,'sucursal_origen_id',v_origen,
          'cliente',(select nombre from public.cliente where id=v.cliente_id),'referencia',v.notas,
          'pago',case when exists(select 1 from public.venta_pago where venta_id=v.id) then 'PAGADO' when v.pago_posterior then 'PAGO POSTERIOR AUTORIZADO' when not v.cobro_exigible then 'TICKET HISTÓRICO · COBRO NO EXIGIBLE' else 'POR COBRAR' end),
          'tarea',null,'lineas',v_lineas,'eventos','[]'::jsonb,'cambios','[]'::jsonb,'entregada',v.estado='COMPLETADA');
      end if;
      raise exception 'Primero escanea la VTD para tomar su preparación.';
    end if;
  else
    if p_accion='crear' and p_id is null then
      v_origen:=(p_datos->>'sucursal_origen_id')::bigint;v_destino:=(p_datos->>'sucursal_destino_id')::bigint;
      if v_origen is null or v_destino is null or v_origen=v_destino or
        (select count(*) from public.sucursal where id in(v_origen,v_destino) and activo and tipo='fisica')<>2 then raise exception 'Elige origen y destino físicos diferentes.'; end if;
      if actor.sucursal_id is not null and
        ((actor.rol in ('vendedor','cajero') and actor.sucursal_id<>v_destino) or
         (actor.rol in ('almacenero','operario') and actor.sucursal_id<>v_origen) or
         (actor.rol in ('admin','gerente') and actor.sucursal_id not in(v_origen,v_destino))) then raise exception 'El traslado no corresponde a tu sucursal asignada.' using errcode='42501'; end if;
      perform pg_advisory_xact_lock(hashtextextended('carrito:'||actor.id||':'||v_origen||':'||v_destino,0));
      select * into d from public.almacen_documento_movil where tipo='TRASLADO_VIRTUAL' and preparador_id=actor.id and sucursal_origen_id=v_origen and sucursal_destino_id=v_destino and estado='BORRADOR' for update;
      if not found then
        insert into public.almacen_documento_movil(tipo,sucursal_origen_id,sucursal_destino_id,estado,preparador_id,preparador_nombre)
          values('TRASLADO_VIRTUAL',v_origen,v_destino,'BORRADOR',actor.id,actor.nombre) returning * into d;
        insert into public.almacen_documento_evento(documento_id,accion,actor_id,actor_nombre) values(d.id,'CARRITO_CREADO',actor.id,actor.nombre);
      end if;
      return almacen_operaciones.documento_datos(d.id);
    end if;
    select * into d from public.almacen_documento_movil where id=p_id and tipo='TRASLADO_VIRTUAL' for update;
    if not found then raise exception 'No se encontró la solicitud de traslado.'; end if;
  end if;
  es_almacen:=actor.rol in ('admin','gerente','almacenero','operario') and (actor.sucursal_id is null or actor.sucursal_id=d.sucursal_origen_id);
  es_admin:=actor.rol in ('admin','gerente') and es_almacen;
  es_dueno:=actor.id=d.preparador_id;
  es_receptor:=d.sucursal_destino_id is not null and (actor.sucursal_id=d.sucursal_destino_id or (actor.rol in ('admin','gerente') and actor.sucursal_id is null));
  if not es_dueno and not (es_almacen and (d.estado<>'BORRADOR' or es_admin)) and not (es_receptor and d.estado in ('EN_TRANSITO','RECIBIDO')) then
    raise exception 'Esta solicitud no está disponible para tu usuario.' using errcode='42501';
  end if;
  if p_accion in ('enviar','escanear','tomar_revision','guardar_revision','verificado','autorizar') then
    perform cp.id from public.producto cp where exists(select 1 from public.almacen_documento_linea dl where dl.documento_id=d.id and dl.vigente and dl.producto_id=cp.id) order by cp.id for share;
    perform cp.id from public.presentacion cp where exists(select 1 from public.almacen_documento_linea dl where dl.documento_id=d.id and dl.vigente and (dl.presentacion_id=cp.id or (cp.es_base and cp.producto_id=dl.producto_id))) order by cp.id for share;
    perform cu.id from public.ubicacion cu where exists(select 1 from public.almacen_documento_linea dl where dl.documento_id=d.id and dl.vigente and dl.ubicacion_origen_id=cu.id) order by cu.id for share;
  end if;
  info:=almacen_operaciones.documento_datos(d.id);
  if p_accion='consultar' or p_accion='crear' then return info; end if;
  if es_auto then
    if d.tipo='VTD' and v.estado<>'ABIERTA' then return info; end if;
    if d.estado='PREPARADO' and es_almacen and not es_dueno and jsonb_array_length(info->'cambios')=0 then p_accion:='tomar_revision';p_version:=d.version;
    else return info; end if;
  end if;
  if p_accion='autorizar' then
    if not es_almacen or actor.id is distinct from d.revisor_id then raise exception 'Sólo el verificador asignado puede autorizar la salida.' using errcode='42501'; end if;
    if d.estado in ('DESPACHADO','EN_TRANSITO','RECIBIDO') then return info; end if;
  end if;
  if p_accion='recibir' then
    if not es_receptor then raise exception 'La recepción corresponde a Tienda destino.' using errcode='42501'; end if;
    if d.estado='RECIBIDO' or info->'documento'->>'traslado_estado'='RECIBIDO' then return info; end if;
  end if;
  if p_version is null or p_version<>d.version then raise exception 'La operación cambió en otro celular. Actualiza antes de guardar.' using errcode='40001'; end if;
  if d.estado in ('DESPACHADO','RECIBIDO','ANULADO') or (d.estado='EN_TRANSITO' and p_accion<>'recibir') then raise exception 'Esta operación ya está cerrada para modificaciones.'; end if;
  if d.tipo='VTD' and v.estado<>'ABIERTA' and p_accion<>'anular' then
    if p_accion='autorizar' and v.estado='COMPLETADA' then
      update public.almacen_documento_movil set estado='DESPACHADO',entregado_en=coalesce(v.completado_en,now()),version=version+1,actualizado_en=now() where id=d.id;
      return almacen_operaciones.documento_datos(d.id);
    end if;
    raise exception 'La VTD ya está completada o anulada.';
  end if;
  if p_accion not in ('sincronizar','devolver','reabrir','anular','agregar','editar','quitar') and jsonb_array_length(info->'cambios')>0 then
    raise exception 'El documento cambió. Vuelve a comprobar el alistado antes de continuar.' using errcode='40001';
  end if;
  if p_accion in ('agregar','editar','quitar','enviar') then
    if d.tipo<>'TRASLADO_VIRTUAL' or d.estado<>'BORRADOR' or not es_dueno then raise exception 'Sólo quien arma este carrito puede editarlo antes de enviarlo.' using errcode='42501'; end if;
    if p_accion='quitar' then
      delete from public.almacen_documento_linea where documento_id=d.id and id=(p_datos->>'linea_id')::bigint returning * into l;
      if not found then raise exception 'La línea no pertenece a este carrito.'; end if;
    elsif p_accion='enviar' then
      if not exists(select 1 from public.almacen_documento_linea where documento_id=d.id and vigente) then raise exception 'Añade al menos un producto al carrito.'; end if;
      update public.almacen_documento_linea set preparada_base=declarada_base,confirmada=true where documento_id=d.id and vigente;
      update public.almacen_documento_movil set estado='PREPARADO',preparado_en=now() where id=d.id;
    else
      if p_accion='editar' then
        select * into l from public.almacen_documento_linea where id=(p_datos->>'linea_id')::bigint and documento_id=d.id for update;
        if not found then raise exception 'La línea no pertenece al carrito.'; end if;
      end if;
      v_producto:=coalesce((p_datos->>'producto_id')::bigint,l.producto_id);
      v_pres:=coalesce((p_datos->>'presentacion_id')::bigint,l.presentacion_id);
      v_ubic:=coalesce((p_datos->>'ubicacion_id')::bigint,l.ubicacion_origen_id);
      select * into pr from public.presentacion where id=v_pres and producto_id=v_producto and activo and factor_unidad_base>0 for share;
      select * into prod from public.producto where id=v_producto and activo for share;
      select * into ub from public.ubicacion where id=v_ubic and sucursal_id=d.sucursal_origen_id and not excluye_disponible for share;
      if pr.id is null or prod.id is null or ub.id is null then raise exception 'Comprueba el producto, la presentación y la ubicación de origen.'; end if;
      if not exists(select 1 from public.producto_ubicacion where producto_id=v_producto and ubicacion_id=v_ubic) and
        not exists(select 1 from public.stock_actual where producto_id=v_producto and ubicacion_id=v_ubic) then raise exception 'El producto no está registrado en esa ubicación.'; end if;
      if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' then raise exception 'Cantidad no válida: usa hasta 6 decimales en unidades base.'; end if;
      v_cantidad:=(p_datos->>'cantidad_base')::numeric;
      if v_cantidad<>round(v_cantidad,4) then raise exception 'El stock admite hasta 4 decimales en unidades base.'; end if;
      if v_cantidad<=0 or v_cantidad>1e12 then raise exception 'La cantidad debe ser positiva.'; end if;
      if p_accion='agregar' then
        select * into l from public.almacen_documento_linea where documento_id=d.id and producto_id=v_producto and presentacion_id=v_pres and ubicacion_origen_id=v_ubic for update;
        v_cantidad:=v_cantidad+coalesce(l.declarada_base,0);
      end if;
      if v_cantidad>1e12 then raise exception 'Cantidad fuera de rango.'; end if;
      cab:=jsonb_build_object('producto_id',prod.id,'nombre',prod.nombre,'sku',prod.sku_interno,'unidad_base',prod.unidad_base,
        'presentacion_id',pr.id,'presentacion',pr.nombre,'factor',pr.factor_unidad_base,'pendiente_base',v_cantidad,'cantidad_base',v_cantidad,
        'ubicacion_id',ub.id,'ubicacion',concat_ws(' · ',ub.codigo_zona,ub.estante,ub.nivel,ub.compartimiento),'preparable',true);
      if l.id is null then
        if (select count(*) from public.almacen_documento_linea where documento_id=d.id)>=200 then raise exception 'El carrito admite hasta 200 líneas.'; end if;
        insert into public.almacen_documento_linea(documento_id,producto_id,presentacion_id,ubicacion_origen_id,declarada_base,snapshot)
          values(d.id,prod.id,pr.id,ub.id,v_cantidad,cab) returning * into l;
      else
        update public.almacen_documento_linea set producto_id=prod.id,presentacion_id=pr.id,ubicacion_origen_id=ub.id,
          declarada_base=v_cantidad,snapshot=cab,observacion=btrim(coalesce(p_datos->>'observacion','')),preparada_base=0,confirmada=false,
          revisada_base=null,metodo_revision=null,codigo_leido=null,revisor_id=null,revisor_nombre=null,revisada_en=null where id=l.id;
      end if;
    end if;
  elsif p_accion='guardar_preparacion' then
    if d.tipo<>'VTD' or d.estado<>'PREPARANDO' or not es_dueno then raise exception 'Esta preparación corresponde a otro operario.' using errcode='42501'; end if;
    select * into l from public.almacen_documento_linea where id=(p_datos->>'linea_id')::bigint and documento_id=d.id and vigente for update;
    if not found then raise exception 'La línea no pertenece a esta VTD.'; end if;
    if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' then raise exception 'Cantidad no válida.'; end if;
    v_cantidad:=(p_datos->>'cantidad_base')::numeric;v_obs:=btrim(coalesce(p_datos->>'observacion',''));
    if v_cantidad>l.declarada_base or v_cantidad>1e12 then raise exception 'La cantidad supera lo indicado en el ticket.'; end if;
    if v_cantidad>0 and not coalesce((l.snapshot->>'preparable')::boolean,false) then raise exception 'Esta línea necesita resolverse en Caja antes de preparar.'; end if;
    if v_cantidad<l.declarada_base and v_obs='' then raise exception 'Indica el motivo del faltante.'; end if;
    update public.almacen_documento_linea set preparada_base=v_cantidad,confirmada=true,observacion=v_obs,
      revisada_base=null,metodo_revision=null,codigo_leido=null,revisor_id=null,revisor_nombre=null,revisada_en=null where id=l.id;
  elsif p_accion='preparado' then
    if d.tipo<>'VTD' or d.estado<>'PREPARANDO' or not es_dueno then raise exception 'La VTD no está disponible para terminar su preparación.'; end if;
    if not exists(select 1 from public.almacen_documento_linea where documento_id=d.id and vigente) or
      exists(select 1 from public.almacen_documento_linea where documento_id=d.id and vigente and (not confirmada or preparada_base<>declarada_base)) then
      raise exception 'La VTD se entrega completa. Si hay faltantes, corrige el ticket en Caja antes de terminar.';
    end if;
    update public.almacen_documento_movil set estado='PREPARADO',preparado_en=now() where id=d.id;
  elsif p_accion='tomar_revision' then
    if not es_almacen or es_dueno then raise exception 'La verificación debe realizarla otra persona de Almacén.' using errcode='42501'; end if;
    if d.estado<>'PREPARADO' then raise exception 'Primero debe terminar el alistado. Si ya tiene verificador, retoma con ese usuario.'; end if;
    update public.almacen_documento_movil set estado='REVISANDO',revisor_id=actor.id,revisor_nombre=actor.nombre where id=d.id;
  elsif p_accion in ('guardar_revision','verificado','devolver') then
    if not es_almacen or actor.id is distinct from d.revisor_id or (d.estado<>'REVISANDO' and not (p_accion='devolver' and d.estado='VERIFICADO')) then raise exception 'Sólo el verificador asignado puede realizar esta acción.' using errcode='42501'; end if;
    if p_accion='guardar_revision' then
      select * into l from public.almacen_documento_linea where id=(p_datos->>'linea_id')::bigint and documento_id=d.id and vigente and preparada_base>0 for update;
      if not found then raise exception 'La línea no está preparada en este documento.'; end if;
      if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' or (p_datos->>'cantidad_base')::numeric<>l.preparada_base then
        raise exception 'La cantidad contada no coincide. Devuelve el alistado para corregirlo.';
      end if;
      if p_datos->>'metodo'='escaneo' then
        perform almacen_operaciones.validar_codigo(p_datos->>'codigo',l.producto_id,l.presentacion_id,d.sucursal_origen_id);
      elsif p_datos->>'metodo' is distinct from 'visual' then raise exception 'Selecciona comprobación visual o escaneo.'; end if;
      update public.almacen_documento_linea set revisada_base=preparada_base,metodo_revision=p_datos->>'metodo',
        codigo_leido=case when p_datos->>'metodo'='escaneo' then p_datos->>'codigo' else null end,revisada_en=now(),revisor_id=actor.id,revisor_nombre=actor.nombre where id=l.id;
    elsif p_accion='verificado' then
      if not exists(select 1 from public.almacen_documento_linea where documento_id=d.id and vigente and preparada_base>0) or
        exists(select 1 from public.almacen_documento_linea where documento_id=d.id and vigente and revisada_base is distinct from preparada_base) then raise exception 'Faltan productos o cantidades por verificar.'; end if;
      update public.almacen_documento_movil set estado='VERIFICADO',verificado_en=now() where id=d.id;
    else
      v_obs:=btrim(coalesce(p_datos->>'observacion',''));
      if v_obs='' or length(v_obs)>1000 then raise exception 'Indica el motivo de la devolución del alistado.'; end if;
      update public.almacen_documento_movil set estado=case when tipo='VTD' then 'PREPARANDO' else 'BORRADOR' end,
        revisor_id=null,revisor_nombre=null,preparado_en=null,verificado_en=null,observacion=v_obs where id=d.id;
      update public.almacen_documento_linea set revisada_base=null,metodo_revision=null,codigo_leido=null,revisor_id=null,revisor_nombre=null,revisada_en=null,
        preparada_base=case when d.tipo='TRASLADO_VIRTUAL' then 0 else preparada_base end,confirmada=case when d.tipo='TRASLADO_VIRTUAL' then false else confirmada end where documento_id=d.id;
    end if;
  elsif p_accion='sincronizar' then
    if d.tipo<>'VTD' or (not es_dueno and not es_admin) then raise exception 'La actualización corresponde al preparador de la VTD.' using errcode='42501'; end if;
    cab:=jsonb_build_object('cliente_id',v.cliente_id,'ubicacion_id',v.ubicacion_id,'total',v.total,'descuento_total',v.descuento_total);
    v_cambio:=cab is distinct from d.snapshot_cabecera;
    update public.almacen_documento_linea dl set vigente=false where documento_id=d.id and not exists(select 1 from almacen_operaciones.lineas_vtd(v.id) a where a.linea_id=dl.venta_linea_id);
    insert into public.almacen_documento_linea(documento_id,venta_linea_id,producto_id,presentacion_id,declarada_base,snapshot)
      select d.id,linea_id,(datos->>'producto_id')::bigint,(datos->>'presentacion_id')::bigint,(datos->>'cantidad_base')::numeric,datos from almacen_operaciones.lineas_vtd(v.id)
      on conflict(documento_id,venta_linea_id) do update set vigente=true,producto_id=excluded.producto_id,presentacion_id=excluded.presentacion_id,
        declarada_base=excluded.declarada_base,snapshot=excluded.snapshot,preparada_base=0,confirmada=false,revisada_base=null,metodo_revision=null,codigo_leido=null,revisor_id=null,revisor_nombre=null,revisada_en=null
      where almacen_documento_linea.snapshot is distinct from excluded.snapshot or not almacen_documento_linea.vigente or v_cambio;
    update public.almacen_documento_movil set estado='PREPARANDO',snapshot_cabecera=cab,revisor_id=null,revisor_nombre=null,preparado_en=null,verificado_en=null where id=d.id;
  elsif p_accion in ('reabrir','anular') then
    if not es_dueno and not es_admin then raise exception 'Esta acción corresponde al responsable del alistado.' using errcode='42501'; end if;
    v_obs:=btrim(coalesce(p_datos->>'observacion',''));
    if v_obs='' or length(v_obs)>1000 then raise exception 'Indica un motivo de hasta 1000 caracteres.'; end if;
    update public.almacen_documento_movil set estado=case when p_accion='anular' then 'ANULADO' when tipo='VTD' then 'PREPARANDO' else 'BORRADOR' end,
      revisor_id=null,revisor_nombre=null,preparado_en=null,verificado_en=null,observacion=v_obs where id=d.id;
    update public.almacen_documento_linea set revisada_base=null,metodo_revision=null,codigo_leido=null,revisor_id=null,revisor_nombre=null,revisada_en=null,
      preparada_base=case when d.tipo='TRASLADO_VIRTUAL' then 0 else preparada_base end,confirmada=case when d.tipo='TRASLADO_VIRTUAL' then false else confirmada end where documento_id=d.id;
  elsif p_accion='autorizar' then
    if d.estado<>'VERIFICADO' then raise exception 'Completa la verificación antes de autorizar la salida.'; end if;
    if actor.id=d.preparador_id then raise exception 'Preparador y verificador deben ser personas diferentes.' using errcode='42501'; end if;
    if d.tipo='VTD' then
      if v.cobro_exigible and not v.pago_posterior and v.total>0 and not exists(select 1 from public.venta_pago where venta_id=v.id) then
        raise exception 'La VTD debe cobrarse en Caja o tener pago posterior autorizado antes de entregar.';
      end if;
      v_resultado:=almacen_operaciones.entregar_vtd(v.id,actor.nombre);
      update public.almacen_documento_movil set estado='DESPACHADO',entregado_en=now() where id=d.id;
    else
      v_linea:=almacen_operaciones.entregar_carrito(d.id,actor.nombre);
      update public.almacen_documento_movil set estado='EN_TRANSITO',traslado_id=v_linea,entregado_en=now() where id=d.id;
    end if;
  elsif p_accion='recibir' then
    if d.estado<>'EN_TRANSITO' or d.traslado_id is null then raise exception 'El traslado todavía no está en tránsito.'; end if;
    v_lineas:=p_datos->'lineas';
    if jsonb_typeof(v_lineas) is distinct from 'array' or jsonb_array_length(v_lineas)<>(select count(*) from public.solicitud_traslado_linea where solicitud_id=d.traslado_id and estado='DESPACHADA') then
      raise exception 'Declara la cantidad recibida de cada línea del traslado.';
    end if;
    for cab in select value from jsonb_array_elements(v_lineas) loop
      if coalesce(cab->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' or not exists(select 1 from public.solicitud_traslado_linea
        where id=(cab->>'linea_id')::bigint and solicitud_id=d.traslado_id and estado='DESPACHADA' and (cab->>'cantidad_base')::numeric between 0 and cantidad_despachada) then raise exception 'Cantidad recibida o línea no válida.'; end if;
    end loop;
    if (select count(distinct x->>'linea_id') from jsonb_array_elements(v_lineas) x)<>jsonb_array_length(v_lineas) then raise exception 'No repitas una línea en la recepción.'; end if;
    if exists(select 1 from public.solicitud_traslado_linea s join jsonb_array_elements(v_lineas) x on s.id=(x->>'linea_id')::bigint where solicitud_id=d.traslado_id and (x->>'cantidad_base')::numeric<s.cantidad_despachada)
      and btrim(coalesce(p_datos->>'observacion',''))='' then raise exception 'Indica el motivo de las diferencias de recepción.'; end if;
    v_resultado:=almacen_operaciones.recibir_carrito(d.traslado_id,actor.nombre,v_lineas);
    update public.almacen_documento_movil set estado='RECIBIDO' where id=d.id;
  else raise exception 'La acción no corresponde a este documento.';
  end if;
  update public.almacen_documento_movil set version=version+1,actualizado_en=now() where id=d.id;
  insert into public.almacen_documento_evento(documento_id,accion,actor_id,actor_nombre,detalle)
    values(d.id,upper(p_accion),actor.id,actor.nombre,coalesce(p_datos,'{}'::jsonb));
  return almacen_operaciones.documento_datos(d.id);
end;
$$;

create function public.operar_documento_movil(p_tipo text,p_documento_id bigint default null,p_accion text default 'consultar',p_version integer default null,p_datos jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
  select almacen_operaciones.operar_documento(p_tipo,p_documento_id,p_accion,p_version,p_datos);
$$;
revoke all on function almacen_operaciones.lineas_vtd(bigint),almacen_operaciones.validar_codigo(text,bigint,bigint,bigint),
  almacen_operaciones.entregar_vtd(bigint,text),almacen_operaciones.entregar_carrito(bigint,text),
  almacen_operaciones.recibir_carrito(bigint,text,jsonb),almacen_operaciones.documento_datos(bigint) from public,anon,authenticated;
revoke all on function almacen_operaciones.operar_documento(text,bigint,text,integer,jsonb),public.operar_documento_movil(text,bigint,text,integer,jsonb) from public,anon;
grant execute on function almacen_operaciones.operar_documento(text,bigint,text,integer,jsonb),public.operar_documento_movil(text,bigint,text,integer,jsonb) to authenticated;
create or replace function almacen_operaciones.operar(
  p_pedido_id bigint, p_sucursal_id bigint, p_tarea_id bigint, p_accion text, p_version integer, p_datos jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_perfil public.perfil%rowtype;
  v_pedido public.pedido%rowtype;
  v_tarea public.almacen_preparacion%rowtype;
  v_linea public.almacen_preparacion_linea%rowtype;
  v_actual jsonb;
  v_cambios jsonb;
  v_items jsonb;
  v_eventos jsonb;
  v_cantidad numeric;
  v_obs text;
  v_codigo text;
  v_producto bigint;
  v_presentacion bigint;
  v_coincidencias integer;
  v_entregada boolean := false;
  v_admin boolean;
  v_auto boolean := p_accion='escanear';
begin
  select * into v_perfil from public.perfil where id=auth.uid() and activo;
  if v_perfil.id is null or v_perfil.rol not in ('admin','gerente','almacenero','operario') then
    raise exception 'Tu perfil no tiene acceso a las operaciones de almacén.' using errcode='42501';
  end if;
  v_admin := v_perfil.rol in ('admin','gerente');
  if not exists(select 1 from public.sucursal where id=p_sucursal_id and activo and tipo='fisica')
    or (v_perfil.sucursal_id is not null and v_perfil.sucursal_id<>p_sucursal_id) then
    raise exception 'Selecciona una sucursal física autorizada.' using errcode='42501';
  end if;
  if p_accion is null or p_accion not in ('consultar','crear','escanear','devolver','sincronizar','guardar_preparacion','preparado','tomar_revision','guardar_revision','verificado','reabrir','reasignar','anular') then
    raise exception 'Operación no válida.';
  end if;
  -- Orden consistente de bloqueos para serializar dos celulares y cambios.
  select * into v_pedido from public.pedido where id=p_pedido_id for update;
  if not found then raise exception 'No se encontró el pedido.'; end if;
  perform id from public.pedido_linea where pedido_id=p_pedido_id order by id for update;
  if p_tarea_id is not null then
    select * into v_tarea from public.almacen_preparacion where id=p_tarea_id and pedido_id=p_pedido_id and sucursal_id=p_sucursal_id for update;
    if not found then raise exception 'No se encontró esa preparación en esta sucursal.'; end if;
  else
    select * into v_tarea from public.almacen_preparacion where pedido_id=p_pedido_id and sucursal_id=p_sucursal_id order by id desc limit 1 for update;
  end if;
  if v_tarea.id is not null then
    select coalesce(bool_and(coalesce(l.cantidad_despachada,0)>=
       (tl.snapshot->>'cantidad_despachada')::numeric+tl.preparada_base),false)
    into v_entregada from public.almacen_preparacion_linea tl
    left join public.pedido_linea l on l.id=tl.pedido_linea_id
    where tl.preparacion_id=v_tarea.id and tl.vigente and tl.preparada_base>0;
  end if;
  if p_accion='escanear' then
    if v_pedido.estado<>'ABIERTO' then p_accion:='consultar';
    elsif v_tarea.id is null or v_tarea.estado in ('DESPACHADO','ANULADO') or (v_tarea.estado='VERIFICADO' and v_entregada) then p_accion:='crear';
    elsif v_tarea.estado='PREPARADO' and v_tarea.preparador_id<>v_perfil.id then p_accion:='tomar_revision';p_version:=v_tarea.version;
    else p_accion:='consultar'; end if;
  end if;
  if p_accion='crear' then
    if v_pedido.estado<>'ABIERTO' then raise exception 'El pedido está cancelado o completado; no se puede preparar.'; end if;
    if v_tarea.estado='VERIFICADO' and v_entregada then
      update public.almacen_preparacion set estado='DESPACHADO',version=version+1,actualizado_en=now() where id=v_tarea.id;
      insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre)
        values(v_tarea.id,'DESPACHO_REGISTRADO',v_perfil.id,v_perfil.nombre);
      v_tarea.estado := 'DESPACHADO';
    end if;
    if v_tarea.id is null or v_tarea.estado in ('DESPACHADO','ANULADO') then
      if exists(select 1 from public.almacen_preparacion where pedido_id=p_pedido_id and estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO')) then
        raise exception 'Este pedido tiene una entrega en preparación en otra sucursal.';
      end if;
      if not exists(select 1 from almacen_operaciones.lineas_actuales(p_pedido_id,p_sucursal_id)) then
        raise exception 'No hay líneas pendientes para preparar en esta sucursal.';
      end if;
      v_entregada := false;
      insert into public.almacen_preparacion(pedido_id,sucursal_id,preparador_id,preparador_nombre)
        values(p_pedido_id,p_sucursal_id,v_perfil.id,v_perfil.nombre) returning * into v_tarea;
      insert into public.almacen_preparacion_linea(preparacion_id,pedido_linea_id,snapshot)
        select v_tarea.id,linea_id,datos from almacen_operaciones.lineas_actuales(p_pedido_id,p_sucursal_id);
      insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre)
        values(v_tarea.id,'PREPARACION_INICIADA',v_perfil.id,v_perfil.nombre);
    end if;
  end if;
  select coalesce(jsonb_agg(x.linea_id),'[]'::jsonb) into v_cambios from (
    select coalesce(a.linea_id,tl.pedido_linea_id) as linea_id
    from almacen_operaciones.lineas_actuales(p_pedido_id,p_sucursal_id) a
    full join (select * from public.almacen_preparacion_linea where preparacion_id=v_tarea.id and vigente) tl on tl.pedido_linea_id=a.linea_id
    where a.datos is distinct from tl.snapshot
  ) x;
  if v_auto and p_accion='tomar_revision' and jsonb_array_length(v_cambios)>0 then p_accion:='consultar'; end if;
  if p_accion not in ('consultar','crear') then
    if v_tarea.id is null then raise exception 'Primero toma la preparación del pedido.'; end if;
    if p_version is null or p_version<>v_tarea.version then
      raise exception 'La preparación cambió en otro celular. Actualiza los datos antes de guardar.' using errcode='40001';
    end if;
    if v_tarea.estado in ('DESPACHADO','ANULADO') then raise exception 'Esta preparación ya está cerrada.'; end if;
    if p_accion<>'anular' and v_pedido.estado<>'ABIERTO' then raise exception 'El pedido está cancelado o completado; no puedes confirmarlo.'; end if;
    if p_accion in ('guardar_preparacion','preparado') and v_tarea.preparador_id<>v_perfil.id then raise exception 'Primero reasigna la preparación para registrar cantidades con tu usuario.' using errcode='42501'; end if;
    if p_accion in ('guardar_preparacion','preparado','sincronizar','reabrir','anular')
      and v_tarea.preparador_id<>v_perfil.id and not v_admin then
      raise exception 'Esta preparación está a cargo de otro operario.' using errcode='42501';
    end if;
    if p_accion not in ('sincronizar','devolver','reabrir','reasignar','anular') and jsonb_array_length(v_cambios)>0 then
      raise exception 'El pedido cambió. Actualiza la preparación y vuelve a comprobar las líneas afectadas.' using errcode='40001';
    end if;
    if p_accion='sincronizar' then
      update public.almacen_preparacion_linea tl set vigente=false,revisada_base=null,metodo_revision=null,codigo_leido=null,revisada_en=null,revisor_id=null,revisor_nombre=null
        where preparacion_id=v_tarea.id and not exists(select 1 from almacen_operaciones.lineas_actuales(p_pedido_id,p_sucursal_id) a where a.linea_id=tl.pedido_linea_id);
      insert into public.almacen_preparacion_linea(preparacion_id,pedido_linea_id,snapshot)
        select v_tarea.id,linea_id,datos from almacen_operaciones.lineas_actuales(p_pedido_id,p_sucursal_id)
        on conflict(preparacion_id,pedido_linea_id) do update set snapshot=excluded.snapshot,vigente=true,
          preparada_base=0,confirmada=false,revisada_base=null,metodo_revision=null,codigo_leido=null,revisada_en=null,revisor_id=null,revisor_nombre=null
        where almacen_preparacion_linea.snapshot is distinct from excluded.snapshot or not almacen_preparacion_linea.vigente;
      update public.almacen_preparacion set estado='PREPARANDO',revisor_id=null,revisor_nombre=null,preparado_en=null,verificado_en=null where id=v_tarea.id;
    elsif p_accion='guardar_preparacion' then
      if v_tarea.estado<>'PREPARANDO' then raise exception 'Reabre la preparación antes de modificar cantidades.'; end if;
      select * into v_linea from public.almacen_preparacion_linea where preparacion_id=v_tarea.id and pedido_linea_id=(p_datos->>'linea_id')::bigint and vigente for update;
      if not found then raise exception 'La línea ya no está en esta preparación.'; end if;
      if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' then raise exception 'Cantidad no válida.'; end if;
      v_cantidad := (p_datos->>'cantidad_base')::numeric;
      v_obs := btrim(coalesce(p_datos->>'observacion',''));
      if v_cantidad>1e12 or v_cantidad>(v_linea.snapshot->>'pendiente_base')::numeric then raise exception 'La cantidad supera lo pendiente del pedido.'; end if;
      if v_cantidad>0 and not (v_linea.snapshot->>'preparable')::boolean then raise exception 'Esta línea requiere resolver su compra o presentación antes de preparar.'; end if;
      if v_cantidad<(v_linea.snapshot->>'pendiente_base')::numeric and v_obs='' then raise exception 'Indica el motivo de la cantidad pendiente para esta entrega.'; end if;
      update public.almacen_preparacion_linea set preparada_base=v_cantidad,confirmada=true,observacion=v_obs,
        revisada_base=null,metodo_revision=null,codigo_leido=null,revisada_en=null,revisor_id=null,revisor_nombre=null where preparacion_id=v_tarea.id and pedido_linea_id=v_linea.pedido_linea_id;
    elsif p_accion='preparado' then
      if v_tarea.estado<>'PREPARANDO' then raise exception 'El pedido no está en preparación.'; end if;
      if exists(select 1 from public.almacen_preparacion_linea where preparacion_id=v_tarea.id and vigente and not confirmada)
        or not exists(select 1 from public.almacen_preparacion_linea where preparacion_id=v_tarea.id and vigente and preparada_base>0) then
        raise exception 'Confirma todas las líneas, indicando los faltantes. Debe haber al menos un producto preparado.';
      end if;
      update public.almacen_preparacion set estado='PREPARADO',preparado_en=now() where id=v_tarea.id;
    elsif p_accion='tomar_revision' then
      if v_tarea.preparador_id=v_perfil.id then raise exception 'La verificación debe realizarla otra persona de Almacén.' using errcode='42501'; end if;
      if v_tarea.estado<>'PREPARADO' then raise exception 'La entrega no está disponible para revisión.'; end if;
      update public.almacen_preparacion set estado='REVISANDO',revisor_id=v_perfil.id,revisor_nombre=v_perfil.nombre where id=v_tarea.id;
    elsif p_accion in ('guardar_revision','verificado') then
      if v_tarea.preparador_id=v_perfil.id then raise exception 'Preparador y verificador deben ser personas diferentes. Reabre la preparación para asignar otro verificador.' using errcode='42501'; end if;
      if v_tarea.estado<>'REVISANDO' or v_tarea.revisor_id is distinct from v_perfil.id then
        raise exception 'Primero toma la revisión. Sólo el revisor asignado puede confirmarla.' using errcode='42501';
      end if;
      if p_accion='guardar_revision' then
        select * into v_linea from public.almacen_preparacion_linea where preparacion_id=v_tarea.id and pedido_linea_id=(p_datos->>'linea_id')::bigint and vigente and preparada_base>0 for update;
        if not found then raise exception 'Esta línea no tiene cantidad preparada para revisar.'; end if;
        if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' or (p_datos->>'cantidad_base')::numeric<>v_linea.preparada_base then
          raise exception 'La cantidad contada no coincide con la preparada. Corrige la preparación antes de confirmar.';
        end if;
        if p_datos->>'metodo'='escaneo' then
          v_codigo := btrim(coalesce(p_datos->>'codigo',''));
          if length(v_codigo)>2048 then raise exception 'Código demasiado largo.'; end if;
          v_producto := null; v_presentacion := null;
          if v_codigo ~ '^https?://[^/?#]+/productos/[1-9][0-9]*/ficha/?([?#]|$)' or v_codigo ~ '^/productos/[1-9][0-9]*/ficha/?([?#]|$)' then
            if v_codigo ~ '[?&]sucursal=' then
              if v_codigo !~ '[?&]sucursal=[1-9][0-9]*(&|#|$)' or
                (substring(v_codigo from '[?&]sucursal=([1-9][0-9]*)'))::bigint<>p_sucursal_id then
                raise exception 'La etiqueta corresponde a otra sucursal o su sucursal no es válida.';
              end if;
            end if;
            v_producto := (substring(v_codigo from '/productos/([1-9][0-9]*)/ficha'))::bigint;
            if v_codigo ~ '[?&]presentacion=[1-9][0-9]*(&|#|$)' then
              v_presentacion := (substring(v_codigo from '[?&]presentacion=([1-9][0-9]*)'))::bigint;
              if not exists(select 1 from public.presentacion where id=v_presentacion and producto_id=v_producto and activo) then raise exception 'La presentación del QR no está disponible.'; end if;
            elsif v_codigo ~ '[?&]presentacion=' then raise exception 'La presentación del QR no es válida.'; end if;
          else
            select count(*),min(pr.producto_id),min(pr.id) into v_coincidencias,v_producto,v_presentacion
              from public.identificador i join public.presentacion pr on pr.id=i.presentacion_id
              where i.valor=v_codigo and i.activo and pr.activo;
            if v_coincidencias<>1 then raise exception 'Código desconocido o ambiguo. Usa el QR de la ficha o la revisión visual.'; end if;
          end if;
          if v_producto is distinct from (v_linea.snapshot->>'producto_id')::bigint then raise exception 'El código corresponde a otro producto.'; end if;
          if v_presentacion is not null then
            if (v_linea.snapshot->>'presentacion_id') is not null and v_presentacion<>(v_linea.snapshot->>'presentacion_id')::bigint then raise exception 'El código corresponde a otra presentación. Comprueba el empaque.'; end if;
            if (v_linea.snapshot->>'presentacion_id') is null and not exists(select 1 from public.presentacion where id=v_presentacion and factor_unidad_base=1) then raise exception 'Esta línea se controla en unidades base. Usa su etiqueta de unidad.'; end if;
          end if;
        elsif p_datos->>'metodo'='visual' then v_codigo := null;
        else raise exception 'Selecciona revisión visual o por escaneo.'; end if;
        update public.almacen_preparacion_linea set revisada_base=preparada_base,metodo_revision=p_datos->>'metodo',codigo_leido=v_codigo,revisada_en=now(),revisor_id=v_perfil.id,revisor_nombre=v_perfil.nombre
          where preparacion_id=v_tarea.id and pedido_linea_id=v_linea.pedido_linea_id;
      else
        if exists(select 1 from public.almacen_preparacion_linea where preparacion_id=v_tarea.id and vigente and preparada_base>0 and revisada_base is distinct from preparada_base)
          or not exists(select 1 from public.almacen_preparacion_linea where preparacion_id=v_tarea.id and vigente and preparada_base>0) then
          raise exception 'Faltan productos o cantidades por revisar.';
        end if;
        update public.almacen_preparacion set estado='VERIFICADO',verificado_en=now() where id=v_tarea.id;
      end if;
    elsif p_accion='devolver' then
      if v_tarea.estado<>'REVISANDO' or v_tarea.revisor_id is distinct from v_perfil.id then raise exception 'Sólo el verificador asignado puede devolver la preparación.' using errcode='42501'; end if;
      v_obs:=btrim(coalesce(p_datos->>'observacion',''));
      if v_obs='' or length(v_obs)>1000 then raise exception 'Indica el motivo de la devolución.'; end if;
      update public.almacen_preparacion set estado='PREPARANDO',revisor_id=null,revisor_nombre=null,preparado_en=null,verificado_en=null where id=v_tarea.id;
      update public.almacen_preparacion_linea set revisada_base=null,metodo_revision=null,codigo_leido=null,revisor_id=null,revisor_nombre=null,revisada_en=null where preparacion_id=v_tarea.id;
    elsif p_accion in ('reabrir','reasignar','anular') then
      v_obs := btrim(coalesce(p_datos->>'observacion',''));
      if v_obs='' or length(v_obs)>1000 then raise exception 'Indica un motivo de hasta 1000 caracteres.'; end if;
      if p_accion='anular' then update public.almacen_preparacion set estado='ANULADO' where id=v_tarea.id;
      else
        if p_accion='reasignar' and not v_admin then raise exception 'Sólo un encargado puede reasignar la preparación.' using errcode='42501'; end if;
        update public.almacen_preparacion set estado='PREPARANDO',preparador_id=case when p_accion='reasignar' then v_perfil.id else preparador_id end,
          preparador_nombre=case when p_accion='reasignar' then v_perfil.nombre else preparador_nombre end,
          revisor_id=null,revisor_nombre=null,preparado_en=null,verificado_en=null where id=v_tarea.id;
        update public.almacen_preparacion_linea set revisada_base=null,metodo_revision=null,codigo_leido=null,revisada_en=null,revisor_id=null,revisor_nombre=null where preparacion_id=v_tarea.id;
      end if;
    end if;
    update public.almacen_preparacion set version=version+1,actualizado_en=now() where id=v_tarea.id returning * into v_tarea;
    insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle)
      values(v_tarea.id,upper(p_accion),v_perfil.id,v_perfil.nombre,coalesce(p_datos,'{}'::jsonb) || case when p_accion='sincronizar' then jsonb_build_object('lineas_afectadas',v_cambios) else '{}'::jsonb end);
    if p_accion='sincronizar' then v_cambios := '[]'::jsonb; end if;
  end if;
  if v_tarea.id is not null then
    select coalesce(jsonb_agg(to_jsonb(l) order by pedido_linea_id),'[]'::jsonb) into v_items from public.almacen_preparacion_linea l where preparacion_id=v_tarea.id;
    select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]'::jsonb) into v_eventos from (select * from public.almacen_preparacion_evento where preparacion_id=v_tarea.id order by id desc limit 80) e;
  else
    select coalesce(jsonb_agg(jsonb_build_object('pedido_linea_id',linea_id,'snapshot',datos,'vigente',true,'preparada_base',0,'confirmada',false) order by linea_id),'[]'::jsonb) into v_items from almacen_operaciones.lineas_actuales(p_pedido_id,p_sucursal_id);
    v_cambios := '[]'::jsonb;
  end if;
  return jsonb_build_object('pedido',jsonb_build_object('id',v_pedido.id,'numero',v_pedido.numero,'referencia',v_pedido.referencia,'estado',v_pedido.estado,
    'cliente',(select nombre from public.cliente where id=v_pedido.cliente_id)),
    'tarea',case when v_tarea.id is not null then to_jsonb(v_tarea) else null end,
    'lineas',v_items,'eventos',coalesce(v_eventos,'[]'::jsonb),'cambios',v_cambios,'entregada',v_entregada,
    'otras_sucursales',(select count(*) from public.pedido_linea where pedido_id=p_pedido_id and sucursal_origen_id is not null and sucursal_origen_id<>p_sucursal_id and cantidad_base>cantidad_despachada and estado not in ('RECHAZADO','CAMBIADA','RETIRADA')));
end;
$$;

-- Activar al publicar ambos clientes; los tickets tomados por el flujo nuevo
-- requieren verificación desde el primer escaneo, incluso durante el despliegue.
create table almacen_operaciones.configuracion_flujos (
  id boolean primary key default true check (id),
  exigir_preparacion_vtd boolean not null default false
);
insert into almacen_operaciones.configuracion_flujos default values;
alter table almacen_operaciones.configuracion_flujos enable row level security;
revoke all on almacen_operaciones.configuracion_flujos from public,anon,authenticated;
-- Impide que el checkout heredado eluda la verificación de una VTD.
create function almacen_operaciones.exigir_vtd_verificada(p_venta bigint)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.perfil%rowtype;d public.almacen_documento_movil%rowtype;info jsonb;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  select * into d from public.almacen_documento_movil where venta_id=p_venta;
  if d.id is null and not (select exigir_preparacion_vtd from almacen_operaciones.configuracion_flujos where id) then return; end if;
  if actor.id is null or actor.rol not in ('admin','gerente','almacenero','operario')
    or d.id is null or d.estado<>'VERIFICADO' or d.revisor_id is distinct from actor.id
    or d.preparador_id=actor.id or (actor.sucursal_id is not null and actor.sucursal_id<>d.sucursal_origen_id) then
    raise exception 'La VTD debe prepararse y verificarse por dos personas desde Operaciones de Almacén antes de entregarla.' using errcode='42501';
  end if;
  perform id from public.venta_linea where venta_id=p_venta order by id for update;
  perform p.id from public.producto p where exists(select 1 from public.venta_linea l where l.venta_id=p_venta and l.producto_id=p.id) order by p.id for share;
  perform pr.id from public.presentacion pr where exists(select 1 from public.venta_linea l where l.venta_id=p_venta and (l.presentacion_id=pr.id or (pr.es_base and pr.producto_id=l.producto_id))) order by pr.id for share;
  info:=almacen_operaciones.documento_datos(d.id);
  if jsonb_array_length(info->'cambios')>0 or exists(select 1 from public.almacen_documento_linea where documento_id=d.id and vigente and (not confirmada or preparada_base<>declarada_base or revisada_base is distinct from preparada_base)) then
    raise exception 'El ticket VTD cambió. Corrige la preparación y vuelve a verificar antes de entregar.' using errcode='40001';
  end if;
end;
$$;
revoke all on function almacen_operaciones.exigir_vtd_verificada(bigint) from public,anon;
grant execute on function almacen_operaciones.exigir_vtd_verificada(bigint) to authenticated;

CREATE OR REPLACE FUNCTION public.completar_venta(p_venta_id bigint, p_usuario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path=pg_catalog,public,pg_temp
AS $function$
declare
  v_venta           venta%rowtype;
  v_linea           venta_linea%rowtype;
  v_presentacion_id bigint;
  v_factor          numeric;
  v_cant_pres       numeric;
  v_kardex_id       bigint;
  v_ubicacion_id    bigint;
  v_subtotal        numeric := 0;
  v_count           int := 0;
begin
  select * into v_venta from venta where id = p_venta_id for update;
  if not found then
    raise exception 'Venta % no existe', p_venta_id;
  end if;
  if v_venta.estado <> 'ABIERTA' then
    raise exception 'Venta % está en estado % y no admite checkout', p_venta_id, v_venta.estado;
  end if;

  if v_venta.numero like 'VTD-%' or exists(select 1 from public.ubicacion where id=v_venta.ubicacion_id and upper(coalesce(codigo_zona,''))='VENTAS DIRECTAS') then
    perform almacen_operaciones.exigir_vtd_verificada(p_venta_id);
  end if;

  for v_linea in select * from venta_linea where venta_id = p_venta_id order by id loop
    v_count := v_count + 1;

    v_presentacion_id := v_linea.presentacion_id;

    if v_presentacion_id is null then
      select id, factor_unidad_base into v_presentacion_id, v_factor
        from presentacion
       where producto_id = v_linea.producto_id and es_base = true
       limit 1;
      if v_presentacion_id is null then
        raise exception 'Producto % no tiene presentación base', v_linea.producto_id;
      end if;
      v_cant_pres := v_linea.cantidad;
    else
      select factor_unidad_base into v_factor
        from presentacion where id = v_presentacion_id;
      if v_factor is null then
        raise exception 'Presentación % inexistente (línea %)', v_presentacion_id, v_linea.id;
      end if;
      v_cant_pres := coalesce(v_linea.cantidad_presentacion, v_linea.cantidad);
    end if;

    if round(v_cant_pres * v_factor, 4) <> round(v_linea.cantidad, 4) then
      raise exception
        'Línea % incoherente: % x factor % da % pero cantidad base es %. Abortado antes de escribir Kardex.',
        v_linea.id, v_cant_pres, v_factor, v_cant_pres * v_factor, v_linea.cantidad;
    end if;

    -- FIX 2026-09-09: resolver el estante físico real. Antes descontaba
    -- siempre contra v_venta.ubicacion_id, que en VTD es la 31 (virtual) —
    -- la mercadería salía del estante pero el Kardex debitaba un balde que
    -- además todos los totales filtran. Ver encabezado de esta migración.
    v_ubicacion_id := resolver_ubicacion_salida(v_linea.producto_id, v_venta.ubicacion_id);

    -- TEMPORAL (2026-08-26, revisado 2026-09-09): sobregiro incondicional.
    -- Se cierra en el PASO 4 del plan de regularización, reemplazando por
    -- permite_sobregiro_sucursal(v_linea.producto_id, 1), una vez que los 30
    -- productos sin stock suficiente tengan entrada real.
    --
    -- FIX 2026-08-29: p_fecha usa v_linea.creado_en (momento real del punto
    -- de venta, en hora local Bolivia) en vez del CURRENT_DATE por defecto.
    select registrar_salida(
      p_presentacion_id => v_presentacion_id,
      p_ubicacion_id    => v_ubicacion_id,
      p_cantidad_pres   => v_cant_pres,
      p_referencia      => 'Venta #' || p_venta_id,
      p_usuario         => p_usuario,
      p_fecha           => (v_linea.creado_en at time zone 'America/La_Paz')::date,
      p_idempotencia    => 'venta_linea:' || v_linea.id,
      p_permitir_sobregiro => true
    ) into v_kardex_id;

    update venta_linea
       set presentacion_id = v_presentacion_id,
           kardex_transaccion_id = v_kardex_id
     where id = v_linea.id;

    v_subtotal := v_subtotal + round(v_linea.precio_unitario * v_cant_pres, 2);
  end loop;

  if v_count = 0 then
    raise exception 'La venta % no tiene líneas', p_venta_id;
  end if;

  update venta
     set subtotal      = v_subtotal,
         total         = round(v_subtotal - coalesce(descuento_total, 0), 2),
         estado        = 'COMPLETADA',
         completado_en = now(),
         creado_por    = coalesce(creado_por, p_usuario)
   where id = p_venta_id;

  return jsonb_build_object(
    'venta_id', p_venta_id,
    'lineas',   v_count,
    'subtotal', v_subtotal,
    'total',    round(v_subtotal - coalesce(v_venta.descuento_total, 0), 2)
  );
end;
$function$
;
notify pgrst, 'reload schema';
