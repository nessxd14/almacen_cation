-- Pedidos: alistador y verificador/retirante. VTD y Traslados conservan sus motores.
alter table evidencia_operacion.configuracion add column pedidos_dos_actores boolean not null default false;
alter table public.almacen_preparacion add column flujo_dos_actores boolean not null default false;
alter table public.almacen_preparacion add column salida_previa boolean not null default false;
alter table public.almacen_preparacion_linea add column observacion_revision text not null default '' check(length(observacion_revision)<=1000);
alter table evidencia_operacion.lote add column etapa text not null default 'SALIDA' check(etapa in ('PREPARACION','SALIDA'));
alter table evidencia_operacion.lote add column mensajes jsonb not null default '[]' check(jsonb_typeof(mensajes)='array');
alter table evidencia_operacion.lote add column fotos_telegram jsonb;
alter table evidencia_operacion.lote add column mensajes_telegram jsonb not null default '{}' check(jsonb_typeof(mensajes_telegram)='object');
alter table evidencia_operacion.retiro add column asignaciones jsonb;
drop index evidencia_operacion.evidencia_operacion_unica;
create unique index evidencia_operacion_salida_unica on evidencia_operacion.lote(tipo,entrega_id) where etapa='SALIDA' and estado<>'BORRADOR';
create unique index evidencia_operacion_preparacion_unica on evidencia_operacion.lote(tipo,entrega_id,version) where etapa='PREPARACION' and estado<>'BORRADOR';

create table evidencia_operacion.despacho_autorizado(preparacion_id bigint primary key references public.almacen_preparacion(id),transaccion bigint not null);
alter table evidencia_operacion.despacho_autorizado enable row level security;
revoke all on evidencia_operacion.despacho_autorizado from public,anon,authenticated;

-- Conserva la validación de códigos del motor de Pedidos. Sólo el nuevo circuito
-- admite diferencias contadas, con motivo; los demás mantienen igualdad exacta.
do $$ declare f text; c record; anterior text; nuevo text; begin
  for c in select conname from pg_constraint where conrelid='public.almacen_preparacion_linea'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%revisada_base = preparada_base%'
  loop execute format('alter table public.almacen_preparacion_linea drop constraint %I',c.conname); end loop;
  f:=pg_get_functiondef('almacen_operaciones.operar(bigint,bigint,bigint,text,integer,jsonb)'::regprocedure);
  f:=replace(f,E'\r\n',E'\n');
  anterior:=$old$if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' or (p_datos->>'cantidad_base')::numeric<>v_linea.preparada_base then
          raise exception 'La cantidad contada no coincide con la preparada. Corrige la preparación antes de confirmar.';
        end if;$old$;
  nuevo:=$new$if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' then raise exception 'Ingresa una cantidad válida con hasta seis decimales.'; end if;
        v_cantidad:=(p_datos->>'cantidad_base')::numeric;
        if v_cantidad>1e12 or v_cantidad>(v_linea.snapshot->>'pendiente_base')::numeric then raise exception 'La cantidad supera lo pendiente del pedido.'; end if;
        if v_cantidad>0 and not (v_linea.snapshot->>'preparable')::boolean then raise exception 'Esta línea no está disponible para retirar.';end if;
        if not v_tarea.flujo_dos_actores and v_cantidad<>v_linea.preparada_base then raise exception 'La cantidad contada no coincide con la preparada. Corrige la preparación antes de confirmar.'; end if;
        if v_tarea.flujo_dos_actores and v_cantidad<>v_linea.preparada_base and (btrim(coalesce(p_datos->>'observacion',''))='' or length(p_datos->>'observacion')>1000) then raise exception 'Indica el motivo de la diferencia encontrada.'; end if;$new$;
  if strpos(f,anterior)=0 then raise exception 'El motor de revisión cambió; revisar antes de migrar.'; end if;
  f:=replace(f,anterior,nuevo);
  f:=replace(f,'revisada_base=null,','revisada_base=null,observacion_revision='''',');
  f:=replace(f,'and vigente and preparada_base>0 for update;','and vigente and (preparada_base>0 or v_tarea.flujo_dos_actores) for update;');
  f:=replace(f,'set revisada_base=preparada_base,metodo_revision=',
    'set revisada_base=case when v_tarea.flujo_dos_actores then v_cantidad else preparada_base end,observacion_revision=case when v_tarea.flujo_dos_actores then btrim(coalesce(p_datos->>''observacion'','''')) else '''' end,metodo_revision=');
  f:=replace(f,'and preparada_base>0 and revisada_base is distinct from preparada_base)',
    'and ((not v_tarea.flujo_dos_actores and preparada_base>0 and revisada_base is distinct from preparada_base) or (v_tarea.flujo_dos_actores and (snapshot->>''preparable'')::boolean and revisada_base is null)))');
  execute f;
end $$;

-- Contexto de captura por etapa, sin alterar el contexto de Traslados.
do $$ begin execute replace(pg_get_functiondef('evidencia_operacion.contexto(text,bigint,bigint)'::regprocedure),'FUNCTION evidencia_operacion.contexto(','FUNCTION evidencia_operacion.contexto_anterior('); end $$;
revoke all on function evidencia_operacion.contexto_anterior(text,bigint,bigint) from public,anon,authenticated;
create or replace function evidencia_operacion.contexto(p_tipo text,p_documento bigint,p_entrega bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;t public.almacen_preparacion%rowtype;etapa text;
begin
  c:=evidencia_operacion.contexto_anterior(p_tipo,p_documento,p_entrega);
  if p_tipo='PEDIDO' then
    select * into t from public.almacen_preparacion where id=p_entrega and pedido_id=p_documento;
    if t.flujo_dos_actores then
      etapa:=case when t.estado='PREPARANDO' then 'PREPARACION' else 'SALIDA' end;
      c:=c||jsonb_build_object('dos_actores',true,'aplica',true,'etapa',etapa,'puede_capturar',
        case when etapa='PREPARACION' then t.preparador_id=auth.uid()
          else t.revisor_id=auth.uid() and t.preparador_id<>auth.uid() and (t.estado in ('REVISANDO','VERIFICADO') or t.estado='DESPACHADO' and t.salida_previa) end
        and not exists(select 1 from evidencia_operacion.retiro where preparacion_id=t.id));
    end if;
  end if;
  return c;
end $$;

create or replace function evidencia_operacion.puede_subir(p_ruta text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare e evidencia_operacion.lote%rowtype;c jsonb;
begin
  select * into e from evidencia_operacion.lote where actor_id=auth.uid() and rutas ? p_ruta and estado='BORRADOR'
    and not limpieza_reclamada and eliminado_en is null and creado_en>now()-interval '48 hours';
  if not found then return false; end if;
  c:=evidencia_operacion.contexto(e.tipo,e.documento_id,e.entrega_id);
  return (select activo from evidencia_operacion.configuracion where id) and (c->>'aplica')::boolean
    and (c->>'puede_capturar')::boolean and (c->>'version')::integer=e.version and e.etapa=coalesce(c->>'etapa','SALIDA');
end $$;

create function evidencia_operacion.evidencia_pedido(p_tipo text,p_documento bigint,p_entrega bigint,p_accion text,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c jsonb;e evidencia_operacion.lote%rowtype;a public.perfil%rowtype;cfg evidencia_operacion.configuracion%rowtype;rid uuid;n integer;r jsonb;
begin
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>4096 then raise exception 'Datos inválidos.'; end if;
  if p_tipo<>'PEDIDO' or not exists(select 1 from public.almacen_preparacion where id=p_entrega and pedido_id=p_documento and flujo_dos_actores) then
    return evidencia_operacion.operar(p_tipo,p_documento,p_entrega,p_accion,p_datos);
  end if;
  perform id from public.pedido where id=p_documento for update;
  perform id from public.almacen_preparacion where id=p_entrega and pedido_id=p_documento for update;
  c:=evidencia_operacion.contexto(p_tipo,p_documento,p_entrega);
  select * into cfg from evidencia_operacion.configuracion where id;
  select * into a from public.perfil where id=auth.uid() and activo;
  if p_accion='crear' then
    if not cfg.activo or not (c->>'puede_capturar')::boolean then raise exception 'Sólo el responsable de esta etapa puede adjuntar fotos.' using errcode='42501'; end if;
    if (p_datos->>'version')::integer is distinct from (c->>'version')::integer then raise exception 'La entrega cambió. Actualiza.' using errcode='40001'; end if;
    rid:=(p_datos->>'id')::uuid;n:=(p_datos->>'cantidad')::integer;
    if rid is null or n is null or n not between 1 and 10 then raise exception 'Adjunta entre 1 y 10 fotos.'; end if;
    insert into evidencia_operacion.lote(id,tipo,documento_id,entrega_id,preparacion_id,actor_id,version,etapa,rutas,chat_id,tema_id,grupo_enlace)
      select rid,p_tipo,p_documento,p_entrega,p_entrega,a.id,(c->>'version')::integer,c->>'etapa',
      jsonb_agg(a.id||'/'||rid||'/'||i||'.jpg' order by i),cfg.chat_id,cfg.tema_id,cfg.grupo_enlace from generate_series(1,n)i on conflict(id) do nothing;
    select * into e from evidencia_operacion.lote where id=rid for update;
    if e.actor_id<>a.id or e.tipo<>p_tipo or e.documento_id<>p_documento or e.entrega_id<>p_entrega or e.etapa<>c->>'etapa'
      or e.version<>(c->>'version')::integer or jsonb_array_length(e.rutas)<>n or e.estado<>'BORRADOR' or e.eliminado_en is not null or e.limpieza_reclamada then raise exception 'El lote no corresponde a esta captura.' using errcode='42501'; end if;
    return jsonb_build_object('id',e.id,'rutas',e.rutas,'subidas',coalesce((select jsonb_agg(name) from storage.objects where bucket_id='evidencias_operaciones' and e.rutas ? name),'[]'));
  elsif p_accion not in ('consultar','reintentar') or p_accion is null then
    raise exception 'Confirma la revisión y el retiro desde la miniapp actualizada.';
  end if;
  r:=evidencia_operacion.operar(p_tipo,p_documento,p_entrega,p_accion,p_datos);
  return r||jsonb_build_object('contexto',c,'envios',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'etapa',l.etapa,'estado',l.estado,
    'cantidad',jsonb_array_length(l.rutas),'error',l.error,'enviado_en',l.enviado_en,'eliminado_en',l.eliminado_en,
    'enlace',case when l.estado='ENVIADO' then 'https://t.me/c/'||l.grupo_enlace||'/'||l.tema_id||'/'||(l.telegram->0->>'message_id') end) order by l.creado_en)
    from evidencia_operacion.lote l where l.tipo=p_tipo and l.entrega_id=p_entrega and l.estado<>'BORRADOR'),'[]'));
end $$;
revoke all on function evidencia_operacion.evidencia_pedido(text,bigint,bigint,text,jsonb) from public,anon;
grant execute on function evidencia_operacion.evidencia_pedido(text,bigint,bigint,text,jsonb) to authenticated;
revoke execute on function evidencia_operacion.operar(text,bigint,bigint,text,jsonb) from authenticated;
create or replace function public.operar_evidencia_operacion(p_tipo text,p_documento_id bigint,p_entrega_id bigint,p_accion text default 'consultar',p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select evidencia_operacion.evidencia_pedido(p_tipo,p_documento_id,p_entrega_id,p_accion,p_datos) $$;

-- Mensajes completos, por líneas, sin truncar productos. Cada parte admite
-- 1500 caracteres Unicode (como máximo 3000 unidades UTF-16 más cabecera).
create function evidencia_operacion.partir_texto(p_texto text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare partes jsonb:='[]';parte text:='';linea text;trozo text;
begin
  foreach linea in array string_to_array(p_texto,E'\n') loop
    while length(linea)>1500 loop
      if parte<>'' then partes:=partes||jsonb_build_array(parte);parte:='';end if;
      trozo:=left(linea,1500);partes:=partes||jsonb_build_array(trozo);linea:=substring(linea from 1501);
    end loop;
    if length(parte)+length(linea)+1>1500 then partes:=partes||jsonb_build_array(parte);parte:='';end if;
    parte:=parte||case when parte='' then '' else E'\n' end||linea;
  end loop;
  if parte<>'' then partes:=partes||jsonb_build_array(parte);end if;
  return partes;
end $$;
revoke all on function evidencia_operacion.partir_texto(text) from public,anon,authenticated;

create function evidencia_operacion.encolar_pedido(p_lote uuid,p_tarea bigint,p_destino text default null) returns void
language plpgsql security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;e evidencia_operacion.lote%rowtype;texto text;material text;numero text;
begin
  select * into t from public.almacen_preparacion where id=p_tarea;
  select * into e from evidencia_operacion.lote where id=p_lote;
  select coalesce(p.numero,'#'||p.id) into numero from public.pedido p where id=t.pedido_id;
  select string_agg(case when q=0 then '❌ ' when q<(snapshot->>'pendiente_base')::numeric then '⚠️ ' else '✅ ' end||
    regexp_replace(coalesce(snapshot->>'nombre','Producto'),E'[\r\n]+',' ','g')||' · '||
    case when e.etapa='SALIDA' then 'salen ' else 'alistado ' end||trim_scale(q/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||' de '||
    trim_scale((snapshot->>'pendiente_base')::numeric/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||' '||coalesce(snapshot->>'presentacion',snapshot->>'unidad_base','unidades')||
    case when q<(snapshot->>'pendiente_base')::numeric then ' · pendiente '||trim_scale(((snapshot->>'pendiente_base')::numeric-q)/coalesce(nullif((snapshot->>'factor')::numeric,0),1)) else '' end||
    case when coalesce(nota,'')<>'' then ' · '||regexp_replace(nota,E'[\r\n]+',' ','g') else '' end,E'\n' order by pedido_linea_id)
    into material from (select l.*,case when e.etapa='SALIDA' then coalesce(revisada_base,0) else preparada_base end as q,
      case when e.etapa='SALIDA' and observacion_revision<>'' then observacion_revision else observacion end as nota
      from public.almacen_preparacion_linea l where preparacion_id=p_tarea and vigente) lineas;
  texto:=case when e.etapa='SALIDA' then '🚚 PEDIDO RETIRADO · ' else '📦 PEDIDO ALISTADO · ' end||numero||
    E'\n🧾 Entrega #'||t.id||E'\n👷 Alistó: '||t.preparador_nombre||
    case when e.etapa='SALIDA' then E'\n🔎 Revisó y retira: '||t.revisor_nombre||E'\n📍 Destino: '||p_destino else E'\n🔎 Estado: pendiente de verificación y retiro' end||
    E'\n🕒 '||to_char(now() at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI')||E'\n'||coalesce(material,'')||E'\n📸 Evidencia: '||e.id;
  update evidencia_operacion.lote set estado='PENDIENTE',caption=case when etapa='SALIDA' then '🚚 Salida de ' else '📦 Alistado de ' end||numero||
    ' · Entrega #'||t.id||E'\n📋 Detalle completo en los mensajes numerados.'||E'\n📸 Ref. '||e.id,mensajes=evidencia_operacion.partir_texto(texto),proximo_intento=now() where id=p_lote;
end $$;
revoke all on function evidencia_operacion.encolar_pedido(uuid,bigint,text) from public,anon,authenticated;

create function evidencia_operacion.plan_salida(p_tarea bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;l record;u record;restante numeric;tomar numeric;asignaciones jsonb;plan jsonb:='[]';error text;usadas jsonb:='{}';clave text;
begin
  select * into t from public.almacen_preparacion where id=p_tarea;
  if t.salida_previa then
    return coalesce((select jsonb_agg(jsonb_build_object('linea_id',pedido_linea_id,'cantidad_base',preparada_base,'previo',true,'asignaciones','[]'::jsonb,'error',null) order by pedido_linea_id)
      from public.almacen_preparacion_linea where preparacion_id=p_tarea and vigente and preparada_base>0),'[]');
  end if;
  for l in select * from public.almacen_preparacion_linea where preparacion_id=p_tarea and vigente and revisada_base>0 order by pedido_linea_id loop
    restante:=l.revisada_base;asignaciones:='[]';error:=null;
    if coalesce((l.snapshot->>'es_personalizado')::boolean,false) then
      if restante<>(l.snapshot->>'pendiente_base')::numeric then error:='El personalizado debe retirarse completo o quedar sin salida.';else restante:=0;end if;
    else
      for u in select s.ubicacion_id,sum(s.cantidad_base) as cantidad_base,
        concat_ws(' · ',b.codigo_zona,b.estante,b.nivel,b.compartimiento) as nombre
        from public.stock_actual s join public.ubicacion b on b.id=s.ubicacion_id
        where s.producto_id=(l.snapshot->>'producto_id')::bigint and b.sucursal_id=t.sucursal_id and not coalesce(b.excluye_disponible,false)
        group by s.ubicacion_id,b.codigo_zona,b.estante,b.nivel,b.compartimiento having sum(s.cantidad_base)>0 order by sum(s.cantidad_base) desc,s.ubicacion_id
      loop
        exit when restante<=0;clave:=(l.snapshot->>'producto_id')||':'||u.ubicacion_id;
        tomar:=least(restante,u.cantidad_base-coalesce((usadas->>clave)::numeric,0));
        if tomar<=0 then continue;end if;
        usadas:=jsonb_set(usadas,array[clave],to_jsonb(coalesce((usadas->>clave)::numeric,0)+tomar));
        asignaciones:=asignaciones||jsonb_build_array(jsonb_build_object('ubicacion_id',u.ubicacion_id,'cantidad_base',tomar,'nombre',u.nombre));restante:=restante-tomar;
      end loop;
      if restante>0 then error:='Stock insuficiente en la sucursal de esta entrega.';end if;
    end if;
    plan:=plan||jsonb_build_array(jsonb_build_object('linea_id',l.pedido_linea_id,'cantidad_base',l.revisada_base,'asignaciones',asignaciones,'error',error));
  end loop;
  return plan;
end $$;
revoke all on function evidencia_operacion.plan_salida(bigint) from public,anon,authenticated;

create function evidencia_operacion.proteger_despacho_pedido() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;
begin
  if new.cantidad_despachada>old.cantidad_despachada or (new.estado='COMPRADO_DIRECTO' and old.estado<>new.estado) then
    select * into t from public.almacen_preparacion where pedido_id=new.pedido_id and flujo_dos_actores and estado<>'ANULADO' order by id desc limit 1;
    if found and not exists(select 1 from evidencia_operacion.despacho_autorizado where preparacion_id=t.id and transaccion=txid_current()) then
      raise exception 'Este pedido se retira desde la miniapp: confirma revisión, fotos y retiro con el verificador.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function evidencia_operacion.proteger_despacho_pedido() from public,anon,authenticated;
create trigger pedido_dos_actores_despacho before update of cantidad_despachada,estado on public.pedido_linea for each row execute function evidencia_operacion.proteger_despacho_pedido();

create function evidencia_operacion.preparacion_dos(p_pedido bigint,p_sucursal bigint,p_tarea bigint,p_accion text,p_version integer,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r jsonb;t public.almacen_preparacion%rowtype;a public.perfil%rowtype;e evidencia_operacion.lote%rowtype;
  accion text:=p_accion;n integer;destino text;plan jsonb;x jsonb;datos jsonb;retiro evidencia_operacion.retiro%rowtype;
begin
  -- La consulta original autentica, valida sucursal/documento y toma sus locks.
  r:=evidencia_operacion.preparacion(p_pedido,p_sucursal,p_tarea,'consultar',null,'{}');
  select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
  select * into a from public.perfil where id=auth.uid() and activo;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>1000000 then raise exception 'Datos inválidos.';end if;
  -- Entregas ya despachadas sin retiro: el revisor puede cerrar el registro
  -- pendiente con fotos; su stock ya salió y no se vuelve a despachar.
  if not coalesce(t.flujo_dos_actores,false) and t.estado='DESPACHADO'
    and not exists(select 1 from evidencia_operacion.retiro where preparacion_id=t.id)
    and (select activo and pedidos_dos_actores from evidencia_operacion.configuracion where id) then
    update public.almacen_preparacion set flujo_dos_actores=true,salida_previa=true where id=t.id returning * into t;
    update public.almacen_preparacion_linea set revisada_base=0 where preparacion_id=t.id and vigente and preparada_base=0 and revisada_base is null;
  end if;
  if not coalesce(t.flujo_dos_actores,false) then
    r:=evidencia_operacion.preparacion(p_pedido,p_sucursal,p_tarea,p_accion,p_version,p_datos);
    select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
    if t.estado='PREPARANDO' and (select activo and pedidos_dos_actores from evidencia_operacion.configuracion where id) then
      update public.almacen_preparacion set flujo_dos_actores=true where id=t.id returning * into t;
    else return r||jsonb_build_object('pedido_dos_actores',false);end if;
    -- La acción ya quedó aplicada en el motor original.
    accion:='consultar';
  end if;
  if accion='escanear' and t.estado='DESPACHADO' then accion:='consultar';end if;
  if accion in ('preparado','confirmar_retiro') then
    select * into e from evidencia_operacion.lote where id=(p_datos->>'evidencia_id')::uuid;
    if e.id is not null and e.estado<>'BORRADOR' and e.tipo='PEDIDO' and e.preparacion_id=t.id and e.actor_id=a.id and e.version=p_version then
      if accion='preparado' and e.etapa='PREPARACION' then accion:='consultar';
      elsif accion='confirmar_retiro' and e.etapa='SALIDA' then
        select * into retiro from evidencia_operacion.retiro where preparacion_id=t.id;
        if retiro.evidencia_id=e.id and retiro.transportista_id=a.id and retiro.destino=btrim(p_datos->>'destino') and retiro.asignaciones=p_datos->'plan' then accion:='consultar';
        else raise exception 'La entrega ya tiene otro retiro confirmado.';end if;
      end if;
    end if;
  end if;
  if accion='confirmar_resto' then
    r:=almacen_operaciones.confirmar_resto_preparacion('PEDIDO',p_pedido,p_sucursal,t.id,p_version);
  elsif accion='confirmar_resto_revision' then
    if t.estado<>'REVISANDO' or t.revisor_id is distinct from a.id or t.preparador_id=a.id then raise exception 'Sólo el verificador asignado confirma la revisión.' using errcode='42501';end if;
    if p_version is distinct from t.version or jsonb_array_length(r->'cambios')>0 then raise exception 'La entrega cambió. Actualiza.' using errcode='40001';end if;
    update public.almacen_preparacion_linea set revisada_base=preparada_base,metodo_revision='visual',codigo_leido=null,
      revisada_en=now(),revisor_id=a.id,revisor_nombre=a.nombre,observacion_revision=''
      where preparacion_id=t.id and vigente and confirmada and (snapshot->>'preparable')::boolean and revisada_base is null;
    get diagnostics n=row_count;
    if n>0 then
      update public.almacen_preparacion set version=version+1,actualizado_en=now() where id=t.id;
      insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle)
        values(t.id,'RESTO_REVISION_CONFIRMADO',a.id,a.nombre,jsonb_build_object('cantidad_lineas',n));
    end if;
  elsif accion='preparado' then
    if t.preparador_id<>a.id then raise exception 'Sólo quien alista puede enviar esta preparación.' using errcode='42501';end if;
    e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,'PEDIDO',p_pedido,t.id,t.version);
    if e.etapa<>'PREPARACION' then raise exception 'Adjunta fotos del alistado de esta entrega.';end if;
    r:=almacen_operaciones.operar(p_pedido,p_sucursal,t.id,'preparado',p_version,p_datos);
    perform evidencia_operacion.encolar_pedido(e.id,t.id);
  elsif accion='confirmar_retiro' then
    if t.preparador_id=a.id or t.revisor_id is distinct from a.id or not(t.estado in ('REVISANDO','VERIFICADO') or t.estado='DESPACHADO' and t.salida_previa) then raise exception 'Sólo quien verifica esta entrega puede retirarla.' using errcode='42501';end if;
    if p_version is distinct from t.version or (not t.salida_previa and jsonb_array_length(r->'cambios')>0) then raise exception 'La entrega cambió. Actualiza.' using errcode='40001';end if;
    destino:=btrim(coalesce(p_datos->>'destino',''));
    if length(destino) not between 3 and 300 then raise exception 'Indica el destino de la entrega.';end if;
    if not exists(select 1 from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and revisada_base>0) then raise exception 'Debe haber al menos un producto verificado para retirar.';end if;
    e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,'PEDIDO',p_pedido,t.id,t.version);
    if e.etapa<>'SALIDA' then raise exception 'Adjunta fotos de la salida de esta entrega.';end if;
    plan:=evidencia_operacion.plan_salida(t.id);
    if plan is distinct from p_datos->'plan' then raise exception 'Cambiaron las ubicaciones de salida. Actualiza y comprueba el material.' using errcode='40001';end if;
    if exists(select 1 from jsonb_array_elements(plan) z where z->>'error' is not null) then raise exception 'Resuelve las cantidades o el stock antes de retirar.';end if;
    if t.estado='REVISANDO' then r:=almacen_operaciones.operar(p_pedido,p_sucursal,t.id,'verificado',p_version,'{}');end if;
    if not t.salida_previa then
    insert into evidencia_operacion.despacho_autorizado values(t.id,txid_current());
    for x in select * from jsonb_array_elements(plan) loop
      if exists(select 1 from public.pedido_linea where id=(x->>'linea_id')::bigint and es_personalizado) then
        perform public.entregar_personalizado((x->>'linea_id')::bigint,a.nombre);
      else
        datos:=(select jsonb_agg(jsonb_build_object('ubicacion_id',y->'ubicacion_id','cantidad_base',y->'cantidad_base')) from jsonb_array_elements(x->'asignaciones')y);
        perform public.despachar_linea((x->>'linea_id')::bigint,datos,a.nombre);
      end if;
    end loop;
    delete from evidencia_operacion.despacho_autorizado where preparacion_id=t.id;
    end if;
    update public.almacen_preparacion set estado='DESPACHADO',verificado_en=coalesce(verificado_en,now()),version=version+1,actualizado_en=now() where id=t.id;
    insert into evidencia_operacion.retiro(preparacion_id,transportista_id,transportista_nombre,destino,evidencia_id,asignaciones)
      values(t.id,a.id,a.nombre,destino,e.id,plan);
    insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle)
      values(t.id,'REVISION_Y_RETIRO',a.id,a.nombre,jsonb_build_object('destino',destino,'evidencia_id',e.id,'asignaciones',plan));
    perform evidencia_operacion.encolar_pedido(e.id,t.id,destino);
  elsif accion='verificado' then raise exception 'Usa Confirmar revisión y retirar en la miniapp actualizada.';
  elsif accion<>'consultar' then
    r:=evidencia_operacion.preparacion(p_pedido,p_sucursal,t.id,accion,p_version,p_datos);
  end if;
  -- También la siguiente entrega parcial conserva el circuito nuevo.
  if (r->'tarea'->>'estado')='PREPARANDO' and (select activo and pedidos_dos_actores from evidencia_operacion.configuracion where id) then
    update public.almacen_preparacion set flujo_dos_actores=true where id=(r->'tarea'->>'id')::bigint;
  end if;
  datos:=r->'confirmacion_preparacion';
  r:=evidencia_operacion.preparacion(p_pedido,p_sucursal,(coalesce(r->'tarea'->>'id',t.id::text))::bigint,'consultar',null,'{}');
  return r||jsonb_build_object('pedido_dos_actores',coalesce((r->'tarea'->>'flujo_dos_actores')::boolean,false),
    'entregada',case when r->'retiro'<>'null'::jsonb then true else (r->>'entregada')::boolean end,
    'confirmacion_preparacion',datos,'plan_salida',coalesce(r->'retiro'->'asignaciones',evidencia_operacion.plan_salida((r->'tarea'->>'id')::bigint)));
end $$;
revoke all on function evidencia_operacion.preparacion_dos(bigint,bigint,bigint,text,integer,jsonb) from public,anon;
grant execute on function evidencia_operacion.preparacion_dos(bigint,bigint,bigint,text,integer,jsonb) to authenticated;
revoke execute on function evidencia_operacion.preparacion(bigint,bigint,bigint,text,integer,jsonb) from authenticated;
revoke execute on function almacen_operaciones.operar(bigint,bigint,bigint,text,integer,jsonb) from authenticated;
create or replace function public.operar_preparacion_pedido(p_pedido_id bigint,p_sucursal_id bigint,p_tarea_id bigint default null,p_accion text default 'consultar',p_version integer default null,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select evidencia_operacion.preparacion_dos(p_pedido_id,p_sucursal_id,p_tarea_id,p_accion,p_version,p_datos)$$;

-- Recibos parciales del álbum y de cada mensaje: un rechazo posterior nunca
-- repite las fotos o los mensajes que Telegram ya confirmó.
do $$ begin execute replace(pg_get_functiondef('public.worker_evidencia_operacion(text,jsonb)'::regprocedure),'FUNCTION public.worker_evidencia_operacion(','FUNCTION evidencia_operacion.worker_anterior(');end $$;
revoke all on function evidencia_operacion.worker_anterior(text,jsonb) from public,anon,authenticated;
create or replace function public.worker_evidencia_operacion(p_accion text,p_datos jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare e evidencia_operacion.lote%rowtype;orden integer;
begin
  if p_accion in ('guardar_fotos','guardar_mensaje') then
    select * into e from evidencia_operacion.lote where id=(p_datos->>'id')::uuid and lease=(p_datos->>'lease')::uuid and estado='ENVIANDO' for update;
    if not found or e.tipo<>'PEDIDO' or jsonb_array_length(e.mensajes)=0 then raise exception 'La reserva de este envío no está vigente.';end if;
    if p_accion='guardar_fotos' then
      if jsonb_typeof(p_datos->'telegram') is distinct from 'array' or jsonb_array_length(p_datos->'telegram')<>jsonb_array_length(e.rutas) then raise exception 'Recibos incompletos.';end if;
      if e.fotos_telegram is not null and e.fotos_telegram<>p_datos->'telegram' then raise exception 'Ya existen otros recibos.';end if;
      update evidencia_operacion.lote set fotos_telegram=p_datos->'telegram' where id=e.id;
    else
      orden:=(p_datos->>'orden')::integer;
      if orden is null or orden<0 or orden>=jsonb_array_length(e.mensajes) or e.fotos_telegram is null or not (p_datos->'telegram' ? 'message_id') then raise exception 'Recibo de detalle inválido.';end if;
      if e.mensajes_telegram ? orden::text and e.mensajes_telegram->orden::text<>p_datos->'telegram' then raise exception 'Este mensaje ya tiene otro recibo.';end if;
      update evidencia_operacion.lote set mensajes_telegram=jsonb_set(mensajes_telegram,array[orden::text],p_datos->'telegram') where id=e.id;
    end if;
    return jsonb_build_object('ok',true);
  elsif p_accion='confirmar' then
    select * into e from evidencia_operacion.lote where id=(p_datos->>'id')::uuid and lease=(p_datos->>'lease')::uuid;
    if e.tipo='PEDIDO' and jsonb_array_length(e.mensajes)>0 and (e.fotos_telegram is null or (select count(*) from jsonb_object_keys(e.mensajes_telegram))<>jsonb_array_length(e.mensajes)) then raise exception 'Falta confirmar el detalle completo del pedido.';end if;
  end if;
  return evidencia_operacion.worker_anterior(p_accion,p_datos);
end $$;
revoke all on function public.worker_evidencia_operacion(text,jsonb) from public,anon,authenticated;
grant execute on function public.worker_evidencia_operacion(text,jsonb) to service_role;
notify pgrst,'reload schema';
