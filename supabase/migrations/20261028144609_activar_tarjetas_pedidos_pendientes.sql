-- Extiende el flujo a todas las tandas de pedidos abiertos que aún no salieron.
-- Conserva cantidades, responsables, estados y versiones de evidencia.
-- Las entregas históricas, canceladas y con salida previa no se reabren.

-- Una recepción documental anterior sigue siendo material de ese mismo pedido.
-- Se consume al retirar/completar el origen; no vuelve a quedar disponible.
create function almacen_operaciones.consumir_recepciones_flexible(p_tarea bigint,p_linea bigint,p_evento bigint,p_origenes jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare o record;r record;q numeric;tomar numeric;
begin
  if not exists(select 1 from public.almacen_preparacion_linea l join public.almacen_preparacion t on t.id=l.preparacion_id
    join public.pedido_despacho_evento e on e.id=l.despacho_evento_id and e.pedido_linea_id=l.pedido_linea_id
    where t.id=p_tarea and l.pedido_linea_id=p_linea and t.modo_flexible and t.estado='DESPACHADO'
      and e.id=p_evento and not e.revertido and not l.origen_aplicado) then
    raise exception 'La recepción no corresponde a esta salida.';
  end if;
  for o in select x->>'tipo' tipo,sum((x->>'cantidad_base')::numeric) cantidad
    from jsonb_array_elements(p_origenes)x where x->>'tipo' in ('TIENDA','COMPRA_RAPIDA') group by x->>'tipo' order by x->>'tipo'
  loop
    q:=o.cantidad;
    for r in select rp.id from almacen_operaciones.recepcion_pedido rp
      where rp.pedido_linea_id=p_linea and rp.tipo=o.tipo order by rp.creado_en,rp.id for update
    loop
      exit when q<=0;
      tomar:=least(q,almacen_operaciones.saldo_recepcion(r.id));
      if tomar>0 then
        insert into almacen_operaciones.consumo_recepcion(preparacion_id,recepcion_id,evento_id,cantidad_base)
          values(p_tarea,r.id,p_evento,tomar)
          on conflict(preparacion_id,recepcion_id) do update set cantidad_base=almacen_operaciones.consumo_recepcion.cantidad_base+excluded.cantidad_base
          where almacen_operaciones.consumo_recepcion.evento_id=excluded.evento_id;
        if not found then raise exception 'La recepción ya está vinculada a otra salida.';end if;
        q:=q-tomar;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function almacen_operaciones.consumir_recepciones_flexible(bigint,bigint,bigint,jsonb) from public,anon,authenticated;

do $$ declare f text;anterior text:='update public.pedido_despacho_evento set abastecimiento_origenes=l.origenes_declarados where id=l.despacho_evento_id;';begin
  f:=pg_get_functiondef('almacen_operaciones.aplicar_origen_flexible(bigint,bigint)'::regprocedure);
  if position(anterior in f)=0 then raise exception 'Revisar el contrato de aplicación de origen antes de migrar.';end if;
  execute replace(f,anterior,'perform almacen_operaciones.consumir_recepciones_flexible(p_tarea,p_linea,l.despacho_evento_id,l.origenes_declarados);'||E'\n  '||anterior);
end $$;

do $$
declare t public.almacen_preparacion%rowtype;l public.almacen_preparacion_linea%rowtype;
  plan jsonb;partida jsonb;previos jsonb;normalizados jsonb;o jsonb;a jsonb;rec almacen_operaciones.recepcion_pedido%rowtype;
  q numeric;valido boolean;pendientes integer;
begin
  -- Mismo orden que las operaciones móviles para respetar el trabajo en curso.
  perform p.id from public.pedido p where p.estado='ABIERTO' and exists(select 1 from public.almacen_preparacion ap
    where ap.pedido_id=p.id and not ap.modo_flexible and not ap.salida_previa and ap.estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO')) order by p.id for update;
  perform pl.id from public.pedido_linea pl join public.pedido p on p.id=pl.pedido_id where p.estado='ABIERTO'
    and exists(select 1 from public.almacen_preparacion ap where ap.pedido_id=p.id and not ap.modo_flexible and not ap.salida_previa
      and ap.estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO')) order by pl.id for update of pl;
  for t in select ap.* from public.almacen_preparacion ap join public.pedido p on p.id=ap.pedido_id
    where p.estado='ABIERTO' and not ap.modo_flexible and not ap.salida_previa
      and ap.estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO') order by ap.pedido_id,ap.id for update of ap
  loop
    -- Las cantidades ya entregadas pertenecen a su circuito histórico.
    if exists(select 1 from evidencia_operacion.retiro where preparacion_id=t.id)
      or exists(select 1 from public.almacen_preparacion_linea al join public.pedido_linea pl on pl.id=al.pedido_linea_id
        where al.preparacion_id=t.id and al.vigente and pl.cantidad_despachada>coalesce((al.snapshot->>'cantidad_despachada')::numeric,0)) then
      continue;
    end if;
    plan:=evidencia_operacion.plan_salida(t.id);
    for l in select * from public.almacen_preparacion_linea where preparacion_id=t.id and vigente order by pedido_linea_id for update loop
      q:=coalesce(l.revisada_base,l.preparada_base);normalizados:='[]';valido:=true;
      previos:=coalesce(l.origenes_revision,l.origenes_preparacion);
      if q<=0 or (select coalesce(sum((x->>'cantidad_base')::numeric),0) from jsonb_array_elements(previos)x)<>q then continue;end if;
      select x into partida from jsonb_array_elements(plan)x where (x->>'linea_id')::bigint=l.pedido_linea_id;
      for o in select * from jsonb_array_elements(previos) loop
        if o->>'tipo'='EXISTENCIA_PERSONALIZADA' then
          normalizados:=normalizados||jsonb_build_array(jsonb_build_object('tipo','ALMACEN','cantidad_base',o->'cantidad_base'));
        elsif o->>'tipo'='ALMACEN' then
          if partida is null or partida->>'error' is not null
            or (select coalesce(sum((x->>'cantidad_base')::numeric),0) from jsonb_array_elements(partida->'asignaciones')x)<>(o->>'cantidad_base')::numeric then valido:=false;exit;end if;
          for a in select * from jsonb_array_elements(partida->'asignaciones') loop
            normalizados:=normalizados||jsonb_build_array(jsonb_build_object('tipo','ALMACEN','cantidad_base',a->'cantidad_base','ubicacion_id',a->'ubicacion_id'));
          end loop;
        elsif o->>'tipo' in ('TIENDA','COMPRA_RAPIDA') then
          select * into rec from almacen_operaciones.recepcion_pedido where id=(o->>'recepcion_id')::uuid and pedido_linea_id=l.pedido_linea_id;
          if not found or rec.tipo<>o->>'tipo' or almacen_operaciones.saldo_recepcion(rec.id)<(o->>'cantidad_base')::numeric then valido:=false;exit;end if;
          normalizados:=normalizados||jsonb_build_array(o||jsonb_build_object('referencia',rec.referencia,'sucursal_tienda_id',rec.sucursal_tienda_id,'costo',rec.costo));
        else valido:=false;exit;end if;
      end loop;
      if valido then update public.almacen_preparacion_linea set origenes_declarados=normalizados where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;end if;
    end loop;
    select count(*) into pendientes from public.almacen_preparacion_linea tl where preparacion_id=t.id and vigente and almacen_operaciones.cantidad_fisica(tl)>0 and
      (origenes_declarados is null or (select coalesce(sum((z->>'cantidad_base')::numeric),0) from jsonb_array_elements(origenes_declarados)z)<>almacen_operaciones.cantidad_fisica(tl));
    -- No cambia la versión: las cantidades no cambiaron y las fotos en borrador siguen siendo válidas.
    update public.almacen_preparacion set modo_flexible=true,modo_abastecimiento=true,flujo_dos_actores=true,
      origenes_pendientes=case when estado='PREPARANDO' then 0 else pendientes end where id=t.id;
  end loop;
end $$;
notify pgrst,'reload schema';
