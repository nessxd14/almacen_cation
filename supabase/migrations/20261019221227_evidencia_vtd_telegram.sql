-- Evidencia privada, obligatoria al activar, y outbox transaccional de Telegram.
-- No se modifica stock, cobros ni evidencia_despacho (revisión de OpenClaw).
create schema evidencia_vtd;
revoke all on schema evidencia_vtd from public, anon;
grant usage on schema evidencia_vtd to authenticated, service_role;

create table evidencia_vtd.configuracion (
  id boolean primary key default true check(id),
  activo boolean not null default false,
  chat_id text not null default '-1003058173908',
  tema_id bigint not null default 17051,
  grupo_enlace text not null default '3058173908',
  worker_url text,
  worker_token text not null default (gen_random_uuid()::text || gen_random_uuid()::text)
);
insert into evidencia_vtd.configuracion(id) values(true);
alter table evidencia_vtd.configuracion enable row level security;
revoke all on evidencia_vtd.configuracion from public, anon, authenticated;

create table evidencia_vtd.lote (
  id uuid primary key,
  venta_id bigint not null references public.venta(id),
  actor_id uuid not null references public.perfil(id),
  version integer not null,
  rutas jsonb not null check(jsonb_typeof(rutas)='array' and jsonb_array_length(rutas) between 1 and 10),
  estado text not null default 'BORRADOR' check(estado in ('BORRADOR','PENDIENTE','ENVIANDO','ENVIADO','ERROR','INCIERTO')),
  creado_en timestamptz not null default now(),
  caption text,
  intentos integer not null default 0,
  proximo_intento timestamptz not null default now(),
  lease uuid,
  iniciado_en timestamptz,
  enviado_en timestamptz,
  borrar_despues timestamptz,
  eliminado_en timestamptz,
  telegram jsonb,
  error text
);
create index evidencia_vtd_venta on evidencia_vtd.lote(venta_id,creado_en);
create index evidencia_vtd_actor on evidencia_vtd.lote(actor_id);
create unique index evidencia_vtd_salida_unica on evidencia_vtd.lote(venta_id) where estado<>'BORRADOR';
create index evidencia_vtd_cola on evidencia_vtd.lote(proximo_intento) where estado='PENDIENTE';
create index evidencia_vtd_limpieza on evidencia_vtd.lote(borrar_despues) where estado='ENVIADO' and eliminado_en is null;
alter table evidencia_vtd.lote enable row level security;
revoke all on evidencia_vtd.lote from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('evidencias_vtd','evidencias_vtd',false,1048576,array['image/jpeg']);

create function evidencia_vtd.puede_subir(p_ruta text) returns boolean
language sql stable security definer set search_path=pg_catalog,public,pg_temp as $$
  select exists(select 1 from evidencia_vtd.lote e
    join public.caja_operacion_vtd d on d.venta_id=e.venta_id
    join public.venta v on v.id=d.venta_id join public.ubicacion u on u.id=v.ubicacion_id
    join public.perfil p on p.id=e.actor_id
    where e.actor_id=auth.uid() and p.activo and p.rol in ('admin','gerente','almacenero','operario')
      and (p.rol in ('admin','gerente') or p.sucursal_id=u.sucursal_id)
      and (d.responsable_id is null or d.responsable_id=p.id)
      and e.estado='BORRADOR' and d.estado='SOLICITADO' and d.version=e.version
      and e.rutas ? p_ruta and e.creado_en>now()-interval '48 hours');
$$;
revoke all on function evidencia_vtd.puede_subir(text) from public,anon;
grant execute on function evidencia_vtd.puede_subir(text) to authenticated;
create policy evidencia_vtd_subir on storage.objects for insert to authenticated
with check(bucket_id='evidencias_vtd' and evidencia_vtd.puede_subir(name));
-- Objetos inmutables: el navegador no recibe SELECT, UPDATE ni DELETE.

create function evidencia_vtd.operar(p_accion text,p_venta_id bigint,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare actor public.perfil%rowtype; d public.caja_operacion_vtd%rowtype; e evidencia_vtd.lote%rowtype; n integer; v_id uuid;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if not found or actor.rol not in ('admin','gerente','almacenero','operario') then raise exception 'Tu perfil no permite gestionar evidencias VTD.' using errcode='42501'; end if;
  -- Reutiliza autorización por sucursal y el orden de locks del expediente.
  perform caja_almacen.operar('consultar_vtd',null,null,jsonb_build_object('venta_id',p_venta_id));
  select * into d from public.caja_operacion_vtd where venta_id=p_venta_id;
  if not found then raise exception 'La VTD no tiene un expediente de salida a Caja.'; end if;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>4096 then raise exception 'Datos de evidencia inválidos.'; end if;
  if p_accion='crear' then
    if not (select activo from evidencia_vtd.configuracion where id) then raise exception 'El envío de evidencias todavía no está activado.'; end if;
    if d.estado<>'SOLICITADO' or d.version is distinct from (p_datos->>'version')::integer then raise exception 'La entrega cambió. Actualiza antes de adjuntar fotos.' using errcode='40001'; end if;
    if d.responsable_id is not null and d.responsable_id<>actor.id then raise exception 'Otro encargado tiene esta verificación.' using errcode='42501'; end if;
    n:=(p_datos->>'cantidad')::integer; v_id:=(p_datos->>'id')::uuid;
    if v_id is null or n is null or n not between 1 and 10 then raise exception 'Adjunta entre 1 y 10 fotos.'; end if;
    -- Evita crear indefinidamente lotes vacíos desde una sesión autorizada.
    if not exists(select 1 from evidencia_vtd.lote where id=v_id) and (select count(*) from evidencia_vtd.lote where venta_id=p_venta_id and estado='BORRADOR' and eliminado_en is null)>=20 then raise exception 'Hay demasiadas cargas pendientes para esta VTD. Contacta al administrador.'; end if;
    insert into evidencia_vtd.lote(id,venta_id,actor_id,version,rutas)
      select v_id,p_venta_id,actor.id,d.version,jsonb_agg(actor.id::text||'/'||v_id::text||'/'||i||'.jpg' order by i) from generate_series(1,n) i
      on conflict(id) do nothing;
    select * into e from evidencia_vtd.lote where id=v_id for update;
    if e.actor_id<>actor.id or e.venta_id<>p_venta_id or e.version<>d.version or jsonb_array_length(e.rutas)<>n or e.estado<>'BORRADOR' or e.eliminado_en is not null then raise exception 'El lote no corresponde a esta captura.' using errcode='42501'; end if;
    return jsonb_build_object('id',e.id,'rutas',e.rutas,'subidas',coalesce((select jsonb_agg(o.name) from storage.objects o where o.bucket_id='evidencias_vtd' and e.rutas ? o.name),'[]'));
  elsif p_accion='reintentar' then
    select * into e from evidencia_vtd.lote where id=(p_datos->>'id')::uuid and venta_id=p_venta_id for update;
    if not found or e.estado<>'ERROR' then raise exception 'Sólo se puede reintentar un envío con error confirmado.'; end if;
    update evidencia_vtd.lote set estado='PENDIENTE',intentos=0,error=null,proximo_intento=now() where id=e.id;
  elsif p_accion<>'consultar' then raise exception 'Acción de evidencia no disponible.'; end if;
  return jsonb_build_object('activo',(select activo from evidencia_vtd.configuracion where id),'envios',coalesce((
    select jsonb_agg(jsonb_build_object('id',l.id,'estado',l.estado,'cantidad',jsonb_array_length(l.rutas),'error',l.error,
      'enviado_en',l.enviado_en,'eliminado_en',l.eliminado_en,'enlace',case when l.estado='ENVIADO' then
      'https://t.me/c/'||c.grupo_enlace||'/'||c.tema_id||'/'||(l.telegram->0->>'message_id') end) order by l.creado_en)
    from evidencia_vtd.lote l cross join evidencia_vtd.configuracion c where l.venta_id=p_venta_id and l.estado<>'BORRADOR'
  ),'[]'));
end;
$$;
revoke all on function evidencia_vtd.operar(text,bigint,jsonb) from public,anon;
grant execute on function evidencia_vtd.operar(text,bigint,jsonb) to authenticated;
create function public.operar_evidencia_vtd(p_accion text,p_venta_id bigint,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path=pg_catalog,public,pg_temp as $$select evidencia_vtd.operar(p_accion,p_venta_id,p_datos)$$;
revoke all on function public.operar_evidencia_vtd(text,bigint,jsonb) from public,anon;
grant execute on function public.operar_evidencia_vtd(text,bigint,jsonb) to authenticated;

create function evidencia_vtd.operar_caja(p_accion text,p_operacion_id uuid,p_sesion_id bigint,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r jsonb; d public.caja_operacion_vtd%rowtype; e evidencia_vtd.lote%rowtype; v_caption text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
  if p_accion='enviar' and (select activo from evidencia_vtd.configuracion where id) then
    r:=caja_almacen.operar('consultar_vtd',p_operacion_id,p_sesion_id,p_datos);
    select * into d from public.caja_operacion_vtd where venta_id=(p_datos->>'venta_id')::bigint;
    -- Un reintento del RPC ya confirmado devuelve la misma salida sin repetir el envío.
    if d.estado='SOLICITADO' then
      select * into e from evidencia_vtd.lote where id=(p_datos->>'evidencia_id')::uuid for update;
      if not found or e.venta_id<>d.venta_id or e.actor_id<>auth.uid() or e.version<>d.version or e.estado<>'BORRADOR' or e.eliminado_en is not null then raise exception 'Adjunta al menos una foto de esta salida antes de enviar a Caja.'; end if;
      if (select count(*) from storage.objects o where o.bucket_id='evidencias_vtd' and e.rutas ? o.name
        and o.metadata->>'mimetype'='image/jpeg' and (o.metadata->>'size')::bigint between 1 and 1048576)<>jsonb_array_length(e.rutas) then raise exception 'Faltan fotos por subir. Conserva la pantalla y reintenta.'; end if;
    end if;
  end if;
  r:=caja_almacen.operar(p_accion,p_operacion_id,p_sesion_id,p_datos);
  if e.id is not null then
    select 'SALIDA DE ALMACÉN HACIA CAJA'||E'\n'||v.numero||E'\nResponsable: '||p.nombre||
      E'\nFecha: '||to_char(now() at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI')||
      E'\nRef. evidencia: '||e.id::text||E'\nMaterial:\n'||coalesce((select string_agg((x->>'nombre')||' · '||(x->>'cantidad_presentacion')||' '||(x->>'presentacion'),E'\n') from jsonb_array_elements(d.lineas) x),'')
      into v_caption from public.venta v join public.perfil p on p.id=auth.uid() where v.id=d.venta_id;
    update evidencia_vtd.lote set estado='PENDIENTE',caption=left(v_caption,1000),proximo_intento=now() where id=e.id;
  end if;
  return r;
end;
$$;
-- Cierra la ruta directa anterior para que no se pueda saltar la foto obligatoria.
revoke execute on function caja_almacen.operar(text,uuid,bigint,jsonb) from authenticated;
revoke all on function evidencia_vtd.operar_caja(text,uuid,bigint,jsonb) from public,anon;
grant execute on function evidencia_vtd.operar_caja(text,uuid,bigint,jsonb) to authenticated;
create or replace function public.operar_caja_almacen(p_accion text,p_operacion_id uuid default null,p_sesion_id bigint default null,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path=pg_catalog,public,pg_temp as $$select evidencia_vtd.operar_caja(p_accion,p_operacion_id,p_sesion_id,p_datos)$$;

-- Exclusivo del servidor. No acepta destinos ni captions aportados por el cliente.
create function public.worker_evidencia_vtd(p_accion text,p_datos jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare e evidencia_vtd.lote%rowtype; c evidencia_vtd.configuracion%rowtype; resultado jsonb;
begin
  select * into c from evidencia_vtd.configuracion where id;
  if p_accion='autorizar' then return jsonb_build_object('autorizado',length(coalesce(p_datos->>'token',''))>0 and c.worker_token=p_datos->>'token'); end if;
  if p_accion='configuracion' then return jsonb_build_object('activo',c.activo,'chat_id',c.chat_id,'tema_id',c.tema_id); end if;
  if p_accion='reclamar' then
    if not c.activo then return null; end if;
    update evidencia_vtd.lote set estado='INCIERTO',error='El envío no recibió confirmación. Revisar Telegram antes de repetir.' where estado='ENVIANDO' and iniciado_en<now()-interval '10 minutes';
    select * into e from evidencia_vtd.lote where estado='PENDIENTE' and proximo_intento<=now() order by proximo_intento for update skip locked limit 1;
    if not found then return null; end if;
    update evidencia_vtd.lote set estado='ENVIANDO',lease=gen_random_uuid(),iniciado_en=now(),intentos=intentos+1 where id=e.id returning * into e;
    return to_jsonb(e);
  elsif p_accion in ('confirmar','error','incierto') then
    select * into e from evidencia_vtd.lote where id=(p_datos->>'id')::uuid and lease=(p_datos->>'lease')::uuid and estado='ENVIANDO' for update;
    if not found then
      if p_accion='confirmar' and exists(select 1 from evidencia_vtd.lote where id=(p_datos->>'id')::uuid and lease=(p_datos->>'lease')::uuid and estado='ENVIADO') then return jsonb_build_object('ok',true); end if;
      raise exception 'La reserva del envío ya no está vigente.';
    end if;
    if p_accion='confirmar' then
      if jsonb_typeof(p_datos->'telegram') is distinct from 'array' or jsonb_array_length(p_datos->'telegram')<>jsonb_array_length(e.rutas) then raise exception 'Confirmación de Telegram incompleta.'; end if;
      update evidencia_vtd.lote set estado='ENVIADO',telegram=p_datos->'telegram',enviado_en=now(),borrar_despues=now()+interval '48 hours',error=null where id=e.id;
    else
      update evidencia_vtd.lote set estado=case when p_accion='incierto' then 'INCIERTO' when intentos>=5 then 'ERROR' else 'PENDIENTE' end,
        error=case when p_accion='incierto' then 'Respuesta de Telegram no confirmada. Revisión manual requerida.' else 'Telegram rechazó el envío. Comprueba la configuración y los permisos del bot.' end,
        proximo_intento=now()+make_interval(secs=>greatest(60,least(86400,coalesce((p_datos->>'retry_after')::integer,least(3600,60*power(2,intentos)::integer))))) where id=e.id;
    end if;
    return jsonb_build_object('ok',true);
  elsif p_accion='limpiar' then
    -- Nunca incluye pendientes, errores ni resultados inciertos.
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into resultado from (
      select id,rutas from evidencia_vtd.lote where eliminado_en is null and
       ((estado='ENVIADO' and borrar_despues<=now() and telegram is not null) or (estado='BORRADOR' and creado_en<now()-interval '48 hours'))
      order by creado_en limit 20
    ) x; return resultado;
  elsif p_accion='borrado' then
    update evidencia_vtd.lote set eliminado_en=now() where id=(p_datos->>'id')::uuid and eliminado_en is null and
      ((estado='ENVIADO' and borrar_despues<=now() and telegram is not null) or (estado='BORRADOR' and creado_en<now()-interval '48 hours'));
    return jsonb_build_object('ok',found);
  else raise exception 'Acción del worker no disponible.'; end if;
end;
$$;
revoke all on function public.worker_evidencia_vtd(text,jsonb) from public,anon,authenticated;
grant execute on function public.worker_evidencia_vtd(text,jsonb) to service_role;

create function evidencia_vtd.despertar() returns void
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare c evidencia_vtd.configuracion%rowtype;
begin
  select * into c from evidencia_vtd.configuracion where id;
  if c.activo and c.worker_url is not null and exists(select 1 from evidencia_vtd.lote where
      (estado='PENDIENTE' and proximo_intento<=now()) or (estado='ENVIANDO' and iniciado_en<now()-interval '10 minutes') or
      (eliminado_en is null and ((estado='ENVIADO' and borrar_despues<=now()) or (estado='BORRADOR' and creado_en<now()-interval '48 hours')))) then
    perform net.http_post(url:=c.worker_url,body:=jsonb_build_object('token',c.worker_token),headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=1000);
  end if;
end;
$$;
revoke all on function evidencia_vtd.despertar() from public,anon,authenticated;
do $$ begin
  if to_regnamespace('cron') is not null then
    perform cron.schedule('evidencia-vtd-telegram','* * * * *','select evidencia_vtd.despertar()');
  end if;
end $$;
