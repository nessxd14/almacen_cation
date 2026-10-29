-- Activa el alistado nuevo sin reabrir salidas ni rehacer el trabajo físico.
set local lock_timeout='5s';
alter table public.almacen_preparacion add column alistado_migrado boolean not null default false;

-- La procedencia de una tanda anterior se completa sobre su cantidad física
-- ya registrada. No cambia cantidades, revisión ni versión de las fotos.
do $$
declare f text;anterior text;nuevo text;
begin
  anterior:='if p_accion=''consultar'' then return almacen_operaciones.enriquecer_alistado_simple(r);end if;';
  nuevo:=$patch$
  if t.alistado_migrado and p_accion='declarar_origen' and t.estado in ('PREPARADO','REVISANDO','VERIFICADO') then
    r:=almacen_operaciones.operar_flexible(p_pedido,p_sucursal,t.id,p_accion,p_version,p_datos);
    update public.almacen_preparacion set version=t.version where id=t.id;
    r:=almacen_operaciones.operar_flexible(p_pedido,p_sucursal,t.id,'consultar',null,'{}');
    return almacen_operaciones.enriquecer_alistado_simple(r);
  end if;
  $patch$||anterior;
  f:=pg_get_functiondef('almacen_operaciones.operar_alistado_simple(bigint,bigint,bigint,text,integer,jsonb)'::regprocedure);
  if position(anterior in f)=0 then raise exception 'Revisar el contrato de alistado antes de activar las tandas.';end if;
  f:=replace(f,anterior,nuevo);
  -- También exige origen cuando una revisión anterior añadió material a una línea en cero.
  f:=replace(f,'ln.preparada_base>0 and (ln.origenes_declarados','almacen_operaciones.cantidad_fisica(ln)>0 and (ln.origenes_declarados');
  execute f;

  anterior:='jsonb_build_object(''alistado_simple'',true,''lineas'',ls)';
  f:=pg_get_functiondef('almacen_operaciones.enriquecer_alistado_simple(jsonb)'::regprocedure);
  if position(anterior in f)=0 then raise exception 'Revisar la respuesta del alistado antes de activar las tandas.';end if;
  execute replace(f,anterior,'jsonb_build_object(''alistado_simple'',true,''alistado_migrado'',t.alistado_migrado,''lineas'',ls)');
end $$;

do $$
declare rec_tarea public.almacen_preparacion%rowtype;rec_linea public.almacen_preparacion_linea%rowtype;
  disponible numeric;faltante numeric;f numeric;
begin
  -- Respeta el orden de bloqueo de la API: pedido, líneas, tanda.
  perform p.id from public.pedido p where p.estado='ABIERTO' and exists(
    select 1 from public.almacen_preparacion t where t.pedido_id=p.id and not t.alistado_simple
      and not t.salida_previa and t.estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO')) order by p.id for update;
  perform pl.id from public.pedido_linea pl join public.pedido p on p.id=pl.pedido_id
    where p.estado='ABIERTO' and exists(select 1 from public.almacen_preparacion t where t.pedido_id=p.id
      and not t.alistado_simple and not t.salida_previa and t.estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO'))
    order by pl.id for update of pl;
  perform t.id from public.almacen_preparacion t join public.pedido p on p.id=t.pedido_id
    where p.estado='ABIERTO' and not t.alistado_simple and not t.salida_previa
      and t.estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO') order by t.pedido_id,t.id for update of t;
  update public.almacen_preparacion t set alistado_simple=true,alistado_migrado=true,
    modo_flexible=true,modo_abastecimiento=true,flujo_dos_actores=true
    from public.pedido p where p.id=t.pedido_id and p.estado='ABIERTO' and not t.alistado_simple and not t.salida_previa
      and t.estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO')
      and not exists(select 1 from evidencia_operacion.retiro r where r.preparacion_id=t.id)
      and not exists(select 1 from public.almacen_preparacion_linea l join public.pedido_linea pl on pl.id=l.pedido_linea_id
        where l.preparacion_id=t.id and l.vigente and pl.cantidad_despachada>coalesce((l.snapshot->>'cantidad_despachada')::numeric,0));
  for rec_tarea in select ap.* from public.almacen_preparacion ap join public.pedido p on p.id=ap.pedido_id
    where p.estado='ABIERTO' and ap.alistado_migrado and ap.estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO')
    order by ap.pedido_id,ap.id
  loop
    for rec_linea in select * from public.almacen_preparacion_linea where preparacion_id=rec_tarea.id and vigente order by pedido_linea_id for update loop
      f:=coalesce((rec_linea.reemplazo->>'factor')::numeric,1);
      if rec_linea.confirmada then
        faltante:=greatest((rec_linea.snapshot->>'pendiente_base')::numeric-almacen_operaciones.cantidad_fisica(rec_linea)/f,0);
      else
        select coalesce(sum((o->>'cantidad_base')::numeric),0) into disponible from jsonb_array_elements(
          almacen_operaciones.proponer_almacen_simple(rec_tarea.id,rec_linea.pedido_linea_id,(rec_linea.snapshot->>'pendiente_base')::numeric*f))o;
        faltante:=greatest((rec_linea.snapshot->>'pendiente_base')::numeric-disponible/f,0);
      end if;
      perform almacen_operaciones.sincronizar_compra_simple(rec_tarea.id,rec_linea.pedido_linea_id,faltante);
    end loop;
  end loop;
end $$;
notify pgrst,'reload schema';
