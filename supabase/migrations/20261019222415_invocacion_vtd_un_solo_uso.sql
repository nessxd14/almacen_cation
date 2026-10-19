-- pg_net concede SELECT a roles de aplicación: no poner secretos reutilizables
-- en su cola. Cada invocación usa una credencial aleatoria de un solo uso.
create table evidencia_vtd.invocacion(id uuid primary key default gen_random_uuid(),creado_en timestamptz not null default now());
alter table evidencia_vtd.invocacion enable row level security;
revoke all on evidencia_vtd.invocacion from public,anon,authenticated;
create index evidencia_vtd_invocacion_fecha on evidencia_vtd.invocacion(creado_en);

do $$ declare definicion text; anterior text; nuevo text;
begin
  definicion:=pg_get_functiondef('public.worker_evidencia_vtd(text,jsonb)'::regprocedure);
  anterior:='if p_accion=''autorizar'' then return jsonb_build_object(''autorizado'',length(coalesce(p_datos->>''token'',''''))>0 and c.worker_token=p_datos->>''token''); end if;';
  nuevo:='if p_accion=''autorizar'' then delete from evidencia_vtd.invocacion where id::text=coalesce(p_datos->>''token'','''') and creado_en>now()-interval ''5 minutes''; return jsonb_build_object(''autorizado'',found); end if;';
  if strpos(definicion,anterior)=0 then raise exception 'La función worker cambió; revisar la migración antes de continuar.'; end if;
  execute replace(definicion,anterior,nuevo);
end $$;

create function evidencia_vtd.invocar(p_accion text default null) returns bigint
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare c evidencia_vtd.configuracion%rowtype; v_nonce uuid; request_id bigint;
begin
  select * into c from evidencia_vtd.configuracion where id;
  if c.worker_url is null then return null; end if;
  delete from evidencia_vtd.invocacion where creado_en<now()-interval '5 minutes';
  insert into evidencia_vtd.invocacion default values returning id into v_nonce;
  select net.http_post(url:=c.worker_url,body:=jsonb_build_object('token',v_nonce::text,'accion',p_accion),headers:='{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds:=case when p_accion='diagnostico' then 20000 else 1000 end) into request_id;
  return request_id;
end;
$$;
revoke all on function evidencia_vtd.invocar(text) from public,anon,authenticated;

create or replace function evidencia_vtd.despertar() returns void
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  if (select activo from evidencia_vtd.configuracion where id) and exists(select 1 from evidencia_vtd.lote where
      (estado='PENDIENTE' and proximo_intento<=now()) or (estado='ENVIANDO' and iniciado_en<now()-interval '10 minutes') or
      (eliminado_en is null and ((estado='ENVIADO' and borrar_despues<=now()) or (estado='BORRADOR' and creado_en<now()-interval '48 hours')))) then
    perform evidencia_vtd.invocar();
  end if;
end;
$$;
alter table evidencia_vtd.configuracion drop column worker_token;

-- Reservar los borradores antes de eliminarlos impide que una confirmación
-- concurrente los convierta en una salida pendiente mientras Storage los borra.
alter table evidencia_vtd.lote add column limpieza_reclamada boolean not null default false;
do $$ declare definicion text; anterior text; nuevo text;
begin
  definicion:=pg_get_functiondef('evidencia_vtd.puede_subir(text)'::regprocedure);
  execute replace(definicion,'e.estado=''BORRADOR'' and d.estado=','not e.limpieza_reclamada and e.estado=''BORRADOR'' and d.estado=');
  definicion:=pg_get_functiondef('evidencia_vtd.operar(text,bigint,jsonb)'::regprocedure);
  execute replace(definicion,'or e.eliminado_en is not null then','or e.eliminado_en is not null or e.limpieza_reclamada then');
  definicion:=pg_get_functiondef('evidencia_vtd.operar_caja(text,uuid,bigint,jsonb)'::regprocedure);
  execute replace(definicion,'or e.eliminado_en is not null then','or e.eliminado_en is not null or e.limpieza_reclamada then');
  definicion:=pg_get_functiondef('public.worker_evidencia_vtd(text,jsonb)'::regprocedure);
  anterior:=$old$select coalesce(jsonb_agg(to_jsonb(x)),'[]') into resultado from (
      select id,rutas from evidencia_vtd.lote where eliminado_en is null and
       ((estado='ENVIADO' and borrar_despues<=now() and telegram is not null) or (estado='BORRADOR' and creado_en<now()-interval '48 hours'))
      order by creado_en limit 20
    ) x; return resultado;$old$;
  nuevo:=$new$with candidatos as (
      select id from evidencia_vtd.lote where eliminado_en is null and
       ((estado='ENVIADO' and borrar_despues<=now() and telegram is not null) or (estado='BORRADOR' and creado_en<now()-interval '48 hours'))
      order by creado_en for update skip locked limit 20
    ), reclamados as (
      update evidencia_vtd.lote l set limpieza_reclamada=true from candidatos cand where l.id=cand.id returning l.id,l.rutas
    ) select coalesce(jsonb_agg(to_jsonb(r)),'[]') into resultado from reclamados r;
    return resultado;$new$;
  if strpos(definicion,anterior)=0 then raise exception 'La limpieza cambió; revisar la migración.'; end if;
  execute replace(definicion,anterior,nuevo);
end $$;
