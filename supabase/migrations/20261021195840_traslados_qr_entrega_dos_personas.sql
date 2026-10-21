-- Solicitudes TRA del carrito: alistador -> receptor en la entrega física.
-- La bandera empieza apagada. No convierte TV, VTD, Pedidos ni salidas históricas.
create schema traslado_qr;
revoke all on schema traslado_qr from public,anon;
grant usage on schema traslado_qr to authenticated,service_role;
alter table evidencia_operacion.configuracion add column traslados_qr boolean not null default false;
create table traslado_qr.tarea(
  solicitud_id bigint primary key references public.solicitud_traslado(id),
  estado text not null default 'PREPARANDO' check(estado in ('PREPARANDO','PREPARADO','REVISANDO','RECIBIDO','ANULADO')),
  version integer not null default 1,
  preparador_id uuid not null references public.perfil(id),preparador_nombre text not null,
  receptor_id uuid references public.perfil(id),receptor_nombre text,
  creado_en timestamptz not null default now(),actualizado_en timestamptz not null default now(),
  preparado_en timestamptz,revision_en timestamptz,recibido_en timestamptz,
  evidencia_recepcion_id uuid references evidencia_operacion.lote(id),resultado jsonb
);
create table traslado_qr.linea(
  solicitud_id bigint not null references traslado_qr.tarea(solicitud_id),
  linea_id bigint not null references public.solicitud_traslado_linea(id),snapshot jsonb not null,
  vigente boolean not null default true,preparada_base numeric not null default 0 check(preparada_base>=0),
  confirmada boolean not null default false,observacion text not null default '' check(length(observacion)<=1000),
  revisada_base numeric check(revisada_base>=0),observacion_revision text not null default '' check(length(observacion_revision)<=1000),
  primary key(solicitud_id,linea_id)
);
create table traslado_qr.evento(id bigint generated always as identity primary key,
  solicitud_id bigint not null references traslado_qr.tarea(solicitud_id),accion text not null,
  actor_id uuid not null references public.perfil(id),actor_nombre text not null,
  creado_en timestamptz not null default now(),detalle jsonb not null default '{}');
create index traslado_qr_eventos on traslado_qr.evento(solicitud_id,id);
create table traslado_qr.autorizacion(solicitud_id bigint primary key references traslado_qr.tarea(solicitud_id),transaccion bigint not null);
alter table traslado_qr.tarea enable row level security;
alter table traslado_qr.linea enable row level security;
alter table traslado_qr.evento enable row level security;
alter table traslado_qr.autorizacion enable row level security;
revoke all on all tables in schema traslado_qr from public,anon,authenticated;

alter table evidencia_operacion.lote add column traslado_qr_id bigint references traslado_qr.tarea(solicitud_id);
alter table evidencia_operacion.lote drop constraint lote_tipo_check;
alter table evidencia_operacion.lote drop constraint lote_check;
alter table evidencia_operacion.lote add constraint lote_tipo_check check(tipo in ('PEDIDO','TRASLADO_VIRTUAL','TRASLADO'));
alter table evidencia_operacion.lote add constraint lote_check check(
 (tipo='PEDIDO' and preparacion_id=entrega_id and preparacion_id is not null and documento_movil_id is null and traslado_qr_id is null) or
 (tipo='TRASLADO_VIRTUAL' and documento_movil_id=entrega_id and documento_movil_id is not null and preparacion_id is null and traslado_qr_id is null) or
 (tipo='TRASLADO' and traslado_qr_id=entrega_id and traslado_qr_id=documento_id and traslado_qr_id is not null and preparacion_id is null and documento_movil_id is null));

create function traslado_qr.actor(p_id bigint) returns public.perfil
language plpgsql stable security definer set search_path='' as $$
declare a public.perfil%rowtype;s public.solicitud_traslado%rowtype;
begin
 select * into a from public.perfil where id=auth.uid() and activo;
 if not found or a.rol not in ('admin','gerente','supervisor','almacen','almacenero','operario','vendedor','cajero') then raise exception 'Inicia sesión con un perfil autorizado.' using errcode='42501';end if;
 select * into s from public.solicitud_traslado where id=p_id;
 if not found then raise exception 'No se encontró la solicitud de traslado.';end if;
 if a.sucursal_id is not null and a.sucursal_id not in(s.sucursal_origen_id,s.sucursal_destino_id) then raise exception 'El traslado pertenece a otra sucursal.' using errcode='42501';end if;
 return a;
end $$;
create function traslado_qr.lineas_actuales(p_id bigint) returns table(linea_id bigint,datos jsonb)
language sql stable security definer set search_path='' as $$
 select l.id,jsonb_build_object('id',l.id,'producto_id',l.producto_id,'nombre',p.nombre,'sku',p.sku_interno,
 'presentacion_id',l.presentacion_id,'presentacion',coalesce(pr.nombre,p.unidad_base),'unidad_base',p.unidad_base,
 'factor',case when l.presentacion_id is not null and l.cantidad_presentacion>0 then l.cantidad_base/l.cantidad_presentacion else 1 end,
 'factor_actual',pr.factor_unidad_base,'sucursal_origen_id',s.sucursal_origen_id,'sucursal_destino_id',s.sucursal_destino_id,
 'cantidad_base',l.cantidad_base,'pendiente_base',l.cantidad_base,'preparable',p.activo and coalesce(pr.activo,true)
   and l.cantidad_base>0 and l.cantidad_base<=1e12 and l.cantidad_base=round(l.cantidad_base,4)
   and (l.presentacion_id is null or (l.cantidad_presentacion>0 and pr.factor_unidad_base=l.cantidad_base/l.cantidad_presentacion))
   and exists(select 1 from public.presentacion b where b.producto_id=p.id and b.es_base and b.activo),
 'estado',l.estado,'nota',l.nota,'modificado_en',l.modificado_en)
 from public.solicitud_traslado_linea l join public.producto p on p.id=l.producto_id
 join public.solicitud_traslado s on s.id=l.solicitud_id
 left join public.presentacion pr on pr.id=l.presentacion_id
 where l.solicitud_id=p_id and l.estado='POR_DESPACHAR' order by l.id
$$;
create function traslado_qr.datos(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.perfil%rowtype;s public.solicitud_traslado%rowtype;t traslado_qr.tarea%rowtype;cambios jsonb;
begin
 a:=traslado_qr.actor(p_id);select * into s from public.solicitud_traslado where id=p_id;
 select * into t from traslado_qr.tarea where solicitud_id=p_id;
 select coalesce(jsonb_agg(x.id),'[]') into cambios from(
  select coalesce(l.linea_id,n.linea_id) id from traslado_qr.lineas_actuales(p_id)n full join
   (select * from traslado_qr.linea where solicitud_id=p_id and vigente)l on l.linea_id=n.linea_id
  where l.snapshot is distinct from n.datos)x;
 return jsonb_build_object('solicitud',to_jsonb(s),'tarea',case when t.solicitud_id is null then null else to_jsonb(t) end,
 'habilitado',(select activo and traslados_qr from evidencia_operacion.configuracion where id),
 'origen',(select nombre from public.sucursal where id=s.sucursal_origen_id),'destino',(select nombre from public.sucursal where id=s.sucursal_destino_id),
 'puede_alistar',a.rol in ('admin','gerente','supervisor','almacen','almacenero','operario') and (a.sucursal_id is null or a.sucursal_id=s.sucursal_origen_id),
 'puede_recibir',(a.sucursal_id is null or a.sucursal_id=s.sucursal_destino_id) and a.id is distinct from t.preparador_id,
 'legacy',t.solicitud_id is null and s.estado<>'SOLICITADO','cambios',case when t.solicitud_id is null or t.estado='RECIBIDO' then '[]'::jsonb else cambios end,
 'lineas',case when t.solicitud_id is null then coalesce((select jsonb_agg(jsonb_build_object('pedido_linea_id',linea_id,'snapshot',datos,'vigente',true,'confirmada',false,'preparada_base',0)) from traslado_qr.lineas_actuales(p_id)),'[]')
 else coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('pedido_linea_id',l.linea_id) order by linea_id) from traslado_qr.linea l where solicitud_id=p_id),'[]') end,
 'eventos',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from (select * from traslado_qr.evento where solicitud_id=p_id order by id desc limit 80)e),'[]'));
end $$;

-- Misma cola privada de evidencias; reserva y permisos de foto por etapa.
do $$ begin execute replace(pg_get_functiondef('evidencia_operacion.contexto(text,bigint,bigint)'::regprocedure),
 'FUNCTION evidencia_operacion.contexto(','FUNCTION traslado_qr.contexto_anterior(');end $$;
create or replace function evidencia_operacion.contexto(p_tipo text,p_documento bigint,p_entrega bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.perfil%rowtype;t traslado_qr.tarea%rowtype;s public.solicitud_traslado%rowtype;
begin
 if p_tipo<>'TRASLADO' then return traslado_qr.contexto_anterior(p_tipo,p_documento,p_entrega);end if;
 a:=traslado_qr.actor(p_documento);
 select * into t from traslado_qr.tarea where solicitud_id=p_documento and solicitud_id=p_entrega;
 if not found then raise exception 'Primero toma el alistado del traslado.';end if;
 select * into s from public.solicitud_traslado where id=p_documento;
 return jsonb_build_object('dos_actores',true,'aplica',true,'version',t.version,'estado',t.estado,'numero',s.numero,
 'etapa',case when t.estado='PREPARANDO' then 'PREPARACION' else 'SALIDA' end,
 'puede_capturar',case when t.estado='PREPARANDO' then a.id=t.preparador_id and a.rol in ('admin','gerente','supervisor','almacen','almacenero','operario') and (a.sucursal_id is null or a.sucursal_id=s.sucursal_origen_id)
   when t.estado='REVISANDO' then a.id=t.receptor_id and a.id<>t.preparador_id and (a.sucursal_id is null or a.sucursal_id=s.sucursal_destino_id) else false end);
end $$;
do $$ begin execute replace(pg_get_functiondef('public.operar_evidencia_operacion(text,bigint,bigint,text,jsonb)'::regprocedure),
 'FUNCTION public.operar_evidencia_operacion(','FUNCTION traslado_qr.evidencia_anterior(');end $$;
create function traslado_qr.evidencia(p_tipo text,p_documento bigint,p_entrega bigint,p_accion text,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.perfil%rowtype;t traslado_qr.tarea%rowtype;c jsonb;e evidencia_operacion.lote%rowtype;cfg evidencia_operacion.configuracion%rowtype;rid uuid;n integer;
begin
 if p_tipo<>'TRASLADO' then return traslado_qr.evidencia_anterior(p_tipo,p_documento,p_entrega,p_accion,p_datos);end if;
 if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>4096 then raise exception 'Datos inválidos.';end if;
 a:=traslado_qr.actor(p_documento);
 perform 1 from public.solicitud_traslado where id=p_documento for update;
 select * into t from traslado_qr.tarea where solicitud_id=p_documento and solicitud_id=p_entrega for update;
 if not found then raise exception 'Primero toma el alistado.';end if;
 c:=evidencia_operacion.contexto(p_tipo,p_documento,p_entrega);select * into cfg from evidencia_operacion.configuracion where id;
 if p_accion='crear' then
  if not cfg.activo or not (c->>'puede_capturar')::boolean then raise exception 'Sólo el responsable de esta etapa puede adjuntar fotos.' using errcode='42501';end if;
  if (p_datos->>'version')::integer is distinct from t.version then raise exception 'La entrega cambió. Actualiza.' using errcode='40001';end if;
  rid:=(p_datos->>'id')::uuid;n:=(p_datos->>'cantidad')::integer;
  if rid is null or n is null or n not between 1 and 10 then raise exception 'Adjunta entre 1 y 10 fotos.';end if;
  insert into evidencia_operacion.lote(id,tipo,documento_id,entrega_id,traslado_qr_id,actor_id,version,etapa,rutas,chat_id,tema_id,grupo_enlace)
   select rid,p_tipo,p_documento,p_entrega,p_documento,a.id,t.version,c->>'etapa',jsonb_agg(a.id||'/'||rid||'/'||i||'.jpg' order by i),cfg.chat_id,cfg.tema_traslados,cfg.grupo_enlace from generate_series(1,n)i on conflict(id) do nothing;
  select * into e from evidencia_operacion.lote where id=rid for update;
  if e.actor_id<>a.id or e.tipo<>p_tipo or e.documento_id<>p_documento or e.etapa<>c->>'etapa' or e.version<>t.version
    or jsonb_array_length(e.rutas)<>n or e.estado<>'BORRADOR' or e.eliminado_en is not null or e.limpieza_reclamada then raise exception 'El lote no corresponde a esta captura.' using errcode='42501';end if;
  return jsonb_build_object('id',e.id,'rutas',e.rutas,'subidas',coalesce((select jsonb_agg(o.name) from storage.objects o where bucket_id='evidencias_operaciones' and e.rutas ? o.name),'[]'));
 elsif p_accion='reintentar' then
  select * into e from evidencia_operacion.lote where id=(p_datos->>'id')::uuid and tipo='TRASLADO' and documento_id=p_documento for update;
  if not found or e.estado<>'ERROR' then raise exception 'Sólo se reintentan errores confirmados.';end if;
  if e.actor_id<>a.id and a.rol not in ('admin','gerente') then raise exception 'Sólo el responsable o un encargado puede reintentar.' using errcode='42501';end if;
  update evidencia_operacion.lote set estado='PENDIENTE',intentos=0,error=null,proximo_intento=now() where id=e.id;
 elsif p_accion<>'consultar' then raise exception 'Acción de evidencia no disponible.';end if;
 return jsonb_build_object('activo',cfg.activo,'contexto',c,'envios',coalesce((select jsonb_agg(jsonb_build_object(
  'id',id,'etapa',etapa,'estado',estado,'cantidad',jsonb_array_length(rutas),'error',error,'enviado_en',enviado_en,'eliminado_en',eliminado_en,
  'enlace',case when estado='ENVIADO' then 'https://t.me/c/'||grupo_enlace||'/'||tema_id||'/'||(telegram->0->>'message_id') end) order by creado_en)
  from evidencia_operacion.lote where tipo='TRASLADO' and documento_id=p_documento and estado<>'BORRADOR'),'[]'));
end $$;
create or replace function public.operar_evidencia_operacion(p_tipo text,p_documento_id bigint,p_entrega_id bigint,p_accion text default 'consultar',p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select traslado_qr.evidencia(p_tipo,p_documento_id,p_entrega_id,p_accion,p_datos)$$;

create function traslado_qr.encolar(p_id bigint,p_lote uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t traslado_qr.tarea%rowtype;s public.solicitud_traslado%rowtype;e evidencia_operacion.lote%rowtype;cab text;material text;
begin
 select * into t from traslado_qr.tarea where solicitud_id=p_id;select * into s from public.solicitud_traslado where id=p_id;
 select * into e from evidencia_operacion.lote where id=p_lote;
 cab:=case when e.etapa='PREPARACION' then '📦 TRASLADO ALISTADO · ' else '📥 TRASLADO ENTREGADO Y RECIBIDO · ' end||coalesce(s.numero,'Traslado #'||p_id)||
 E'\n🏭 Origen: '||(select nombre from public.sucursal where id=s.sucursal_origen_id)||E'\n🏪 Destino: '||(select nombre from public.sucursal where id=s.sucursal_destino_id)||
 E'\n👷 Alistó: '||t.preparador_nombre||E'\n🕒 Alistado: '||to_char(t.preparado_en at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI:SS')||
 case when e.etapa='SALIDA' then E'\n🤝 Recibe: '||t.receptor_nombre||E'\n🔎 Tomó revisión: '||to_char(t.revision_en at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI:SS')||E'\n🚚 Entrega/recepción: '||to_char(t.recibido_en at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI:SS') else E'\n🔎 Pendiente de entrega al receptor' end;
 select string_agg(case when q=0 then '❌ ' when q<(snapshot->>'cantidad_base')::numeric then '⚠️ ' else '✅ ' end||
  regexp_replace(snapshot->>'nombre',E'[\r\n]+',' ','g')||' · '||trim_scale(q/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||' de '||trim_scale((snapshot->>'cantidad_base')::numeric/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||' '||coalesce(snapshot->>'presentacion',snapshot->>'unidad_base')||
  case when q<(snapshot->>'cantidad_base')::numeric then ' · saldo '||trim_scale(((snapshot->>'cantidad_base')::numeric-q)/coalesce(nullif((snapshot->>'factor')::numeric,0),1)) else '' end||
  case when nota<>'' then ' · '||regexp_replace(nota,E'[\r\n]+',' ','g') else '' end,E'\n' order by linea_id)
 into material from(select l.*,case when e.etapa='SALIDA' then revisada_base else preparada_base end q,
  case when e.etapa='SALIDA' and observacion_revision<>'' then observacion_revision else observacion end nota from traslado_qr.linea l where solicitud_id=p_id and vigente)x;
 update evidencia_operacion.lote set estado='PENDIENTE',caption=left(cab,700)||E'\n📸 Ref. '||e.id,
 mensajes=evidencia_operacion.partir_texto(cab||E'\n'||coalesce(material,'')||E'\n📸 Evidencia: '||e.id),proximo_intento=now() where id=p_lote;
end $$;

-- Reutiliza el despacho/recepción existentes. Sólo la transacción de entrega
-- puede invocar el despacho delegado con una cuenta receptora de destino.
create function traslado_qr.actor_despacho(p_id bigint) returns text language plpgsql stable security definer set search_path='' as $$
declare t traslado_qr.tarea%rowtype;
begin
 select * into t from traslado_qr.tarea where solicitud_id=p_id;
 if auth.uid() is null or t.receptor_id is distinct from auth.uid() or t.preparador_id=auth.uid() or not exists(
  select 1 from traslado_qr.autorizacion where solicitud_id=p_id and transaccion=txid_current()) then raise exception 'Confirma la recepción desde el QR.' using errcode='42501';end if;
 return t.preparador_nombre;
end $$;
do $$ declare f text; begin
 f:=pg_get_functiondef('public.despachar_traslado(bigint,text,jsonb)'::regprocedure);
 if strpos(f,'p_usuario := public.traslado_autorizar(v_sol.sucursal_origen_id,''despachar'');')=0 then raise exception 'Cambió el motor de despacho; revisar antes de migrar.';end if;
 execute replace(replace(f,'FUNCTION public.despachar_traslado(','FUNCTION traslado_qr.despachar('),
 'p_usuario := public.traslado_autorizar(v_sol.sucursal_origen_id,''despachar'');','p_usuario := traslado_qr.actor_despacho(p_solicitud_id);');
 execute replace(pg_get_functiondef('public.despachar_traslado(bigint,text,jsonb)'::regprocedure),'FUNCTION public.despachar_traslado(','FUNCTION traslado_qr.despacho_anterior(');
 execute replace(pg_get_functiondef('public.recibir_traslado(bigint,text,jsonb)'::regprocedure),'FUNCTION public.recibir_traslado(','FUNCTION traslado_qr.recepcion_anterior(');
 execute replace(pg_get_functiondef('public.cerrar_solicitud_traslado(bigint,public.estado_traslado,text,text)'::regprocedure),'FUNCTION public.cerrar_solicitud_traslado(','FUNCTION traslado_qr.cerrar(');
end $$;
alter function traslado_qr.cerrar(bigint,public.estado_traslado,text,text) set search_path=pg_catalog,public;
create function traslado_qr.legacy(p_accion text,p_id bigint,p_usuario text,p_lineas jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform traslado_qr.actor(p_id);
 perform 1 from public.solicitud_traslado where id=p_id for update;
 if exists(select 1 from traslado_qr.tarea where solicitud_id=p_id) or
  (p_accion='despachar' and (select activo and traslados_qr from evidencia_operacion.configuracion where id)
   and exists(select 1 from public.solicitud_traslado where id=p_id and estado='SOLICITADO')) then
  raise exception 'Este traslado se entrega desde el QR: alistado y recepción.' using errcode='42501';end if;
 if p_accion='despachar' then return traslado_qr.despacho_anterior(p_id,p_usuario,p_lineas);end if;
 return traslado_qr.recepcion_anterior(p_id,p_usuario,p_lineas);
end $$;
create or replace function public.despachar_traslado(p_solicitud_id bigint,p_usuario text default null,p_lineas jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$select traslado_qr.legacy('despachar',p_solicitud_id,p_usuario,p_lineas)$$;
create or replace function public.recibir_traslado(p_solicitud_id bigint,p_usuario text default null,p_lineas jsonb default null) returns jsonb
language sql security invoker set search_path='' as $$select traslado_qr.legacy('recibir',p_solicitud_id,p_usuario,p_lineas)$$;
create function traslado_qr.proteger() returns trigger language plpgsql security definer set search_path='' as $$
declare id_solicitud bigint;
begin
 id_solicitud:=coalesce((to_jsonb(old)->>'solicitud_id')::bigint,(to_jsonb(old)->>'id')::bigint);
 if exists(select 1 from traslado_qr.tarea where solicitud_id=id_solicitud) and not exists(
  select 1 from traslado_qr.autorizacion where solicitud_id=id_solicitud and transaccion=txid_current()) then
  raise exception 'Este traslado se confirma desde el QR.' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger traslado_qr_estado before update of estado on public.solicitud_traslado for each row execute function traslado_qr.proteger();
create trigger traslado_qr_cantidades before update of estado,cantidad_despachada,cantidad_recibida on public.solicitud_traslado_linea for each row execute function traslado_qr.proteger();
create trigger traslado_qr_borrar before delete on public.solicitud_traslado_linea for each row execute function traslado_qr.proteger();

create function traslado_qr.operar(p_id bigint,p_accion text,p_version integer,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.perfil%rowtype;s public.solicitud_traslado%rowtype;t traslado_qr.tarea%rowtype;
 l traslado_qr.linea%rowtype;e evidencia_operacion.lote%rowtype;accion text:=p_accion;info jsonb;q numeric;nota text;
 payload jsonb;recibidas jsonb;respuesta jsonb;total numeric;n integer;
begin
 a:=traslado_qr.actor(p_id);
 if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>1000000 then raise exception 'Datos inválidos.';end if;
 select * into s from public.solicitud_traslado where id=p_id for update;
 perform 1 from public.solicitud_traslado_linea where solicitud_id=p_id order by id for update;
 select * into t from traslado_qr.tarea where solicitud_id=p_id for update;
 info:=traslado_qr.datos(p_id);
 if accion='escanear' then
  accion:=case when t.solicitud_id is null and s.estado='SOLICITADO' and (info->>'puede_alistar')::boolean and (info->>'habilitado')::boolean then 'iniciar'
   when t.estado='PREPARADO' and (info->>'puede_recibir')::boolean then 'tomar_revision' else 'consultar' end;
  if accion='tomar_revision' then p_version:=t.version;end if;
 end if;
 if accion='consultar' then return info;end if;
 if accion='iniciar' then
  if not (info->>'habilitado')::boolean then raise exception 'Este circuito todavía no está habilitado.';end if;
  if not (info->>'puede_alistar')::boolean then raise exception 'Almacén de origen debe tomar el alistado.' using errcode='42501';end if;
  if t.solicitud_id is not null then return info;end if;
  if s.estado<>'SOLICITADO' or exists(select 1 from public.solicitud_traslado_linea where solicitud_id=p_id and (cantidad_despachada>0 or cantidad_recibida>0)) then raise exception 'Este traslado ya tuvo salida; conserva su recepción anterior.';end if;
  if not exists(select 1 from traslado_qr.lineas_actuales(p_id)) then raise exception 'No hay líneas pendientes para alistar.';end if;
  insert into traslado_qr.tarea(solicitud_id,preparador_id,preparador_nombre) values(p_id,a.id,a.nombre);
  insert into traslado_qr.linea(solicitud_id,linea_id,snapshot) select p_id,linea_id,datos from traslado_qr.lineas_actuales(p_id);
  insert into traslado_qr.evento(solicitud_id,accion,actor_id,actor_nombre) values(p_id,'ALISTADO_INICIADO',a.id,a.nombre);
  return traslado_qr.datos(p_id);
 end if;
 if t.solicitud_id is null then raise exception 'Primero toma el alistado.';end if;
 if accion in ('preparado','recibir') then
  select * into e from evidencia_operacion.lote where id=(p_datos->>'evidencia_id')::uuid and tipo='TRASLADO' and documento_id=p_id and actor_id=a.id;
  if e.version=p_version and e.estado<>'BORRADOR' and ((accion='preparado' and e.etapa='PREPARACION' and t.estado<>'PREPARANDO')
   or (accion='recibir' and t.estado='RECIBIDO' and t.evidencia_recepcion_id=e.id)) then return info;end if;
 end if;
 if t.estado in ('RECIBIDO','ANULADO') or s.estado<>'SOLICITADO' then raise exception 'Esta entrega ya está cerrada.';end if;
 if p_version is distinct from t.version then raise exception 'El traslado cambió en otro celular. Actualiza.' using errcode='40001';end if;
 if accion not in ('sincronizar','devolver','anular') and info->'cambios'<>'[]'::jsonb then raise exception 'La solicitud cambió. Actualiza el alistado antes de continuar.' using errcode='40001';end if;
 if accion in ('guardar_preparacion','confirmar_resto','preparado','sincronizar','anular') and (t.preparador_id<>a.id or not (info->>'puede_alistar')::boolean) then raise exception 'Sólo el alistador asignado puede modificar esta preparación.' using errcode='42501';end if;
 if accion in ('guardar_revision','confirmar_resto_revision','recibir','devolver') and (t.receptor_id is distinct from a.id or t.preparador_id=a.id or t.estado<>'REVISANDO' or not (info->>'puede_recibir')::boolean) then raise exception 'Sólo el receptor asignado confirma lo recibido.' using errcode='42501';end if;
 if accion in ('guardar_preparacion','confirmar_resto','preparado') and t.estado<>'PREPARANDO' then raise exception 'El alistado ya está enviado.';end if;
 if accion in ('guardar_preparacion','guardar_revision') then
  select * into l from traslado_qr.linea where solicitud_id=p_id and linea_id=(p_datos->>'linea_id')::bigint and vigente for update;
  if not found then raise exception 'La línea no pertenece a este traslado.';end if;
  if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,4})?$' then raise exception 'Cantidad válida con hasta cuatro decimales en base.';end if;
  q:=(p_datos->>'cantidad_base')::numeric;nota:=btrim(coalesce(p_datos->>'observacion',''));
  if q>1e12 or q>(l.snapshot->>'cantidad_base')::numeric or (accion='guardar_revision' and q>l.preparada_base) then raise exception 'La cantidad supera lo solicitado o alistado.';end if;
  if q>0 and not coalesce((l.snapshot->>'preparable')::boolean,false) then raise exception 'El producto o presentación no está disponible.';end if;
  if length(nota)>1000 or (q<case when accion='guardar_revision' then l.preparada_base else (l.snapshot->>'cantidad_base')::numeric end and nota='') then raise exception 'Indica el motivo del faltante o diferencia.';end if;
  if accion='guardar_preparacion' then update traslado_qr.linea set preparada_base=q,confirmada=true,observacion=nota,revisada_base=null,observacion_revision='' where solicitud_id=p_id and linea_id=l.linea_id;
  else update traslado_qr.linea set revisada_base=q,observacion_revision=nota where solicitud_id=p_id and linea_id=l.linea_id;end if;
 elsif accion='confirmar_resto' then
  update traslado_qr.linea set preparada_base=(snapshot->>'cantidad_base')::numeric,confirmada=true where solicitud_id=p_id and vigente and not confirmada and (snapshot->>'preparable')::boolean;
 elsif accion='tomar_revision' then
  if t.estado<>'PREPARADO' or not (info->>'puede_recibir')::boolean then raise exception 'La recepción corresponde a otra persona de la sucursal destino.' using errcode='42501';end if;
  update traslado_qr.tarea set estado='REVISANDO',receptor_id=a.id,receptor_nombre=a.nombre,revision_en=now() where solicitud_id=p_id;
 elsif accion='confirmar_resto_revision' then
  update traslado_qr.linea set revisada_base=preparada_base where solicitud_id=p_id and vigente and confirmada and revisada_base is null;
 elsif accion='preparado' then
  if exists(select 1 from traslado_qr.linea where solicitud_id=p_id and vigente and not confirmada) or not exists(select 1 from traslado_qr.linea where solicitud_id=p_id and vigente and preparada_base>0) then raise exception 'Confirma las líneas y faltantes; debe haber material alistado.';end if;
  e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,'TRASLADO',p_id,p_id,t.version);
  if e.etapa<>'PREPARACION' then raise exception 'Adjunta fotos del alistado.';end if;
  update traslado_qr.tarea set estado='PREPARADO',preparado_en=now() where solicitud_id=p_id;
  perform traslado_qr.encolar(p_id,e.id);
 elsif accion in ('sincronizar','devolver') then
  nota:=btrim(coalesce(p_datos->>'observacion',''));if length(nota) not between 3 and 1000 then raise exception 'Indica el motivo para corregir el alistado.';end if;
  update traslado_qr.linea set vigente=false where solicitud_id=p_id;
  insert into traslado_qr.linea as previa(solicitud_id,linea_id,snapshot) select p_id,linea_id,datos from traslado_qr.lineas_actuales(p_id)
   on conflict(solicitud_id,linea_id) do update set snapshot=excluded.snapshot,vigente=true,
   preparada_base=case when previa.snapshot=excluded.snapshot then previa.preparada_base else 0 end,
   confirmada=previa.snapshot=excluded.snapshot and previa.confirmada,
   observacion=case when previa.snapshot=excluded.snapshot then previa.observacion else '' end,revisada_base=null,observacion_revision='';
  update traslado_qr.tarea set estado='PREPARANDO',receptor_id=null,receptor_nombre=null,revision_en=null,preparado_en=null where solicitud_id=p_id;
 elsif accion='anular' then
  nota:=btrim(coalesce(p_datos->>'observacion',''));if length(nota) not between 3 and 1000 then raise exception 'Indica el motivo de la anulación.';end if;
  insert into traslado_qr.autorizacion values(p_id,txid_current());
  perform traslado_qr.cerrar(p_id,'CANCELADO',a.nombre,nota);
  delete from traslado_qr.autorizacion where solicitud_id=p_id;
  update traslado_qr.tarea set estado='ANULADO' where solicitud_id=p_id;
 elsif accion='recibir' then
  if exists(select 1 from traslado_qr.linea where solicitud_id=p_id and vigente and revisada_base is null) or not exists(select 1 from traslado_qr.linea where solicitud_id=p_id and vigente and revisada_base>0) then raise exception 'Confirma cada cantidad recibida; debe haber material para entregar.';end if;
  e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,'TRASLADO',p_id,p_id,t.version);
  if e.etapa<>'SALIDA' then raise exception 'Adjunta fotos de la recepción.';end if;
  select jsonb_agg(jsonb_build_object('linea_id',linea_id,'accion',case when revisada_base>0 then 'DESPACHAR' else 'FALTANTE' end,'cantidad_base',revisada_base) order by linea_id),sum(revisada_base) into payload,total from traslado_qr.linea where solicitud_id=p_id and vigente;
  insert into traslado_qr.autorizacion values(p_id,txid_current());
  respuesta:=traslado_qr.despachar(p_id,t.preparador_nombre,payload);
  if (respuesta->>'cantidad_despachada')::numeric is distinct from total or exists(select 1 from traslado_qr.linea cl join public.solicitud_traslado_linea sl on sl.id=cl.linea_id where cl.solicitud_id=p_id and cl.vigente and coalesce(sl.cantidad_despachada,0)<>cl.revisada_base) then raise exception 'Cambió el stock disponible. No se registró ninguna entrega; actualiza y comprueba las cantidades.' using errcode='40001';end if;
  select jsonb_agg(jsonb_build_object('linea_id',id,'cantidad_base',cantidad_despachada) order by id) into recibidas from public.solicitud_traslado_linea where solicitud_id=p_id and estado='DESPACHADA';
  perform traslado_qr.recepcion_anterior(p_id,a.nombre,recibidas);
  delete from traslado_qr.autorizacion where solicitud_id=p_id;
  update traslado_qr.tarea set estado='RECIBIDO',recibido_en=now(),evidencia_recepcion_id=e.id,resultado=respuesta where solicitud_id=p_id;
  perform traslado_qr.encolar(p_id,e.id);
 else raise exception 'Acción de traslado no disponible.';end if;
 update traslado_qr.tarea set version=version+1,actualizado_en=now() where solicitud_id=p_id;
 insert into traslado_qr.evento(solicitud_id,accion,actor_id,actor_nombre,detalle) values(p_id,upper(accion),a.id,a.nombre,p_datos);
 return traslado_qr.datos(p_id);
end $$;
create function public.operar_traslado_qr(p_solicitud_id bigint,p_accion text default 'consultar',p_version integer default null,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select traslado_qr.operar(p_solicitud_id,p_accion,p_version,p_datos)$$;
revoke all on all functions in schema traslado_qr from public,anon,authenticated;
grant execute on function traslado_qr.operar(bigint,text,integer,jsonb),traslado_qr.evidencia(text,bigint,bigint,text,jsonb),traslado_qr.legacy(text,bigint,text,jsonb) to authenticated;
revoke all on function public.operar_traslado_qr(bigint,text,integer,jsonb) from public,anon;
grant execute on function public.operar_traslado_qr(bigint,text,integer,jsonb) to authenticated;

-- Recibos completos para ambos tipos, conservando el worker SQL anterior.
do $$ declare f text;begin
 f:=pg_get_functiondef('public.worker_evidencia_operacion(text,jsonb)'::regprocedure);
 if strpos(f,'e.tipo<>''PEDIDO''')=0 then raise exception 'Actualizar primero el worker de recibos por etapa.';end if;
 execute replace(replace(f,'e.tipo<>''PEDIDO''','e.tipo not in (''PEDIDO'',''TRASLADO'')'),'e.tipo=''PEDIDO''','e.tipo in (''PEDIDO'',''TRASLADO'')');
end $$;
notify pgrst,'reload schema';

-- Petición pendiente del piloto de Pedidos: ambas fotos ya eran independientes;
-- cada caption ahora identifica actor y hora, además del detalle con toma de revisión.
create or replace function evidencia_operacion.encolar_pedido(p_lote uuid,p_tarea bigint,p_destino text default null) returns void
language plpgsql security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;e evidencia_operacion.lote%rowtype;cab text;material text;numero text;revision text;
begin
 select * into t from public.almacen_preparacion where id=p_tarea;
 select * into e from evidencia_operacion.lote where id=p_lote;
 select coalesce(p.numero,'#'||p.id) into numero from public.pedido p where id=t.pedido_id;
 select to_char(max(creado_en) at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI:SS') into revision
  from public.almacen_preparacion_evento where preparacion_id=t.id and accion='TOMAR_REVISION' and creado_en>=coalesce(t.preparado_en,t.creado_en);
 cab:=case when e.etapa='SALIDA' then '🚚 PEDIDO RETIRADO · ' else '📦 PEDIDO ALISTADO · ' end||numero||
  E'\n🧾 Entrega #'||t.id||E'\n👷 Alistó: '||t.preparador_nombre||E'\n🕒 Alistado: '||to_char(coalesce(t.preparado_en,t.creado_en) at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI:SS')||
  case when e.etapa='SALIDA' then E'\n🔎 Revisó y retira: '||t.revisor_nombre||E'\n🕒 Tomó revisión: '||coalesce(revision,'Sin registro anterior')||E'\n🚚 Salida: '||to_char(now() at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI:SS')||E'\n📍 Destino: '||p_destino else E'\n🔎 Estado: pendiente de verificación y retiro' end;
 select string_agg(case when q=0 then '❌ ' when q<(snapshot->>'pendiente_base')::numeric then '⚠️ ' else '✅ ' end||
  regexp_replace(coalesce(snapshot->>'nombre','Producto'),E'[\r\n]+',' ','g')||' · '||case when e.etapa='SALIDA' then 'salen ' else 'alistado ' end||
  trim_scale(q/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||' de '||trim_scale((snapshot->>'pendiente_base')::numeric/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||' '||coalesce(snapshot->>'presentacion',snapshot->>'unidad_base','unidades')||
  case when q<(snapshot->>'pendiente_base')::numeric then ' · pendiente '||trim_scale(((snapshot->>'pendiente_base')::numeric-q)/coalesce(nullif((snapshot->>'factor')::numeric,0),1)) else '' end||
  case when coalesce(nota,'')<>'' then ' · '||regexp_replace(nota,E'[\r\n]+',' ','g') else '' end,E'\n' order by pedido_linea_id)
  into material from(select l.*,case when e.etapa='SALIDA' then coalesce(revisada_base,0) else preparada_base end q,
   case when e.etapa='SALIDA' and observacion_revision<>'' then observacion_revision else observacion end nota
   from public.almacen_preparacion_linea l where preparacion_id=p_tarea and vigente)x;
 update evidencia_operacion.lote set estado='PENDIENTE',caption=left(cab,700)||E'\n📸 Ref. '||e.id,
  mensajes=evidencia_operacion.partir_texto(cab||E'\n'||coalesce(material,'')||E'\n📸 Evidencia: '||e.id),proximo_intento=now() where id=p_lote;
end $$;
revoke all on function evidencia_operacion.encolar_pedido(uuid,bigint,text) from public,anon,authenticated;
