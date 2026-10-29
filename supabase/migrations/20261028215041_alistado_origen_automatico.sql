-- Alistado simple para nuevas tandas. Los históricos conservan su contrato.
alter table public.almacen_preparacion add column alistado_simple boolean not null default false;
alter table public.compra_solicitud add column alistado_automatico boolean not null default false;

create function almacen_operaciones.activar_alistado_simple() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.alistado_simple:=new.modo_flexible;
  return new;
end $$;
revoke all on function almacen_operaciones.activar_alistado_simple() from public,anon,authenticated;
create trigger zzz_preparacion_simple before insert on public.almacen_preparacion
for each row execute function almacen_operaciones.activar_alistado_simple();

-- Propuesta determinista: stock positivo de la sucursal, sin repetirlo entre
-- líneas del mismo producto. No reserva ni mueve inventario.
create function almacen_operaciones.proponer_almacen_simple(p_tarea bigint,p_linea bigint,p_cantidad numeric) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;l public.almacen_preparacion_linea%rowtype;
  producto bigint;u record;libre numeric;omitir numeric;tomar numeric;resto numeric:=p_cantidad;resultado jsonb:='[]';
begin
  select * into t from public.almacen_preparacion where id=p_tarea;
  select * into l from public.almacen_preparacion_linea where preparacion_id=p_tarea and pedido_linea_id=p_linea;
  producto:=coalesce((l.reemplazo->>'producto_id')::bigint,(l.snapshot->>'producto_id')::bigint);
  if producto is null or coalesce(p_cantidad,0)<=0 then return resultado;end if;
  select coalesce(sum((a.snapshot->>'pendiente_base')::numeric*coalesce((a.reemplazo->>'factor')::numeric,1)),0) into omitir
    from public.almacen_preparacion_linea a where a.preparacion_id=t.id and a.vigente and a.pedido_linea_id<p_linea
    and a.origenes_declarados is null and not a.confirmada
    and coalesce((a.reemplazo->>'producto_id')::bigint,(a.snapshot->>'producto_id')::bigint)=producto;
  for u in select b.id,coalesce(s.cantidad_base,0)-coalesce((
      select sum((o->>'cantidad_base')::numeric) from public.almacen_preparacion_linea a
      cross join lateral jsonb_array_elements(coalesce(a.origenes_declarados,'[]'))o
      where a.preparacion_id=t.id and a.vigente and a.pedido_linea_id<>p_linea and o->>'tipo'='ALMACEN'
      and (o->>'ubicacion_id')::bigint=b.id
      and coalesce((a.reemplazo->>'producto_id')::bigint,(a.snapshot->>'producto_id')::bigint)=producto),0) disponible
    from public.ubicacion b left join public.stock_actual s on s.ubicacion_id=b.id and s.producto_id=producto
    where b.sucursal_id=t.sucursal_id and not coalesce(b.excluye_disponible,false)
    order by b.id loop
    libre:=greatest(u.disponible,0);
    tomar:=least(libre,omitir);libre:=libre-tomar;omitir:=omitir-tomar;
    tomar:=least(libre,resto);
    if tomar>0 then resultado:=resultado||jsonb_build_array(jsonb_build_object('tipo','ALMACEN','ubicacion_id',u.id,'cantidad_base',tomar));resto:=resto-tomar;end if;
    exit when resto<=0;
  end loop;
  return resultado;
end $$;
revoke all on function almacen_operaciones.proponer_almacen_simple(bigint,bigint,numeric) from public,anon,authenticated;

-- Una solicitud automática representa lo que falta conseguir, sin registrar
-- recepciones ficticias ni tocar compras ya comprometidas por Compras.
create function almacen_operaciones.sincronizar_compra_simple(p_tarea bigint,p_linea bigint,p_faltante numeric) returns void
language plpgsql security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;l public.pedido_linea%rowtype;c public.compra_solicitud%rowtype;nuevo numeric;
begin
  select * into t from public.almacen_preparacion where id=p_tarea;
  select * into l from public.pedido_linea where id=p_linea;
  select * into c from public.compra_solicitud where pedido_linea_id=p_linea and estado in ('SOLICITADA','COMPRADA') order by id limit 1 for update;
  if c.id is not null then
    if not c.alistado_automatico or c.estado<>'SOLICITADA' then return;end if;
    nuevo:=c.cantidad_recibida+greatest(p_faltante,0);
    if p_faltante<=0 then
      update public.compra_solicitud set estado='CANCELADA',cancelado_en=now(),cancelado_motivo='Faltante resuelto durante el alistado; la línea del pedido se conserva.' where id=c.id;
    elsif nuevo<>c.cantidad_base then
      update public.compra_solicitud set cantidad_base=nuevo where id=c.id;
    else return;
    end if;
  elsif p_faltante>0 then
    insert into public.compra_solicitud(pedido_linea_id,producto_id,descripcion,cantidad_base,origen,motivo,solicitado_por,alistado_automatico)
    values(l.id,l.producto_id,l.descripcion,p_faltante,case when l.es_personalizado then 'PERSONALIZADO' else 'ALMACEN' end,
      'Faltante calculado durante el alistado',t.preparador_nombre,true);
  else return;
  end if;
  insert into public.pedido_evento(pedido_id,pedido_linea_id,accion,motivo,usuario)
    values(t.pedido_id,p_linea,'COMPRA_ALISTADO_AUTOMATICA','Pendiente de conseguir: '||greatest(p_faltante,0),t.preparador_nombre);
end $$;
revoke all on function almacen_operaciones.sincronizar_compra_simple(bigint,bigint,numeric) from public,anon,authenticated;

create function almacen_operaciones.enriquecer_alistado_simple(p_resultado jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=p_resultado;t public.almacen_preparacion%rowtype;l jsonb;ls jsonb:='[]';propuesta jsonb;q numeric;almacen numeric;f numeric;
begin
  select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
  if not coalesce(t.alistado_simple,false) then return r;end if;
  for l in select * from jsonb_array_elements(coalesce(r->'lineas','[]')) loop
    f:=coalesce((l->'reemplazo'->>'factor')::numeric,1);
    q:=(l->'snapshot'->>'pendiente_base')::numeric*f;
    propuesta:=almacen_operaciones.proponer_almacen_simple(t.id,(l->>'pedido_linea_id')::bigint,q);
    select coalesce(sum((o->>'cantidad_base')::numeric),0) into almacen from jsonb_array_elements(propuesta)o;
    l:=l||jsonb_build_object('propuesta_almacen',propuesta,'propuesta_almacen_base',almacen,
      'propuesta_compra_base',greatest(q-almacen,0),'compra_existente',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'estado',c.estado,'automatica',c.alistado_automatico,'pendiente_base',c.cantidad_base-c.cantidad_recibida)) from public.compra_solicitud c where c.pedido_linea_id=(l->>'pedido_linea_id')::bigint and c.estado in ('SOLICITADA','COMPRADA')),'[]'));
    ls:=ls||jsonb_build_array(l);
  end loop;
  return r||jsonb_build_object('alistado_simple',true,'lineas',ls);
end $$;
revoke all on function almacen_operaciones.enriquecer_alistado_simple(jsonb) from public,anon,authenticated;

create function almacen_operaciones.operar_alistado_simple(p_pedido bigint,p_sucursal bigint,p_tarea bigint,p_accion text,p_version integer,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;t public.almacen_preparacion%rowtype;l public.almacen_preparacion_linea%rowtype;a public.perfil%rowtype;
  origenes jsonb;propuesta jsonb;qa numeric;qe numeric;total numeric;f numeric;nota text;tipo text;suma numeric;anterior bigint;
begin
  -- Conserva autenticación, sucursal, bloqueo del pedido y orden de bloqueo del motor existente.
  r:=almacen_operaciones.operar_flexible(p_pedido,p_sucursal,p_tarea,'consultar',null,'{}');
  if p_accion in ('crear','escanear') then
    anterior:=(r->'tarea'->>'id')::bigint;
    r:=almacen_operaciones.operar_flexible(p_pedido,p_sucursal,p_tarea,p_accion,p_version,p_datos);
    select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
    if t.id is distinct from anterior and t.alistado_simple and t.estado='PREPARANDO' and t.preparador_id=auth.uid() then
      for l in select * from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and not confirmada order by pedido_linea_id loop
        propuesta:=almacen_operaciones.proponer_almacen_simple(t.id,l.pedido_linea_id,(l.snapshot->>'pendiente_base')::numeric*coalesce((l.reemplazo->>'factor')::numeric,1));
        select coalesce(sum((o->>'cantidad_base')::numeric),0) into suma from jsonb_array_elements(propuesta)o;
        perform almacen_operaciones.sincronizar_compra_simple(t.id,l.pedido_linea_id,greatest((l.snapshot->>'pendiente_base')::numeric-suma/coalesce((l.reemplazo->>'factor')::numeric,1),0));
      end loop;
      r:=almacen_operaciones.operar_flexible(p_pedido,p_sucursal,t.id,'consultar',null,'{}');
    end if;
    return almacen_operaciones.enriquecer_alistado_simple(r);
  end if;
  select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
  if not coalesce(t.alistado_simple,false) then return almacen_operaciones.operar_flexible(p_pedido,p_sucursal,p_tarea,p_accion,p_version,p_datos);end if;
  if p_accion='consultar' then return almacen_operaciones.enriquecer_alistado_simple(r);end if;
  select * into a from public.perfil where id=auth.uid() and activo;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>100000 then raise exception 'Datos inválidos.';end if;
  if p_accion in ('guardar_alistado','devolver_linea') then
    if t.version is distinct from p_version then raise exception 'El envío cambió. Actualiza antes de guardar.' using errcode='40001';end if;
    if r->'pedido'->>'estado'<>'ABIERTO' or jsonb_array_length(r->'cambios')>0 then raise exception 'El pedido cambió o está cerrado. Actualiza el alistado.' using errcode='40001';end if;
    select * into l from public.almacen_preparacion_linea where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint and vigente for update;
    if not found then raise exception 'La línea no pertenece a este envío.';end if;
  end if;
  if p_accion='guardar_alistado' then
    if t.estado<>'PREPARANDO' or t.preparador_id is distinct from a.id then raise exception 'Sólo el alistador asignado puede corregir el producto.' using errcode='42501';end if;
    if coalesce(p_datos->>'almacen_base','') !~ '^\d+(\.\d{1,6})?$' or coalesce(p_datos->>'externa_base','') !~ '^\d+(\.\d{1,6})?$' then raise exception 'Ingresa cantidades válidas para Almacén y externos.';end if;
    qa:=(p_datos->>'almacen_base')::numeric;qe:=(p_datos->>'externa_base')::numeric;
    f:=coalesce((l.reemplazo->>'factor')::numeric,1);total:=trim_scale((qa+qe)/f);
    if qa>1e12 or qe>1e12 or scale(trim_scale(total))>6 or total>(l.snapshot->>'pendiente_base')::numeric then raise exception 'La cantidad preparada supera lo pendiente o la equivalencia no es exacta.';end if;
    nota:=btrim(coalesce(p_datos->>'observacion',''));
    if length(nota)>1000 then raise exception 'La observación es demasiado larga.';end if;
    if coalesce(l.reemplazo->>'producto_id',l.snapshot->>'producto_id') is null then
      origenes:=case when qa>0 then jsonb_build_array(jsonb_build_object('tipo','ALMACEN','cantidad_base',qa)) else '[]'::jsonb end;
    else
      origenes:=almacen_operaciones.proponer_almacen_simple(t.id,l.pedido_linea_id,qa);
      select coalesce(sum((o->>'cantidad_base')::numeric),0) into suma from jsonb_array_elements(origenes)o;
      if suma<>qa then raise exception 'El stock de Almacén cambió. Actualiza y confirma la cantidad física.' using errcode='40001';end if;
    end if;
    if qe>0 then
      tipo:=coalesce(p_datos->>'tipo_externo','COMPRA_RAPIDA');
      if tipo not in ('COMPRA_RAPIDA','TIENDA') or length(btrim(coalesce(p_datos->>'referencia',''))) not between 1 and 200 then raise exception 'Indica la procedencia del material externo ya preparado.';end if;
      if tipo='TIENDA' and not exists(select 1 from public.sucursal s where s.id=(p_datos->>'sucursal_tienda_id')::bigint and s.activo and s.tipo='fisica' and s.id<>t.sucursal_id) then raise exception 'Selecciona la Tienda de origen.';end if;
      if exists(select 1 from public.compra_solicitud where pedido_linea_id=l.pedido_linea_id and estado='COMPRADA') then raise exception 'Hay una compra comprometida. Registra su recepción desde Compras antes de alistar para conservar su seguimiento.';end if;
      origenes:=origenes||jsonb_build_array(jsonb_build_object('tipo',tipo,'cantidad_base',qe,'referencia',btrim(p_datos->>'referencia'))||case when tipo='TIENDA' then jsonb_build_object('sucursal_tienda_id',(p_datos->>'sucursal_tienda_id')::bigint) else '{}'::jsonb end);
    end if;
    r:=almacen_operaciones.operar_flexible(p_pedido,p_sucursal,t.id,'guardar_preparacion',t.version,jsonb_build_object('linea_id',l.pedido_linea_id,'cantidad_base',total,'observacion',coalesce(nullif(nota,''),case when total=0 then 'No alistado en este envío' when total<(l.snapshot->>'pendiente_base')::numeric then 'Envío parcial' else '' end),'pendiente_tipo','COMPRA_GESTIONADA'));
    update public.almacen_preparacion_linea set origenes_declarados=origenes where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
    perform almacen_operaciones.sincronizar_compra_simple(t.id,l.pedido_linea_id,greatest((l.snapshot->>'pendiente_base')::numeric-total,0));
    update public.almacen_preparacion set origenes_pendientes=0 where id=t.id;
    insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle) values(t.id,'ORIGEN_ALISTADO',a.id,a.nombre,jsonb_build_object('linea_id',l.pedido_linea_id,'origenes',origenes,'nota_automatica',nota=''));
  elsif p_accion='devolver_linea' then
    if t.estado<>'REVISANDO' or t.revisor_id is distinct from a.id or t.preparador_id=a.id then raise exception 'Sólo el verificador asignado puede devolver esta línea.' using errcode='42501';end if;
    nota:=btrim(coalesce(p_datos->>'observacion',''));
    if length(nota) not between 3 and 1000 then raise exception 'Indica el motivo para devolver la línea.';end if;
    update public.almacen_preparacion_linea set confirmada=false,revisada_base=null,revisada_en=null,revisor_id=null,revisor_nombre=null,observacion_revision=nota where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
    update public.almacen_preparacion set estado='PREPARANDO',version=version+1,actualizado_en=now() where id=t.id;
    insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle) values(t.id,'DEVOLVER_LINEA',a.id,a.nombre,jsonb_build_object('linea_id',l.pedido_linea_id,'observacion',nota));
  else
    if p_accion in ('guardar_preparacion','registrar_incidencia','recibir_compra_tarjeta','gestionar_compra','declarar_origen','confirmar_resto','confirmar_resto_revision') then raise exception 'Confirma cantidades y origen desde el alistado de este producto.';end if;
    if p_accion='guardar_revision' then
      select * into l from public.almacen_preparacion_linea where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint and vigente;
      if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' or (p_datos->>'cantidad_base')::numeric is distinct from l.preparada_base then raise exception 'Devuelve la línea al almacenero para corregir cantidad u origen.';end if;
    end if;
    if p_accion in ('preparado','confirmar_retiro') and exists(select 1 from public.almacen_preparacion_linea ln where ln.preparacion_id=t.id and ln.vigente and ln.preparada_base>0 and (ln.origenes_declarados is null or (select coalesce(sum((o->>'cantidad_base')::numeric),0) from jsonb_array_elements(ln.origenes_declarados)o)<>almacen_operaciones.cantidad_fisica(ln))) then raise exception 'Completa el origen durante el alistado antes de enviar o cerrar.';end if;
    r:=almacen_operaciones.operar_flexible(p_pedido,p_sucursal,t.id,p_accion,p_version,p_datos);
    if p_accion='reemplazar_material' then
      update public.almacen_preparacion_linea set confirmada=false where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint;
    end if;
  end if;
  r:=almacen_operaciones.operar_flexible(p_pedido,p_sucursal,t.id,'consultar',null,'{}');
  return almacen_operaciones.enriquecer_alistado_simple(r);
end $$;
revoke all on function almacen_operaciones.operar_alistado_simple(bigint,bigint,bigint,text,integer,jsonb) from public,anon;
grant execute on function almacen_operaciones.operar_alistado_simple(bigint,bigint,bigint,text,integer,jsonb) to authenticated;
create or replace function public.operar_preparacion_pedido(p_pedido_id bigint,p_sucursal_id bigint,p_tarea_id bigint default null,p_accion text default 'consultar',p_version integer default null,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select almacen_operaciones.operar_alistado_simple(p_pedido_id,p_sucursal_id,p_tarea_id,p_accion,p_version,p_datos) $$;
revoke execute on function almacen_operaciones.operar_flexible(bigint,bigint,bigint,text,integer,jsonb) from authenticated;
notify pgrst,'reload schema';
