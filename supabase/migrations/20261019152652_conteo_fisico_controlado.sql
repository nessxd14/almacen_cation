-- Conteo con corte por ubicación. No regulariza ni cierra sesiones anteriores.
-- inventario_control es privado: no añadirlo a los esquemas de la Data API.
create schema if not exists inventario_control;
revoke all on schema inventario_control from public, anon, authenticated;

create table inventario_control.sesion (
  id bigint primary key references public.sesion_conteo(id),
  solicitud uuid not null unique,
  solicitud_datos jsonb not null,
  ubicacion_id bigint not null references public.ubicacion(id),
  sucursal_id bigint not null references public.sucursal(id),
  nombre text not null, metodo text not null check (metodo in ('SIMPLE','DOBLE_CIEGO')),
  tipo text not null check (tipo in ('INICIAL','VERIFICACION')),
  alcance text not null check (alcance in ('PARCIAL','UBICACION')),
  estado text not null default 'CAPTURA' check (estado in ('CAPTURA','REVISION','APLICANDO','APLICADA','CANCELADA')),
  version integer not null default 1,
  corte_en timestamptz not null default clock_timestamp(),
  creada_por uuid not null references public.perfil(id),
  cerrada_en timestamptz
);
create unique index conteo_ubicacion_activa on inventario_control.sesion(ubicacion_id)
  where estado in ('CAPTURA','REVISION','APLICANDO');
create index conteo_ultima_aplicacion on inventario_control.sesion(ubicacion_id,cerrada_en desc) where estado='APLICADA';
create table inventario_control.ronda (
  sesion_id bigint not null references inventario_control.sesion(id),
  numero smallint not null check (numero in (1,2)),
  usuario_id uuid not null references public.perfil(id), dispositivo uuid not null,
  finalizada_en timestamptz,
  primary key(sesion_id, numero), unique(sesion_id, usuario_id)
);
create table inventario_control.producto (
  sesion_id bigint not null references inventario_control.sesion(id),
  producto_id bigint not null references public.producto(id),
  teorico numeric not null, ultimo_movimiento bigint not null,
  conteo_1 numeric, conteo_2 numeric, cantidad_final numeric check(cantidad_final >= 0),
  aprobada boolean not null default false, motivo text,
  conciliacion_id bigint references public.conciliacion_linea(id),
  movimiento_id bigint references public.kardex_transacciones(id),
  primary key(sesion_id, producto_id)
);
create table inventario_control.captura (
  uuid uuid primary key, sesion_id bigint not null references inventario_control.sesion(id),
  ronda smallint not null, usuario_id uuid not null references public.perfil(id),
  presentacion_id bigint references public.presentacion(id), producto_id bigint references public.producto(id),
  cantidad numeric not null check(cantidad >= 0 and cantidad < 1000000000000),
  factor numeric check(factor > 0 and factor < 1000000000000),
  descripcion text, foto_ref text not null,
  creada_en timestamptz not null default clock_timestamp(), anulada boolean not null default false,
  foreign key(sesion_id,ronda) references inventario_control.ronda(sesion_id,numero)
);
create index conteo_captura_sesion on inventario_control.captura(sesion_id, ronda);
create table inventario_control.evento (
  id bigint generated always as identity primary key,
  sesion_id bigint not null references inventario_control.sesion(id),
  actor uuid not null references public.perfil(id), accion text not null, datos jsonb not null,
  creado_en timestamptz not null default clock_timestamp()
);
alter table inventario_control.sesion enable row level security;
alter table inventario_control.ronda enable row level security;
alter table inventario_control.producto enable row level security;
alter table inventario_control.captura enable row level security;
alter table inventario_control.evento enable row level security;
revoke all on all tables in schema inventario_control from public, anon, authenticated;
revoke all on all sequences in schema inventario_control from public, anon, authenticated;

-- Conserva el acumulador existente y evita depender del search_path del RPC.
create or replace function public.trg_stock_desde_kardex() returns trigger
language plpgsql set search_path = '' as $$ begin
  insert into public.stock_actual(producto_id,ubicacion_id,cantidad_base,actualizado_en)
  values(NEW.producto_id,NEW.ubicacion_id,NEW.cantidad,now())
  on conflict(producto_id,ubicacion_id) do update
    set cantidad_base=public.stock_actual.cantidad_base+excluded.cantidad_base,actualizado_en=now();
  return NEW;
end $$;

-- El candado de ubicación se comparte con entradas/salidas, incluso fuera del POS.
-- El permiso excepcional sólo existe dentro de la transacción de aplicación y
-- exige la conciliación y cantidad exactas. No depende de variables del cliente.
create function inventario_control.proteger_movimiento() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s inventario_control.sesion%rowtype;
begin
  perform 1 from public.ubicacion where id=NEW.ubicacion_id for update;
  select * into s from inventario_control.sesion
    where ubicacion_id=NEW.ubicacion_id and estado in ('CAPTURA','REVISION','APLICANDO');
  -- Una operación pudo validar disponibilidad ANTES de esperar este candado.
  -- Si cruzó una aplicación debe empezar de nuevo y leer el saldo actualizado.
  if not found and exists(select 1 from inventario_control.sesion where ubicacion_id=NEW.ubicacion_id and estado='APLICADA' and cerrada_en>transaction_timestamp()) then
    raise exception 'El saldo cambió al aplicar un conteo. Reintenta la operación para leer las existencias actualizadas.' using errcode='40001';
  end if;
  if found and not coalesce((s.estado='APLICANDO' and NEW.origen_sesion_id=s.id and
    NEW.tipo_movimiento::text='AJUSTE' and exists (
      select 1 from inventario_control.producto p where p.sesion_id=s.id
        and p.producto_id=NEW.producto_id and p.aprobada
        and p.conciliacion_id=NEW.origen_conciliacion_id
        and NEW.cantidad=p.cantidad_final-p.teorico
        and NEW.idempotencia_clave='conteo-controlado:'||s.id||':'||p.producto_id)),false) then
    raise exception 'Ubicación en conteo #%: termine o cancele el conteo antes de mover mercancía.',s.id using errcode='55000';
  end if;
  return NEW;
end $$;
create trigger conteo_proteger_kardex before insert on public.kardex_transacciones
for each row execute function inventario_control.proteger_movimiento();

-- También impide cambiar stock directamente durante el corte. La escritura
-- anidada del trigger kardex_mantiene_stock ya pasó proteger_movimiento.
create function inventario_control.proteger_stock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ubicacion bigint;
begin
  if pg_trigger_depth() > 1 then return coalesce(NEW,OLD); end if;
  v_ubicacion:=case when TG_OP='DELETE' then OLD.ubicacion_id else NEW.ubicacion_id end;
  if TG_OP='UPDATE' and (NEW.producto_id<>OLD.producto_id or NEW.ubicacion_id<>OLD.ubicacion_id) then
    raise exception 'No se permite cambiar la identidad de una fila de stock.';
  end if;
  perform 1 from public.ubicacion where id=v_ubicacion for update;
  if exists(select 1 from inventario_control.sesion where ubicacion_id=v_ubicacion and estado in ('CAPTURA','REVISION','APLICANDO')) then
    raise exception 'Ubicación en conteo: no se puede modificar el saldo directamente.' using errcode='55000';
  end if;
  if exists(select 1 from inventario_control.sesion where ubicacion_id=v_ubicacion and estado='APLICADA' and cerrada_en>transaction_timestamp()) then
    raise exception 'El saldo cambió al aplicar un conteo. Reintenta la operación.' using errcode='40001';
  end if;
  return coalesce(NEW,OLD);
end $$;
create trigger conteo_proteger_stock before insert or update or delete on public.stock_actual
for each row execute function inventario_control.proteger_stock();

create function inventario_control.proteger_truncate() returns trigger
language plpgsql security definer set search_path = '' as $$ begin
  if exists(select 1 from inventario_control.sesion where estado in ('CAPTURA','REVISION','APLICANDO')) then
    raise exception 'Hay ubicaciones en conteo: no se pueden vaciar los saldos.' using errcode='55000';
  end if;
  return null;
end $$;
create trigger conteo_proteger_truncate before truncate on public.stock_actual
execute function inventario_control.proteger_truncate();

-- El espejo histórico que consumen las fichas sólo lo modifica el motor.
create function inventario_control.proteger_espejo() returns trigger
language plpgsql set search_path = '' as $$
declare v_id bigint;
begin
  if TG_TABLE_NAME='sesion_conteo' then v_id:=coalesce(NEW.id,OLD.id);
  else v_id:=coalesce(NEW.sesion_id,OLD.sesion_id); end if;
  if current_user in ('authenticated','anon') and exists(select 1 from public.sesion_conteo where id=v_id and nombre like '[Controlado] %') then
    raise exception 'El conteo controlado se modifica desde sus operaciones autorizadas.' using errcode='42501';
  end if;
  return coalesce(NEW,OLD);
end $$;
create trigger conteo_espejo_sesion before update or delete on public.sesion_conteo
for each row execute function inventario_control.proteger_espejo();
create trigger conteo_espejo_linea before insert or update or delete on public.conciliacion_linea
for each row execute function inventario_control.proteger_espejo();

-- Las tablas históricas tienen políticas permisivas. Esta restricción adicional
-- evita que los espejos nuevos filtren rondas/cantidades por la API de tablas.
create function inventario_control.permite_espejo(p_sesion bigint,p_es_conciliacion boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from inventario_control.sesion where id=p_sesion) or exists(
    select 1 from inventario_control.sesion s join public.perfil p on p.id=auth.uid() and p.activo
    where s.id=p_sesion and p.rol in ('admin','gerente','almacenero','operario')
      and (p.sucursal_id is null or p.sucursal_id=s.sucursal_id)
      and (not p_es_conciliacion or (p.rol in ('admin','gerente') and s.estado='APLICADA')));
$$;
create policy conteo_controlado_espejo_sesion on public.sesion_conteo as restrictive for all to authenticated
  using(inventario_control.permite_espejo(id,false)) with check(inventario_control.permite_espejo(id,false));
create policy conteo_controlado_espejo_linea on public.conciliacion_linea as restrictive for all to authenticated
  using(inventario_control.permite_espejo(sesion_id,true)) with check(inventario_control.permite_espejo(sesion_id,true));

create function inventario_control.operar(p_accion text, p_sesion_id bigint, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.perfil%rowtype; ub public.ubicacion%rowtype;
  s inventario_control.sesion%rowtype; r inventario_control.ronda%rowtype;
  cap inventario_control.captura%rowtype; pr public.presentacion%rowtype;
  item record; v_id bigint; v_num smallint; v_uuid uuid; v_cantidad numeric;
  v_factor numeric; v_producto bigint; v_foto text; v_motivo text;
  v_manager boolean; v_read_review boolean; v_revision jsonb; v_ids bigint[];
  v_result jsonb; v_action_write boolean := false;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if not found or actor.rol not in ('admin','gerente','almacenero','operario') then
    raise exception 'No autorizado para inventario.' using errcode='42501';
  end if;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' then raise exception 'Datos de operación inválidos.'; end if;
  v_manager:=actor.rol in ('admin','gerente');

  if p_accion='ultimo' then
    if actor.sucursal_id is not null and actor.sucursal_id<>(p_datos->>'sucursal_id')::bigint then raise exception 'Sucursal no autorizada.' using errcode='42501'; end if;
    return (select jsonb_build_object('sesion_id',cs.id,'creado_en',cs.cerrada_en,'creado_por',pe.nombre,'origen_conciliacion_id',p.conciliacion_id)
      from inventario_control.producto p join inventario_control.sesion cs on cs.id=p.sesion_id
      join inventario_control.evento e on e.sesion_id=cs.id and e.accion='aplicar' join public.perfil pe on pe.id=e.actor
      where p.producto_id=(p_datos->>'producto_id')::bigint and cs.sucursal_id=(p_datos->>'sucursal_id')::bigint and cs.estado='APLICADA'
      order by cs.cerrada_en desc,cs.id desc limit 1);
  end if;

  if p_accion='listar' then
    if actor.sucursal_id is not null and actor.sucursal_id<>(p_datos->>'sucursal_id')::bigint then
      raise exception 'Sucursal no autorizada.' using errcode='42501';
    end if;
    return jsonb_build_object('sesiones',coalesce((select jsonb_agg(to_jsonb(t) order by case when t.estado in ('CAPTURA','REVISION') then 0 else 1 end,t.id desc) from (
      select id,nombre,metodo,tipo,alcance,estado,version,ubicacion_id,corte_en
      from inventario_control.sesion where sucursal_id=(p_datos->>'sucursal_id')::bigint and
        (estado in ('CAPTURA','REVISION') or id in (select cs.id from inventario_control.sesion cs where cs.sucursal_id=(p_datos->>'sucursal_id')::bigint and cs.estado not in ('CAPTURA','REVISION') order by cs.id desc limit 50))) t),'[]'::jsonb),
      'anteriores',(select count(*) from public.sesion_conteo sc where sc.estado='ABIERTA'
        and (exists(select 1 from public.ubicacion u where u.id=sc.ubicacion_id and u.sucursal_id=(p_datos->>'sucursal_id')::bigint) or (sc.ubicacion_id is null and actor.sucursal_id is null))
        and not exists(select 1 from inventario_control.sesion ns where ns.id=sc.id)));
  end if;

  if p_accion='crear' then
    v_uuid:=(p_datos->>'solicitud')::uuid;
    if v_uuid is null then raise exception 'Falta la solicitud de creación.'; end if;
    select * into ub from public.ubicacion where id=(p_datos->>'ubicacion_id')::bigint for update;
    if not found or ub.excluye_disponible or not exists(select 1 from public.sucursal su where su.id=ub.sucursal_id and su.tipo<>'virtual' and su.activo) then
      raise exception 'Elige una ubicación física válida.';
    end if;
    if actor.sucursal_id is not null and actor.sucursal_id<>ub.sucursal_id then
      raise exception 'Sucursal no autorizada.' using errcode='42501';
    end if;
    select * into s from inventario_control.sesion where solicitud=v_uuid;
    if found then
      if s.creada_por<>actor.id or s.ubicacion_id<>ub.id or s.solicitud_datos<>p_datos then raise exception 'Solicitud ya utilizada con otro contenido.'; end if;
      return inventario_control.operar('detalle',s.id,'{}');
    end if;
    if p_datos->>'metodo' not in ('SIMPLE','DOBLE_CIEGO') or p_datos->>'tipo' not in ('INICIAL','VERIFICACION') or p_datos->>'alcance' not in ('PARCIAL','UBICACION') then
      raise exception 'Método, propósito o alcance inválido.';
    end if;
    if exists(select 1 from inventario_control.sesion where ubicacion_id=ub.id and estado in ('CAPTURA','REVISION','APLICANDO')) then raise exception 'Ya hay un conteo activo en esta ubicación.'; end if;
    insert into public.sesion_conteo(nombre,metodo,ubicacion_id)
      values('[Controlado] '||coalesce(nullif(btrim(p_datos->>'nombre'),''),'Conteo físico'),p_datos->>'metodo',ub.id) returning id into v_id;
    insert into inventario_control.sesion(id,solicitud,solicitud_datos,ubicacion_id,sucursal_id,nombre,metodo,tipo,alcance,creada_por)
      values(v_id,v_uuid,p_datos,ub.id,ub.sucursal_id,coalesce(nullif(btrim(p_datos->>'nombre'),''),'Conteo físico'),p_datos->>'metodo',p_datos->>'tipo',p_datos->>'alcance',actor.id);
    if p_datos->>'alcance'='PARCIAL' then
      select array_agg(distinct value::bigint) into v_ids from jsonb_array_elements_text(p_datos->'producto_ids');
      if coalesce(cardinality(v_ids),0)=0 then raise exception 'El conteo parcial necesita productos.'; end if;
      if exists(select 1 from unnest(v_ids) x(id) where not exists(select 1 from public.producto p where p.id=x.id)) then raise exception 'Producto inexistente.'; end if;
    else
      select array_agg(distinct producto_id) into v_ids from (
        select producto_id from public.stock_actual where ubicacion_id=ub.id
        union select producto_id from public.producto_ubicacion where ubicacion_id=ub.id) q;
    end if;
    insert into inventario_control.producto(sesion_id,producto_id,teorico,ultimo_movimiento)
      select v_id,x.id,coalesce(sa.cantidad_base,0),coalesce((select max(k.id) from public.kardex_transacciones k where k.producto_id=x.id and k.ubicacion_id=ub.id),0)
      from unnest(v_ids) x(id) left join public.stock_actual sa on sa.producto_id=x.id and sa.ubicacion_id=ub.id;
    insert into inventario_control.evento(sesion_id,actor,accion,datos) values(v_id,actor.id,'crear',p_datos);
    return inventario_control.operar('detalle',v_id,'{}');
  end if;

  -- Todos los cambios de una sesión se serializan con el mismo orden de candados.
  select * into s from inventario_control.sesion where id=p_sesion_id;
  if not found then raise exception 'La sesión anterior no tiene corte: inicia un conteo controlado nuevo.'; end if;
  if actor.sucursal_id is not null and actor.sucursal_id<>s.sucursal_id then raise exception 'Sucursal no autorizada.' using errcode='42501'; end if;
  if p_accion='estado_captura' then
    return jsonb_build_object('confirmada',exists(select 1 from inventario_control.captura where uuid=(p_datos->>'uuid')::uuid and sesion_id=s.id and usuario_id=actor.id));
  end if;
  if p_accion<>'detalle' then
    perform 1 from public.ubicacion where id=s.ubicacion_id for update;
    select * into s from inventario_control.sesion where id=p_sesion_id for update;
  end if;
  select * into r from inventario_control.ronda where sesion_id=s.id and usuario_id=actor.id;

  if p_accion='tomar_ronda' then
    if s.estado<>'CAPTURA' then raise exception 'La captura ya terminó.'; end if;
    v_num:=(p_datos->>'ronda')::smallint; v_uuid:=(p_datos->>'dispositivo')::uuid;
    if v_num is null or v_num not in (1,2) or (s.metodo='SIMPLE' and v_num<>1) or v_uuid is null then raise exception 'Ronda o dispositivo inválido.'; end if;
    if r.usuario_id is not null and (r.numero<>v_num or r.dispositivo<>v_uuid) then raise exception 'Ya tienes otra ronda o dispositivo asignado en esta sesión.'; end if;
    if exists(select 1 from inventario_control.ronda where sesion_id=s.id and numero=v_num and (usuario_id<>actor.id or dispositivo<>v_uuid)) then raise exception 'Esta ronda ya está asignada a otra persona o dispositivo.'; end if;
    insert into inventario_control.ronda(sesion_id,numero,usuario_id,dispositivo) values(s.id,v_num,actor.id,v_uuid) on conflict do nothing;
    v_action_write:=true;

  elsif p_accion='capturar' then
    v_uuid:=(p_datos->>'uuid')::uuid; v_cantidad:=(p_datos->>'cantidad')::numeric;
    v_id:=(p_datos->>'presentacion_id')::bigint; v_foto:=p_datos->>'foto_ref';
    if r.usuario_id is null or r.dispositivo is distinct from (p_datos->>'dispositivo')::uuid then raise exception 'Toma tu ronda en este dispositivo antes de capturar.'; end if;
    select * into cap from inventario_control.captura where uuid=v_uuid;
    if found then
      if cap.sesion_id<>s.id or cap.usuario_id<>actor.id or cap.ronda<>r.numero or cap.presentacion_id is distinct from v_id or cap.cantidad is distinct from v_cantidad or cap.foto_ref is distinct from v_foto or cap.descripcion is distinct from nullif(btrim(p_datos->>'descripcion'),'') then raise exception 'El identificador de captura ya tiene otro contenido.'; end if;
      return inventario_control.operar('detalle',s.id,'{}');
    end if;
    if s.estado<>'CAPTURA' or r.finalizada_en is not null then raise exception 'La ronda ya está cerrada; la captura tardía no se aplicó.'; end if;
    if v_uuid is null or v_cantidad is null or v_cantidad<0 or v_cantidad>=10000000000 or v_cantidad::text in ('NaN','Infinity','-Infinity') or round(v_cantidad,4)<>v_cantidad then raise exception 'Cantidad inválida: usa hasta cuatro decimales.'; end if;
    if v_foto is distinct from 'sesion_'||s.id||'/'||v_uuid||'.jpg' or not exists(select 1 from storage.objects where bucket_id='conteos_controlados' and name=v_foto and owner_id=actor.id::text) then raise exception 'Sube la foto antes de confirmar la captura.'; end if;
    if v_id is not null then
      select * into pr from public.presentacion where id=v_id and activo;
      if not found or pr.factor_unidad_base<=0 or pr.factor_unidad_base>=10000000000 or pr.factor_unidad_base::text in ('NaN','Infinity','-Infinity') then raise exception 'Presentación inválida.'; end if;
      v_producto:=pr.producto_id; v_factor:=pr.factor_unidad_base;
      if v_cantidad*v_factor>=10000000000 or round(v_cantidad*v_factor,4)<>v_cantidad*v_factor then raise exception 'Cantidad base fuera de rango o con más de cuatro decimales.'; end if;
      if not exists(select 1 from inventario_control.producto where sesion_id=s.id and producto_id=v_producto) then
        if s.alcance<>'UBICACION' then raise exception 'Producto fuera del alcance parcial.'; end if;
        insert into inventario_control.producto(sesion_id,producto_id,teorico,ultimo_movimiento)
        values(s.id,v_producto,coalesce((select cantidad_base from public.stock_actual where producto_id=v_producto and ubicacion_id=s.ubicacion_id),0),coalesce((select max(id) from public.kardex_transacciones where producto_id=v_producto and ubicacion_id=s.ubicacion_id),0));
      end if;
    elsif nullif(btrim(p_datos->>'descripcion'),'') is null then raise exception 'Describe el artículo sin catálogo.';
    end if;
    insert into inventario_control.captura(uuid,sesion_id,ronda,usuario_id,presentacion_id,producto_id,cantidad,factor,descripcion,foto_ref)
      values(v_uuid,s.id,r.numero,actor.id,v_id,v_producto,v_cantidad,v_factor,nullif(btrim(p_datos->>'descripcion'),''),v_foto);
    v_action_write:=true;

  elsif p_accion='anular_captura' then
    if s.estado<>'CAPTURA' or r.usuario_id is null or r.finalizada_en is not null or r.dispositivo is distinct from (p_datos->>'dispositivo')::uuid then raise exception 'Tu ronda no está abierta en este dispositivo.'; end if;
    v_motivo:=nullif(btrim(p_datos->>'motivo'),'');
    if v_motivo is null then raise exception 'Indica el motivo de la anulación.'; end if;
    update inventario_control.captura set anulada=true where uuid=(p_datos->>'uuid')::uuid and sesion_id=s.id and usuario_id=actor.id;
    if not found then raise exception 'Captura no encontrada.'; end if;
    v_action_write:=true;

  elsif p_accion='catalogar' then
    if not v_manager or s.estado<>'CAPTURA' then raise exception 'Solo supervisión puede vincular artículos durante la captura.'; end if;
    select * into cap from inventario_control.captura where uuid=(p_datos->>'uuid')::uuid and sesion_id=s.id and presentacion_id is null and not anulada;
    select * into pr from public.presentacion where id=(p_datos->>'presentacion_id')::bigint and activo;
    if cap.uuid is null or pr.id is null or pr.factor_unidad_base<=0 or pr.factor_unidad_base>=10000000000 or pr.factor_unidad_base::text in ('NaN','Infinity','-Infinity') or cap.cantidad*pr.factor_unidad_base>=10000000000 or round(cap.cantidad*pr.factor_unidad_base,4)<>cap.cantidad*pr.factor_unidad_base then raise exception 'Captura, presentación o conversión inválida.'; end if;
    if not exists(select 1 from inventario_control.producto where sesion_id=s.id and producto_id=pr.producto_id) then
      if s.alcance<>'UBICACION' then raise exception 'Producto fuera del alcance parcial: cancela y reinicia con el alcance correcto.'; end if;
      insert into inventario_control.producto(sesion_id,producto_id,teorico,ultimo_movimiento) values(s.id,pr.producto_id,coalesce((select cantidad_base from public.stock_actual where producto_id=pr.producto_id and ubicacion_id=s.ubicacion_id),0),coalesce((select max(id) from public.kardex_transacciones where producto_id=pr.producto_id and ubicacion_id=s.ubicacion_id),0));
    end if;
    update inventario_control.captura set presentacion_id=pr.id,producto_id=pr.producto_id,factor=pr.factor_unidad_base where uuid=cap.uuid;
    v_action_write:=true;

  elsif p_accion='finalizar_ronda' then
    if r.usuario_id is not null and r.finalizada_en is not null and r.dispositivo=(p_datos->>'dispositivo')::uuid then return inventario_control.operar('detalle',s.id,'{}'); end if;
    if s.estado<>'CAPTURA' or r.usuario_id is null or r.dispositivo is distinct from (p_datos->>'dispositivo')::uuid then raise exception 'Tu ronda no está abierta en este dispositivo.'; end if;
    if r.finalizada_en is not null then return inventario_control.operar('detalle',s.id,'{}'); end if;
    if coalesce((p_datos->>'confirmo_sin_pendientes')::boolean,false) is not true then raise exception 'Confirma la sincronización de este dispositivo.'; end if;
    if jsonb_typeof(p_datos->'capturas') is distinct from 'array' or
      (select coalesce(jsonb_agg(uuid::text order by uuid::text),'[]'::jsonb) from inventario_control.captura where sesion_id=s.id and ronda=r.numero and not anulada)
      is distinct from (select coalesce(jsonb_agg(value order by value),'[]'::jsonb) from jsonb_array_elements_text(p_datos->'capturas')) then raise exception 'Las capturas del dispositivo no coinciden con las sincronizadas. Actualiza antes de finalizar.'; end if;
    if exists(select 1 from inventario_control.captura where sesion_id=s.id and ronda=r.numero and not anulada and producto_id is null) then raise exception 'Hay artículos sin catálogo: pide a supervisión que los vincule.'; end if;
    if not exists(select 1 from inventario_control.producto where sesion_id=s.id) or exists(
      select 1 from inventario_control.producto p where p.sesion_id=s.id and not exists(select 1 from inventario_control.captura c where c.sesion_id=s.id and c.ronda=r.numero and c.producto_id=p.producto_id and not c.anulada)) then raise exception 'Faltan productos del alcance: registra también los ceros observados.'; end if;
    update inventario_control.ronda set finalizada_en=clock_timestamp() where sesion_id=s.id and numero=r.numero;
    if (select count(*) from inventario_control.ronda where sesion_id=s.id and finalizada_en is not null)=(case when s.metodo='SIMPLE' then 1 else 2 end) then
      update inventario_control.producto p set
        conteo_1=(select sum(c.cantidad*c.factor) from inventario_control.captura c where c.sesion_id=s.id and c.producto_id=p.producto_id and c.ronda=1 and not c.anulada),
        conteo_2=(select sum(c.cantidad*c.factor) from inventario_control.captura c where c.sesion_id=s.id and c.producto_id=p.producto_id and c.ronda=2 and not c.anulada)
      where p.sesion_id=s.id;
      -- Un artículo descubierto en la segunda ronda necesita observación explícita
      -- en la primera: nunca se convierte una ausencia en cero.
      if exists(select 1 from inventario_control.producto where sesion_id=s.id and (conteo_1 is null or (s.metodo='DOBLE_CIEGO' and conteo_2 is null))) then raise exception 'Una ronda anterior no cubre todos los productos descubiertos: cancela y vuelve a contar el alcance completo.'; end if;
      update inventario_control.sesion set estado='REVISION' where id=s.id;
      update public.sesion_conteo set estado='CONCILIADA' where id=s.id;
    end if;
    v_action_write:=true;

  elsif p_accion='resolver' then
    if not v_manager or s.estado<>'REVISION' then raise exception 'Solo supervisión puede resolver un conteo terminado.' using errcode='42501'; end if;
    if s.version is distinct from (p_datos->>'version')::integer then raise exception 'El conteo cambió: actualiza antes de resolver.' using errcode='40001'; end if;
    v_cantidad:=(p_datos->>'cantidad_base')::numeric; v_motivo:=nullif(btrim(p_datos->>'motivo'),'');
    if v_cantidad is null or v_cantidad<0 or v_cantidad>=10000000000 or v_cantidad::text in ('NaN','Infinity','-Infinity') or round(v_cantidad,4)<>v_cantidad or length(coalesce(v_motivo,''))<5 then raise exception 'Indica una cantidad válida con hasta cuatro decimales y el motivo de revisión (mínimo 5 caracteres).'; end if;
    if exists(select 1 from inventario_control.producto where sesion_id=s.id and producto_id=(p_datos->>'producto_id')::bigint
      and (teorico<>v_cantidad or conteo_1<>v_cantidad or (s.metodo='DOBLE_CIEGO' and conteo_2<>v_cantidad)))
      and coalesce((p_datos->>'reconteo_confirmado')::boolean,false) is not true then raise exception 'Confirma el reconteo físico de la diferencia antes de aprobar.'; end if;
    update inventario_control.producto set cantidad_final=v_cantidad,aprobada=true,motivo=v_motivo where sesion_id=s.id and producto_id=(p_datos->>'producto_id')::bigint;
    if not found then raise exception 'Producto fuera del alcance.'; end if;
    v_action_write:=true;

  elsif p_accion='aplicar' then
    if not v_manager then raise exception 'Solo supervisión puede aplicar.' using errcode='42501'; end if;
    if s.estado='APLICADA' then return inventario_control.operar('detalle',s.id,'{}'); end if;
    if s.estado<>'REVISION' or s.version is distinct from (p_datos->>'version')::integer then raise exception 'Termina las rondas y actualiza la revisión antes de aplicar.'; end if;
    if not exists(select 1 from inventario_control.producto where sesion_id=s.id) or exists(select 1 from inventario_control.producto where sesion_id=s.id and not aprobada) then raise exception 'Hay productos pendientes de aprobar.'; end if;
    if exists(select 1 from inventario_control.producto p where p.sesion_id=s.id and (
      p.teorico<>coalesce((select cantidad_base from public.stock_actual where producto_id=p.producto_id and ubicacion_id=s.ubicacion_id),0) or
      p.ultimo_movimiento<>coalesce((select max(id) from public.kardex_transacciones where producto_id=p.producto_id and ubicacion_id=s.ubicacion_id),0))) then raise exception 'Hubo movimientos después del corte: cancela y realiza un nuevo conteo.'; end if;
    update inventario_control.sesion set estado='APLICANDO' where id=s.id;
    for item in select * from inventario_control.producto where sesion_id=s.id order by producto_id loop
      select * into pr from public.presentacion where producto_id=item.producto_id and es_base and factor_unidad_base=1 order by id limit 1;
      if not found then raise exception 'Producto % sin presentación base de factor 1.',item.producto_id; end if;
      insert into public.conciliacion_linea(sesion_id,presentacion_id,ubicacion_id,cantidad_conteo_1,cantidad_conteo_2,cantidad_conciliada,factor_a_base_snap,metodo_resolucion,estado,resuelto_por,resuelto_en)
        values(s.id,pr.id,s.ubicacion_id,item.conteo_1,item.conteo_2,item.cantidad_final,1,'MANUAL','INYECTADA',actor.nombre,clock_timestamp()) returning id into v_id;
      update inventario_control.producto set conciliacion_id=v_id where sesion_id=s.id and producto_id=item.producto_id;
      if item.cantidad_final<>item.teorico then
        insert into public.kardex_transacciones(producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia,motivo,creado_por,fecha_efectiva,origen_sesion_id,origen_conciliacion_id,idempotencia_clave)
          values(item.producto_id,s.ubicacion_id,item.cantidad_final-item.teorico,'AJUSTE','Conteo #'||s.id,item.motivo,actor.nombre,(clock_timestamp() at time zone 'America/La_Paz')::date,s.id,v_id,'conteo-controlado:'||s.id||':'||item.producto_id) returning id into v_id;
        update inventario_control.producto set movimiento_id=v_id where sesion_id=s.id and producto_id=item.producto_id;
      end if;
      -- La fecha de verificación existe incluso cuando el ajuste es cero.
      -- No activa control estricto si hay otra ubicación del producto sin verificar.
      if not exists(select 1 from (
        select sa.ubicacion_id from public.stock_actual sa join public.ubicacion u on u.id=sa.ubicacion_id where sa.producto_id=item.producto_id and u.sucursal_id=s.sucursal_id and not u.excluye_disponible
        union select pu.ubicacion_id from public.producto_ubicacion pu join public.ubicacion u on u.id=pu.ubicacion_id where pu.producto_id=item.producto_id and u.sucursal_id=s.sucursal_id and not u.excluye_disponible) u
        where u.ubicacion_id<>s.ubicacion_id and not exists(select 1 from inventario_control.producto pp join inventario_control.sesion ss on ss.id=pp.sesion_id where pp.producto_id=item.producto_id and ss.ubicacion_id=u.ubicacion_id and ss.estado='APLICADA')) then
        insert into public.producto_sucursal(producto_id,sucursal_id,se_vende,control_stock,inventariado_en,inventariado_por)
          values(item.producto_id,s.sucursal_id,true,'ESTRICTO',clock_timestamp(),actor.nombre)
          on conflict(producto_id,sucursal_id) do update set control_stock='ESTRICTO',inventariado_en=excluded.inventariado_en,inventariado_por=excluded.inventariado_por;
      end if;
    end loop;
    update inventario_control.sesion set estado='APLICADA',cerrada_en=clock_timestamp() where id=s.id;
    update public.sesion_conteo set estado='CERRADA',cerrada_en=clock_timestamp(),cerrada_por=actor.nombre where id=s.id;
    v_action_write:=true;

  elsif p_accion='cancelar' then
    if not v_manager and s.creada_por<>actor.id then raise exception 'Solo quien creó el conteo o supervisión puede cancelarlo.' using errcode='42501'; end if;
    if s.estado in ('APLICADA','CANCELADA') then raise exception 'El conteo ya terminó.'; end if;
    v_motivo:=nullif(btrim(p_datos->>'motivo'),'');
    if length(coalesce(v_motivo,''))<5 then raise exception 'Indica el motivo de cancelación (mínimo 5 caracteres).'; end if;
    update inventario_control.sesion set estado='CANCELADA',cerrada_en=clock_timestamp() where id=s.id;
    update public.sesion_conteo set estado='CERRADA',cerrada_en=clock_timestamp(),cerrada_por=actor.nombre where id=s.id;
    v_action_write:=true;
  elsif p_accion<>'detalle' then raise exception 'Operación de conteo desconocida.';
  end if;

  if v_action_write then
    update inventario_control.sesion set version=version+1 where id=s.id;
    insert into inventario_control.evento(sesion_id,actor,accion,datos) values(s.id,actor.id,p_accion,p_datos);
    return inventario_control.operar('detalle',s.id,'{}');
  end if;
  -- El esperado y ambas rondas se revelan sólo a supervisión, tras el cierre.
  v_read_review:=v_manager and s.estado in ('REVISION','APLICADA');
  select coalesce(jsonb_agg(jsonb_build_object('producto_id',p.producto_id,'nombre',prod.nombre,'unidad_base',prod.unidad_base,
    'contado',exists(select 1 from inventario_control.captura c where c.sesion_id=s.id and c.usuario_id=actor.id and c.producto_id=p.producto_id and not c.anulada),
    'teorico',case when v_read_review then p.teorico end,'conteo_1',case when v_read_review then p.conteo_1 end,'conteo_2',case when v_read_review then p.conteo_2 end,
    'cantidad_final',case when v_read_review then p.cantidad_final end,'aprobada',case when v_read_review then p.aprobada end,'motivo',case when v_read_review then p.motivo end) order by prod.nombre),'[]'::jsonb)
    into v_revision from inventario_control.producto p join public.producto prod on prod.id=p.producto_id where p.sesion_id=s.id;
  select jsonb_build_object('sesion',to_jsonb(s)-'solicitud'-'solicitud_datos','puede_revisar',v_read_review,'puede_cancelar',v_manager or s.creada_por=actor.id,'productos',v_revision,
    'rondas',coalesce((select jsonb_agg(jsonb_build_object('numero',rr.numero,'mia',rr.usuario_id=actor.id,'finalizada',rr.finalizada_en is not null,'dispositivo',case when rr.usuario_id=actor.id then rr.dispositivo end) order by rr.numero) from inventario_control.ronda rr where rr.sesion_id=s.id),'[]'::jsonb),
    'capturas',coalesce((select jsonb_agg(to_jsonb(c) order by c.creada_en) from inventario_control.captura c where c.sesion_id=s.id and c.usuario_id=actor.id),'[]'::jsonb),
    'sin_catalogo',case when v_manager then coalesce((select jsonb_agg(jsonb_build_object('uuid',c.uuid,'descripcion',c.descripcion,'foto_ref',c.foto_ref)) from inventario_control.captura c where c.sesion_id=s.id and c.producto_id is null and not c.anulada),'[]'::jsonb) else '[]'::jsonb end,
    'evidencias',case when v_read_review then coalesce((select jsonb_agg(jsonb_build_object('uuid',c.uuid,'producto_id',c.producto_id,'ronda',c.ronda,'cantidad',c.cantidad,'factor',c.factor,'foto_ref',c.foto_ref,'anulada',c.anulada,'actor',pe.nombre) order by c.creada_en) from inventario_control.captura c join public.perfil pe on pe.id=c.usuario_id where c.sesion_id=s.id),'[]'::jsonb) else '[]'::jsonb end,
    'eventos',case when v_read_review then coalesce((select jsonb_agg(jsonb_build_object('accion',e.accion,'actor',p.nombre,'creado_en',e.creado_en,'datos',case when e.accion in ('resolver','cancelar') then e.datos else '{}'::jsonb end) order by e.id) from inventario_control.evento e join public.perfil p on p.id=e.actor where e.sesion_id=s.id),'[]'::jsonb) else '[]'::jsonb end)
  into v_result;
  return v_result;
end $$;

revoke all on all functions in schema inventario_control from public,anon,authenticated;
grant usage on schema inventario_control to authenticated;
grant execute on function inventario_control.operar(text,bigint,jsonb) to authenticated;
grant execute on function inventario_control.permite_espejo(bigint,boolean) to authenticated;
create function public.operar_conteo(p_accion text, p_sesion_id bigint default null, p_datos jsonb default '{}')
returns jsonb language sql security invoker set search_path = '' as $$
  select inventario_control.operar(p_accion,p_sesion_id,p_datos);
$$;
revoke all on function public.operar_conteo(text,bigint,jsonb) from public,anon;
grant execute on function public.operar_conteo(text,bigint,jsonb) to authenticated;

-- Fotos nuevas en un bucket privado: las políticas históricas de conteos
-- permitían lectura anónima y no sirven para dos observaciones independientes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('conteos_controlados','conteos_controlados',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create function inventario_control.foto_permitida(p_nombre text,p_owner text,p_escritura boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from inventario_control.sesion s join public.perfil p on p.id=auth.uid() and p.activo
    where p.rol in ('admin','gerente','almacenero','operario') and (p.sucursal_id is null or p.sucursal_id=s.sucursal_id)
      and p_nombre ~ ('^sesion_'||s.id||'/[0-9a-f-]{36}\.jpg$')
      and ((p_owner=p.id::text and (not p_escritura or (s.estado='CAPTURA' and exists(select 1 from inventario_control.ronda r where r.sesion_id=s.id and r.usuario_id=p.id and r.finalizada_en is null))))
        or (not p_escritura and p.rol in ('admin','gerente') and s.estado in ('REVISION','APLICADA'))));
$$;
revoke all on function inventario_control.foto_permitida(text,text,boolean) from public,anon;
grant execute on function inventario_control.foto_permitida(text,text,boolean) to authenticated;
create policy conteo_controlado_foto_insert on storage.objects for insert to authenticated
  with check(bucket_id='conteos_controlados' and inventario_control.foto_permitida(name,owner_id,true));
create policy conteo_controlado_foto_select on storage.objects for select to authenticated
  using(bucket_id='conteos_controlados' and inventario_control.foto_permitida(name,owner_id,false));
-- Sin UPDATE/DELETE: una foto confirmada es evidencia inmutable. Los reintentos
-- aceptan el objeto existente y la captura conserva siempre el mismo UUID.

-- Las capturas históricas no tienen un corte verificable y no deben regularizar
-- existencias mediante las antiguas funciones de objetivos por presentación.
create or replace function public.conciliar_sesion(p_sesion_id bigint) returns void
language plpgsql set search_path = '' as $$ begin
  raise exception 'Usa Conteo controlado: las sesiones anteriores no tienen un corte verificable.';
end $$;
create or replace function public.inyectar_conciliacion_sesion(p_sesion_id bigint,p_usuario text default null) returns jsonb
language plpgsql set search_path = '' as $$ begin
  raise exception 'Usa la revisión de Conteo controlado para aprobar y aplicar existencias.';
end $$;
revoke execute on function public.conciliar_sesion(bigint) from public,anon;
revoke execute on function public.inyectar_conciliacion_sesion(bigint,text) from public,anon;
revoke execute on function public.marcar_inventariado(bigint,bigint) from public,anon,authenticated;
notify pgrst, 'reload schema';
