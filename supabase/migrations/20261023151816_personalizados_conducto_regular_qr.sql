-- Los personalizados pasan por el mismo alistado, verificación y retiro.
-- No cambia documentos históricos ni mueve inventario de catálogo.
create or replace function evidencia_operacion.proteger_despacho_pedido() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;
begin
  if new.cantidad_despachada>old.cantidad_despachada
    or (new.estado='COMPRADO_DIRECTO' and old.estado<>new.estado)
    or ((old.es_personalizado or new.es_personalizado) and new.estado='DESPACHADA' and old.estado<>new.estado) then
    select * into t from public.almacen_preparacion
      where pedido_id=new.pedido_id and flujo_dos_actores and estado<>'ANULADO' order by id desc limit 1;
    if (found or old.es_personalizado or new.es_personalizado)
      and not exists(select 1 from evidencia_operacion.despacho_autorizado where preparacion_id=t.id and transaccion=txid_current()) then
      raise exception 'Este pedido se retira desde la miniapp: confirma alistado, revisión, fotos y retiro con el verificador.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function evidencia_operacion.proteger_despacho_pedido() from public,anon,authenticated;

-- confirmar_retiro autoriza esta salida dentro de su transacción privada.
-- Los RPC antiguos quedan bloqueados incluso sin una preparación previa.
create or replace function public.entregar_personalizado(p_linea_id bigint,p_usuario text default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare l public.pedido_linea%rowtype;a public.perfil%rowtype;
begin
  if not public.app_puede_inventariar() then
    raise exception 'Un cajero no puede entregar ítems personalizados.' using errcode='42501';
  end if;
  select * into a from public.perfil where id=auth.uid() and activo;
  if a.id is null then raise exception 'Inicia sesión para entregar.' using errcode='42501';end if;
  select * into l from public.pedido_linea where id=p_linea_id for update;
  if not found then raise exception 'La línea no existe';end if;
  if not l.es_personalizado or l.estado<>'ESPECIAL' then raise exception 'El personalizado no está pendiente de entrega';end if;
  update public.pedido_linea set estado='DESPACHADA',cantidad_despachada=cantidad_base,
    modificado_por=a.nombre,modificado_en=now() where id=l.id;
  perform public.recalcular_estado_pedido(l.pedido_id);
  return jsonb_build_object('linea_id',l.id,'estado','DESPACHADA');
end $$;
revoke all on function public.entregar_personalizado(bigint,text) from public,anon;
grant execute on function public.entregar_personalizado(bigint,text) to authenticated;

notify pgrst,'reload schema';
