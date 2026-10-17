-- Confirma sólo líneas aún sin guardar. Conserva faltantes y ceros.
-- No verifica productos, no termina el documento ni mueve existencias.
create function almacen_operaciones.confirmar_resto_preparacion(
  p_tipo text, p_documento_id bigint, p_sucursal_id bigint, p_tarea_id bigint, p_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.perfil%rowtype;
  info jsonb;
  tarea jsonb;
  ids bigint[];
  n integer;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if actor.id is null or actor.rol not in ('admin','gerente','almacenero','operario') then
    raise exception 'Tu perfil no puede confirmar preparaciones.' using errcode='42501';
  end if;
  if p_tipo is null or p_tipo not in ('PEDIDO','VTD') then
    raise exception 'Esta confirmación sólo corresponde a la preparación de Pedido o VTD.';
  end if;
  if p_tarea_id is null then raise exception 'Primero toma la preparación del documento.'; end if;
  -- Reutiliza permisos y orden de bloqueos del motor vigente.
  if p_tipo='PEDIDO' then
    info:=almacen_operaciones.operar(p_documento_id,p_sucursal_id,p_tarea_id,'consultar',null,'{}');
  else
    info:=almacen_operaciones.operar_documento('VTD',p_documento_id,'consultar',null,'{}');
    if (info->'documento'->>'sucursal_origen_id')::bigint is distinct from p_sucursal_id then
      raise exception 'La VTD pertenece a otra sucursal.' using errcode='42501';
    end if;
  end if;
  tarea:=info->'tarea';
  if (tarea->>'id')::bigint is distinct from p_tarea_id then
    raise exception 'Esta preparación no corresponde al documento.';
  end if;
  if tarea->>'estado' is distinct from 'PREPARANDO'
    or coalesce(info->'pedido'->>'estado',info->'documento'->>'estado') is distinct from 'ABIERTO' then
    raise exception 'Sólo puedes confirmar líneas mientras el documento está en preparación.';
  end if;
  if (tarea->>'preparador_id')::uuid is distinct from actor.id then
    raise exception 'Sólo el preparador asignado puede confirmar estas cantidades.' using errcode='42501';
  end if;
  if p_version is null or p_version is distinct from (tarea->>'version')::integer then
    raise exception 'La preparación cambió en otro celular. Actualiza antes de confirmar el resto.' using errcode='40001';
  end if;
  if jsonb_array_length(info->'cambios')>0 then
    raise exception 'El documento cambió. Actualiza la preparación antes de confirmar el resto.' using errcode='40001';
  end if;
  select array_agg(
    case when p_tipo='PEDIDO' then (l->>'pedido_linea_id')::bigint else (l->>'id')::bigint end
    order by case when p_tipo='PEDIDO' then (l->>'pedido_linea_id')::bigint else (l->>'id')::bigint end
  ) into ids from jsonb_array_elements(info->'lineas') l
  where (l->>'vigente')::boolean and not (l->>'confirmada')::boolean
    and coalesce((l->'snapshot'->>'preparable')::boolean,false)
    and (l->'snapshot'->>'pendiente_base')::numeric>0
    and (l->'snapshot'->>'pendiente_base')::numeric<=1e12
    and round((l->'snapshot'->>'pendiente_base')::numeric,6)=(l->'snapshot'->>'pendiente_base')::numeric;
  if ids is null then return info; end if;
  if p_tipo='PEDIDO' then
    update public.almacen_preparacion_linea
      set preparada_base=(snapshot->>'pendiente_base')::numeric,confirmada=true,
        revisada_base=null,metodo_revision=null,codigo_leido=null,revisada_en=null,revisor_id=null,revisor_nombre=null
      where preparacion_id=p_tarea_id and pedido_linea_id=any(ids) and vigente and not confirmada;
    get diagnostics n=row_count;
    update public.almacen_preparacion set version=version+1,actualizado_en=now() where id=p_tarea_id;
    insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle)
      values(p_tarea_id,'RESTO_PREPARACION_CONFIRMADO',actor.id,actor.nombre,
        jsonb_build_object('lineas_confirmadas',ids,'cantidad_lineas',n));
    info:=almacen_operaciones.operar(p_documento_id,p_sucursal_id,p_tarea_id,'consultar',null,'{}');
  else
    update public.almacen_documento_linea
      set preparada_base=declarada_base,confirmada=true,
        revisada_base=null,metodo_revision=null,codigo_leido=null,revisada_en=null,revisor_id=null,revisor_nombre=null
      where documento_id=p_tarea_id and id=any(ids) and vigente and not confirmada;
    get diagnostics n=row_count;
    update public.almacen_documento_movil set version=version+1,actualizado_en=now() where id=p_tarea_id;
    insert into public.almacen_documento_evento(documento_id,accion,actor_id,actor_nombre,detalle)
      values(p_tarea_id,'RESTO_PREPARACION_CONFIRMADO',actor.id,actor.nombre,
        jsonb_build_object('lineas_confirmadas',ids,'cantidad_lineas',n));
    info:=almacen_operaciones.documento_datos(p_tarea_id);
  end if;
  return info||jsonb_build_object('confirmacion_preparacion',jsonb_build_object('confirmadas',n));
end;
$$;
revoke all on function almacen_operaciones.confirmar_resto_preparacion(text,bigint,bigint,bigint,integer) from public,anon;
grant execute on function almacen_operaciones.confirmar_resto_preparacion(text,bigint,bigint,bigint,integer) to authenticated;
create function public.confirmar_resto_preparacion(
  p_tipo text, p_documento_id bigint, p_sucursal_id bigint, p_tarea_id bigint, p_version integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select almacen_operaciones.confirmar_resto_preparacion(
    upper(p_tipo),p_documento_id,p_sucursal_id,p_tarea_id,p_version
  );
$$;
revoke all on function public.confirmar_resto_preparacion(text,bigint,bigint,bigint,integer) from public,anon;
grant execute on function public.confirmar_resto_preparacion(text,bigint,bigint,bigint,integer) to authenticated;
notify pgrst,'reload schema';
