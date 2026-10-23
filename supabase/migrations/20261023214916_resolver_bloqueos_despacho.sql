-- El cero posterga la línea; nunca crea una compra ni resuelve su saldo.
alter table public.almacen_preparacion_linea drop constraint almacen_preparacion_linea_pendiente_tipo_check;
alter table public.almacen_preparacion_linea add constraint almacen_preparacion_linea_pendiente_tipo_check
  check(pendiente_tipo in ('POR_COMPLETAR','TIENDA','COMPRA_RAPIDA','COMPRA_GESTIONADA'));

-- La solicitud sólo nace de una decisión explícita de comprar. No modifica históricos.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public._compra_solicitud_sync()'::regprocedure);
  if position($old$NEW.estado = 'POR_COMPRAR' or (NEW.estado = 'ESPECIAL' and NEW.es_personalizado)$old$ in definition)=0 then
    raise exception 'Revisar la versión del sincronizador de compras antes de migrar.';
  end if;
  definition:=replace(definition,$old$NEW.estado = 'POR_COMPRAR' or (NEW.estado = 'ESPECIAL' and NEW.es_personalizado)$old$,$new$NEW.estado = 'POR_COMPRAR'$new$);
  execute definition;
end $migration$;


create function almacen_operaciones.validar_reuso_recepciones(p_linea bigint,p_cantidad numeric,p_origenes jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
declare recibido numeric;usado numeric;
begin
  select coalesce(sum(almacen_operaciones.saldo_recepcion(id)),0) into recibido from almacen_operaciones.recepcion_pedido where pedido_linea_id=p_linea;
  select coalesce(sum((o->>'cantidad_base')::numeric),0) into usado from jsonb_array_elements(p_origenes)o where o->>'tipo' in ('TIENDA','COMPRA_RAPIDA');
  if usado<least(p_cantidad,recibido) then
    raise exception 'Reutiliza primero las recepciones de este pedido. Devuelve al alistador si el origen ya fue revisado.';
  end if;
end $$;
revoke all on function almacen_operaciones.validar_reuso_recepciones(bigint,numeric,jsonb) from public,anon,authenticated;


create or replace function almacen_operaciones.origenes_cantidad(p_tarea bigint,p_linea bigint,p_cantidad numeric,p_origenes jsonb,p_revision boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.almacen_preparacion_linea%rowtype;r almacen_operaciones.recepcion_pedido%rowtype;
  x jsonb;salida jsonb:='[]';suma numeric:=0;q numeric;resto numeric:=p_cantidad;lista jsonb;usados uuid[]:='{}';tipo text;
begin
  select * into l from public.almacen_preparacion_linea where preparacion_id=p_tarea and pedido_linea_id=p_linea and vigente;
  if l.pedido_linea_id is null then raise exception 'Línea ajena a esta entrega.';end if;
  if p_origenes is null then
    if p_revision then
      lista:=l.origenes_preparacion;
      for x in select * from jsonb_array_elements(lista) loop
        exit when resto<=0;q:=least(resto,(x->>'cantidad_base')::numeric);
        salida:=salida||jsonb_build_array(x||jsonb_build_object('cantidad_base',q));resto:=resto-q;
      end loop;
      if resto>0 then raise exception 'La cantidad supera lo alistado por origen. Devuelve al alistador para corregir.';end if;
      perform almacen_operaciones.validar_reuso_recepciones(p_linea,p_cantidad,salida);
      return salida;
    end if;
    -- Una cantidad simple reutiliza primero material recibido para este pedido.
    for r in select * from almacen_operaciones.recepcion_pedido where pedido_linea_id=p_linea order by creado_en,id loop
      exit when resto<=0;q:=least(resto,almacen_operaciones.saldo_recepcion(r.id));
      if q>0 then salida:=salida||jsonb_build_array(jsonb_build_object('tipo',r.tipo,'recepcion_id',r.id,'referencia',r.referencia,'cantidad_base',q));resto:=resto-q;end if;
    end loop;
    if resto>0 and (l.snapshot->>'es_personalizado')::boolean and almacen_operaciones.saldo_compra_recibida(p_linea)<resto and not (l.confirmada and exists(select 1 from jsonb_array_elements(l.origenes_preparacion)o where o->>'tipo'='EXISTENCIA_PERSONALIZADA' and (o->>'cantidad_base')::numeric>=resto)) then raise exception 'Declara el origen del personalizado antes de alistarlo.';end if;
    if resto>0 then salida:=salida||jsonb_build_array(jsonb_build_object('tipo',case when (l.snapshot->>'es_personalizado')::boolean then 'EXISTENCIA_PERSONALIZADA' else 'ALMACEN' end,'cantidad_base',resto));end if;
    p_origenes:=salida;salida:='[]';
  end if;
  if jsonb_typeof(p_origenes)<>'array' or jsonb_array_length(p_origenes)>50 then raise exception 'Orígenes inválidos.';end if;
  for x in select * from jsonb_array_elements(p_origenes) loop
    if coalesce(x->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' then raise exception 'Cantidad de origen inválida.';end if;
    q:=(x->>'cantidad_base')::numeric;tipo:=x->>'tipo';
    if q<=0 or q>1e12 then raise exception 'Cantidad de origen inválida.';end if;
    if tipo in ('TIENDA','COMPRA_RAPIDA') then
      select * into r from almacen_operaciones.recepcion_pedido rp where rp.id=(x->>'recepcion_id')::uuid and rp.pedido_linea_id=p_linea;
      if not found or r.tipo<>tipo or r.id=any(usados) or q>almacen_operaciones.saldo_recepcion(r.id) then raise exception 'La recepción no corresponde o no tiene saldo suficiente.';end if;
      usados:=array_append(usados,r.id);
      x:=jsonb_build_object('tipo',r.tipo,'recepcion_id',r.id,'referencia',r.referencia,'cantidad_base',q);
    elsif tipo in ('ALMACEN','EXISTENCIA_PERSONALIZADA') then
      if (tipo='EXISTENCIA_PERSONALIZADA') is distinct from (l.snapshot->>'es_personalizado')::boolean then raise exception 'Origen incompatible con el producto.';end if;
      if exists(select 1 from jsonb_array_elements(salida)y where y->>'tipo'=tipo) then raise exception 'Origen repetido.';end if;
      x:=jsonb_build_object('tipo',tipo,'cantidad_base',q);
    else raise exception 'Selecciona un origen válido.';end if;
    if p_revision and not exists(select 1 from jsonb_array_elements(l.origenes_preparacion)y
      where y->>'tipo'=x->>'tipo' and y->>'recepcion_id' is not distinct from x->>'recepcion_id'
        and q<=(y->>'cantidad_base')::numeric) then raise exception 'Devuelve la preparación para cambiar su origen o aumentar lo alistado.';end if;
    suma:=suma+q;salida:=salida||jsonb_build_array(x);
  end loop;
  if suma<>p_cantidad then raise exception 'Las cantidades por origen deben sumar la cantidad de la línea.';end if;
  perform almacen_operaciones.validar_reuso_recepciones(p_linea,p_cantidad,salida);
  return salida;
end $$;

create or replace function almacen_operaciones.operar_abastecimiento(p_pedido bigint,p_sucursal bigint,p_tarea bigint,p_accion text,p_version integer,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r jsonb;t public.almacen_preparacion%rowtype;a public.perfil%rowtype;l public.almacen_preparacion_linea%rowtype;
  pl public.pedido_linea%rowtype;recepcion almacen_operaciones.recepcion_pedido%rowtype;c public.compra_solicitud%rowtype;
  e evidencia_operacion.lote%rowtype;retiro evidencia_operacion.retiro%rowtype;
  accion text:=p_accion;q numeric;ref text;tipo text;saldo numeric;formal numeric;origenes jsonb;plan jsonb;x jsonb;datos jsonb;confirmacion jsonb;
begin
  -- El motor anterior autentica y bloquea pedido/líneas/preparación en su orden habitual.
  r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,p_tarea,'consultar',null,'{}');
  if accion in ('crear','escanear') then
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,p_tarea,
      case when accion='escanear' and p_tarea is null and r->'pedido'->>'estado'='ABIERTO' and r->'tarea'->>'estado' in ('DESPACHADO','ANULADO') then 'crear' else accion end,p_version,p_datos);accion:='consultar';
  end if;
  select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
  if not coalesce(t.modo_abastecimiento,false) then
    -- Entregas del circuito anterior conservan cantidades/revisión y retiro posterior.
    -- La confirmación de stock migra al QR; los endpoints tradicionales siguen cerrados.
    if accion='confirmar_salida_legada' then
      if t.estado='DESPACHADO' and exists(select 1 from public.almacen_preparacion_evento pe where pe.preparacion_id=t.id and pe.accion='SALIDA_QR_LEGADA' and pe.actor_id=auth.uid() and pe.detalle->'plan'=p_datos->'plan') then return almacen_operaciones.enriquecer_abastecimiento(r);end if;
      select * into a from public.perfil where id=auth.uid() and activo;
      if t.flujo_dos_actores or t.estado<>'VERIFICADO' or t.revisor_id is distinct from a.id or t.preparador_id=a.id then raise exception 'Sólo el verificador confirma esta salida anterior desde QR.' using errcode='42501';end if;
      if p_version is distinct from t.version or jsonb_array_length(r->'cambios')>0 then raise exception 'La entrega cambió. Actualiza.' using errcode='40001';end if;
      plan:=evidencia_operacion.plan_salida(t.id);
      if plan is distinct from p_datos->'plan' or jsonb_array_length(plan)=0 or exists(select 1 from jsonb_array_elements(plan) z where z->>'error' is not null) then raise exception 'Comprueba el plan de salida antes de confirmar.';end if;
      insert into evidencia_operacion.despacho_autorizado values(t.id,txid_current());
      for x in select * from jsonb_array_elements(plan) loop
        if exists(select 1 from public.pedido_linea where id=(x->>'linea_id')::bigint and es_personalizado) then perform public.entregar_personalizado((x->>'linea_id')::bigint,a.nombre);
        else
          select jsonb_agg(jsonb_build_object('ubicacion_id',z->'ubicacion_id','cantidad_base',z->'cantidad_base')) into datos from jsonb_array_elements(x->'asignaciones')z;
          perform public.despachar_linea((x->>'linea_id')::bigint,datos,a.nombre);
        end if;
      end loop;
      delete from evidencia_operacion.despacho_autorizado where preparacion_id=t.id;
      insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle) values(t.id,'SALIDA_QR_LEGADA',a.id,a.nombre,jsonb_build_object('plan',plan));
      r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,'consultar',null,'{}');
      return almacen_operaciones.enriquecer_abastecimiento(r);
    end if;
    if accion<>'consultar' then r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,p_tarea,accion,p_version,p_datos);end if;
    return almacen_operaciones.enriquecer_abastecimiento(r);
  end if;
  select * into a from public.perfil where id=auth.uid() and activo;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>1000000 then raise exception 'Datos inválidos.';end if;
  -- Reintentos exactos se recuperan antes de comprobar la versión que ya avanzó.
  if accion='registrar_abastecimiento' then
    select * into recepcion from almacen_operaciones.recepcion_pedido where id=(p_datos->>'id')::uuid;
    if found then
      if recepcion.actor_id<>a.id or recepcion.pedido_linea_id<>(p_datos->>'linea_id')::bigint or recepcion.tipo<>p_datos->>'tipo'
        or recepcion.cantidad_base<>(p_datos->>'cantidad_base')::numeric or recepcion.referencia<>btrim(coalesce(p_datos->>'referencia','Tercero'))
        or recepcion.costo is distinct from nullif(p_datos->>'costo','')::numeric
        or recepcion.sucursal_tienda_id is distinct from nullif(p_datos->>'sucursal_tienda_id','')::bigint
        or not exists(select 1 from public.pedido_linea where id=recepcion.pedido_linea_id and pedido_id=p_pedido) then
        raise exception 'La clave pertenece a otra recepción.' using errcode='42501';end if;
      return almacen_operaciones.enriquecer_abastecimiento(r);
    end if;
  elsif accion='preparado' then
    select * into e from evidencia_operacion.lote where id=(p_datos->>'evidencia_id')::uuid;
    if e.id is not null and e.estado<>'BORRADOR' and e.tipo='PEDIDO' and e.etapa='PREPARACION'
      and e.preparacion_id=t.id and e.actor_id=a.id and e.version=p_version then return almacen_operaciones.enriquecer_abastecimiento(r);end if;
  elsif accion='confirmar_retiro' then
    select * into retiro from evidencia_operacion.retiro where preparacion_id=t.id;
    if found then
      if retiro.transportista_id=a.id and retiro.evidencia_id=(p_datos->>'evidencia_id')::uuid
        and retiro.destino=btrim(p_datos->>'destino') and retiro.asignaciones=p_datos->'plan' then return almacen_operaciones.enriquecer_abastecimiento(r);end if;
      raise exception 'La entrega ya tiene otro retiro confirmado.';
    end if;
  end if;
  if accion<>'consultar' then
    if p_version is distinct from t.version then raise exception 'La entrega cambió. Actualiza.' using errcode='40001';end if;
    if accion not in ('sincronizar','devolver','reabrir','reasignar','anular') and jsonb_array_length(r->'cambios')>0 then raise exception 'El pedido cambió. Actualiza la preparación.' using errcode='40001';end if;
  end if;
  if accion in ('registrar_abastecimiento','declarar_pendiente','gestionar_compra','guardar_preparacion') then
    if t.estado<>'PREPARANDO' or t.preparador_id is distinct from a.id then raise exception 'Sólo el alistador asignado puede declarar el abastecimiento.' using errcode='42501';end if;
    select * into l from public.almacen_preparacion_linea where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint and vigente;
    if not found then raise exception 'La línea no pertenece a esta entrega.';end if;
    select * into pl from public.pedido_linea where id=l.pedido_linea_id;
  end if;
  if accion='registrar_abastecimiento' then
    if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' or (p_datos->>'cantidad_base')::numeric<=0 then raise exception 'Indica una cantidad positiva de hasta seis decimales.';end if;
    q:=(p_datos->>'cantidad_base')::numeric;tipo:=p_datos->>'tipo';ref:=btrim(coalesce(nullif(p_datos->>'referencia',''),'Tercero'));
    if tipo not in ('TIENDA','COMPRA_RAPIDA') or length(ref)>200 or p_datos->>'id' is null then raise exception 'Indica origen y referencia válidos.';end if;
    if tipo='TIENDA' and not exists(select 1 from public.sucursal s where s.id=(p_datos->>'sucursal_tienda_id')::bigint and s.activo and s.tipo='fisica' and s.id<>p_sucursal) then raise exception 'Selecciona la Tienda de origen.';end if;
    select coalesce(sum(almacen_operaciones.saldo_recepcion(id)),0) into saldo from almacen_operaciones.recepcion_pedido where pedido_linea_id=pl.id;
    formal:=almacen_operaciones.saldo_compra_recibida(pl.id);
    if q>pl.cantidad_base-pl.cantidad_despachada-saldo-formal then raise exception 'La cantidad supera el saldo sin abastecer o ya tiene una compra recibida. Reutiliza la compra existente.';end if;
    select * into c from public.compra_solicitud where pedido_linea_id=pl.id and estado in ('SOLICITADA','COMPRADA') for update;
    if c.estado='COMPRADA' and q>greatest(pl.cantidad_base-pl.cantidad_despachada-saldo-formal-(c.cantidad_base-c.cantidad_recibida),0) then raise exception 'Existe una compra comprometida para esa cantidad. Resuélvela desde Compras antes de registrar otra.';end if;
    if c.estado='SOLICITADA' then
      update public.compra_solicitud set cantidad_base=case when c.cantidad_base-q<=c.cantidad_recibida then c.cantidad_base else c.cantidad_base-q end,
        estado=case when c.cantidad_base-q<=c.cantidad_recibida then 'CANCELADA' else estado end,
        cancelado_en=case when c.cantidad_base-q<=c.cantidad_recibida then now() end,
        cancelado_motivo=case when c.cantidad_base-q<=c.cantidad_recibida then 'Cubierta por abastecimiento directo al pedido' end
        where id=c.id;
      insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle)
        values(t.id,'SOLICITUD_REDUCIDA',a.id,a.nombre,jsonb_build_object('solicitud_id',c.id,'cantidad_anterior',c.cantidad_base,'cantidad_cubierta',q,'recepcion_id',p_datos->>'id'));
    end if;
    insert into almacen_operaciones.recepcion_pedido(id,pedido_linea_id,tipo,cantidad_base,referencia,sucursal_tienda_id,costo,actor_id,actor_nombre)
      values((p_datos->>'id')::uuid,pl.id,tipo,q,ref,nullif(p_datos->>'sucursal_tienda_id','')::bigint,nullif(p_datos->>'costo','')::numeric,a.id,a.nombre);
    if pl.estado='POR_COMPRAR' then
      update public.pedido_linea set estado='POR_DESPACHAR',modificado_por=a.nombre,modificado_en=now() where id=pl.id;
      update public.almacen_preparacion_linea set snapshot=(select datos from almacen_operaciones.lineas_actuales(p_pedido,p_sucursal) where linea_id=pl.id) where preparacion_id=t.id and pedido_linea_id=pl.id;
    end if;
    update public.almacen_preparacion set version=version+1,actualizado_en=now() where id=t.id;
  elsif accion='gestionar_compra' then
    q:=nullif(p_datos->>'cantidad_base','')::numeric;
    select coalesce(sum(almacen_operaciones.saldo_recepcion(id)),0) into saldo from almacen_operaciones.recepcion_pedido where pedido_linea_id=pl.id;
    formal:=almacen_operaciones.saldo_compra_recibida(pl.id);
    if q is null or q<=0 or q>1e12 or scale(q)>6 or q>pl.cantidad_base-pl.cantidad_despachada-saldo-formal then raise exception 'Cantidad de compra supera el saldo sin abastecer o ya tiene una compra recibida.';end if;
    select * into c from public.compra_solicitud where pedido_linea_id=pl.id and estado in ('SOLICITADA','COMPRADA') for update;
    if c.estado='COMPRADA' then raise exception 'La compra ya está comprometida. Consulta su gestión desde Compras.';
    elsif c.id is not null then update public.compra_solicitud set cantidad_base=cantidad_recibida+q,motivo=p_datos->>'observacion' where id=c.id;
    elsif pl.es_personalizado or pl.estado='POR_COMPRAR' then
      insert into public.compra_solicitud(pedido_linea_id,producto_id,descripcion,cantidad_base,origen,motivo,solicitado_por)
        values(pl.id,pl.producto_id,pl.descripcion,q,case when pl.es_personalizado then 'PERSONALIZADO' else 'ALMACEN' end,p_datos->>'observacion',a.nombre);
    else perform public.enviar_linea_a_compra(pl.id,q,p_datos->>'observacion',a.nombre);end if;
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,'sincronizar',t.version,jsonb_build_object('observacion','Compra gestionada desde la miniapp'));
    update public.almacen_preparacion_linea set pendiente_tipo='COMPRA_GESTIONADA',confirmada=true,preparada_base=0,
      observacion=coalesce(nullif(p_datos->>'observacion',''),'Pendiente de compra gestionada')
      where preparacion_id=t.id and vigente and snapshot->>'estado'='POR_COMPRAR';
    update public.almacen_preparacion_linea set origenes_preparacion='[]',origenes_revision=null where preparacion_id=t.id and not confirmada;
  elsif accion='declarar_pendiente' then
    if coalesce(p_datos->>'pendiente_tipo','') not in ('POR_COMPLETAR','TIENDA','COMPRA_RAPIDA','COMPRA_GESTIONADA') or btrim(coalesce(p_datos->>'observacion',''))='' then raise exception 'Declara qué se hará con el faltante y su motivo.';end if;
    update public.almacen_preparacion_linea set pendiente_tipo=p_datos->>'pendiente_tipo',observacion=left(p_datos->>'observacion',1000) where preparacion_id=t.id and pedido_linea_id=pl.id;
    update public.almacen_preparacion set version=version+1,actualizado_en=now() where id=t.id;
  elsif accion in ('guardar_preparacion','guardar_revision') then
    q:=nullif(p_datos->>'cantidad_base','')::numeric;
    if q is null or q<0 or q>1e12 or scale(q)>6 then raise exception 'Cantidad inválida.';end if;
    origenes:=almacen_operaciones.origenes_cantidad(t.id,(p_datos->>'linea_id')::bigint,q,p_datos->'origenes',accion='guardar_revision');
    if accion='guardar_preparacion' and q<(l.snapshot->>'pendiente_base')::numeric then
      tipo:=coalesce(p_datos->>'pendiente_tipo',l.pendiente_tipo,case when q=0 then 'POR_COMPLETAR' when l.snapshot->>'estado'='POR_COMPRAR' then 'COMPRA_GESTIONADA' end);
      if coalesce(tipo,'') not in ('POR_COMPLETAR','TIENDA','COMPRA_RAPIDA','COMPRA_GESTIONADA') then raise exception 'Declara qué se hará con la cantidad pendiente.';end if;
    else tipo:=null;end if;
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,accion,p_version,p_datos);
    if accion='guardar_preparacion' then update public.almacen_preparacion_linea set origenes_preparacion=origenes,origenes_revision=null,pendiente_tipo=tipo where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint;
    else update public.almacen_preparacion_linea set origenes_revision=origenes where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint;end if;
  elsif accion in ('confirmar_resto','confirmar_resto_revision') then
    if accion='confirmar_resto' and exists(select 1 from public.almacen_preparacion_linea x where x.preparacion_id=t.id and x.vigente and not x.confirmada and (x.snapshot->>'es_personalizado')::boolean and (select coalesce(sum(almacen_operaciones.saldo_recepcion(id)),0) from almacen_operaciones.recepcion_pedido where pedido_linea_id=x.pedido_linea_id)+almacen_operaciones.saldo_compra_recibida(x.pedido_linea_id)<(x.snapshot->>'pendiente_base')::numeric) then raise exception 'Declara el origen de los personalizados o déjalos en 0 para otra entrega antes de confirmar el resto.';end if;
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,accion,p_version,p_datos);confirmacion:=r->'confirmacion_preparacion';
    for l in select * from public.almacen_preparacion_linea where preparacion_id=t.id and vigente loop
      if accion='confirmar_resto' and jsonb_array_length(l.origenes_preparacion)=0 and l.preparada_base>0 then
        update public.almacen_preparacion_linea set origenes_preparacion=almacen_operaciones.origenes_cantidad(t.id,l.pedido_linea_id,l.preparada_base,null) where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
      elsif accion='confirmar_resto_revision' and l.origenes_revision is null and l.revisada_base is not null then
        update public.almacen_preparacion_linea set origenes_revision=almacen_operaciones.origenes_cantidad(t.id,l.pedido_linea_id,l.revisada_base,null,true) where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
      end if;
    end loop;
    update public.almacen_preparacion_linea set pendiente_tipo='COMPRA_GESTIONADA' where preparacion_id=t.id and vigente and snapshot->>'estado'='POR_COMPRAR' and preparada_base=0 and pendiente_tipo is null;
  elsif accion='preparado' then
    if exists(select 1 from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and preparada_base<(snapshot->>'pendiente_base')::numeric and pendiente_tipo is null) then raise exception 'Declara qué se hará con cada faltante antes de enviar.';end if;
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,accion,p_version,p_datos);
  elsif accion='confirmar_retiro' then
    if t.revisor_id is distinct from a.id or t.preparador_id=a.id or t.estado not in ('REVISANDO','VERIFICADO') then raise exception 'Sólo el verificador asignado puede confirmar el retiro.' using errcode='42501';end if;
    ref:=btrim(coalesce(p_datos->>'destino',''));
    if length(ref) not between 3 and 300 then raise exception 'Indica el destino de la entrega.';end if;
    e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,'PEDIDO',p_pedido,t.id,t.version);
    if e.etapa<>'SALIDA' then raise exception 'Adjunta fotos de la salida.';end if;
    plan:=evidencia_operacion.plan_salida(t.id);
    if plan is distinct from p_datos->'plan' then raise exception 'Cambió el plan de salida. Actualiza y comprueba los orígenes.' using errcode='40001';end if;
    if jsonb_array_length(plan)=0 or exists(select 1 from jsonb_array_elements(plan)z where z->>'error' is not null) then raise exception 'Comprueba el stock y las cantidades por origen antes de retirar.';end if;
    if t.estado='REVISANDO' then r:=almacen_operaciones.operar(p_pedido,p_sucursal,t.id,'verificado',p_version,'{}');end if;
    insert into evidencia_operacion.despacho_autorizado values(t.id,txid_current());
    for x in select * from jsonb_array_elements(plan) loop
      if jsonb_array_length(x->'asignaciones')>0 then
        select jsonb_agg(jsonb_build_object('ubicacion_id',z->'ubicacion_id','cantidad_base',z->'cantidad_base')) into datos from jsonb_array_elements(x->'asignaciones')z;
        perform public.despachar_linea((x->>'linea_id')::bigint,datos,a.nombre);
      end if;
      perform almacen_operaciones.despachar_documental(t.id,(x->>'linea_id')::bigint,x->'origenes');
    end loop;
    delete from evidencia_operacion.despacho_autorizado where preparacion_id=t.id;
    update public.almacen_preparacion set estado='DESPACHADO',verificado_en=coalesce(verificado_en,now()),version=version+1,actualizado_en=now() where id=t.id;
    insert into evidencia_operacion.retiro(preparacion_id,transportista_id,transportista_nombre,destino,evidencia_id,asignaciones) values(t.id,a.id,a.nombre,ref,e.id,plan);
    insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle) values(t.id,'REVISION_Y_RETIRO',a.id,a.nombre,jsonb_build_object('destino',ref,'evidencia_id',e.id,'asignaciones',plan));
    perform evidencia_operacion.encolar_pedido(e.id,t.id,ref);
  elsif accion<>'consultar' then
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,accion,p_version,p_datos);
    if accion in ('reabrir','devolver','sincronizar','reasignar') then
      update public.almacen_preparacion_linea set origenes_revision=null where preparacion_id=t.id;
      update public.almacen_preparacion_linea set origenes_preparacion='[]' where preparacion_id=t.id and not confirmada;
    end if;
  end if;
  if accion in ('registrar_abastecimiento','declarar_pendiente','gestionar_compra') then
    insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle) values(t.id,upper(accion),a.id,a.nombre,p_datos);
  end if;
  r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,'consultar',null,'{}');
  return almacen_operaciones.enriquecer_abastecimiento(r||jsonb_build_object('confirmacion_preparacion',confirmacion));
end $$;

create or replace function evidencia_operacion.plan_salida(p_tarea bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;l record;u record;x jsonb;restante numeric;tomar numeric;
  asignaciones jsonb;plan jsonb:='[]';error text;usadas jsonb:='{}';clave text;origenes jsonb;
begin
  select * into t from public.almacen_preparacion where id=p_tarea;
  if not t.modo_abastecimiento then return evidencia_operacion.plan_salida_v1(p_tarea);end if;
  for l in select * from public.almacen_preparacion_linea where preparacion_id=p_tarea and vigente and revisada_base>0 order by pedido_linea_id loop
    restante:=0;asignaciones:='[]';error:=null;origenes:=coalesce(l.origenes_revision,'[]');
    if (select coalesce(sum((z->>'cantidad_base')::numeric),0) from jsonb_array_elements(origenes)z)<>l.revisada_base then error:='Comprueba las cantidades por origen.';end if;
    begin perform almacen_operaciones.validar_reuso_recepciones(l.pedido_linea_id,l.revisada_base,origenes);exception when others then error:=sqlerrm;end;
    for x in select * from jsonb_array_elements(origenes) loop
      if x->>'tipo'='ALMACEN' then restante:=restante+(x->>'cantidad_base')::numeric;
      elsif x->>'recepcion_id' is not null and (x->>'cantidad_base')::numeric>coalesce(almacen_operaciones.saldo_recepcion((x->>'recepcion_id')::uuid),0) then error:='La recepción asignada ya no tiene saldo suficiente.';end if;
    end loop;
    for u in select s.ubicacion_id,sum(s.cantidad_base) as cantidad_base,concat_ws(' · ',b.codigo_zona,b.estante,b.nivel,b.compartimiento) as nombre
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
    if restante>0 then error:='Stock insuficiente para la parte que sale de Almacén.';end if;
    plan:=plan||jsonb_build_array(jsonb_build_object('linea_id',l.pedido_linea_id,'cantidad_base',l.revisada_base,'asignaciones',asignaciones,'origenes',origenes,'error',error));
  end loop;
  return plan;
end $$;

-- Diagnóstico antes de enviar a revisión y antes del retiro. No cambia cantidades.
create function almacen_operaciones.bloqueos_despacho(p_tarea bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;l record;q numeric;origenes jsonb;doc numeric;almacen numeric;disponible numeric;usadas jsonb:='{}';codigo text;detalle text;resultado jsonb:='[]';
begin
  select * into t from public.almacen_preparacion where id=p_tarea;
  if not coalesce(t.modo_abastecimiento,false) or t.estado in ('DESPACHADO','ANULADO') then return resultado;end if;
  for l in select * from public.almacen_preparacion_linea where preparacion_id=t.id and vigente order by pedido_linea_id loop
    codigo:=null;detalle:=null;disponible:=null;almacen:=0;
    q:=case when t.estado='PREPARANDO' then l.preparada_base else coalesce(l.revisada_base,l.preparada_base) end;
    if not l.confirmada then codigo:='CANTIDAD';detalle:='Confirma cuánto saldrá en esta entrega. Puedes dejar 0 para otra entrega.';
    elsif q>0 then
      origenes:=case when t.estado='PREPARANDO' then l.origenes_preparacion else coalesce(l.origenes_revision,l.origenes_preparacion) end;
      if (select coalesce(sum((o->>'cantidad_base')::numeric),0) from jsonb_array_elements(origenes)o)<>q then codigo:='ORIGEN';detalle:='Declara las cantidades por origen.';
      else
        begin perform almacen_operaciones.validar_reuso_recepciones(l.pedido_linea_id,q,origenes);
        exception when others then codigo:='RECEPCION';detalle:=sqlerrm;end;
        if codigo is null and exists(select 1 from jsonb_array_elements(origenes)o where o->>'recepcion_id' is not null and (o->>'cantidad_base')::numeric>almacen_operaciones.saldo_recepcion((o->>'recepcion_id')::uuid)) then codigo:='RECEPCION';detalle:='La recepción asignada no tiene saldo suficiente. Devuelve al alistador para corregir.';end if;
        select coalesce(sum((o->>'cantidad_base')::numeric),0) into almacen from jsonb_array_elements(origenes)o where o->>'tipo'='ALMACEN';
        if almacen>0 then
          select coalesce(sum(greatest(s.cantidad_base,0)),0) into disponible from public.stock_actual s join public.ubicacion u on u.id=s.ubicacion_id
            where s.producto_id=(l.snapshot->>'producto_id')::bigint and u.sucursal_id=t.sucursal_id and not coalesce(u.excluye_disponible,false);
          disponible:=greatest(0,disponible-coalesce((usadas->>(l.snapshot->>'producto_id'))::numeric,0));
          usadas:=jsonb_set(usadas,array[l.snapshot->>'producto_id'],to_jsonb(coalesce((usadas->>(l.snapshot->>'producto_id'))::numeric,0)+almacen));
          if codigo is null and disponible<almacen then codigo:='STOCK';detalle:='El stock registrado en Almacén no alcanza para esta entrega. Si el material está físicamente aquí, resuelve el conteo en este apartado.';end if;
          if codigo is null and exists(select 1 from inventario_control.sesion cs join public.stock_actual sa on sa.ubicacion_id=cs.ubicacion_id where cs.sucursal_id=t.sucursal_id and cs.estado in ('CAPTURA','REVISION','APLICANDO') and sa.producto_id=(l.snapshot->>'producto_id')::bigint and sa.cantidad_base>0) then codigo:='STOCK';detalle:='Una ubicación tiene un conteo activo. Resuélvelo antes de retirar el material.';end if;
        end if;
      end if;
    end if;
    if codigo is not null then resultado:=resultado||jsonb_build_array(jsonb_build_object('linea_id',l.pedido_linea_id,'codigo',codigo,'detalle',detalle,'cantidad_base',q,'almacen_base',almacen,'disponible_base',disponible));end if;
  end loop;
  return resultado;
end $$;
revoke all on function almacen_operaciones.bloqueos_despacho(bigint) from public,anon,authenticated;


create or replace function almacen_operaciones.enriquecer_abastecimiento(p_resultado jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=p_resultado;l jsonb;ls jsonb:='[]';t public.almacen_preparacion%rowtype;pid bigint;
begin
  pid:=(r->'pedido'->>'id')::bigint;
  select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
  for l in select * from jsonb_array_elements(coalesce(r->'lineas','[]')) loop
    l:=l||jsonb_build_object('recepciones',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('saldo',almacen_operaciones.saldo_recepcion(a.id)) order by a.creado_en,a.id)
      from almacen_operaciones.recepcion_pedido a where a.pedido_linea_id=(l->>'pedido_linea_id')::bigint),'[]'),
      'compras',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'estado',c.estado,'cantidad_base',c.cantidad_base,'cantidad_recibida',c.cantidad_recibida,'referencia',c.nota_compra) order by c.id)
      from public.compra_solicitud c where c.pedido_linea_id=(l->>'pedido_linea_id')::bigint),'[]'),
      'snapshot',(l->'snapshot')||jsonb_build_object('marca',(select marca from public.producto where id=(l->'snapshot'->>'producto_id')::bigint)));
    if t.modo_abastecimiento and t.estado not in ('DESPACHADO','ANULADO') and l->'snapshot'->>'producto_id' is not null then
      l:=l||jsonb_build_object('stock_almacen',coalesce((select jsonb_agg(jsonb_build_object('ubicacion_id',u.id,'nombre',concat_ws(' · ',u.codigo_zona,u.estante,u.nivel,u.compartimiento),'cantidad_base',coalesce(sa.cantidad_base,0),
        'presentacion_base_id',(select id from public.presentacion where producto_id=(l->'snapshot'->>'producto_id')::bigint and activo and es_base and factor_unidad_base=1 order by id limit 1),
        'conteo_id',(select id from inventario_control.sesion where ubicacion_id=u.id and estado in ('CAPTURA','REVISION','APLICANDO') order by id desc limit 1)) order by u.id)
        from public.ubicacion u left join public.stock_actual sa on sa.ubicacion_id=u.id and sa.producto_id=(l->'snapshot'->>'producto_id')::bigint
        where u.sucursal_id=t.sucursal_id and not coalesce(u.excluye_disponible,false) and (sa.producto_id is not null or exists(select 1 from public.producto_ubicacion pu where pu.ubicacion_id=u.id and pu.producto_id=(l->'snapshot'->>'producto_id')::bigint))),'[]'));
    end if;
    l:=l||jsonb_build_object('compra_recibida_base',almacen_operaciones.saldo_compra_recibida((l->>'pedido_linea_id')::bigint));
    ls:=ls||jsonb_build_array(l);
  end loop;
  if t.id is not null and not t.flujo_dos_actores and t.estado='VERIFICADO' then
    r:=r||jsonb_build_object('salida_qr_legada',true,'plan_salida',evidencia_operacion.plan_salida(t.id));
  end if;
  return r||jsonb_build_object('lineas',ls,'abastecimiento',coalesce(t.modo_abastecimiento,false),'resumen_pedido',almacen_operaciones.resumen_pedido(pid),
    'bloqueos_despacho',almacen_operaciones.bloqueos_despacho(t.id),'numero_entrega',(select count(*) from public.almacen_preparacion where pedido_id=pid and id<=t.id));
end $$;
