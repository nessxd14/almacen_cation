-- QA transaccional: usa un pedido abierto como fuente, no deja cambios.
-- Ejecutar como postgres con execute_sql. Todo se revierte al terminar.
begin;
set local statement_timeout = '15s';
do $$
declare
  v_uid uuid; v_otro uuid; v_sid bigint; v_pid bigint; v_lid bigint;
  v_tarea bigint; v_version integer; v_result jsonb; v_l jsonb;
  v_q numeric; v_preparada numeric; v_count integer := 0;
  v_stock text; v_stock_despues text; v_sucursal_anterior bigint; v_otra_sucursal bigint;
begin
  select id,sucursal_id into v_uid,v_sucursal_anterior from public.perfil where activo and rol='admin' order by sucursal_id nulls first limit 1;
  assert v_uid is not null, 'QA necesita un administrador activo';
  select id into v_sid from public.sucursal where activo and tipo='fisica' and (v_sucursal_anterior is null or id=v_sucursal_anterior) order by id limit 1;
  select p.id into v_pid from public.pedido p join lateral (
    select count(*) as n, max((datos->>'pendiente_base')::numeric) as mayor
      from almacen_operaciones.lineas_actuales(p.id,v_sid) where (datos->>'preparable')::boolean
  ) l on true where p.estado='ABIERTO' and l.n between 1 and 10 and l.mayor>=2
    and not exists(select 1 from public.almacen_preparacion where pedido_id=p.id)
    order by p.id desc limit 1;
  assert v_pid is not null, 'QA necesita un pedido abierto sin preparación';
  select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.producto_id,s.ubicacion_id)::text,'')) into v_stock from public.stock_actual s;
  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,null,'crear');
  v_tarea := (v_result->'tarea'->>'id')::bigint;
  v_version := (v_result->'tarea'->>'version')::integer;
  assert v_result->'tarea'->>'preparador_id'=v_uid::text, 'Responsable real de sesión';
  assert (public.operar_preparacion_pedido(v_pid,v_sid,null,'crear')->'tarea'->>'id')::bigint=v_tarea, 'Crear es idempotente';
  select linea_id,(datos->>'pendiente_base')::numeric into v_lid,v_q from almacen_operaciones.lineas_actuales(v_pid,v_sid) where (datos->>'preparable')::boolean and (datos->>'pendiente_base')::numeric>=2 limit 1;
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'preparado',v_version);
    raise exception 'QA sin bloqueo';
  exception when others then assert position('Confirma todas las líneas' in sqlerrm)>0, sqlerrm; end;
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'guardar_preparacion',v_version,jsonb_build_object('linea_id',v_lid,'cantidad_base',v_q+1));
    raise exception 'QA sin bloqueo';
  exception when others then assert position('supera lo pendiente' in sqlerrm)>0, sqlerrm; end;
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'guardar_preparacion',v_version,jsonb_build_object('linea_id',v_lid,'cantidad_base',1));
    raise exception 'QA sin bloqueo';
  exception when others then assert position('Indica el motivo' in sqlerrm)>0, sqlerrm; end;
  v_preparada := round(v_q/2,6);
  for v_l in select value from jsonb_array_elements(v_result->'lineas') loop
    v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'guardar_preparacion',v_version,
      jsonb_build_object('linea_id',v_l->>'pedido_linea_id','cantidad_base',case when (v_l->>'pedido_linea_id')::bigint=v_lid then v_preparada else 0 end,'observacion','QA entrega parcial'));
    v_version := (v_result->'tarea'->>'version')::integer;
    v_count := v_count+1;
  end loop;
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'preparado',v_version-1);
    raise exception 'QA sin bloqueo';
  exception when others then assert position('otro celular' in sqlerrm)>0, sqlerrm; end;
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'preparado',v_version);
  v_version := (v_result->'tarea'->>'version')::integer;
  -- Revisión por otra persona, si existe un segundo encargado autorizado.
  select id into v_otro from public.perfil where id<>v_uid and activo and rol in ('admin','gerente','almacenero','operario') and (sucursal_id is null or sucursal_id=v_sid) limit 1;
  assert v_otro is not null, 'QA necesita dos personas distintas autorizadas en la sucursal';
  perform set_config('request.jwt.claim.sub',v_otro::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_otro,'role','authenticated')::text,true);
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'tomar_revision',v_version);
  v_version := (v_result->'tarea'->>'version')::integer;
  assert v_result->'tarea'->>'revisor_id'=v_otro::text, 'Revisor real de sesión';
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'verificado',v_version);
    raise exception 'QA sin bloqueo';
  exception when others then assert position('Faltan productos' in sqlerrm)>0, sqlerrm; end;
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'guardar_revision',v_version,jsonb_build_object('linea_id',v_lid,'cantidad_base',v_preparada+1,'metodo','visual'));
    raise exception 'QA sin bloqueo';
  exception when others then assert position('no coincide' in sqlerrm)>0, sqlerrm; end;
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'guardar_revision',v_version,jsonb_build_object('linea_id',v_lid,'cantidad_base',v_preparada,'metodo','escaneo','codigo','https://qa.invalid/productos/9000000000000/ficha'));
    raise exception 'QA sin bloqueo';
  exception when others then assert position('otro producto' in sqlerrm)>0, sqlerrm; end;
  select value into v_l from jsonb_array_elements(v_result->'lineas') where (value->>'pedido_linea_id')::bigint=v_lid;
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'guardar_revision',v_version,jsonb_build_object('linea_id',v_lid,'cantidad_base',v_preparada,'metodo','escaneo','codigo','https://qa.invalid/productos/'||(v_l->'snapshot'->>'producto_id')||'/ficha?sucursal='||(v_sid+1000000)));
    raise exception 'QA sin bloqueo';
  exception when others then assert position('otra sucursal' in sqlerrm)>0, sqlerrm; end;
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'guardar_revision',v_version,jsonb_build_object('linea_id',v_lid,'cantidad_base',v_preparada,'metodo','escaneo','codigo','https://qa.invalid/productos/'||(v_l->'snapshot'->>'producto_id')||'/ficha'));
  v_version := (v_result->'tarea'->>'version')::integer;
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'verificado',v_version);
  v_version := (v_result->'tarea'->>'version')::integer;
  assert v_result->'tarea'->>'estado'='VERIFICADO', 'Entrega parcial verificada';
  select md5(coalesce(jsonb_agg(to_jsonb(s) order by s.producto_id,s.ubicacion_id)::text,'')) into v_stock_despues from public.stock_actual s;
  assert v_stock=v_stock_despues, 'El checklist no modifica stock';
  -- Cambios de Seller bloquean finalizar; sincronizar conserva otras líneas.
  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'reabrir',v_version,jsonb_build_object('observacion','QA corrección'));
  v_version := (v_result->'tarea'->>'version')::integer;
  update public.pedido_linea set cantidad_base=cantidad_base+1 where id=v_lid;
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'preparado',v_version);
    raise exception 'QA sin bloqueo';
  exception when others then assert position('El pedido cambió' in sqlerrm)>0, sqlerrm; end;
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'sincronizar',v_version);
  assert jsonb_array_length(v_result->'cambios')=0, 'Sincronización';
  select value into v_l from jsonb_array_elements(v_result->'lineas') where (value->>'pedido_linea_id')::bigint=v_lid;
  assert not (v_l->>'confirmada')::boolean and (v_l->>'preparada_base')::numeric=0, 'Se reinicia la línea cambiada';
  assert (select count(*) from public.almacen_preparacion_linea where preparacion_id=v_tarea and confirmada)=v_count-1, 'Se conservan líneas sin cambios';
  -- Una nueva entrega parte del pendiente real y no hereda "ya despachada".
  v_version := (v_result->'tarea'->>'version')::integer;
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'guardar_preparacion',v_version,jsonb_build_object('linea_id',v_lid,'cantidad_base',v_preparada,'observacion','QA nueva entrega'));
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'preparado',(v_result->'tarea'->>'version')::integer);
  perform set_config('request.jwt.claim.sub',v_otro::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_otro,'role','authenticated')::text,true);
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'escanear');
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'guardar_revision',(v_result->'tarea'->>'version')::integer,jsonb_build_object('linea_id',v_lid,'cantidad_base',v_preparada,'metodo','visual'));
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'verificado',(v_result->'tarea'->>'version')::integer);
  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'role','authenticated')::text,true);
  update public.pedido_linea set cantidad_despachada=cantidad_despachada+v_preparada where id=v_lid;
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'crear');
  assert not (v_result->>'entregada')::boolean, 'Nueva entrega sin estado de despacho anterior';
  assert (select estado from public.almacen_preparacion where id=v_tarea)='DESPACHADO', 'Historial del despacho anterior';
  assert (v_result->'tarea'->>'id')::bigint<>v_tarea, 'Nueva preparación';
  v_tarea := (v_result->'tarea'->>'id')::bigint;
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'anular',(v_result->'tarea'->>'version')::integer,jsonb_build_object('observacion','QA anulación'));
  v_result := public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'crear');
  assert v_result->'tarea'->>'estado'='PREPARANDO' and (v_result->'tarea'->>'id')::bigint<>v_tarea, 'Nueva preparación después de anular';
  v_tarea := (v_result->'tarea'->>'id')::bigint;
  -- Restricción de sucursal y de perfil, con cambios invisibles fuera de esta transacción.
  select id into v_otra_sucursal from public.sucursal where activo and tipo='fisica' and id<>v_sid limit 1;
  if v_otra_sucursal is not null then
    update public.perfil set sucursal_id=v_otra_sucursal where id=v_uid;
    begin
      perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'consultar');
      raise exception 'QA sin bloqueo';
    exception when others then assert position('autorizada' in sqlerrm)>0, sqlerrm; end;
    execute 'set local role authenticated';
    assert (select count(*) from public.almacen_preparacion where id=v_tarea)=0, 'RLS oculta otras sucursales';
    assert (select count(*) from public.almacen_preparacion_linea where preparacion_id=v_tarea)=0, 'RLS de líneas';
    assert (select count(*) from public.almacen_preparacion_evento where preparacion_id=v_tarea)=0, 'RLS de historial';
    execute 'reset role';
    update public.perfil set sucursal_id=v_sucursal_anterior where id=v_uid;
  end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin
    perform public.operar_preparacion_pedido(v_pid,v_sid,v_tarea,'consultar');
    raise exception 'QA sin bloqueo';
  exception when others then assert position('perfil no tiene acceso' in sqlerrm)>0, sqlerrm; end;
  assert not has_function_privilege('anon','public.operar_preparacion_pedido(bigint,bigint,bigint,text,integer,jsonb)','EXECUTE'), 'Anónimo sin acceso RPC';
  assert not has_function_privilege('anon','almacen_operaciones.operar(bigint,bigint,bigint,text,integer,jsonb)','EXECUTE'), 'Motor sin acceso anónimo';
  assert not has_table_privilege('authenticated','public.almacen_preparacion','INSERT'), 'Sin escritura directa';
  perform set_config('qa.resultado','Cantidades, parcial, versión, QR, cambios Seller, responsables, stock intacto y RLS: correctos. Transacción revertida.',true);
end $$;
select current_setting('qa.resultado') as validacion;
rollback;
