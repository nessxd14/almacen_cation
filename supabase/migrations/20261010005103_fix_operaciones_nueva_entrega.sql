-- Reinicia el indicador de despacho al crear la siguiente entrega.
-- Valida el contexto de sucursal de las etiquetas con QR.
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
  if p_accion is null or p_accion not in ('consultar','crear','sincronizar','guardar_preparacion','preparado','tomar_revision','guardar_revision','verificado','reabrir','reasignar','anular') then
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
  if p_accion not in ('consultar','crear') then
    if v_tarea.id is null then raise exception 'Primero toma la preparación del pedido.'; end if;
    if p_version is null or p_version<>v_tarea.version then
      raise exception 'La preparación cambió en otro celular. Actualiza los datos antes de guardar.' using errcode='40001';
    end if;
    if v_tarea.estado in ('DESPACHADO','ANULADO') then raise exception 'Esta preparación ya está cerrada.'; end if;
    if p_accion<>'anular' and v_pedido.estado<>'ABIERTO' then raise exception 'El pedido está cancelado o completado; no puedes confirmarlo.'; end if;
    if p_accion in ('guardar_preparacion','preparado','sincronizar','reabrir','anular')
      and v_tarea.preparador_id<>v_perfil.id and not v_admin then
      raise exception 'Esta preparación está a cargo de otro operario.' using errcode='42501';
    end if;
    if p_accion not in ('sincronizar','reabrir','reasignar','anular') and jsonb_array_length(v_cambios)>0 then
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
      if v_tarea.estado<>'PREPARADO' then raise exception 'La entrega no está disponible para revisión.'; end if;
      update public.almacen_preparacion set estado='REVISANDO',revisor_id=v_perfil.id,revisor_nombre=v_perfil.nombre where id=v_tarea.id;
    elsif p_accion in ('guardar_revision','verificado') then
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
notify pgrst, 'reload schema';
