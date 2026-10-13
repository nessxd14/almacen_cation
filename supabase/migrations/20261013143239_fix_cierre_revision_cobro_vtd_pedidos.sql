-- Revisión y despacho: el checklist refleja la salida efectiva, Caja cobra y Almacén entrega.
-- Conserva los motores existentes de Kardex y caja; no regulariza pagos ni mueve existencias.
-- El caché privado guarda la respuesta completa de cada cobro y rechaza otra intención.

create or replace function almacen_operaciones.sincronizar_despacho_pedido(p_pedido bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t public.almacen_preparacion%rowtype;
  actor public.perfil%rowtype;
  n integer := 0;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  for t in select * from public.almacen_preparacion
    where pedido_id=p_pedido and estado='VERIFICADO' order by id for update
  loop
    if exists(select 1 from public.almacen_preparacion_linea
        where preparacion_id=t.id and vigente and preparada_base>0)
      and not exists(
        select 1 from public.almacen_preparacion_linea tl
        left join public.pedido_linea l on l.id=tl.pedido_linea_id
        where tl.preparacion_id=t.id and tl.vigente and tl.preparada_base>0
          and (l.id is null
            or l.producto_id is distinct from (tl.snapshot->>'producto_id')::bigint
            or l.presentacion_id is distinct from (tl.snapshot->>'presentacion_id')::bigint
            or coalesce(l.cantidad_despachada,0) <
              coalesce((tl.snapshot->>'cantidad_despachada')::numeric,0)+tl.preparada_base)
      ) then
      update public.almacen_preparacion
        set estado='DESPACHADO',version=version+1,actualizado_en=now() where id=t.id;
      insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle)
        values(t.id,'DESPACHO_REGISTRADO',coalesce(actor.id,'00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(actor.nombre,'Sistema'),
          jsonb_build_object('origen','salidas_registradas','pedido_id',p_pedido));
      n:=n+1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function almacen_operaciones.sincronizar_despacho_pedido(bigint) from public,anon,authenticated;

create or replace function almacen_operaciones.al_despachar_pedido()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform almacen_operaciones.sincronizar_despacho_pedido(new.pedido_id);
  return new;
end;
$$;
revoke all on function almacen_operaciones.al_despachar_pedido() from public,anon,authenticated;
create trigger almacen_sincronizar_despacho_pedido
  after update of cantidad_despachada on public.pedido_linea for each row
  when (new.cantidad_despachada > old.cantidad_despachada)
  execute function almacen_operaciones.al_despachar_pedido();

-- Cierra solo checklists cuya cantidad preparada ya salió; no cambia el pedido ni el Kardex.
do $$ declare p bigint; begin
  for p in select distinct pedido_id from public.almacen_preparacion where estado='VERIFICADO'
  loop perform almacen_operaciones.sincronizar_despacho_pedido(p); end loop;
end; $$;

CREATE OR REPLACE FUNCTION almacen_operaciones.operar(p_pedido_id bigint, p_sucursal_id bigint, p_tarea_id bigint, p_accion text, p_version integer, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform almacen_operaciones.sincronizar_despacho_pedido(p_pedido_id);
  if p_tarea_id is not null then
    select * into v_tarea from public.almacen_preparacion where id=p_tarea_id and pedido_id=p_pedido_id and sucursal_id=p_sucursal_id for update;
    if not found then raise exception 'No se encontró esa preparación en esta sucursal.'; end if;
  else
    select * into v_tarea from public.almacen_preparacion where pedido_id=p_pedido_id and sucursal_id=p_sucursal_id order by id desc limit 1 for update;
  end if;
  if v_tarea.id is not null then
    select coalesce(bool_and(l.id is not null
       and l.producto_id is not distinct from (tl.snapshot->>'producto_id')::bigint
       and l.presentacion_id is not distinct from (tl.snapshot->>'presentacion_id')::bigint
       and coalesce(l.cantidad_despachada,0)>=
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
$function$
;

CREATE OR REPLACE FUNCTION public.completar_venta(p_venta_id bigint, p_usuario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
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
  -- Caja puede recibir una confirmación atrasada después del despacho de Almacén.
  -- La salida ya registrada se consulta sin volver a escribir stock o pagos.
  if v_venta.estado = 'COMPLETADA' and (
    v_venta.numero like 'VTD-%' or exists (
      select 1 from public.ubicacion where id=v_venta.ubicacion_id
        and upper(coalesce(codigo_zona,''))='VENTAS DIRECTAS'
    )
  ) then
    if not exists (
      select 1 from public.perfil where id=auth.uid() and activo
        and rol in ('admin','gerente','cajero','almacenero','operario')
    ) then
      raise exception 'Tu perfil no puede consultar esta entrega.' using errcode='42501';
    end if;
    return jsonb_build_object(
      'venta_id',v_venta.id,'lineas',(select count(*) from public.venta_linea where venta_id=v_venta.id),
      'subtotal',v_venta.subtotal,'total',v_venta.total,'reintento',true
    );
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

CREATE OR REPLACE FUNCTION almacen_operaciones.cobrar_vtd_nucleo(p_venta_ids bigint[], p_sesion_caja_id bigint, p_pagos jsonb, p_idempotencia text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_rol        text;
  v_ses        sesion_caja%rowtype;
  v_perfil     perfil%rowtype;
  v_usuario    text;
  v_ids        bigint[];
  v_venta      venta%rowtype;
  v_total      numeric := 0;
  v_pagado     numeric := 0;
  v_cambio     numeric := 0;
  v_pago       jsonb;
  v_metodo     metodo_pago;
  v_rest_pago  numeric;
  v_rest_venta numeric;
  v_toma       numeric;
  v_verif      text;
  v_recibido   numeric;
  v_n          int := 0;
  v_idx        int;
  v_resto      jsonb := '[]'::jsonb;
  v_ventas_out jsonb := '[]'::jsonb;
begin
  v_rol := app_rol_actual();
  if v_rol is null or v_rol not in ('cajero', 'gerente', 'admin') then
    raise exception 'No autorizado para cobrar';
  end if;

  if p_idempotencia is null or btrim(p_idempotencia) = '' or length(p_idempotencia) > 180 then
    raise exception 'Clave de idempotencia obligatoria (máx. 180 caracteres)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cobro_vtd:' || p_idempotencia, 0));

  -- Sesión: abierta; un cajero solo cobra en su propio turno.
  select * into v_ses from sesion_caja where id = p_sesion_caja_id;
  if not found or v_ses.estado <> 'ABIERTA' then
    raise exception 'No hay una sesión de caja abierta (%).', p_sesion_caja_id;
  end if;
  if v_rol = 'cajero' and v_ses.cajero_id is distinct from auth.uid() then
    raise exception 'Solo podés cobrar en tu propio turno';
  end if;

  select * into v_perfil from perfil where id = auth.uid();
  v_usuario := coalesce(v_perfil.email, 'sistema');

  -- Ventas: sin duplicados, bloqueadas en orden para evitar deadlocks.
  select array_agg(distinct x order by x) into v_ids from unnest(p_venta_ids) x where x is not null;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'Hay que indicar al menos una VTD a cobrar';
  end if;

  for v_venta in select * from venta where id = any(v_ids) order by id for update loop
    v_n := v_n + 1;
    if v_venta.numero is null or v_venta.numero not like 'VTD-%' then
      raise exception 'La venta % no es una venta directa (VTD)', v_venta.id;
    end if;
    if v_venta.estado = 'ANULADA' then
      raise exception '% está anulada', v_venta.numero;
    end if;
    if not v_venta.cobro_exigible then
      raise exception '% es histórica y está fuera del circuito de cobro', v_venta.numero;
    end if;
    if exists (select 1 from venta_pago where venta_id = v_venta.id) then
      raise exception '% ya tiene un cobro registrado', v_venta.numero;
    end if;
    if coalesce(v_venta.total, 0) <= 0 then
      raise exception '% tiene total 0', v_venta.numero;
    end if;
    v_total := v_total + v_venta.total;
  end loop;
  if v_n <> array_length(v_ids, 1) then
    raise exception 'Alguna de las VTD indicadas no existe';
  end if;

  -- Pagos: solo medios de mostrador; la suma debe dar el total exacto.
  if p_pagos is null or jsonb_typeof(p_pagos) <> 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'p_pagos debe ser un array no vacío';
  end if;
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_metodo := (v_pago ->> 'metodo')::metodo_pago;
    if v_metodo not in ('EFECTIVO', 'QR', 'TRANSFERENCIA') then
      raise exception 'Método % no permitido para VTD (retail): solo EFECTIVO, QR o TRANSFERENCIA', v_metodo;
    end if;
    if coalesce((v_pago ->> 'monto')::numeric, 0) <= 0 then
      raise exception 'Cada pago debe tener monto positivo';
    end if;
    v_recibido := (v_pago ->> 'recibido')::numeric;
    if v_recibido is not null then
      if v_metodo <> 'EFECTIVO' then
        raise exception '"recibido" solo aplica a EFECTIVO';
      end if;
      if v_recibido < (v_pago ->> 'monto')::numeric then
        raise exception 'El monto recibido (%) no puede ser menor al pago (%)', v_recibido, (v_pago ->> 'monto')::numeric;
      end if;
      v_cambio := v_cambio + (v_recibido - (v_pago ->> 'monto')::numeric);
    end if;
    v_pagado := v_pagado + (v_pago ->> 'monto')::numeric;
    v_resto := v_resto || jsonb_build_array(jsonb_build_object(
                 'metodo', v_metodo::text,
                 'monto', (v_pago ->> 'monto')::numeric,
                 'resto', (v_pago ->> 'monto')::numeric,
                 'recibido', v_recibido,
                 'referencia', v_pago ->> 'referencia'));
  end loop;
  if round(v_pagado, 2) <> round(v_total, 2) then
    raise exception 'El pago (%) no coincide con el total de las VTD (%)', v_pagado, v_total;
  end if;

  -- Reparto: se llenan las VTD en orden de id con los pagos en el orden recibido.
  -- Un pago puede partirse entre dos VTD; "recibido" solo se guarda si el pago
  -- entero cae en una sola VTD (el cambio total va en la respuesta).
  v_idx := 0;
  v_n := 0;
  for v_venta in select * from venta where id = any(v_ids) order by id loop
    v_rest_venta := v_venta.total;
    while v_rest_venta > 0 loop
      v_rest_pago := (v_resto -> v_idx ->> 'resto')::numeric;
      if v_rest_pago <= 0 then
        v_idx := v_idx + 1;
        continue;
      end if;
      v_toma   := least(v_rest_pago, v_rest_venta);
      v_metodo := (v_resto -> v_idx ->> 'metodo')::metodo_pago;
      v_verif  := case when v_metodo in ('QR', 'TRANSFERENCIA') then 'PENDIENTE' else 'NO_APLICA' end;
      v_n := v_n + 1;

      insert into venta_pago (venta_id, metodo, monto, recibido, referencia, estado_verificacion)
      values (v_venta.id, v_metodo, v_toma,
              case when v_toma = (v_resto -> v_idx ->> 'monto')::numeric
                   then (v_resto -> v_idx ->> 'recibido')::numeric end,
              v_resto -> v_idx ->> 'referencia', v_verif);

      insert into movimiento_caja (sesion_caja_id, tipo, metodo, monto, venta_id, cliente_id,
                                   creado_por, idempotencia_clave, nota)
      values (p_sesion_caja_id, 'VENTA', v_metodo, v_toma, v_venta.id, v_venta.cliente_id,
              v_usuario, 'cobro_vtd:' || p_idempotencia || ':' || v_n, 'Cobro ' || v_venta.numero);

      v_resto := jsonb_set(v_resto, array[v_idx::text, 'resto'], to_jsonb(v_rest_pago - v_toma));
      v_rest_venta := v_rest_venta - v_toma;
    end loop;

    insert into venta_evento (venta_id, accion, motivo, usuario)
    values (v_venta.id, 'COBRADA', 'Cobro en caja, sesión ' || p_sesion_caja_id, v_usuario);

    v_ventas_out := v_ventas_out || jsonb_build_array(jsonb_build_object(
                      'venta_id', v_venta.id, 'numero', v_venta.numero,
                      'total', v_venta.total, 'estado', v_venta.estado));
  end loop;

  return jsonb_build_object(
    'reintento', false,
    'sesion_caja_id', p_sesion_caja_id,
    'ventas', v_ventas_out,
    'total', v_total,
    'cambio', v_cambio,
    'pendiente_verificacion', exists (
      select 1 from venta_pago where venta_id = any(v_ids) and estado_verificacion = 'PENDIENTE')
  );
end;
$function$
;

revoke all on function almacen_operaciones.cobrar_vtd_nucleo(bigint[],bigint,jsonb,text) from public,anon,authenticated;

create table almacen_operaciones.cobro_vtd_respuesta (
  idempotencia text primary key check(length(idempotencia) between 1 and 180),
  actor_id uuid not null,
  sesion_caja_id bigint not null references public.sesion_caja(id),
  solicitud jsonb not null,
  resultado jsonb not null,
  creado_en timestamptz not null default now()
);
alter table almacen_operaciones.cobro_vtd_respuesta enable row level security;
create index cobro_vtd_respuesta_sesion_idx on almacen_operaciones.cobro_vtd_respuesta(sesion_caja_id);
revoke all on almacen_operaciones.cobro_vtd_respuesta from public,anon,authenticated;
comment on table almacen_operaciones.cobro_vtd_respuesta is
  'Caché privado de recibos VTD. Sin acceso de clientes; la RPC valida perfil, actor y solicitud.';

create function almacen_operaciones.cobrar_vtd_seguro(
  p_venta_ids bigint[], p_sesion_caja_id bigint, p_pagos jsonb, p_idempotencia text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.perfil%rowtype;
  previa almacen_operaciones.cobro_vtd_respuesta%rowtype;
  ids bigint[];
  pagos jsonb := '[]'::jsonb;
  pago jsonb;
  solicitud jsonb;
  resultado jsonb;
  prefijo text;
  originales bigint[];
  sesiones bigint[];
  usuarios text[];
  total_previo numeric;
  total_pago numeric := 0;
  cambio_previo numeric;
  n_recibidos integer;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if actor.id is null or actor.rol not in ('cajero','gerente','admin') then
    raise exception 'No autorizado para cobrar' using errcode='42501';
  end if;
  if p_idempotencia is null or btrim(p_idempotencia)='' or length(p_idempotencia)>180 then
    raise exception 'Clave de idempotencia obligatoria (máx. 180 caracteres)';
  end if;
  select array_agg(distinct x order by x) into ids from unnest(p_venta_ids) x where x is not null;
  if ids is null then raise exception 'Hay que indicar al menos una VTD a cobrar'; end if;
  if p_pagos is null or jsonb_typeof(p_pagos)<>'array' or jsonb_array_length(p_pagos)=0 then
    raise exception 'p_pagos debe ser un array no vacío';
  end if;
  for pago in select * from jsonb_array_elements(p_pagos) loop
    if coalesce(pago->>'metodo','') not in ('EFECTIVO','QR','TRANSFERENCIA')
      or coalesce(pago->>'monto','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or (pago->>'monto')::numeric<=0 then
      raise exception 'Cada pago requiere EFECTIVO, QR o TRANSFERENCIA y un monto positivo con hasta 2 decimales';
    end if;
    if pago->>'recibido' is not null and (
      pago->>'metodo'<>'EFECTIVO'
      or pago->>'recibido' !~ '^[0-9]+([.][0-9]{1,2})?$'
      or (pago->>'recibido')::numeric < (pago->>'monto')::numeric
    ) then raise exception 'El monto recibido debe cubrir el pago y sólo aplica a EFECTIVO'; end if;
    pagos:=pagos||jsonb_build_array(jsonb_build_object(
      'metodo',pago->>'metodo','monto',(pago->>'monto')::numeric,
      'recibido',(pago->>'recibido')::numeric,'referencia',pago->>'referencia'));
    total_pago:=total_pago+(pago->>'monto')::numeric;
  end loop;
  solicitud:=jsonb_build_object('ventas',to_jsonb(ids),'sesion_caja_id',p_sesion_caja_id,'pagos',pagos);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cobro_vtd:'||p_idempotencia,0));
  select * into previa from almacen_operaciones.cobro_vtd_respuesta where idempotencia=p_idempotencia;
  if found then
    if previa.actor_id<>actor.id or previa.solicitud is distinct from solicitud then
      raise exception 'Esta clave ya corresponde a otro cobro o usuario; conserva la solicitud original' using errcode='22023';
    end if;
    return previa.resultado||jsonb_build_object('reintento',true);
  end if;

  -- Compatibilidad con recibos anteriores al caché. La clave se compara literalmente:
  -- '%' y '_' nunca pueden recuperar el recibo de otra operación.
  prefijo:='cobro_vtd:'||p_idempotencia||':';
  select array_agg(distinct m.venta_id order by m.venta_id),
    array_agg(distinct m.sesion_caja_id),array_agg(distinct m.creado_por),sum(m.monto)
    into originales,sesiones,usuarios,total_previo
    from public.movimiento_caja m
    where left(m.idempotencia_clave,length(prefijo))=prefijo
      and substring(m.idempotencia_clave from length(prefijo)+1) ~ '^[1-9][0-9]*$';
  if originales is not null then
    if originales is distinct from ids or sesiones is distinct from array[p_sesion_caja_id]
      or usuarios is distinct from array[coalesce(actor.email,'sistema')]
      or total_previo<>total_pago then
      raise exception 'Esta clave ya corresponde a otro cobro o usuario; conserva la solicitud original' using errcode='22023';
    end if;
    if exists (
      select 1 from (
        select metodo,referencia,sum(monto) monto from public.venta_pago where venta_id=any(ids) group by metodo,referencia
      ) vp full join (
        select x->>'metodo' metodo,x->>'referencia' referencia,sum((x->>'monto')::numeric) monto
          from jsonb_array_elements(pagos) x group by x->>'metodo',x->>'referencia'
      ) pp on vp.metodo::text=pp.metodo and vp.referencia is not distinct from pp.referencia
      where vp.monto is distinct from pp.monto
    ) then raise exception 'Esta clave ya corresponde a otros medios de pago; conserva la solicitud original'; end if;
    select sum(recibido-monto),count(*) filter(where recibido is not null)
      into cambio_previo,n_recibidos from public.venta_pago where venta_id=any(ids) and metodo='EFECTIVO';
    -- Un pago antiguo repartido entre ventas perdió "recibido": no inventar su cambio.
    if n_recibidos < (select count(*) from jsonb_array_elements(pagos) x where x->>'recibido' is not null) then
      cambio_previo:=null;
    elsif cambio_previo is not null and cambio_previo is distinct from (
      select sum((x->>'recibido')::numeric-(x->>'monto')::numeric)
        from jsonb_array_elements(pagos) x where x->>'recibido' is not null
    ) then
      raise exception 'Esta clave ya corresponde a otro efectivo recibido; conserva la solicitud original';
    end if;
    select jsonb_build_object('reintento',true,'sesion_caja_id',p_sesion_caja_id,
      'ventas',jsonb_agg(jsonb_build_object('venta_id',v.id,'numero',v.numero,'total',v.total,'estado',v.estado) order by v.id),
      'total',total_previo,'cambio',cambio_previo,
      'pendiente_verificacion',exists(select 1 from public.venta_pago where venta_id=any(ids) and estado_verificacion='PENDIENTE')
    ) into resultado from public.venta v where id=any(ids);
  else
    resultado:=almacen_operaciones.cobrar_vtd_nucleo(ids,p_sesion_caja_id,pagos,p_idempotencia);
  end if;
  insert into almacen_operaciones.cobro_vtd_respuesta(idempotencia,actor_id,sesion_caja_id,solicitud,resultado)
    values(p_idempotencia,actor.id,p_sesion_caja_id,solicitud,resultado);
  return resultado;
end;
$$;
revoke all on function almacen_operaciones.cobrar_vtd_seguro(bigint[],bigint,jsonb,text) from public,anon;
grant execute on function almacen_operaciones.cobrar_vtd_seguro(bigint[],bigint,jsonb,text) to authenticated;

create or replace function public.cobrar_vtd(
  p_venta_ids bigint[], p_sesion_caja_id bigint, p_pagos jsonb, p_idempotencia text
) returns jsonb language sql security invoker set search_path = '' as $$
  select almacen_operaciones.cobrar_vtd_seguro(p_venta_ids,p_sesion_caja_id,p_pagos,p_idempotencia);
$$;
revoke all on function public.cobrar_vtd(bigint[],bigint,jsonb,text) from public,anon;
grant execute on function public.cobrar_vtd(bigint[],bigint,jsonb,text) to authenticated;
notify pgrst, 'reload schema';
