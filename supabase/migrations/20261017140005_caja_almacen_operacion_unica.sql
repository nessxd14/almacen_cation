-- Flujo opt-in: sólo VTD vinculadas a una operación. No reclasifica históricos.
create schema if not exists caja_almacen;
revoke all on schema caja_almacen from public, anon;
grant usage on schema caja_almacen to authenticated;

create table public.caja_operacion_almacen (
  id uuid primary key,
  cajero_id uuid not null references public.perfil(id),
  sesion_id bigint not null references public.sesion_caja(id),
  estado text not null default 'ACTIVA' check (estado in ('ACTIVA','COBRADA','COMPLETADA','RECHAZADA')),
  borrador jsonb not null default '{}',
  revision integer not null default 0,
  comprobante jsonb,
  creado_en timestamptz not null default now(),
  cerrado_en timestamptz
);
create unique index caja_operacion_unica_cajero on public.caja_operacion_almacen(cajero_id) where cerrado_en is null;
create index caja_operacion_turno on public.caja_operacion_almacen(sesion_id) where cerrado_en is null;

create table public.caja_operacion_vtd (
  venta_id bigint primary key references public.venta(id),
  operacion_id uuid not null references public.caja_operacion_almacen(id),
  estado text not null default 'SOLICITADO' check (estado in ('SOLICITADO','EN_CAJA','ENTREGADO','RETORNO_PENDIENTE','RETORNADO','CANCELADO')),
  lineas jsonb not null,
  responsable_id uuid references public.perfil(id),
  escaneado_en timestamptz,
  enviado_en timestamptz,
  recibido_en timestamptz,
  motivo text,
  version integer not null default 0
);
create index caja_operacion_vtd_operacion on public.caja_operacion_vtd(operacion_id);
create index caja_operacion_vtd_pendientes on public.caja_operacion_vtd(estado) where estado in ('SOLICITADO','EN_CAJA','RETORNO_PENDIENTE');
create table public.caja_operacion_evento (
  id bigint generated always as identity primary key,
  operacion_id uuid not null references public.caja_operacion_almacen(id),
  venta_id bigint references public.venta(id),
  accion text not null,
  actor_id uuid not null,
  detalle jsonb not null default '{}',
  creado_en timestamptz not null default now()
);
create index caja_operacion_evento_operacion on public.caja_operacion_evento(operacion_id,id);
alter table public.caja_operacion_almacen enable row level security;
alter table public.caja_operacion_vtd enable row level security;
alter table public.caja_operacion_evento enable row level security;
-- No acceso directo: el RPC comprueba perfil, propietario y sucursal en cada acción.
revoke all on public.caja_operacion_almacen, public.caja_operacion_vtd, public.caja_operacion_evento from public, anon, authenticated;

-- Contexto privado por transacción. Un cliente no puede fingirlo mediante set_config.
create table caja_almacen.contexto (transaccion bigint primary key, operacion_id uuid not null);
alter table caja_almacen.contexto enable row level security;
revoke all on caja_almacen.contexto from public, anon, authenticated;

create function caja_almacen.respuesta(p_id uuid) returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$
  select jsonb_build_object('operacion',to_jsonb(o),'vtds',coalesce((
    select jsonb_agg(to_jsonb(d)||jsonb_build_object('numero',v.numero,'total',v.total,'cliente_id',v.cliente_id,'cliente',c.nombre,'ubicacion_id',v.ubicacion_id) order by d.venta_id)
    from public.caja_operacion_vtd d join public.venta v on v.id=d.venta_id left join public.cliente c on c.id=v.cliente_id where d.operacion_id=o.id
  ),'[]'::jsonb)) from public.caja_operacion_almacen o where o.id=p_id;
$$;
revoke all on function caja_almacen.respuesta(uuid) from public,anon,authenticated;

create function caja_almacen.respuesta_almacen(p_id uuid,p_venta bigint) returns jsonb
language sql security definer set search_path=pg_catalog,public,pg_temp as $$
  select jsonb_build_object('operacion',jsonb_build_object('id',r->'operacion'->'id','estado',r->'operacion'->'estado'),
    'vtds',coalesce((select jsonb_agg(x) from jsonb_array_elements(r->'vtds') x where (x->>'venta_id')::bigint=p_venta),'[]'::jsonb))
  from (select caja_almacen.respuesta(p_id) r) q;
$$;
revoke all on function caja_almacen.respuesta_almacen(uuid,bigint) from public,anon,authenticated;

create function caja_almacen.operar(p_accion text,p_operacion_id uuid,p_sesion_id bigint,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare
  actor public.perfil%rowtype; ses public.sesion_caja%rowtype;
  op public.caja_operacion_almacen%rowtype; d public.caja_operacion_vtd%rowtype;
  v public.venta%rowtype; linea jsonb; actuales jsonb; salida bigint; result jsonb;
  ids bigint[]; vid bigint; v_motivo text; pago record; efectivo numeric;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if not found or actor.rol not in ('cajero','admin','gerente','almacenero','operario') then raise exception 'Tu perfil no permite esta operación.' using errcode='42501'; end if;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>1000000 then raise exception 'Datos de operación inválidos.'; end if;
  v_motivo:=btrim(coalesce(p_datos->>'motivo',''));
  if length(v_motivo)>1000 then raise exception 'El motivo no puede superar 1000 caracteres.'; end if;

  if p_accion in ('listar_almacen','consultar_vtd','escanear','enviar','recibir_retorno') then
    if actor.rol not in ('admin','gerente','almacenero','operario') then raise exception 'Esta acción corresponde a Almacén.' using errcode='42501'; end if;
    if p_accion='listar_almacen' then
      return jsonb_build_object('documentos',coalesce((select jsonb_agg(x) from (
        select ent.*,vs.numero,vs.total,u.sucursal_id from public.caja_operacion_vtd ent join public.venta vs on vs.id=ent.venta_id join public.ubicacion u on u.id=vs.ubicacion_id
        where ent.estado in ('SOLICITADO','EN_CAJA','RETORNO_PENDIENTE') and (actor.rol in ('admin','gerente') or actor.sucursal_id=u.sucursal_id)
        order by ent.venta_id limit 200
      ) x),'[]'::jsonb));
    end if;
    vid:=(p_datos->>'venta_id')::bigint;
    -- Orden global: cajero -> operación -> VTD -> venta. Igual al checkout.
    select o.* into op from public.caja_operacion_almacen o join public.caja_operacion_vtd l on l.operacion_id=o.id where l.venta_id=vid;
    if not found then return jsonb_build_object('operacion',null); end if;
    perform pg_advisory_xact_lock(hashtextextended('caja-almacen:'||op.cajero_id,0));
    select * into op from public.caja_operacion_almacen where id=op.id for update;
    select * into d from public.caja_operacion_vtd where venta_id=vid for update;
    select * into v from public.venta where id=vid for update;
    if actor.rol not in ('admin','gerente') and not exists(select 1 from public.ubicacion where id=v.ubicacion_id and sucursal_id=actor.sucursal_id) then raise exception 'Esta entrega pertenece a otra sucursal.' using errcode='42501'; end if;
    if p_accion='consultar_vtd' then return caja_almacen.respuesta_almacen(op.id,vid); end if;
    if p_accion='escanear' then
      if d.estado='SOLICITADO' and d.escaneado_en is null then
        update public.caja_operacion_vtd set responsable_id=actor.id,escaneado_en=now(),version=version+1 where venta_id=vid;
        insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id) values(op.id,vid,'ESCANEADO',actor.id);
      end if;
      return caja_almacen.respuesta_almacen(op.id,vid);
    end if;
    if p_accion='enviar' and d.estado in ('EN_CAJA','ENTREGADO') then return caja_almacen.respuesta_almacen(op.id,vid); end if;
    if p_accion='recibir_retorno' and d.estado='RETORNADO' then return caja_almacen.respuesta_almacen(op.id,vid); end if;
    if (p_datos->>'version')::integer is distinct from d.version then raise exception 'La entrega cambió. Actualiza antes de confirmar.' using errcode='40001'; end if;
    if p_accion='enviar' then
      if d.estado<>'SOLICITADO' or op.cerrado_en is not null or v.estado<>'ABIERTA' then raise exception 'La entrega ya no está disponible para enviar.'; end if;
      if d.responsable_id is not null and d.responsable_id<>actor.id then raise exception 'Otro encargado tiene esta verificación.' using errcode='42501'; end if;
      if d.escaneado_en is null and length(v_motivo)<5 then raise exception 'Indica el motivo para regularizar una verificación sin escaneo.'; end if;
      if p_datos->'cantidades' is distinct from (select jsonb_agg(jsonb_build_object('linea_id',x->'linea_id','cantidad_base',x->'cantidad_base') order by (x->>'linea_id')::bigint) from jsonb_array_elements(d.lineas) x) then raise exception 'Comprueba todas las cantidades y presentaciones del documento.'; end if;
      insert into caja_almacen.contexto values(txid_current(),op.id);
      actuales:='[]';
      for linea in select value from jsonb_array_elements(d.lineas) loop
        if not exists(select 1 from public.presentacion pr where pr.id=(linea->>'presentacion_id')::bigint and pr.producto_id=(linea->>'producto_id')::bigint
          and coalesce(pr.activo,true) and round(pr.factor_unidad_base*(linea->>'cantidad_presentacion')::numeric,4)=round((linea->>'cantidad_base')::numeric,4)) then raise exception 'La presentación cambió. Revisa el documento antes de enviar.'; end if;
        -- Salida a custodia de Caja: queda en tránsito en este expediente, fuera del disponible.
        select public.registrar_salida(
          p_presentacion_id=>(linea->>'presentacion_id')::bigint,
          p_ubicacion_id=>public.resolver_ubicacion_salida((linea->>'producto_id')::bigint,v.ubicacion_id),
          p_cantidad_pres=>(linea->>'cantidad_presentacion')::numeric,
          p_referencia=>'Envío Caja VTD #'||vid,p_usuario=>actor.nombre::varchar,
          p_idempotencia=>'caja-almacen:envio:'||vid||':'||(linea->>'linea_id'),p_permitir_sobregiro=>false
        ) into salida;
        update public.venta_linea set kardex_transaccion_id=salida where id=(linea->>'linea_id')::bigint;
        actuales:=actuales||jsonb_build_array(linea||jsonb_build_object('kardex_id',salida));
      end loop;
      update public.caja_operacion_vtd set estado='EN_CAJA',lineas=actuales,responsable_id=actor.id,enviado_en=now(),motivo=nullif(v_motivo,''),version=version+1 where venta_id=vid;
      delete from caja_almacen.contexto where transaccion=txid_current();
    else
      if d.estado<>'RETORNO_PENDIENTE' then raise exception 'No hay material pendiente de retorno.'; end if;
      if p_datos->'cantidades' is distinct from (select jsonb_agg(jsonb_build_object('linea_id',x->'linea_id','cantidad_base',x->'cantidad_base') order by (x->>'linea_id')::bigint) from jsonb_array_elements(d.lineas) x) then raise exception 'Declara la recepción completa; si falta material, conserva la incidencia pendiente.'; end if;
      for linea in select value from jsonb_array_elements(d.lineas) loop
        select ubicacion_id into vid from public.kardex_transacciones where id=(linea->>'kardex_id')::bigint;
        perform public.registrar_entrada((linea->>'presentacion_id')::bigint,vid,(linea->>'cantidad_presentacion')::numeric,
          'Retorno Caja VTD #'||d.venta_id,actor.nombre::varchar,current_date,null,'caja-almacen:retorno:'||d.venta_id||':'||(linea->>'linea_id'));
      end loop;
      update public.caja_operacion_vtd set estado='RETORNADO',recibido_en=now(),version=version+1 where venta_id=d.venta_id;
    end if;
    insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle) values(op.id,d.venta_id,upper(p_accion),actor.id,p_datos);
    return caja_almacen.respuesta_almacen(op.id,d.venta_id);
  end if;

  if actor.rol not in ('cajero','admin','gerente') then raise exception 'Esta acción corresponde a Caja.' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('caja-almacen:'||actor.id,0));
  select * into op from public.caja_operacion_almacen where cajero_id=actor.id and cerrado_en is null for update;
  if p_accion='actual' then return coalesce(caja_almacen.respuesta(op.id),jsonb_build_object('operacion',null,'vtds','[]'::jsonb)); end if;
  if p_accion='crear_vtd' then
    if p_operacion_id is null or (op.id is not null and op.id<>p_operacion_id) then raise exception 'Retoma tu operación pendiente antes de solicitar otro material.'; end if;
    if exists(select 1 from public.caja_operacion_almacen where id=p_operacion_id and cajero_id<>actor.id) then raise exception 'La operación pertenece a otro cajero.' using errcode='42501'; end if;
    select detalle into result from public.caja_operacion_evento where operacion_id=p_operacion_id and accion='SOLICITUD_CREADA' order by id limit 1;
    if found then
      if result is distinct from p_datos->'solicitud' then raise exception 'La solicitud ya fue creada con otro contenido. Recupera su documento.'; end if;
      return caja_almacen.respuesta(p_operacion_id);
    end if;
    select * into ses from public.sesion_caja where id=p_sesion_id for update;
    if not found or ses.estado<>'ABIERTA' or (actor.rol='cajero' and ses.cajero_id is distinct from actor.id) then raise exception 'No tienes un turno propio abierto.' using errcode='42501'; end if;
    if op.id is null then insert into public.caja_operacion_almacen(id,cajero_id,sesion_id) values(p_operacion_id,actor.id,p_sesion_id) returning * into op; end if;
    if op.estado<>'ACTIVA' or op.sesion_id<>p_sesion_id then raise exception 'La operación ya fue cobrada o pertenece a otro turno.'; end if;
    insert into caja_almacen.contexto values(txid_current(),op.id);
    result:=public.abrir_venta(p_lineas=>p_datos->'solicitud'->'lineas',p_ubicacion_id=>(p_datos->'solicitud'->>'ubicacion_id')::bigint,
      p_sesion_caja_id=>p_sesion_id,p_pagos=>null,p_cliente_id=>nullif(p_datos->'solicitud'->>'cliente_id','')::bigint,
      p_descuento_total=>coalesce((p_datos->'solicitud'->>'descuento')::numeric,0),p_usuario=>actor.nombre,p_idempotencia=>'caja-almacen:crear:'||op.id);
    delete from caja_almacen.contexto where transaccion=txid_current();
    perform caja_almacen.operar('vincular',op.id,p_sesion_id,jsonb_build_object('vtd_ids',jsonb_build_array(result->'venta_id'),'borrador',coalesce(p_datos->'borrador','{}')));
    insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle) values(op.id,(result->>'venta_id')::bigint,'SOLICITUD_CREADA',actor.id,p_datos->'solicitud');
    return caja_almacen.respuesta(op.id);
  end if;
  if p_accion='vincular' then
    if p_operacion_id is null then raise exception 'Identifica la operación actual.'; end if;
    if op.id is not null and op.id<>p_operacion_id then raise exception 'Primero retoma y resuelve tu operación pendiente.' using errcode='40001'; end if;
    select * into ses from public.sesion_caja where id=p_sesion_id for update;
    if not found or ses.estado<>'ABIERTA' or (actor.rol='cajero' and ses.cajero_id is distinct from actor.id) then raise exception 'No tienes un turno propio abierto.' using errcode='42501'; end if;
    if op.id is null then
      insert into public.caja_operacion_almacen(id,cajero_id,sesion_id) values(p_operacion_id,actor.id,p_sesion_id) returning * into op;
    end if;
    if op.sesion_id<>p_sesion_id or op.estado<>'ACTIVA' then raise exception 'La operación ya fue cobrada o pertenece a otro turno.'; end if;
    if p_datos ? 'borrador' then
      if jsonb_typeof(p_datos->'borrador') is distinct from 'object' then raise exception 'Borrador inválido.'; end if;
      if exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id) and (p_datos->>'revision')::integer is distinct from op.revision then raise exception 'La operación cambió en otra pestaña. Recupera su versión actual.' using errcode='40001'; end if;
    end if;
    if jsonb_typeof(p_datos->'vtd_ids') is distinct from 'array' or jsonb_array_length(p_datos->'vtd_ids') not between 1 and 30 then raise exception 'Selecciona entre una y treinta VTD.'; end if;
    for vid in select distinct value::bigint from jsonb_array_elements_text(p_datos->'vtd_ids') order by 1 loop
      select * into d from public.caja_operacion_vtd where venta_id=vid;
      if found then
        if d.operacion_id<>op.id then raise exception 'La VTD ya pertenece a otra operación.'; end if;
        continue;
      end if;
      select * into v from public.venta where id=vid for update;
      if not found or v.numero not like 'VTD-%' or v.estado not in ('ABIERTA','COMPLETADA') or not v.cobro_exigible or v.total<=0 or exists(select 1 from public.venta_pago where venta_id=vid) then raise exception 'La VTD no está disponible para este cobro.'; end if;
      if v.estado='ABIERTA' and exists(select 1 from public.venta_linea where venta_id=vid and kardex_transaccion_id is not null) then raise exception 'La VTD ya tiene una salida registrada; revisa su entrega.'; end if;
      select jsonb_agg(jsonb_build_object('linea_id',l.id,'producto_id',l.producto_id,'presentacion_id',l.presentacion_id,'cantidad_base',l.cantidad,
        'cantidad_presentacion',coalesce(l.cantidad_presentacion,l.cantidad),'nombre',p.nombre,'presentacion',pr.nombre) order by l.id)
        into actuales from public.venta_linea l join public.producto p on p.id=l.producto_id join public.presentacion pr on pr.id=l.presentacion_id where l.venta_id=vid;
      if actuales is null then raise exception 'La VTD no tiene líneas con presentación válida.'; end if;
      insert into public.caja_operacion_vtd(venta_id,operacion_id,lineas,estado) values(vid,op.id,actuales,case when v.estado='COMPLETADA' then 'ENTREGADO' else 'SOLICITADO' end);
      insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id) values(op.id,vid,'VINCULADO',actor.id);
    end loop;
    if (select count(*) from public.caja_operacion_vtd where operacion_id=op.id and estado in ('SOLICITADO','EN_CAJA','ENTREGADO'))>30 then raise exception 'La operación admite hasta treinta VTD.'; end if;
    if p_datos ? 'borrador' then update public.caja_operacion_almacen set borrador=p_datos->'borrador',revision=revision+1 where id=op.id; end if;
    return caja_almacen.respuesta(op.id);
  end if;
  -- Recuperar un resultado cerrado sólo para su propietario (respuesta perdida).
  if op.id is null and p_operacion_id is not null then select * into op from public.caja_operacion_almacen where id=p_operacion_id and cajero_id=actor.id for update; end if;
  if op.id is null or op.id is distinct from p_operacion_id then raise exception 'Retoma tu operación actual antes de continuar.' using errcode='40001'; end if;
  if op.cerrado_en is not null then
    if p_accion in ('completar','cerrar_rechazo') then return caja_almacen.respuesta(op.id); end if;
    raise exception 'La operación ya está cerrada.';
  end if;
  select * into ses from public.sesion_caja where id=op.sesion_id for update;
  if ses.estado<>'ABIERTA' then raise exception 'El turno ya está cerrado.'; end if;
  if p_accion='guardar' then
    if op.estado<>'ACTIVA' then raise exception 'El cobro ya fue registrado; no edites sus importes.'; end if;
    if (p_datos->>'revision')::integer is distinct from op.revision then raise exception 'La operación cambió en otra pestaña. Recupera su versión actual.' using errcode='40001'; end if;
    if jsonb_typeof(p_datos->'borrador') is distinct from 'object' then raise exception 'Borrador inválido.'; end if;
    update public.caja_operacion_almacen set borrador=p_datos->'borrador',revision=revision+1 where id=op.id;
  elsif p_accion='rechazar' then
    if length(v_motivo)<5 then raise exception 'Indica el motivo del rechazo (mínimo 5 caracteres).'; end if;
    vid:=(p_datos->>'venta_id')::bigint;
    select * into d from public.caja_operacion_vtd where venta_id=vid and operacion_id=op.id for update;
    if not found then raise exception 'La VTD no pertenece a esta operación.'; end if;
    if d.estado in ('CANCELADO','RETORNO_PENDIENTE','RETORNADO') then return caja_almacen.respuesta(op.id); end if;
    if d.estado='ENTREGADO' then raise exception 'La entrega ya se completó. Usa el procedimiento de devolución.'; end if;
    select * into v from public.venta where id=vid for update;
    if exists(select 1 from public.venta_pago where venta_id=vid) then
      if p_datos->>'devolucion_realizada' is distinct from 'true' or length(btrim(coalesce(p_datos->>'referencia','')))<3 then raise exception 'Confirma la devolución realizada e indica su referencia antes de resolver el rechazo.'; end if;
      select coalesce(sum(case when tipo in ('VENTA','ANTICIPO','INGRESO') then monto when tipo in ('EGRESO','ANULACION') then -monto else 0 end),0)+ses.monto_apertura into efectivo from public.movimiento_caja where sesion_caja_id=ses.id and metodo='EFECTIVO' and not fuera_de_arqueo;
      if efectivo<(select coalesce(sum(monto),0) from public.venta_pago where venta_id=vid and metodo='EFECTIVO') then raise exception 'No hay efectivo suficiente en este turno para registrar la devolución.'; end if;
    end if;
    insert into caja_almacen.contexto values(txid_current(),op.id);
    for pago in select * from public.venta_pago where venta_id=vid loop
      insert into public.movimiento_caja(sesion_caja_id,tipo,metodo,monto,venta_id,creado_por,nota)
        values(ses.id,'ANULACION',pago.metodo,pago.monto,vid,actor.nombre,'Rechazo VTD: '||v_motivo||' · '||(p_datos->>'referencia'));
    end loop;
    update public.venta set estado='ANULADA' where id=vid;
    update public.caja_operacion_vtd set estado=case when d.estado='EN_CAJA' then 'RETORNO_PENDIENTE' else 'CANCELADO' end,motivo=v_motivo,version=version+1 where venta_id=vid;
    delete from caja_almacen.contexto where transaccion=txid_current();
    insert into public.caja_operacion_evento(operacion_id,venta_id,accion,actor_id,detalle) values(op.id,vid,'RECHAZADO',actor.id,p_datos);
  elsif p_accion in ('completar','cerrar_rechazo') then
    if p_accion='completar' then
      if op.comprobante is null then raise exception 'Primero registra el cobro conjunto de esta operación.'; end if;
      if exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado='SOLICITADO') then raise exception 'Pendiente de verificación de Almacén. Puedes cobrar el conjunto, pero todavía no completar.'; end if;
      if exists(select 1 from public.venta_pago where venta_id in(select value::bigint from jsonb_array_elements_text(op.comprobante->'ventas')) and estado_verificacion::text in ('PENDIENTE','RECHAZADO') and exists(select 1 from public.venta vs where vs.id=venta_id and vs.estado<>'ANULADA')) then raise exception 'Hay pagos digitales pendientes o rechazados. Solicita su verificación antes de entregar.'; end if;
      insert into caja_almacen.contexto values(txid_current(),op.id);
      update public.venta set estado='COMPLETADA',completado_en=now() where id in(select venta_id from public.caja_operacion_vtd where operacion_id=op.id and estado='EN_CAJA');
      update public.caja_operacion_vtd set estado='ENTREGADO',version=version+1 where operacion_id=op.id and estado='EN_CAJA';
      delete from caja_almacen.contexto where transaccion=txid_current();
    else
      if op.comprobante is not null or exists(select 1 from public.caja_operacion_vtd where operacion_id=op.id and estado in ('SOLICITADO','EN_CAJA','ENTREGADO')) then raise exception 'Completa el cobro y la entrega de la operación vigente.'; end if;
      if jsonb_array_length(coalesce(op.borrador->'cart','[]'))>0 then raise exception 'Resuelve también los productos VTA de la operación.'; end if;
    end if;
    update public.caja_operacion_almacen set estado=case when p_accion='completar' then 'COMPLETADA' else 'RECHAZADA' end,cerrado_en=now(),revision=revision+1 where id=op.id;
    insert into public.caja_operacion_evento(operacion_id,accion,actor_id) values(op.id,upper(p_accion),actor.id);
  else raise exception 'Acción desconocida.';
  end if;
  return caja_almacen.respuesta(op.id);
end;
$$;
revoke all on function caja_almacen.operar(text,uuid,bigint,jsonb) from public,anon;
grant execute on function caja_almacen.operar(text,uuid,bigint,jsonb) to authenticated;
create function public.operar_caja_almacen(p_accion text,p_operacion_id uuid default null,p_sesion_id bigint default null,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path=pg_catalog,public,pg_temp as $$select caja_almacen.operar(p_accion,p_operacion_id,p_sesion_id,p_datos)$$;
revoke all on function public.operar_caja_almacen(text,uuid,bigint,jsonb) from public,anon;
grant execute on function public.operar_caja_almacen(text,uuid,bigint,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION caja_almacen.checkout_base(p_lineas jsonb, p_pagos jsonb, p_sesion_id bigint, p_idempotencia text, p_cliente_id bigint DEFAULT NULL::bigint, p_descuento numeric DEFAULT 0, p_saldo numeric DEFAULT 0, p_vendedor_id uuid DEFAULT NULL::uuid, p_pedido_ids bigint[] DEFAULT '{}'::bigint[], p_quitadas jsonb DEFAULT '[]'::jsonb, p_vtd_ids bigint[] DEFAULT '{}'::bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  actor uuid:=auth.uid(); usuario text; seller uuid:=p_vendedor_id; seller_name text;
  pedido_seller uuid; cantidad int; session_row public.sesion_caja%rowtype;
  previo public.cobro_caja%rowtype; solicitud jsonb; resultado jsonb; receipt_doc jsonb;
  nuevo numeric:=0; vtd_total numeric:=0; total numeric; pagado numeric:=0; cash_change numeric:=0;
  l jsonb; pago jsonb; cantidad_linea numeric; unitario numeric; factor numeric; monto numeric;
  falta numeric; toma numeric; pagos_nuevos jsonb:='[]'; pagos_vtd jsonb:='[]'; metodo text;
  venta_nueva bigint; ventas bigint[]:='{}'; v public.venta%rowtype; receipt_id bigint; numero text;
begin
  perform hermes.exigir_operador_pos();
  select coalesce(p.email,p.id::text) into usuario from public.perfil p where p.id=actor and p.activo;
  if actor is null or usuario is null then raise exception 'Operador no autorizado' using errcode='42501';end if;
  if p_idempotencia is null or length(p_idempotencia)<8 or length(p_idempotencia)>160 then raise exception 'Clave de cobro inválida';end if;
  if p_lineas is null or jsonb_typeof(p_lineas)<>'array' or p_pagos is null or jsonb_typeof(p_pagos)<>'array'
    or p_quitadas is null or jsonb_typeof(p_quitadas)<>'array' or p_vtd_ids is null or p_pedido_ids is null
    or p_descuento is null or p_saldo is null or p_descuento<0 or p_saldo<0
    or p_descuento::text in ('NaN','Infinity','-Infinity') or p_saldo::text in ('NaN','Infinity','-Infinity')
    or p_descuento<>round(p_descuento,2) or p_saldo<>round(p_saldo,2) then raise exception 'Datos de cobro inválidos';end if;
  if cardinality(p_pedido_ids)>1 or cardinality(p_vtd_ids)>30
    or cardinality(p_vtd_ids)<>(select count(distinct x) from unnest(p_vtd_ids) x)
    or exists(select 1 from unnest(p_vtd_ids) x where x is null or x<=0) then raise exception 'Selección de documentos inválida';end if;
  solicitud:=jsonb_build_object('lineas',p_lineas,'pagos',p_pagos,'sesion',p_sesion_id,'cliente',p_cliente_id,
    'descuento',p_descuento,'saldo',p_saldo,'vendedor',seller,'pedidos',p_pedido_ids,'quitadas',p_quitadas,'vtd',p_vtd_ids,'actor',actor);
  perform pg_advisory_xact_lock(hashtextextended('checkout-caja:'||p_idempotencia,0));
  select * into previo from public.cobro_caja where idempotencia=p_idempotencia;
  if found then
    if previo.solicitud is distinct from solicitud then raise exception 'Este intento corresponde a otro cobro';end if;
    return previo.documento||jsonb_build_object('reintento',true);
  end if;
  select * into session_row from public.sesion_caja where id=p_sesion_id for update;
  if not found or session_row.estado::text<>'ABIERTA' then raise exception 'La caja está cerrada';end if;
  if session_row.cajero_id is distinct from actor and not exists(select 1 from public.perfil where id=actor and rol::text in ('admin','gerente'))
    then raise exception 'Este turno pertenece a otro cajero' using errcode='42501';end if;
  if seller is not null and not exists(select 1 from public.perfil p where p.id=seller and p.activo
    and p.rol::text in ('vendedor','vendedor_mayoreo','cajero','admin','gerente')) then raise exception 'Vendedor no disponible';end if;
  if cardinality(p_pedido_ids)>0 then
    select vendedor_id into pedido_seller from public.pedido_vendedor where id=p_pedido_ids[1];
    if not found then raise exception 'Pedido de vendedor inexistente';end if;
    if seller is not null and seller<>pedido_seller then raise exception 'Conserva el vendedor del pedido';end if;
    seller:=pedido_seller;
  end if;
  select nombre into seller_name from public.perfil where id=seller;
  for l in select * from jsonb_array_elements(p_lineas) loop
    unitario:=(l->>'precio_unitario')::numeric;
    cantidad_linea:=coalesce((l->>'cantidad_presentacion')::numeric,(l->>'cantidad_base')::numeric);
    if unitario is null or unitario<=0 or cantidad_linea is null or cantidad_linea<=0
      or unitario::text in ('NaN','Infinity','-Infinity') or cantidad_linea::text in ('NaN','Infinity','-Infinity') then raise exception 'Línea sin precio o cantidad válida';end if;
    if l->>'presentacion_id' is not null then
      select factor_unidad_base into factor from public.presentacion where id=(l->>'presentacion_id')::bigint;
      if factor is null then raise exception 'Presentación inexistente';end if;
    end if;
    nuevo:=nuevo+round(unitario*cantidad_linea,2);
  end loop;
  nuevo:=nuevo-p_descuento;
  if nuevo<0 or (jsonb_array_length(p_lineas)>0 and nuevo<=0) or p_saldo>nuevo then raise exception 'Descuento o saldo exceden la venta de mostrador';end if;
  cantidad:=0;
  for v in select * from public.venta where id=any(p_vtd_ids) order by id for update loop
    cantidad:=cantidad+1;
    if v.numero is null or v.numero not like 'VTD-%' or not v.cobro_exigible or v.estado::text='ANULADA'
      or v.total is null or v.total<=0 or exists(select 1 from public.venta_pago where venta_id=v.id)
      or not exists(select 1 from public.v_vtd_por_cobrar vc where vc.venta_id=v.id) then raise exception 'Una VTD ya está cobrada o no está disponible';end if;
    if v.cliente_id is not null and v.cliente_id is distinct from p_cliente_id then raise exception 'Elige el mismo cliente de la VTD para este cobro';end if;
    vtd_total:=vtd_total+v.total;ventas:=array_append(ventas,v.id);
  end loop;
  if cantidad<>cardinality(p_vtd_ids) then raise exception 'VTD inexistente';end if;
  total:=nuevo+vtd_total;
  if total<=0 then raise exception 'Agrega productos o documentos para cobrar';end if;
  falta:=nuevo-p_saldo;
  for pago in select * from jsonb_array_elements(p_pagos) loop
    metodo:=pago->>'metodo';monto:=(pago->>'monto')::numeric;
    if metodo is null or metodo not in ('EFECTIVO','QR','TRANSFERENCIA') or monto is null or monto<=0
      or monto::text in ('NaN','Infinity','-Infinity') or monto<>round(monto,2) then raise exception 'Pago inválido';end if;
    if pago->>'recibido' is not null then
      if metodo<>'EFECTIVO' or (pago->>'recibido')::numeric<monto or (pago->>'recibido')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'Recibido inválido';end if;
      cash_change:=cash_change+(pago->>'recibido')::numeric-monto;
    end if;
    pagado:=pagado+monto;toma:=least(falta,monto);
    if toma>0 then pagos_nuevos:=pagos_nuevos||jsonb_build_array(jsonb_build_object('metodo',metodo,'monto',toma));end if;
    if monto>toma then pagos_vtd:=pagos_vtd||jsonb_build_array(jsonb_build_object('metodo',metodo,'monto',monto-toma));end if;
    falta:=falta-toma;
  end loop;
  if pagado+p_saldo<>total then raise exception 'El pago no coincide con el total del carrito';end if;
  if p_saldo>0 then pagos_nuevos:=pagos_nuevos||jsonb_build_array(jsonb_build_object('metodo','SALDO_FAVOR','monto',p_saldo));end if;
  if jsonb_array_length(p_lineas)>0 then
    if cardinality(p_pedido_ids)>0 then
      resultado:=public.cobrar_pedido_vendedor(p_pedido_ids,p_lineas,pagos_nuevos,p_sesion_id,'caja:'||p_idempotencia||':venta',p_quitadas,p_descuento,p_cliente_id);
    else
      resultado:=public.registrar_venta(p_lineas,pagos_nuevos,p_sesion_id,p_cliente_id,p_descuento,usuario,'caja:'||p_idempotencia||':venta');
    end if;
    venta_nueva:=(resultado->>'venta_id')::bigint;
    update public.venta set vendedor_id=seller where id=venta_nueva;
    ventas:=array_prepend(venta_nueva,ventas);
  elsif cardinality(p_pedido_ids)>0 then raise exception 'El pedido no tiene líneas verificadas';end if;
  if cardinality(p_vtd_ids)>0 then
    perform public.cobrar_vtd(p_vtd_ids,p_sesion_id,pagos_vtd,'caja:'||p_idempotencia||':vtd');
    -- La atribución elegida completa VTD sin vendedor; conserva atribuciones previas.
    if seller is not null then update public.venta set vendedor_id=seller where id=any(p_vtd_ids) and vendedor_id is null;end if;
  end if;
  receipt_id:=nextval(pg_get_serial_sequence('public.cobro_caja','id'));
  numero:='CJA-'||to_char(now() at time zone 'America/La_Paz','YYYYMMDD')||'-'||receipt_id;
  receipt_doc:=jsonb_build_object('numero',numero,'total',total,'ventas',ventas,'vendedor',seller_name,
    'cliente',(select nombre from public.cliente where id=p_cliente_id),'creado_en',now(),'pagos',p_pagos,
    'saldo_favor',p_saldo,'cambio',cash_change,'descuento',p_descuento,
    'lineas',(select coalesce(jsonb_agg(jsonb_build_object('descripcion',coalesce(nullif(vl.descripcion,''),pr.nombre),
      'cantidad',coalesce(vl.cantidad_presentacion,vl.cantidad),'precio',vl.precio_unitario,
      'subtotal',round(coalesce(vl.cantidad_presentacion,vl.cantidad)*vl.precio_unitario,2),
      'origen',case when vl.venta_id=venta_nueva then 'Mostrador' else sale.numero end) order by vl.venta_id,vl.id),'[]')
      from public.venta_linea vl join public.venta sale on sale.id=vl.venta_id left join public.producto pr on pr.id=vl.producto_id where vl.venta_id=any(ventas)));
  insert into public.cobro_caja(id,numero,sesion_id,actor_id,idempotencia,solicitud,documento) overriding system value
    values(receipt_id,numero,p_sesion_id,actor,p_idempotencia,solicitud,receipt_doc);
  receipt_doc:=receipt_doc||jsonb_build_object('id',receipt_id,'reintento',false);
  update public.cobro_caja set documento=receipt_doc where id=receipt_id;
  return receipt_doc;
end $function$

;
revoke all on function caja_almacen.checkout_base(jsonb,jsonb,bigint,text,bigint,numeric,numeric,uuid,bigint[],jsonb,bigint[]) from public,anon,authenticated;

create or replace function public.checkout_caja(
  p_lineas jsonb,p_pagos jsonb,p_sesion_id bigint,p_idempotencia text,
  p_cliente_id bigint default null,p_descuento numeric default 0,p_saldo numeric default 0,p_vendedor_id uuid default null,
  p_pedido_ids bigint[] default '{}',p_quitadas jsonb default '[]',p_vtd_ids bigint[] default '{}'
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare op public.caja_operacion_almacen%rowtype; result jsonb; esperadas bigint[]; previa public.cobro_caja%rowtype;
begin
  if not exists(select 1 from public.perfil where id=auth.uid() and activo and rol in ('cajero','admin','gerente')) then raise exception 'No autorizado' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('caja-almacen:'||auth.uid(),0));
  select * into op from public.caja_operacion_almacen where cajero_id=auth.uid() and cerrado_en is null for update;
  -- Los reintentos siguen validando la huella del checkout original.
  select * into previa from public.cobro_caja where idempotencia=p_idempotencia;
  if previa.id is not null and previa.actor_id is distinct from auth.uid() then raise exception 'El cobro pertenece a otro cajero.' using errcode='42501'; end if;
  if op.id is null and exists(select 1 from public.venta where id=any(p_vtd_ids) and estado='ABIERTA') and previa.id is null then
    if p_idempotencia !~ '^checkout:[0-9a-fA-F-]{36}$' then raise exception 'Actualiza Caja y vincula las VTD a tu operación antes de cobrar.'; end if;
    perform caja_almacen.operar('vincular',substring(p_idempotencia from 10)::uuid,p_sesion_id,jsonb_build_object('vtd_ids',to_jsonb(p_vtd_ids)));
    select * into op from public.caja_operacion_almacen where cajero_id=auth.uid() and cerrado_en is null for update;
  end if;
  if op.id is not null then
    if p_idempotencia is distinct from 'checkout:'||op.id or op.sesion_id<>p_sesion_id then raise exception 'Resuelve primero la operación pendiente de Almacén; la VTA vinculada sí puede cobrarse con ella.' using errcode='42501'; end if;
    select coalesce(array_agg(venta_id order by venta_id),'{}'::bigint[]) into esperadas from public.caja_operacion_vtd where operacion_id=op.id and estado in ('SOLICITADO','EN_CAJA','ENTREGADO');
    if previa.id is null and esperadas is distinct from (select coalesce(array_agg(x order by x),'{}'::bigint[]) from unnest(p_vtd_ids) x) then raise exception 'Incluye todas las VTD vigentes de esta operación en el cobro conjunto.'; end if;
    if op.comprobante is not null and previa.id is null then raise exception 'El cobro ya fue registrado. Completa la entrega sin cobrar otra vez.'; end if;
    insert into caja_almacen.contexto values(txid_current(),op.id);
  end if;
  result:=caja_almacen.checkout_base(p_lineas,p_pagos,p_sesion_id,p_idempotencia,p_cliente_id,p_descuento,p_saldo,p_vendedor_id,p_pedido_ids,p_quitadas,p_vtd_ids);
  if op.id is not null then
    update public.caja_operacion_almacen set comprobante=result,estado='COBRADA',revision=revision+1 where id=op.id;
    delete from caja_almacen.contexto where transaccion=txid_current();
  end if;
  return result;
end;
$$;
revoke all on function public.checkout_caja(jsonb,jsonb,bigint,text,bigint,numeric,numeric,uuid,bigint[],jsonb,bigint[]) from public,anon;
grant execute on function public.checkout_caja(jsonb,jsonb,bigint,text,bigint,numeric,numeric,uuid,bigint[],jsonb,bigint[]) to authenticated;

create function caja_almacen.guardar_integridad() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare op_id uuid; linked uuid; vid bigint; permitido uuid;
begin
  if auth.uid() is not null then perform pg_advisory_xact_lock(hashtextextended('caja-almacen:'||auth.uid(),0)); end if;
  select id into op_id from public.caja_operacion_almacen where cajero_id=auth.uid() and cerrado_en is null;
  select operacion_id into permitido from caja_almacen.contexto where transaccion=txid_current();
  if tg_table_name='sesion_caja' then
    if old.estado='ABIERTA' and new.estado<>'ABIERTA' and exists(select 1 from public.caja_operacion_almacen where sesion_id=old.id and cerrado_en is null) then raise exception 'Resuelve la operación Caja–Almacén antes de cerrar el turno.'; end if;
    return new;
  elsif tg_table_name='venta' then
    if tg_op<>'INSERT' then select operacion_id into linked from public.caja_operacion_vtd where venta_id=old.id; end if;
  elsif tg_table_name='venta_linea' then
    vid:=case when tg_op='DELETE' then old.venta_id else new.venta_id end;
    select operacion_id into linked from public.caja_operacion_vtd where venta_id=vid;
    -- No se puede trasladar una línea de una VTD vinculada a otra venta.
    if tg_op='UPDATE' and old.venta_id<>new.venta_id and exists(select 1 from public.caja_operacion_vtd where venta_id=old.venta_id) then raise exception 'La VTD vinculada no puede desvincular sus líneas.'; end if;
  elsif tg_table_name='venta_pago' then
    vid:=case when tg_op='DELETE' then old.venta_id else new.venta_id end;
    select operacion_id into linked from public.caja_operacion_vtd where venta_id=vid;
    -- La verificación bancaria mantiene sus permisos y su recorrido independiente.
    if tg_op='UPDATE' and new.venta_id=old.venta_id and new.monto=old.monto and new.metodo=old.metodo then return new; end if;
  elsif tg_table_name='movimiento_caja' then
    select operacion_id into linked from public.caja_operacion_vtd where venta_id=new.venta_id;
    if linked is null and new.tipo not in ('VENTA','ANTICIPO') then return new; end if;
  end if;
  if linked is not null and permitido is distinct from linked then raise exception 'Resuelve esta VTD desde su operación de Caja–Almacén.' using errcode='42501'; end if;
  if op_id is not null and permitido is distinct from op_id and (tg_table_name in ('venta','venta_pago','movimiento_caja')) then raise exception 'Tienes una operación pendiente de Almacén. Continúa la VTA vinculada y cobra el conjunto.' using errcode='42501'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function caja_almacen.guardar_integridad() from public,anon,authenticated;
create trigger caja_almacen_venta before insert or update or delete on public.venta for each row execute function caja_almacen.guardar_integridad();
create trigger caja_almacen_linea before insert or update or delete on public.venta_linea for each row execute function caja_almacen.guardar_integridad();
create trigger caja_almacen_pago before insert or update or delete on public.venta_pago for each row execute function caja_almacen.guardar_integridad();
create trigger caja_almacen_movimiento before insert on public.movimiento_caja for each row execute function caja_almacen.guardar_integridad();
create trigger caja_almacen_cierre before update of estado on public.sesion_caja for each row execute function caja_almacen.guardar_integridad();
