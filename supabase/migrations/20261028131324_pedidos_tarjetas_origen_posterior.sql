-- Nuevas tandas: declaración física, verificación independiente y origen posterior.
-- Los circuitos anteriores conservan su contrato y su historial.
alter table public.almacen_preparacion
  add column modo_flexible boolean not null default false,
  add column origenes_pendientes integer not null default 0;
alter table public.almacen_preparacion_linea
  add column incidencia_pendiente boolean not null default false,
  add column reemplazo jsonb,
  add column origenes_declarados jsonb,
  add column origen_aplicado boolean not null default false,
  add column despacho_evento_id bigint references public.pedido_despacho_evento(id);

create function almacen_operaciones.activar_flexible() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.modo_flexible:=new.modo_abastecimiento and coalesce((select activo and pedidos_dos_actores from evidencia_operacion.configuracion where id),false);
  return new;
end $$;
revoke all on function almacen_operaciones.activar_flexible() from public,anon,authenticated;
-- Se ejecuta después de los triggers que determinan ambos modos.
create trigger zz_preparacion_flexible before insert on public.almacen_preparacion
for each row execute function almacen_operaciones.activar_flexible();

create function almacen_operaciones.cantidad_fisica(p_linea public.almacen_preparacion_linea) returns numeric
language sql immutable set search_path='' as $$
  select coalesce(p_linea.revisada_base,p_linea.preparada_base)*coalesce((p_linea.reemplazo->>'factor')::numeric,1)
$$;
revoke all on function almacen_operaciones.cantidad_fisica(public.almacen_preparacion_linea) from public,anon,authenticated;

-- Aplica exactamente una vez la parte de Almacén. Puede quedar negativa.
-- Tienda y compra son procedencias del pedido, sin entradas ficticias de catálogo.
create function almacen_operaciones.aplicar_origen_flexible(p_tarea bigint,p_linea bigint) returns void
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare t public.almacen_preparacion%rowtype;l public.almacen_preparacion_linea%rowtype;
  x jsonb;producto bigint;pres bigint;k bigint;indice integer:=0;
begin
  select * into t from public.almacen_preparacion where id=p_tarea;
  select * into l from public.almacen_preparacion_linea where preparacion_id=p_tarea and pedido_linea_id=p_linea for update;
  if not t.modo_flexible or t.estado<>'DESPACHADO' or l.origen_aplicado or l.despacho_evento_id is null or l.origenes_declarados is null then return;end if;
  if exists(select 1 from public.pedido_despacho_evento where id=l.despacho_evento_id and revertido) then raise exception 'La salida fue corregida; revisa el origen con un encargado.';end if;
  if (select coalesce(sum((o->>'cantidad_base')::numeric),0) from jsonb_array_elements(l.origenes_declarados)o)<>almacen_operaciones.cantidad_fisica(l) then return;end if;
  producto:=coalesce((l.reemplazo->>'producto_id')::bigint,(l.snapshot->>'producto_id')::bigint);
  for x in select * from jsonb_array_elements(l.origenes_declarados) loop
    indice:=indice+1;
    if x->>'tipo'='ALMACEN' and producto is not null then
      select id into pres from public.presentacion where producto_id=producto and activo and es_base and factor_unidad_base=1 order by id limit 1;
      if pres is null then raise exception 'El producto necesita una presentación base activa para descontar Almacén.';end if;
      k:=public.registrar_salida(pres,(x->>'ubicacion_id')::bigint,(x->>'cantidad_base')::numeric,
        'Pedido '||t.pedido_id||' · tanda '||t.id||' · origen declarado',t.preparador_nombre::varchar,
        coalesce((select (retirado_en at time zone 'America/La_Paz')::date from evidencia_operacion.retiro where preparacion_id=t.id),(now() at time zone 'America/La_Paz')::date),
        'pedido-flexible:'||t.id||':'||p_linea||':'||indice,true);
      insert into public.pedido_despacho_movimiento(evento_id,kardex_transaccion_id,ubicacion_id,cantidad_base)
        values(l.despacho_evento_id,k,(x->>'ubicacion_id')::bigint,(x->>'cantidad_base')::numeric);
    end if;
  end loop;
  update public.pedido_despacho_evento set abastecimiento_origenes=l.origenes_declarados where id=l.despacho_evento_id;
  update public.almacen_preparacion_linea set origen_aplicado=true where preparacion_id=p_tarea and pedido_linea_id=p_linea;
end $$;
revoke all on function almacen_operaciones.aplicar_origen_flexible(bigint,bigint) from public,anon,authenticated;

create function almacen_operaciones.enriquecer_flexible(p_resultado jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=p_resultado;t public.almacen_preparacion%rowtype;ls jsonb;plan jsonb;pendientes jsonb;
begin
  select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
  if not coalesce(t.modo_flexible,false) then return r;end if;
  select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('snapshot',l.snapshot||jsonb_build_object('imagen_url',p.imagen_url),
    'compras',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'estado',c.estado,'cantidad_base',c.cantidad_base,'cantidad_recibida',c.cantidad_recibida)) from public.compra_solicitud c where c.pedido_linea_id=l.pedido_linea_id),'[]')) order by l.pedido_linea_id),'[]')
    into ls from public.almacen_preparacion_linea l left join public.producto p on p.id=(l.snapshot->>'producto_id')::bigint where l.preparacion_id=t.id;
  select coalesce(jsonb_agg(jsonb_build_object('linea_id',l.pedido_linea_id,'cantidad_base',l.revisada_base,'asignaciones','[]'::jsonb,
    'origenes',coalesce(l.origenes_declarados,'[]'),'declaracion_fisica',true,'error',null) order by l.pedido_linea_id),'[]') into plan
    from public.almacen_preparacion_linea l where preparacion_id=t.id and vigente and revisada_base>0;
  select coalesce(jsonb_agg(jsonb_build_object('linea_id',l.pedido_linea_id,'nombre',coalesce(l.reemplazo->>'nombre',l.snapshot->>'nombre'),
    'cantidad_base',almacen_operaciones.cantidad_fisica(l),'unidad_base',coalesce(l.reemplazo->>'unidad_base',l.snapshot->>'unidad_base'),
    'producto_id',coalesce((l.reemplazo->>'producto_id')::bigint,(l.snapshot->>'producto_id')::bigint),
    'origenes',l.origenes_declarados) order by l.pedido_linea_id),'[]') into pendientes
    from public.almacen_preparacion_linea l where preparacion_id=t.id and vigente and almacen_operaciones.cantidad_fisica(l)>0
      and (l.origenes_declarados is null or (select coalesce(sum((o->>'cantidad_base')::numeric),0) from jsonb_array_elements(l.origenes_declarados)o)<>almacen_operaciones.cantidad_fisica(l));
  return r||jsonb_build_object('pedido_flexible',true,'lineas',ls,'bloqueos_despacho','[]'::jsonb,'plan_salida',coalesce(r->'retiro'->'asignaciones',plan),
    'origenes_pendientes',case when t.estado in ('PREPARANDO','ANULADO') then '[]'::jsonb else pendientes end,
    'puede_declarar_origen',t.preparador_id=auth.uid() and t.estado in ('PREPARADO','REVISANDO','VERIFICADO','DESPACHADO'));
end $$;
revoke all on function almacen_operaciones.enriquecer_flexible(jsonb) from public,anon,authenticated;

create function almacen_operaciones.operar_flexible(p_pedido bigint,p_sucursal bigint,p_tarea bigint,p_accion text,p_version integer,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb;t public.almacen_preparacion%rowtype;a public.perfil%rowtype;l public.almacen_preparacion_linea%rowtype;
  pl public.pedido_linea%rowtype;e evidencia_operacion.lote%rowtype;retiro evidencia_operacion.retiro%rowtype;
  q numeric;fisica numeric;nota text;tipo text;x jsonb;origenes jsonb;suma numeric;producto public.producto%rowtype;
  cambio jsonb;plan jsonb;eid bigint;sol public.compra_solicitud%rowtype;pendientes integer;confirmacion jsonb;
begin
  -- Este punto autentica, valida sucursal y toma pedido/líneas/tanda en orden.
  r:=almacen_operaciones.operar_abastecimiento(p_pedido,p_sucursal,p_tarea,'consultar',null,'{}');
  if p_accion in ('crear','escanear') then
    r:=almacen_operaciones.operar_abastecimiento(p_pedido,p_sucursal,p_tarea,p_accion,p_version,p_datos);
    return almacen_operaciones.enriquecer_flexible(r);
  end if;
  select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
  if not coalesce(t.modo_flexible,false) then
    return almacen_operaciones.operar_abastecimiento(p_pedido,p_sucursal,p_tarea,p_accion,p_version,p_datos);
  end if;
  select * into a from public.perfil where id=auth.uid() and activo;
  if p_accion is null or p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>100000 then raise exception 'Datos inválidos.';end if;
  if p_accion='consultar' then return almacen_operaciones.enriquecer_flexible(r);end if;
  -- Recuperación exacta de confirmaciones con respuesta perdida.
  if p_accion='preparado' then
    select * into e from evidencia_operacion.lote where id=(p_datos->>'evidencia_id')::uuid;
    if e.estado<>'BORRADOR' and e.tipo='PEDIDO' and e.etapa='PREPARACION' and e.preparacion_id=t.id and e.actor_id=a.id and e.version=p_version then return almacen_operaciones.enriquecer_flexible(r);end if;
  elsif p_accion='confirmar_retiro' then
    select * into retiro from evidencia_operacion.retiro where preparacion_id=t.id;
    if found then
      if retiro.transportista_id=a.id and retiro.evidencia_id=(p_datos->>'evidencia_id')::uuid and retiro.destino=btrim(p_datos->>'destino') and retiro.asignaciones=p_datos->'plan' then return almacen_operaciones.enriquecer_flexible(r);end if;
      raise exception 'La tanda ya tiene otro retiro confirmado.';
    end if;
  elsif p_accion='declarar_origen' then
    select * into l from public.almacen_preparacion_linea where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint and vigente;
    if t.estado in ('PREPARADO','REVISANDO','VERIFICADO','DESPACHADO') and t.preparador_id=a.id and l.origenes_declarados=p_datos->'origenes' then return almacen_operaciones.enriquecer_flexible(r);end if;
  end if;
  if p_version is distinct from t.version then raise exception 'La tanda cambió. Actualiza antes de guardar.' using errcode='40001';end if;
  if r->'pedido'->>'estado'<>'ABIERTO' and p_accion not in ('declarar_origen','anular') then raise exception 'El pedido está cancelado o completado; no puedes modificar su entrega.';end if;
  if p_accion<>'declarar_origen' and jsonb_array_length(r->'cambios')>0 and p_accion not in ('sincronizar','reabrir','devolver','reasignar','anular') then raise exception 'El pedido cambió. Actualiza la tanda.' using errcode='40001';end if;
  if p_accion in ('guardar_preparacion','registrar_incidencia','gestionar_compra','recibir_compra_tarjeta','reemplazar_material') then
    if t.estado<>'PREPARANDO' or t.preparador_id is distinct from a.id then raise exception 'Sólo el alistador asignado puede cambiar esta preparación.' using errcode='42501';end if;
  elsif p_accion='guardar_revision' then
    if t.estado<>'REVISANDO' or t.revisor_id is distinct from a.id or t.preparador_id=a.id then raise exception 'Sólo el verificador asignado puede comprobar la salida.' using errcode='42501';end if;
  end if;
  if p_accion in ('guardar_preparacion','registrar_incidencia','guardar_revision','gestionar_compra','recibir_compra_tarjeta','reemplazar_material','declarar_origen') then
    select * into l from public.almacen_preparacion_linea where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint and vigente for update;
    if not found then raise exception 'La línea no pertenece a esta tanda.';end if;
    select * into pl from public.pedido_linea where id=l.pedido_linea_id;
  end if;
  if p_accion in ('guardar_preparacion','registrar_incidencia','guardar_revision','gestionar_compra','recibir_compra_tarjeta','reemplazar_material') then
    if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' then raise exception 'Cantidad inválida.';end if;
    q:=(p_datos->>'cantidad_base')::numeric;nota:=btrim(coalesce(p_datos->>'observacion',''));
    if q>1e12 or q>pl.cantidad_base-pl.cantidad_despachada or length(nota)>1000 then raise exception 'La cantidad supera lo pendiente del pedido o la nota es demasiado larga.';end if;
    if p_accion='registrar_incidencia' or p_accion='guardar_preparacion' and q<pl.cantidad_base-pl.cantidad_despachada or p_accion='guardar_revision' and q<>l.preparada_base then
      if nota='' then raise exception 'Indica el motivo de la diferencia.';end if;
    end if;
  end if;
  if p_accion in ('guardar_preparacion','registrar_incidencia','recibir_compra_tarjeta','reemplazar_material') then
    if p_accion='reemplazar_material' then
      select * into producto from public.producto where id=(p_datos->>'producto_id')::bigint and activo;
      if producto.id is null or q<=0 or coalesce(p_datos->>'factor','') !~ '^\d+(\.\d{1,6})?$' or (p_datos->>'factor')::numeric<=0 or (p_datos->>'factor')::numeric>1e6 then raise exception 'Selecciona un producto y una equivalencia positiva válida.';end if;
      cambio:=jsonb_build_object('producto_id',producto.id,'nombre',producto.nombre,'sku',producto.sku_interno,'imagen_url',producto.imagen_url,'unidad_base',producto.unidad_base,'factor',(p_datos->>'factor')::numeric);
      update public.almacen_preparacion_linea set reemplazo=cambio where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
      update public.pedido set alerta_lineas_en=now() where id=p_pedido;
      insert into public.pedido_evento(pedido_id,pedido_linea_id,accion,motivo,usuario) values(p_pedido,l.pedido_linea_id,'REEMPLAZO_MATERIAL',l.snapshot->>'nombre'||' → '||producto.nombre||' · '||q||' unidades solicitadas · equivalencia '||(p_datos->>'factor')||' · '||nota,a.nombre);
    elsif p_accion='recibir_compra_tarjeta' then
      if q<=0 or length(btrim(coalesce(p_datos->>'referencia',''))) not between 1 and 200 then raise exception 'Indica la cantidad recibida y el proveedor.';end if;
      if nullif(p_datos->>'costo','') is not null and ((p_datos->>'costo') !~ '^\d+(\.\d{1,6})?$' or (p_datos->>'costo')::numeric>1e12) then raise exception 'Costo inválido.';end if;
      -- Es recepción física explícita; el origen mixto se declara después de enviar.
      select * into sol from public.compra_solicitud where pedido_linea_id=pl.id and estado in ('SOLICITADA','COMPRADA') for update;
      if sol.id is not null then raise exception 'Esta línea ya tiene una compra gestionada. Registra su recepción desde Compras para conservar su seguimiento.';end if;
    end if;
    fisica:=q*coalesce((cambio->>'factor')::numeric,(l.reemplazo->>'factor')::numeric,1);
    if fisica>1e12 or scale(trim_scale(fisica))>6 then raise exception 'La equivalencia debe dar una cantidad física exacta con hasta seis decimales.';end if;
    tipo:=case when q<pl.cantidad_base-pl.cantidad_despachada then coalesce(p_datos->>'pendiente_tipo','POR_COMPLETAR') end;
    if tipo is not null and tipo not in ('POR_COMPLETAR','TIENDA','COMPRA_RAPIDA','COMPRA_GESTIONADA') then raise exception 'Situación pendiente inválida.';end if;
    update public.almacen_preparacion_linea set preparada_base=q,confirmada=p_accion<>'registrar_incidencia',incidencia_pendiente=p_accion='registrar_incidencia',
      observacion=nota,pendiente_tipo=tipo,revisada_base=null,revisada_en=null,revisor_id=null,revisor_nombre=null,metodo_revision=null,codigo_leido=null,
      origenes_declarados=null where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
  elsif p_accion='gestionar_compra' then
    if q<=0 then raise exception 'Indica una cantidad positiva para comprar.';end if;
    select * into sol from public.compra_solicitud where pedido_linea_id=pl.id and estado in ('SOLICITADA','COMPRADA') for update;
    if sol.estado='COMPRADA' then raise exception 'La compra ya está comprometida. Consulta su gestión en Compras.';end if;
    if sol.id is not null then
      update public.compra_solicitud set cantidad_base=cantidad_recibida+q,motivo=nota where id=sol.id;
    else
      insert into public.compra_solicitud(pedido_linea_id,producto_id,descripcion,cantidad_base,origen,motivo,solicitado_por)
        values(pl.id,pl.producto_id,coalesce(pl.descripcion,l.snapshot->>'nombre'),q,case when pl.es_personalizado then 'PERSONALIZADO' else 'ALMACEN' end,nota,a.nombre);
    end if;
    -- Comprar el faltante conserva lo que sí se alistó y los importes de la venta.
    if q>pl.cantidad_base-pl.cantidad_despachada-l.preparada_base then raise exception 'La compra supera el faltante físico de esta tanda.';end if;
    update public.almacen_preparacion_linea set confirmada=true,incidencia_pendiente=false,pendiente_tipo='COMPRA_GESTIONADA',observacion=coalesce(nullif(nota,''),'Pendiente de compra gestionada') where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
  elsif p_accion='guardar_revision' then
    fisica:=q*coalesce((l.reemplazo->>'factor')::numeric,1);
    if fisica>1e12 or scale(trim_scale(fisica))>6 then raise exception 'Cantidad física de reemplazo inválida.';end if;
    update public.almacen_preparacion_linea set revisada_base=q,metodo_revision='visual',codigo_leido=null,revisada_en=now(),revisor_id=a.id,revisor_nombre=a.nombre,
      observacion_revision=nota where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
  elsif p_accion='declarar_origen' then
    if t.preparador_id is distinct from a.id or t.estado not in ('PREPARADO','REVISANDO','VERIFICADO','DESPACHADO') then raise exception 'El alistador declara el origen después de enviar a verificación.' using errcode='42501';end if;
    if l.origen_aplicado then raise exception 'Este origen ya se aplicó al inventario. Un encargado debe gestionar su corrección.';end if;
    origenes:=p_datos->'origenes';suma:=0;fisica:=almacen_operaciones.cantidad_fisica(l);
    if jsonb_typeof(origenes) is distinct from 'array' or jsonb_array_length(origenes) not between 1 and 50 or fisica<=0 then raise exception 'Declara de dónde viene el material de esta tanda.';end if;
    for x in select * from jsonb_array_elements(origenes) loop
      tipo:=x->>'tipo';
      if coalesce(tipo,'') not in ('ALMACEN','TIENDA','COMPRA_RAPIDA') or coalesce(x->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' or (x->>'cantidad_base')::numeric<=0 then raise exception 'Origen o cantidad inválida.';end if;
      suma:=suma+(x->>'cantidad_base')::numeric;
      if tipo='ALMACEN' and coalesce(l.reemplazo->>'producto_id',l.snapshot->>'producto_id') is not null and not exists(select 1 from public.ubicacion where id=(x->>'ubicacion_id')::bigint and sucursal_id=t.sucursal_id and not coalesce(excluye_disponible,false)) then raise exception 'Selecciona la ubicación de Almacén.';end if;
      if tipo='TIENDA' and not exists(select 1 from public.sucursal s where s.id=(x->>'sucursal_tienda_id')::bigint and s.activo and s.tipo='fisica' and s.id<>t.sucursal_id) then raise exception 'Selecciona la Tienda de origen.';end if;
      if tipo='COMPRA_RAPIDA' and length(btrim(coalesce(x->>'referencia',''))) not between 1 and 200 then raise exception 'Indica el proveedor de la compra.';end if;
      if nullif(x->>'costo','') is not null and ((x->>'costo') !~ '^\d+(\.\d{1,6})?$' or (x->>'costo')::numeric>1e12) then raise exception 'Costo inválido.';end if;
    end loop;
    if suma<>fisica then raise exception 'Los tres orígenes deben sumar la cantidad física de esta tanda (%).',fisica;end if;
    update public.almacen_preparacion_linea set origenes_declarados=origenes where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
    perform almacen_operaciones.aplicar_origen_flexible(t.id,l.pedido_linea_id);
  elsif p_accion='preparado' then
    if t.preparador_id is distinct from a.id or t.estado<>'PREPARANDO' then raise exception 'Sólo el alistador puede enviar esta tanda.' using errcode='42501';end if;
    if exists(select 1 from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and (not confirmada or incidencia_pendiente)) or not exists(select 1 from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and preparada_base>0) then raise exception 'Resuelve los pendientes y confirma al menos un producto alistado.';end if;
    e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,'PEDIDO',p_pedido,t.id,t.version);
    if e.etapa<>'PREPARACION' then raise exception 'Adjunta las fotos del alistado.';end if;
    update public.almacen_preparacion set estado='PREPARADO',preparado_en=now() where id=t.id;
    perform evidencia_operacion.encolar_pedido(e.id,t.id);
  elsif p_accion='confirmar_retiro' then
    if t.estado not in ('REVISANDO','VERIFICADO') or t.revisor_id is distinct from a.id or t.preparador_id=a.id then raise exception 'Sólo la segunda persona asignada puede verificar y retirar.' using errcode='42501';end if;
    if exists(select 1 from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and revisada_base is null) then raise exception 'Comprueba la cantidad que sale de cada producto, incluso los que quedan en cero.';end if;
    if not exists(select 1 from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and revisada_base>0) then raise exception 'No hay material para retirar.';end if;
    nota:=btrim(coalesce(p_datos->>'destino',''));
    if length(nota) not between 3 and 300 then raise exception 'Indica el destino de la entrega.';end if;
    e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,'PEDIDO',p_pedido,t.id,t.version);
    if e.etapa<>'SALIDA' then raise exception 'Adjunta las fotos de la salida.';end if;
    plan:=almacen_operaciones.enriquecer_flexible(r)->'plan_salida';
    if plan is distinct from p_datos->'plan' then raise exception 'La salida cambió. Actualiza la tanda.' using errcode='40001';end if;
    insert into evidencia_operacion.despacho_autorizado values(t.id,txid_current());
    for l in select * from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and revisada_base>0 order by pedido_linea_id loop
      select * into pl from public.pedido_linea where id=l.pedido_linea_id;
      if l.revisada_base>pl.cantidad_base-pl.cantidad_despachada then raise exception 'La salida supera lo pendiente del producto.';end if;
      insert into public.pedido_despacho_evento(pedido_linea_id,cantidad_base,creado_por,abastecimiento_origenes)
        values(pl.id,l.revisada_base,a.nombre,jsonb_build_array(jsonb_build_object('tipo','POR_DECLARAR','cantidad_base',l.revisada_base))) returning id into eid;
      update public.almacen_preparacion_linea set despacho_evento_id=eid where preparacion_id=t.id and pedido_linea_id=pl.id;
      update public.pedido_linea set cantidad_despachada=cantidad_despachada+l.revisada_base,
        estado=case when cantidad_despachada+l.revisada_base>=cantidad_base then 'DESPACHADA'::public.estado_linea when es_personalizado then 'ESPECIAL'::public.estado_linea else 'PENDIENTE'::public.estado_linea end,
        modificado_por=a.nombre,modificado_en=now() where id=pl.id;
    end loop;
    delete from evidencia_operacion.despacho_autorizado where preparacion_id=t.id;
    update public.almacen_preparacion set estado='DESPACHADO',verificado_en=now() where id=t.id;
    insert into evidencia_operacion.retiro(preparacion_id,transportista_id,transportista_nombre,destino,evidencia_id,asignaciones) values(t.id,a.id,a.nombre,nota,e.id,plan);
    for l in select * from public.almacen_preparacion_linea where preparacion_id=t.id and vigente loop perform almacen_operaciones.aplicar_origen_flexible(t.id,l.pedido_linea_id);end loop;
    perform public.recalcular_estado_pedido(p_pedido);
    perform evidencia_operacion.encolar_pedido(e.id,t.id,nota);
  elsif p_accion in ('confirmar_resto','confirmar_resto_revision') then
    raise exception 'Confirma los productos desde sus tarjetas; las excepciones se resuelven al terminar.';
  else
    r:=almacen_operaciones.operar_abastecimiento(p_pedido,p_sucursal,t.id,p_accion,p_version,p_datos);
    if r->'tarea'->>'estado' in ('PREPARANDO','ANULADO') then
      update public.almacen_preparacion set origenes_pendientes=0 where id=t.id;
      r:=almacen_operaciones.operar_abastecimiento(p_pedido,p_sucursal,t.id,'consultar',null,'{}');
    end if;
    return almacen_operaciones.enriquecer_flexible(r);
  end if;
  select count(*) into pendientes from public.almacen_preparacion_linea tl where preparacion_id=t.id and vigente and almacen_operaciones.cantidad_fisica(tl)>0 and
    (origenes_declarados is null or (select coalesce(sum((o->>'cantidad_base')::numeric),0) from jsonb_array_elements(origenes_declarados)o)<>almacen_operaciones.cantidad_fisica(tl));
  update public.almacen_preparacion set version=version+1,actualizado_en=now(),origenes_pendientes=case when estado in ('PREPARANDO','ANULADO') then 0 else pendientes end where id=t.id;
  insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle) values(t.id,upper(p_accion),a.id,a.nombre,p_datos);
  r:=almacen_operaciones.operar_abastecimiento(p_pedido,p_sucursal,t.id,'consultar',null,'{}');
  return almacen_operaciones.enriquecer_flexible(r);
end $$;
revoke all on function almacen_operaciones.operar_flexible(bigint,bigint,bigint,text,integer,jsonb) from public,anon;
grant execute on function almacen_operaciones.operar_flexible(bigint,bigint,bigint,text,integer,jsonb) to authenticated;
create or replace function public.operar_preparacion_pedido(p_pedido_id bigint,p_sucursal_id bigint,p_tarea_id bigint default null,p_accion text default 'consultar',p_version integer default null,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select almacen_operaciones.operar_flexible(p_pedido_id,p_sucursal_id,p_tarea_id,p_accion,p_version,p_datos) $$;
-- Evita saltarse la declaración o la auditoría mediante el endpoint anterior.
revoke execute on function almacen_operaciones.operar_abastecimiento(bigint,bigint,bigint,text,integer,jsonb) from authenticated;

-- No se pierden tareas de procedencia aunque ya haya más de 80 tandas recientes.
-- Invoker: respeta RLS y sólo devuelve las tareas del alistador autenticado.
create function public.listar_origenes_pendientes_pedido(p_sucursal_id bigint) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('pedido',jsonb_build_object('id',p.id,'numero',p.numero,'referencia',p.referencia,
    'cliente',jsonb_build_object('nombre',c.nombre))) order by t.actualizado_en),'[]')
  from public.almacen_preparacion t join public.pedido p on p.id=t.pedido_id left join public.cliente c on c.id=p.cliente_id
  where t.sucursal_id=p_sucursal_id and t.preparador_id=(select auth.uid()) and t.origenes_pendientes>0 and t.estado<>'ANULADO'
$$;
revoke all on function public.listar_origenes_pendientes_pedido(bigint) from public,anon;
grant execute on function public.listar_origenes_pendientes_pedido(bigint) to authenticated;

-- La corrección documental anterior no revierte un Kardex ni su procedencia.
-- Las nuevas salidas deben corregirse con todos sus movimientos.
do $$ declare v text;begin
  v:=pg_get_functiondef('almacen_operaciones.corregir_salida_documental(bigint,text,uuid)'::regprocedure);
  if position('if e.id is null' in v)=0 then raise exception 'Revisar contrato de corrección documental.';end if;
  v:=replace(v,'if e.id is null',E'if exists(select 1 from public.almacen_preparacion_linea where despacho_evento_id=p_evento) then raise exception ''Esta tanda requiere corregir la salida y sus orígenes con un encargado.'';end if;\n  if e.id is null');
  execute v;
end $$;
notify pgrst,'reload schema';
