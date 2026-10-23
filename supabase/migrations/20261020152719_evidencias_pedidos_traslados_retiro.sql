-- Evidencias de Pedidos y Traslados QR. No modifica el circuito de VTD.
create schema evidencia_operacion;
revoke all on schema evidencia_operacion from public,anon;
grant usage on schema evidencia_operacion to authenticated,service_role;
create table evidencia_operacion.configuracion(
  id boolean primary key default true check(id), activo boolean not null default false,
  habilitado_desde timestamptz not null default now(),
  chat_id text not null default '-1003058173908', grupo_enlace text not null default '3058173908',
  tema_id bigint not null default 9, tema_traslados bigint not null default 17226, worker_url text
);
insert into evidencia_operacion.configuracion(id) values(true);
create table evidencia_operacion.lote(
  id uuid primary key, tipo text not null check(tipo in ('PEDIDO','TRASLADO_VIRTUAL')),
  documento_id bigint not null, entrega_id bigint not null,
  preparacion_id bigint references public.almacen_preparacion(id),
  documento_movil_id bigint references public.almacen_documento_movil(id),
  actor_id uuid not null references public.perfil(id), version integer not null,
  rutas jsonb not null check(jsonb_typeof(rutas)='array' and jsonb_array_length(rutas) between 1 and 10),
  estado text not null default 'BORRADOR' check(estado in ('BORRADOR','PENDIENTE','ENVIANDO','ENVIADO','ERROR','INCIERTO')),
  creado_en timestamptz not null default now(),caption text,intentos integer not null default 0,
  proximo_intento timestamptz not null default now(),lease uuid,iniciado_en timestamptz,enviado_en timestamptz,
  borrar_despues timestamptz,eliminado_en timestamptz,telegram jsonb,error text,
  limpieza_reclamada boolean not null default false,
  chat_id text not null,tema_id bigint not null,grupo_enlace text not null,
  check((tipo='PEDIDO' and preparacion_id=entrega_id and preparacion_id is not null and documento_movil_id is null)
    or (tipo='TRASLADO_VIRTUAL' and documento_movil_id=entrega_id and documento_movil_id is not null and preparacion_id is null))
);
create unique index evidencia_operacion_unica on evidencia_operacion.lote(tipo,entrega_id) where estado<>'BORRADOR';
create index evidencia_operacion_cola on evidencia_operacion.lote(proximo_intento) where estado='PENDIENTE';
create index evidencia_operacion_actor on evidencia_operacion.lote(actor_id);
create index evidencia_operacion_documento on evidencia_operacion.lote(tipo,documento_id,entrega_id);
create index evidencia_operacion_limpieza on evidencia_operacion.lote(borrar_despues) where eliminado_en is null;
create table evidencia_operacion.retiro(
  preparacion_id bigint primary key references public.almacen_preparacion(id),
  transportista_id uuid not null references public.perfil(id),transportista_nombre text not null,
  destino text not null check(length(destino) between 3 and 300),retirado_en timestamptz not null default now(),
  evidencia_id uuid not null unique references evidencia_operacion.lote(id),
  estado text not null default 'EN_TRANSPORTE' check(estado='EN_TRANSPORTE')
);
create table evidencia_operacion.invocacion(id uuid primary key default gen_random_uuid(),creado_en timestamptz not null default now());
create index evidencia_operacion_invocacion_fecha on evidencia_operacion.invocacion(creado_en);
alter table evidencia_operacion.configuracion enable row level security;
alter table evidencia_operacion.lote enable row level security;
alter table evidencia_operacion.retiro enable row level security;
alter table evidencia_operacion.invocacion enable row level security;
revoke all on all tables in schema evidencia_operacion from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('evidencias_operaciones','evidencias_operaciones',false,1048576,array['image/jpeg']);

create function evidencia_operacion.contexto(p_tipo text,p_documento bigint,p_entrega bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.perfil%rowtype; t public.almacen_preparacion%rowtype; d public.almacen_documento_movil%rowtype;
  origen bigint; destino bigint; creador uuid; revisor uuid; estado text; version integer; fecha timestamptz;
  numero text; preparador text; verificador text; titulo text; material text;
begin
  select * into a from public.perfil where id=auth.uid() and activo;
  if not found or a.rol not in ('admin','gerente','almacenero','operario','vendedor','cajero') then
    raise exception 'Tu perfil no permite consultar esta entrega.' using errcode='42501'; end if;
  if p_tipo='PEDIDO' then
    select * into t from public.almacen_preparacion where id=p_entrega and pedido_id=p_documento;
    if not found then raise exception 'No se encontró la preparación del pedido.'; end if;
    if a.rol not in ('admin','gerente','almacenero','operario') then raise exception 'Tu perfil no puede retirar pedidos.' using errcode='42501'; end if;
    origen:=t.sucursal_id;creador:=t.preparador_id;revisor:=t.revisor_id;estado:=t.estado;version:=t.version;fecha:=t.creado_en;
    preparador:=t.preparador_nombre;verificador:=t.revisor_nombre;
    select coalesce(p.numero,'#'||p.id),coalesce(c.nombre,'Sin cliente registrado') into numero,titulo
      from public.pedido p left join public.cliente c on c.id=p.cliente_id where p.id=p_documento and p.estado<>'CANCELADO';
    if not found then raise exception 'El pedido está cancelado o no existe.'; end if;
    select string_agg((snapshot->>'nombre')||' · '||preparada_base||' '||coalesce(snapshot->>'unidad_base','unidades'),E'\n' order by pedido_linea_id)
      into material from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and preparada_base>0;
  elsif p_tipo='TRASLADO_VIRTUAL' then
    select * into d from public.almacen_documento_movil where id=p_documento and id=p_entrega and tipo='TRASLADO_VIRTUAL';
    if not found then raise exception 'No se encontró el traslado virtual.'; end if;
    origen:=d.sucursal_origen_id;destino:=d.sucursal_destino_id;creador:=d.preparador_id;revisor:=d.revisor_id;
    estado:=d.estado;version:=d.version;fecha:=d.creado_en;numero:='Traslado virtual #'||d.id;
    preparador:=d.preparador_nombre;verificador:=d.revisor_nombre;
    select nombre into titulo from public.sucursal where id=destino;
    select string_agg((snapshot->>'nombre')||' · '||preparada_base||' '||coalesce(snapshot->>'unidad_base','unidades'),E'\n' order by id)
      into material from public.almacen_documento_linea where documento_id=d.id and vigente and preparada_base>0;
  else raise exception 'Tipo de evidencia no válido.'; end if;
  if not ((a.rol in ('admin','gerente','almacenero','operario') and (a.sucursal_id is null or a.sucursal_id=origen))
      or (p_tipo='TRASLADO_VIRTUAL' and (a.id=creador or a.sucursal_id=destino))) then
    raise exception 'La entrega pertenece a otra sucursal.' using errcode='42501'; end if;
  return jsonb_build_object('estado',estado,'version',version,'numero',numero,'titulo',titulo,'origen',origen,
    'preparador',preparador,'revisor',verificador,'material',material,
    'aplica',fecha >= (select habilitado_desde from evidencia_operacion.configuracion where id),
    'puede_capturar',a.rol in ('admin','gerente','almacenero','operario') and (a.sucursal_id is null or a.sucursal_id=origen)
      and case when p_tipo='PEDIDO' then estado='DESPACHADO' and revisor is not null and a.id<>creador and a.id<>revisor
        and not exists(select 1 from evidencia_operacion.retiro where preparacion_id=p_entrega)
      else estado='VERIFICADO' and a.id=revisor and a.id<>creador end);
end;
$$;
revoke all on function evidencia_operacion.contexto(text,bigint,bigint) from public,anon,authenticated;

create function evidencia_operacion.puede_subir(p_ruta text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare e evidencia_operacion.lote%rowtype; c jsonb;
begin
  select * into e from evidencia_operacion.lote where actor_id=auth.uid() and rutas ? p_ruta and estado='BORRADOR'
    and not limpieza_reclamada and eliminado_en is null and creado_en>now()-interval '48 hours';
  if not found then return false; end if;
  c:=evidencia_operacion.contexto(e.tipo,e.documento_id,e.entrega_id);
  return (select activo from evidencia_operacion.configuracion where id) and (c->>'aplica')::boolean
    and (c->>'puede_capturar')::boolean and (c->>'version')::integer=e.version;
end;
$$;
revoke all on function evidencia_operacion.puede_subir(text) from public,anon;
grant execute on function evidencia_operacion.puede_subir(text) to authenticated;
create policy evidencia_operacion_subir on storage.objects for insert to authenticated
with check(bucket_id='evidencias_operaciones' and evidencia_operacion.puede_subir(name));

create function evidencia_operacion.validar_lote(p_id uuid,p_tipo text,p_documento bigint,p_entrega bigint,p_version integer)
returns evidencia_operacion.lote language plpgsql security definer set search_path='' as $$
declare e evidencia_operacion.lote%rowtype;
begin
  select * into e from evidencia_operacion.lote where id=p_id for update;
  if not found or e.tipo<>p_tipo or e.documento_id<>p_documento or e.entrega_id<>p_entrega or e.actor_id<>auth.uid()
      or e.version<>p_version or e.estado<>'BORRADOR' or e.eliminado_en is not null or e.limpieza_reclamada then
    raise exception 'Adjunta fotos de esta entrega y de su versión actual.'; end if;
  if (select count(*) from storage.objects o where o.bucket_id='evidencias_operaciones' and e.rutas ? o.name
      and o.metadata->>'mimetype'='image/jpeg' and (o.metadata->>'size')::bigint between 1 and 1048576)<>jsonb_array_length(e.rutas) then
    raise exception 'Faltan fotos por subir. Conserva la pantalla y reintenta.'; end if;
  return e;
end;
$$;
revoke all on function evidencia_operacion.validar_lote(uuid,text,bigint,bigint,integer) from public,anon,authenticated;

create function evidencia_operacion.operar(p_tipo text,p_documento bigint,p_entrega bigint,p_accion text,p_datos jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; a public.perfil%rowtype; e evidencia_operacion.lote%rowtype; cfg evidencia_operacion.configuracion%rowtype;
  rid uuid;n integer;destino text;r evidencia_operacion.retiro%rowtype;
begin
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>4096 then raise exception 'Datos inválidos.'; end if;
  -- Mismo orden de locks que los motores originales: documento, preparación, lote.
  if p_tipo='PEDIDO' then
    perform id from public.pedido where id=p_documento for update;
    perform id from public.almacen_preparacion where id=p_entrega and pedido_id=p_documento for update;
  elsif p_tipo='TRASLADO_VIRTUAL' then perform id from public.almacen_documento_movil where id=p_documento for update;
  end if;
  c:=evidencia_operacion.contexto(p_tipo,p_documento,p_entrega);
  select * into cfg from evidencia_operacion.configuracion where id;
  select * into a from public.perfil where id=auth.uid() and activo;
  if p_accion='crear' then
    if not cfg.activo or not (c->>'aplica')::boolean then raise exception 'Esta entrega no tiene habilitadas las evidencias nuevas.'; end if;
    if not (c->>'puede_capturar')::boolean then raise exception 'El retiro requiere una tercera persona distinta de quien preparó y revisó; el traslado lo confirma su revisor.' using errcode='42501'; end if;
    if (p_datos->>'version')::integer is distinct from (c->>'version')::integer then raise exception 'La entrega cambió. Actualiza antes de adjuntar fotos.' using errcode='40001'; end if;
    rid:=(p_datos->>'id')::uuid;n:=(p_datos->>'cantidad')::integer;
    if rid is null or n is null or n not between 1 and 10 then raise exception 'Adjunta entre 1 y 10 fotos.'; end if;
    insert into evidencia_operacion.lote(id,tipo,documento_id,entrega_id,preparacion_id,documento_movil_id,actor_id,version,rutas,chat_id,tema_id,grupo_enlace)
    select rid,p_tipo,p_documento,p_entrega,case when p_tipo='PEDIDO' then p_entrega end,
      case when p_tipo='TRASLADO_VIRTUAL' then p_entrega end,a.id,(c->>'version')::integer,
      jsonb_agg(a.id||'/'||rid||'/'||i||'.jpg' order by i),cfg.chat_id,
      case when p_tipo='PEDIDO' then cfg.tema_id else cfg.tema_traslados end,cfg.grupo_enlace
      from generate_series(1,n) i on conflict(id) do nothing;
    select * into e from evidencia_operacion.lote where id=rid for update;
    if e.actor_id<>a.id or e.tipo<>p_tipo or e.documento_id<>p_documento or e.entrega_id<>p_entrega or e.version<>(c->>'version')::integer
      or jsonb_array_length(e.rutas)<>n or e.estado<>'BORRADOR' or e.eliminado_en is not null or e.limpieza_reclamada then raise exception 'El lote no corresponde a esta captura.' using errcode='42501'; end if;
    return jsonb_build_object('id',e.id,'rutas',e.rutas,'subidas',coalesce((select jsonb_agg(name) from storage.objects where bucket_id='evidencias_operaciones' and e.rutas ? name),'[]'));
  elsif p_accion='retirar' then
    if p_tipo<>'PEDIDO' then raise exception 'Los traslados conservan dos responsables; no tienen transportista.'; end if;
    select * into r from evidencia_operacion.retiro where preparacion_id=p_entrega;
    if found then
      if r.transportista_id<>a.id or r.destino is distinct from btrim(p_datos->>'destino') or r.evidencia_id is distinct from (p_datos->>'evidencia_id')::uuid then
        raise exception 'Esta entrega ya tiene un retiro confirmado. Consulta el registro.'; end if;
    else
      if not cfg.activo or not (c->>'aplica')::boolean or not (c->>'puede_capturar')::boolean then raise exception 'Sólo una tercera persona puede retirar esta entrega despachada.' using errcode='42501'; end if;
      if (p_datos->>'version')::integer is distinct from (c->>'version')::integer then raise exception 'La entrega cambió. Actualiza.' using errcode='40001'; end if;
      destino:=btrim(coalesce(p_datos->>'destino',''));
      if length(destino) not between 3 and 300 then raise exception 'Indica el destino de esta entrega (3 a 300 caracteres).'; end if;
      e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,p_tipo,p_documento,p_entrega,(c->>'version')::integer);
      insert into evidencia_operacion.retiro(preparacion_id,transportista_id,transportista_nombre,destino,evidencia_id)
        values(p_entrega,a.id,a.nombre,destino,e.id);
      update evidencia_operacion.lote set estado='PENDIENTE',caption=left('RETIRO DE PEDIDO PARA TRANSPORTE'||E'\n'||(c->>'numero')||
        E'\nEntrega: '||p_entrega||E'\nPreparó: '||(c->>'preparador')||E'\nRevisó: '||(c->>'revisor')||E'\nTransporta: '||a.nombre||
        E'\nDestino: '||destino||E'\nFecha: '||to_char(now() at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI')||
        E'\nRef. evidencia: '||e.id||E'\nMaterial:\n'||coalesce(c->>'material',''),1000) where id=e.id;
      insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle)
        values(p_entrega,'RETIRO_TRANSPORTE',a.id,a.nombre,jsonb_build_object('destino',destino,'evidencia_id',e.id));
    end if;
  elsif p_accion='reintentar' then
    select * into e from evidencia_operacion.lote where id=(p_datos->>'id')::uuid and tipo=p_tipo and documento_id=p_documento and entrega_id=p_entrega for update;
    if not found or e.estado<>'ERROR' then raise exception 'Sólo se reintentan errores confirmados.'; end if;
    if a.id<>e.actor_id and a.rol not in ('admin','gerente') then raise exception 'Sólo el responsable o un encargado puede reintentar.' using errcode='42501'; end if;
    update evidencia_operacion.lote set estado='PENDIENTE',intentos=0,error=null,proximo_intento=now() where id=e.id;
  elsif p_accion<>'consultar' then raise exception 'Acción de evidencia no disponible.'; end if;
  return jsonb_build_object('activo',cfg.activo and (c->>'aplica')::boolean,'contexto',c,
    'retiro',(select to_jsonb(x) from evidencia_operacion.retiro x where p_tipo='PEDIDO' and x.preparacion_id=p_entrega),
    'envios',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'estado',l.estado,'cantidad',jsonb_array_length(l.rutas),
      'error',l.error,'enviado_en',l.enviado_en,'eliminado_en',l.eliminado_en,'enlace',case when l.estado='ENVIADO' then
        'https://t.me/c/'||l.grupo_enlace||'/'||l.tema_id||'/'||(l.telegram->0->>'message_id') end) order by l.creado_en)
      from evidencia_operacion.lote l where l.tipo=p_tipo and l.documento_id=p_documento and l.entrega_id=p_entrega and l.estado<>'BORRADOR'),'[]'));
end;
$$;
revoke all on function evidencia_operacion.operar(text,bigint,bigint,text,jsonb) from public,anon;
grant execute on function evidencia_operacion.operar(text,bigint,bigint,text,jsonb) to authenticated;
create function public.operar_evidencia_operacion(p_tipo text,p_documento_id bigint,p_entrega_id bigint,p_accion text default 'consultar',p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select evidencia_operacion.operar(p_tipo,p_documento_id,p_entrega_id,p_accion,p_datos)$$;
revoke all on function public.operar_evidencia_operacion(text,bigint,bigint,text,jsonb) from public,anon;
grant execute on function public.operar_evidencia_operacion(text,bigint,bigint,text,jsonb) to authenticated;

-- Escanear una entrega despachada consulta su retiro; no crea otra preparación por accidente.
create function evidencia_operacion.preparacion(p_pedido bigint,p_sucursal bigint,p_tarea bigint,p_accion text,p_version integer,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tarea bigint:=p_tarea;accion text:=p_accion;r jsonb;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
  if p_accion='escanear' and (select activo from evidencia_operacion.configuracion where id) then
    if tarea is null then select id into tarea from public.almacen_preparacion where pedido_id=p_pedido and sucursal_id=p_sucursal order by id desc limit 1; end if;
    if exists(select 1 from public.almacen_preparacion where id=tarea and estado='DESPACHADO'
      and creado_en>=(select habilitado_desde from evidencia_operacion.configuracion where id)) then accion:='consultar'; end if;
  end if;
  r:=almacen_operaciones.operar(p_pedido,p_sucursal,tarea,accion,p_version,p_datos);
  return r||jsonb_build_object('retiro',(select to_jsonb(x) from evidencia_operacion.retiro x where x.preparacion_id=(r->'tarea'->>'id')::bigint),
    'retiros_pendientes',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'preparador',t.preparador_nombre,'revisor',t.revisor_nombre) order by t.id)
      from public.almacen_preparacion t where t.pedido_id=p_pedido and t.sucursal_id=p_sucursal and t.estado='DESPACHADO'
      and (select activo and t.creado_en>=habilitado_desde from evidencia_operacion.configuracion where id)
      and not exists(select 1 from evidencia_operacion.retiro x where x.preparacion_id=t.id)),'[]'));
end;
$$;
revoke all on function evidencia_operacion.preparacion(bigint,bigint,bigint,text,integer,jsonb) from public,anon;
grant execute on function evidencia_operacion.preparacion(bigint,bigint,bigint,text,integer,jsonb) to authenticated;
create or replace function public.operar_preparacion_pedido(p_pedido_id bigint,p_sucursal_id bigint,p_tarea_id bigint default null,p_accion text default 'consultar',p_version integer default null,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select evidencia_operacion.preparacion(p_pedido_id,p_sucursal_id,p_tarea_id,p_accion,p_version,p_datos)$$;

-- Traslados: el segundo responsable autoriza salida y evidencia en una sola transacción.
create function evidencia_operacion.documento(p_tipo text,p_id bigint,p_accion text,p_version integer,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.almacen_documento_movil%rowtype;c jsonb;e evidencia_operacion.lote%rowtype;r jsonb;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
  if p_tipo='TRASLADO_VIRTUAL' and p_accion='autorizar' then
    select * into d from public.almacen_documento_movil where id=p_id and tipo='TRASLADO_VIRTUAL' for update;
    if d.estado='VERIFICADO' and (select activo and d.creado_en>=habilitado_desde from evidencia_operacion.configuracion where id) then
      c:=evidencia_operacion.contexto(p_tipo,p_id,p_id);
      if not (c->>'puede_capturar')::boolean then raise exception 'Sólo el revisor asignado puede autorizar este traslado.' using errcode='42501'; end if;
      e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,p_tipo,p_id,p_id,d.version);
    end if;
  end if;
  r:=almacen_operaciones.operar_documento(p_tipo,p_id,p_accion,p_version,p_datos);
  if e.id is not null then
    update evidencia_operacion.lote set estado='PENDIENTE',caption=left('SALIDA DE TRASLADO'||E'\n'||(c->>'numero')||
      E'\nPreparó: '||(c->>'preparador')||E'\nRevisó y autorizó: '||(c->>'revisor')||E'\nDestino: '||(c->>'titulo')||
      E'\nFecha: '||to_char(now() at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI')||
      E'\nRef. evidencia: '||e.id||E'\nMaterial:\n'||coalesce(c->>'material',''),1000) where id=e.id;
  end if;
  return r;
end;
$$;
revoke execute on function almacen_operaciones.operar_documento(text,bigint,text,integer,jsonb) from authenticated;
revoke all on function evidencia_operacion.documento(text,bigint,text,integer,jsonb) from public,anon;
grant execute on function evidencia_operacion.documento(text,bigint,text,integer,jsonb) to authenticated;
create or replace function public.operar_documento_movil(p_tipo text,p_documento_id bigint default null,p_accion text default 'consultar',p_version integer default null,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select evidencia_operacion.documento(p_tipo,p_documento_id,p_accion,p_version,p_datos)$$;

-- Reutiliza las reservas, reintentos, retención y credenciales de un uso ya probadas.
do $$ declare f text; begin
  f:=pg_get_functiondef('public.worker_evidencia_vtd(text,jsonb)'::regprocedure);
  f:=replace(replace(f,'public.worker_evidencia_vtd','public.worker_evidencia_operacion'),'evidencia_vtd.','evidencia_operacion.');
  execute f;
  f:=pg_get_functiondef('evidencia_vtd.invocar(text)'::regprocedure);
  execute replace(f,'evidencia_vtd.','evidencia_operacion.');
  f:=pg_get_functiondef('evidencia_vtd.despertar()'::regprocedure);
  execute replace(f,'evidencia_vtd.','evidencia_operacion.');
end $$;
revoke all on function public.worker_evidencia_operacion(text,jsonb) from public,anon,authenticated;
grant execute on function public.worker_evidencia_operacion(text,jsonb) to service_role;
revoke all on function evidencia_operacion.invocar(text),evidencia_operacion.despertar() from public,anon,authenticated;
do $$ begin
  if to_regnamespace('cron') is not null then perform cron.schedule('evidencia-operaciones-telegram','* * * * *','select evidencia_operacion.despertar()'); end if;
end $$;
notify pgrst,'reload schema';
