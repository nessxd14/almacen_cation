-- Validaciones y recuperación de traslados; no confirma recepciones ni mueve saldos históricos.
create or replace function public.traslado_autorizar(p_sucursal bigint,p_accion text)
returns text language plpgsql security invoker set search_path=public as $$
declare actor public.perfil%rowtype;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if not found then raise exception 'Se requiere un perfil activo para operar traslados.' using errcode='42501'; end if;
  if p_accion in ('despachar','recuperar','revertir') and actor.rol not in ('admin','gerente','supervisor','almacen','almacenero','operario') then
    raise exception 'Tu perfil no permite despachar ni recuperar faltantes.' using errcode='42501';
  end if;
  if p_accion in ('crear','recibir') and actor.rol not in ('admin','gerente','supervisor','almacen','almacenero','operario','vendedor','cajero') then
    raise exception 'Tu perfil no permite solicitar ni recibir traslados.' using errcode='42501';
  end if;
  if p_accion<>'crear' and actor.rol not in ('admin','gerente','supervisor') and actor.sucursal_id is not null and actor.sucursal_id<>p_sucursal then
    raise exception 'Esta operación no corresponde a tu sucursal asignada.' using errcode='42501';
  end if;
  if not exists(select 1 from public.sucursal where id=p_sucursal and activo and tipo<>'virtual') then
    raise exception 'Selecciona una sucursal física activa.';
  end if;
  return actor.nombre;
end $$;
revoke all on function public.traslado_autorizar(bigint,text) from public,anon;
grant execute on function public.traslado_autorizar(bigint,text) to authenticated;

CREATE OR REPLACE FUNCTION public.crear_solicitud_traslado(p_motivo motivo_traslado, p_lineas jsonb, p_usuario text DEFAULT NULL::text, p_sucursal_origen_id bigint DEFAULT 1, p_sucursal_destino_id bigint DEFAULT 2, p_referencia text DEFAULT NULL::text, p_nota text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path=public
AS $function$
declare
  v_id bigint; v_linea jsonb; v_prod bigint; v_pres bigint;
  v_factor numeric; v_cant_pres numeric; v_cant numeric;
begin
  p_usuario := public.traslado_autorizar(p_sucursal_destino_id,'crear');
  if exists(select 1 from public.perfil where id=auth.uid() and rol not in ('admin','gerente','supervisor') and sucursal_id is not null and sucursal_id not in (p_sucursal_origen_id,p_sucursal_destino_id)) then
    raise exception 'El traslado no corresponde a tu sucursal asignada.' using errcode='42501';
  end if;
  if p_sucursal_origen_id=p_sucursal_destino_id or not exists(select 1 from public.sucursal where id=p_sucursal_origen_id and activo and tipo<>'virtual') then
    raise exception 'Origen y destino deben ser sucursales físicas diferentes.';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'p_lineas debe ser un array no vacío';
  end if;

  insert into solicitud_traslado (motivo, sucursal_origen_id, sucursal_destino_id,
                                  referencia, nota, solicitado_por)
  values (p_motivo, p_sucursal_origen_id, p_sucursal_destino_id,
          p_referencia, p_nota, p_usuario)
  returning id into v_id;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_prod := (v_linea->>'producto_id')::bigint;
    if v_prod is null then raise exception 'Cada línea requiere producto_id'; end if;
    v_pres := (v_linea->>'presentacion_id')::bigint;

    if v_pres is not null then
      select factor_unidad_base into v_factor
        from presentacion where id = v_pres and producto_id = v_prod;
      if v_factor is null then
        raise exception 'La presentación % no pertenece al producto %', v_pres, v_prod;
      end if;
      v_cant_pres := (v_linea->>'cantidad_presentacion')::numeric;
      if v_cant_pres is null or v_cant_pres <= 0 then
        raise exception 'cantidad_presentacion debe ser positiva';
      end if;
      v_cant := v_cant_pres * v_factor;
    else
      v_cant := (v_linea->>'cantidad_base')::numeric;
      v_cant_pres := v_cant;
      if v_cant is null or v_cant <= 0 then raise exception 'cantidad_base debe ser positiva'; end if;
    end if;

    if v_cant::text in ('NaN','Infinity','-Infinity') then raise exception 'La cantidad debe ser finita.'; end if;
    insert into solicitud_traslado_linea (solicitud_id, producto_id, presentacion_id,
                                          cantidad_presentacion, cantidad_base, nota)
    values (v_id, v_prod, v_pres, v_cant_pres, v_cant, v_linea->>'nota');
  end loop;

  return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.despachar_traslado(p_solicitud_id bigint, p_usuario text DEFAULT NULL::text, p_lineas jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_sol solicitud_traslado%rowtype; v_ubic_destino bigint; v_l record;
  v_accion text; v_pedido numeric; v_restante numeric; v_toma numeric; v_ub record;
  v_pres_base bigint; v_total numeric := 0; v_disponible numeric;
  v_bloqueadas jsonb := '[]'::jsonb; v_rechazadas jsonb := '[]'::jsonb;
  v_omitidas jsonb := '[]'::jsonb;   v_parciales jsonb := '[]'::jsonb;
  v_faltante_ids bigint[] := '{}';
  v_tanda_id bigint; v_numero_tanda int; v_nueva_linea_id bigint; v_p jsonb;
begin
  select * into v_sol from solicitud_traslado where id = p_solicitud_id for update;
  if not found then raise exception 'Solicitud % no existe', p_solicitud_id; end if;
  if v_sol.estado <> 'SOLICITADO' then
    raise exception 'La solicitud % está en estado % y no se puede despachar', p_solicitud_id, v_sol.estado;
  end if;
  p_usuario := public.traslado_autorizar(v_sol.sucursal_origen_id,'despachar');
  if p_lineas is not null then
    if jsonb_typeof(p_lineas)<>'array' or jsonb_array_length(p_lineas)=0 then raise exception 'Declara las líneas del despacho.'; end if;
    if exists(select 1 from jsonb_array_elements(p_lineas) x where not exists (
      select 1 from solicitud_traslado_linea l where l.id=(x->>'linea_id')::bigint and l.solicitud_id=p_solicitud_id and l.estado='POR_DESPACHAR')) then
      raise exception 'El despacho contiene líneas ajenas o ya resueltas.';
    end if;
    if exists(select 1 from jsonb_array_elements(p_lineas) x group by x->>'linea_id' having count(*)>1) then raise exception 'Hay líneas repetidas en el despacho.'; end if;
  end if;
  v_ubic_destino := ubicacion_recepcion(v_sol.sucursal_destino_id);
  if v_ubic_destino is null then raise exception 'La sucursal destino % no tiene ubicaciones', v_sol.sucursal_destino_id; end if;

  for v_l in select * from solicitud_traslado_linea
              where solicitud_id = p_solicitud_id and estado = 'POR_DESPACHAR' order by id
  loop
    v_accion := 'DESPACHAR'; v_pedido := v_l.cantidad_base;
    if p_lineas is not null then
      select coalesce(x->>'accion','DESPACHAR'), coalesce((x->>'cantidad_base')::numeric, v_l.cantidad_base)
        into v_accion, v_pedido
        from jsonb_array_elements(p_lineas) x
       where (x->>'linea_id')::bigint = v_l.id
       limit 1;
      if not found then
        -- F1: una línea omitida ya no queda colgada; pasa a la tanda de faltante
        v_faltante_ids := array_append(v_faltante_ids, v_l.id);
        v_omitidas := v_omitidas || jsonb_build_object('linea_id', v_l.id, 'producto_id', v_l.producto_id);
        continue;
      end if;
    end if;

    if v_accion not in ('DESPACHAR','RECHAZAR','FALTANTE') then raise exception 'Acción de despacho no válida.'; end if;
    if v_accion='DESPACHAR' and (v_pedido>v_l.cantidad_base or v_pedido::text in ('NaN','Infinity','-Infinity')) then
      raise exception 'La cantidad de la línea % supera lo solicitado (%).',v_l.id,v_l.cantidad_base;
    end if;
    if v_accion = 'RECHAZAR' then
      update solicitud_traslado_linea set estado = 'RECHAZADO', modificado_por = p_usuario, modificado_en = now() where id = v_l.id;
      v_rechazadas := v_rechazadas || jsonb_build_object('linea_id', v_l.id);
      continue;
    end if;

    if v_accion = 'FALTANTE' then
      v_faltante_ids := array_append(v_faltante_ids, v_l.id);
      continue;
    end if;

    if v_pedido is null or v_pedido <= 0 then
      raise exception 'La línea % necesita una acción (RECHAZAR o FALTANTE) si la cantidad es 0', v_l.id;
    end if;

    select id into v_pres_base from presentacion where producto_id = v_l.producto_id and es_base and coalesce(activo, true) limit 1;
    if v_pres_base is null then raise exception 'Producto % sin presentación base', v_l.producto_id; end if;

    -- F2: mismo criterio que el loop de descuento: solo bins positivos y no excluidos
    select coalesce(sum(sa.cantidad_base), 0) into v_disponible
      from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
     where sa.producto_id = v_l.producto_id
       and u.sucursal_id = v_sol.sucursal_origen_id
       and sa.cantidad_base > 0
       and not coalesce(u.excluye_disponible, false);

    if v_disponible < v_pedido then
      -- F1: la línea bloqueada pasa a la tanda de faltante en vez de quedar colgada
      v_bloqueadas := v_bloqueadas || jsonb_build_object('linea_id', v_l.id, 'producto_id', v_l.producto_id,
        'pedido', v_pedido, 'disponible', v_disponible, 'faltan', v_pedido - v_disponible);
      v_faltante_ids := array_append(v_faltante_ids, v_l.id);
      continue;
    end if;

    v_restante := v_pedido;
    for v_ub in
      select sa.ubicacion_id, sa.cantidad_base
        from stock_actual sa join ubicacion u on u.id = sa.ubicacion_id
       where sa.producto_id = v_l.producto_id
         and u.sucursal_id = v_sol.sucursal_origen_id
         and sa.cantidad_base > 0
         and not coalesce(u.excluye_disponible, false)
       order by sa.cantidad_base desc
    loop
      exit when v_restante <= 0;
      v_toma := least(v_restante, v_ub.cantidad_base);
      perform registrar_traslado(v_pres_base, v_ub.ubicacion_id, v_ubic_destino, v_toma, 'Traslado #' || p_solicitud_id, p_usuario, current_date);
      v_restante := v_restante - v_toma;
    end loop;

    if v_restante > 0 then
      raise exception 'Línea %: quedaron % sin descontar tras recorrer las ubicaciones (inconsistencia de stock)', v_l.id, v_restante;
    end if;

    update solicitud_traslado_linea
       set cantidad_despachada = coalesce(cantidad_despachada,0) + v_pedido, estado = 'DESPACHADA'
     where id = v_l.id;
    v_total := v_total + v_pedido;

    -- F4: el saldo de un despacho parcial va a la tanda de faltante
    if v_pedido < v_l.cantidad_base then
      v_parciales := v_parciales || jsonb_build_object('linea_id', v_l.id, 'producto_id', v_l.producto_id,
        'pedido', v_l.cantidad_base, 'despachado', v_pedido, 'saldo', v_l.cantidad_base - v_pedido);
    end if;
  end loop;

  if coalesce(array_length(v_faltante_ids, 1), 0) > 0 or jsonb_array_length(v_parciales) > 0 then
    v_numero_tanda := coalesce(v_sol.numero_tanda, 1) + 1;
    insert into solicitud_traslado (motivo, sucursal_origen_id, sucursal_destino_id, referencia, nota, solicitado_por, tanda_de_id, numero_tanda)
    values (v_sol.motivo, v_sol.sucursal_origen_id, v_sol.sucursal_destino_id, v_sol.referencia,
            'Faltante de tanda ' || coalesce(v_sol.numero_tanda,1), p_usuario, p_solicitud_id, v_numero_tanda)
    returning id into v_tanda_id;

    for v_l in select * from solicitud_traslado_linea where id = any(v_faltante_ids) loop
      insert into solicitud_traslado_linea (solicitud_id, producto_id, presentacion_id, cantidad_presentacion, cantidad_base, estado)
      values (v_tanda_id, v_l.producto_id, v_l.presentacion_id, v_l.cantidad_presentacion, v_l.cantidad_base, 'POR_DESPACHAR')
      returning id into v_nueva_linea_id;
      update solicitud_traslado_linea set estado = 'CAMBIADA', reemplazada_por_id = v_nueva_linea_id, modificado_por = p_usuario, modificado_en = now() where id = v_l.id;
    end loop;

    for v_p in select * from jsonb_array_elements(v_parciales) loop
      insert into solicitud_traslado_linea (solicitud_id, producto_id, presentacion_id, cantidad_presentacion, cantidad_base, estado, nota)
      values (v_tanda_id, (v_p->>'producto_id')::bigint, null, (v_p->>'saldo')::numeric, (v_p->>'saldo')::numeric, 'POR_DESPACHAR',
              'Saldo de despacho parcial de la línea ' || (v_p->>'linea_id'));
    end loop;
  end if;

  -- Guardia: ninguna línea puede quedar POR_DESPACHAR en la solicitud despachada
  if exists (select 1 from solicitud_traslado_linea where solicitud_id = p_solicitud_id and estado = 'POR_DESPACHAR') then
    raise exception 'La solicitud % quedaría con líneas POR_DESPACHAR sin resolver', p_solicitud_id;
  end if;

  if v_total > 0 then
    update solicitud_traslado set estado = 'EN_TRANSITO', despachado_por = p_usuario, despachado_en = now(),
           reversible_hasta = now() + interval '30 minutes', ubicacion_destino_id = v_ubic_destino
     where id = p_solicitud_id;
  else
    update solicitud_traslado set estado = 'CANCELADO',
           nota = trim(both ' ' from coalesce(nota,'') || ' [cerrado sin envío: todas las líneas rechazadas o movidas a faltante]')
     where id = p_solicitud_id;
  end if;

  return jsonb_build_object(
    'solicitud_id', p_solicitud_id,
    'estado', (select estado from solicitud_traslado where id = p_solicitud_id),
    'cantidad_despachada', v_total,
    'ubicacion_destino_id', v_ubic_destino,
    'rechazadas', v_rechazadas,
    'bloqueadas_por_stock', v_bloqueadas,
    'omitidas', v_omitidas,
    'parciales', v_parciales,
    'tanda_faltante_id', v_tanda_id
  );
end; $function$;

REVOKE ALL ON FUNCTION public.despachar_traslado(bigint,text,jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.despachar_traslado(bigint,text,jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.recibir_traslado(p_solicitud_id bigint, p_usuario text DEFAULT NULL::text, p_lineas jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_sol           solicitud_traslado%rowtype;
  v_ubic_destino  bigint;
  v_l             record;
  v_despachada    numeric;
  v_recibida      numeric;
  v_falta         numeric;
  v_stock_actual  numeric;
  v_faltantes     int   := 0;
  v_detalle       jsonb := '[]'::jsonb;
  v_no_despachadas jsonb;
begin
  select * into v_sol from solicitud_traslado where id = p_solicitud_id for update;
  if not found then
    raise exception 'Solicitud % no existe', p_solicitud_id;
  end if;
  p_usuario := public.traslado_autorizar(v_sol.sucursal_destino_id,'recibir');
  if exists(select 1 from solicitud_traslado_linea where solicitud_id=p_solicitud_id and estado='POR_DESPACHAR') then
    raise exception 'Este traslado conserva líneas antiguas sin salida. Almacén debe recuperar primero esos faltantes.';
  end if;
  if p_lineas is not null then
    if jsonb_typeof(p_lineas)<>'array' then raise exception 'Las cantidades recibidas deben ser una lista.'; end if;
    if exists(select 1 from jsonb_array_elements(p_lineas) x group by x->>'linea_id' having count(*)>1) or
       exists(select 1 from jsonb_array_elements(p_lineas) x where not exists(select 1 from solicitud_traslado_linea l where l.id=(x->>'linea_id')::bigint and l.solicitud_id=p_solicitud_id and l.estado='DESPACHADA') or x->>'cantidad_base' is null) then
      raise exception 'La recepción contiene líneas repetidas, ajenas, no despachadas o sin cantidad.';
    end if;
  end if;
  if v_sol.estado <> 'EN_TRANSITO' then
    raise exception 'La solicitud % está en estado % y no se puede recibir', p_solicitud_id, v_sol.estado;
  end if;

  v_ubic_destino := coalesce(v_sol.ubicacion_destino_id, ubicacion_recepcion(v_sol.sucursal_destino_id));
  if v_ubic_destino is null then
    raise exception 'La sucursal destino % no tiene ubicación de recepción configurada', v_sol.sucursal_destino_id;
  end if;

  -- F3: aviso de líneas que nunca salieron (casos heredados antes de este fix)
  select coalesce(jsonb_agg(jsonb_build_object('linea_id', id, 'producto_id', producto_id, 'cantidad_base', cantidad_base) order by id), '[]'::jsonb)
    into v_no_despachadas
    from solicitud_traslado_linea
   where solicitud_id = p_solicitud_id and estado = 'POR_DESPACHAR';

  -- F3: solo se reciben líneas realmente despachadas
  for v_l in select * from solicitud_traslado_linea
              where solicitud_id = p_solicitud_id and estado = 'DESPACHADA' order by id
  loop
    v_despachada := coalesce(v_l.cantidad_despachada, 0);

    v_recibida := v_despachada;
    if p_lineas is not null then
      select (x->>'cantidad_base')::numeric into v_recibida
        from jsonb_array_elements(p_lineas) x
       where (x->>'linea_id')::bigint = v_l.id;
      v_recibida := coalesce(v_recibida, v_despachada);
    end if;

    if v_recibida < 0 or v_recibida > v_despachada or v_recibida::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Cantidad recibida inválida en la línea % (recibido %, despachado %)', v_l.id, v_recibida, v_despachada;
    end if;

    v_falta := v_despachada - v_recibida;

    if v_falta > 0 then
      -- Mismo candado que registrar_ajuste/registrar_traslado: leer después de adquirirlo.
      perform pg_advisory_xact_lock(hashtextextended(v_l.producto_id::text || ':' || v_ubic_destino::text,0));

      select coalesce(sum(sa.cantidad_base), 0) into v_stock_actual
        from stock_actual sa
       where sa.producto_id = v_l.producto_id and sa.ubicacion_id = v_ubic_destino;

      perform registrar_ajuste(v_l.producto_id, v_ubic_destino, v_stock_actual - v_falta,
                               'Faltante en traslado', 'Traslado #' || p_solicitud_id, p_usuario, current_date);

      v_faltantes := v_faltantes + 1;
      v_detalle := v_detalle || jsonb_build_object(
        'linea_id', v_l.id, 'producto_id', v_l.producto_id, 'despachado', v_despachada,
        'recibido', v_recibida, 'faltante', v_falta, 'ubicacion_id', v_ubic_destino);
    end if;

    update solicitud_traslado_linea set cantidad_recibida = v_recibida where id = v_l.id;
  end loop;

  update solicitud_traslado
     set estado = 'RECIBIDO', recibido_por = p_usuario, recibido_en = now()
   where id = p_solicitud_id;

  return jsonb_build_object(
    'solicitud_id',          p_solicitud_id,
    'estado',                'RECIBIDO',
    'ubicacion_destino_id',  v_ubic_destino,
    'lineas_con_faltante',   v_faltantes,
    'faltantes',             v_detalle,
    'lineas_no_despachadas', v_no_despachadas);
end;
$function$;

REVOKE ALL ON FUNCTION public.recibir_traslado(bigint,text,jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.recibir_traslado(bigint,text,jsonb) TO authenticated, service_role;

create or replace function public.recuperar_faltantes_traslado(p_solicitud_id bigint,p_usuario text default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s solicitud_traslado%rowtype; l solicitud_traslado_linea%rowtype; tanda bigint; nueva bigint; total integer:=0;
begin
  select * into s from solicitud_traslado where id=p_solicitud_id for update;
  if not found then raise exception 'No se encontró el traslado.'; end if;
  p_usuario:=public.traslado_autorizar(s.sucursal_origen_id,'recuperar');
  if s.estado not in ('EN_TRANSITO','RECIBIDO') then raise exception 'Sólo se recuperan faltantes de un traslado ya despachado.'; end if;
  for l in select * from solicitud_traslado_linea where solicitud_id=s.id and estado='POR_DESPACHAR' order by id for update loop
    if coalesce(l.cantidad_despachada,0)<>0 then raise exception 'La línea % tiene una salida registrada; requiere conciliación manual.',l.id; end if;
    if tanda is null then
      insert into solicitud_traslado(motivo,sucursal_origen_id,sucursal_destino_id,referencia,nota,solicitado_por,tanda_de_id,numero_tanda)
      values(s.motivo,s.sucursal_origen_id,s.sucursal_destino_id,s.referencia,'Recuperación de líneas sin salida de '||coalesce(s.numero,'#'||s.id),p_usuario,s.id,coalesce(s.numero_tanda,1)+1) returning id into tanda;
    end if;
    insert into solicitud_traslado_linea(solicitud_id,producto_id,presentacion_id,cantidad_presentacion,cantidad_base,estado,nota)
    values(tanda,l.producto_id,l.presentacion_id,l.cantidad_presentacion,l.cantidad_base,'POR_DESPACHAR','Recuperada de la línea '||l.id||' · '||coalesce(l.nota,'')) returning id into nueva;
    update solicitud_traslado_linea set estado='CAMBIADA',reemplazada_por_id=nueva,modificado_por=p_usuario,modificado_en=now() where id=l.id;
    total:=total+1;
  end loop;
  return jsonb_build_object('solicitud_id',s.id,'tanda_faltante_id',tanda,'recuperadas',total,'stock_modificado',false);
end $$;
revoke all on function public.recuperar_faltantes_traslado(bigint,text) from public,anon;
grant execute on function public.recuperar_faltantes_traslado(bigint,text) to authenticated;
revoke all on function public.crear_solicitud_traslado(motivo_traslado,jsonb,text,bigint,bigint,text,text) from public,anon;
grant execute on function public.crear_solicitud_traslado(motivo_traslado,jsonb,text,bigint,bigint,text,text) to authenticated,service_role;
