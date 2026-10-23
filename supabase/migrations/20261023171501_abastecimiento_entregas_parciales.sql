-- Abastecimiento documental por pedido. No acredita stock de Tienda ni compras rápidas.
alter table evidencia_operacion.configuracion add column abastecimiento_pedidos boolean not null default false;
alter table public.almacen_preparacion add column modo_abastecimiento boolean not null default false;
alter table public.pedido_despacho_evento add column abastecimiento_origenes jsonb;
alter table public.pedido_despacho_evento
  add column correccion_documental_id uuid unique,
  add column correccion_documental_motivo text,
  add column correccion_documental_actor uuid references public.perfil(id);
alter table public.almacen_preparacion_linea
  add column origenes_preparacion jsonb not null default '[]',
  add column origenes_revision jsonb,
  add column pendiente_tipo text check(pendiente_tipo in ('TIENDA','COMPRA_RAPIDA','COMPRA_GESTIONADA'));
create table almacen_operaciones.recepcion_pedido(
  id uuid primary key, pedido_linea_id bigint not null references public.pedido_linea(id),
  tipo text not null check(tipo in ('TIENDA','COMPRA_RAPIDA')),
  cantidad_base numeric not null check(cantidad_base>0 and cantidad_base<=1e12 and scale(cantidad_base)<=6),
  referencia text not null check(length(btrim(referencia)) between 1 and 200),
  sucursal_tienda_id bigint references public.sucursal(id),
  costo numeric check(costo>=0), actor_id uuid not null references public.perfil(id), actor_nombre text not null,
  creado_en timestamptz not null default now(),
  check(tipo='TIENDA' or sucursal_tienda_id is null)
);
create index recepcion_pedido_linea on almacen_operaciones.recepcion_pedido(pedido_linea_id);
create table almacen_operaciones.consumo_recepcion(
  preparacion_id bigint not null references public.almacen_preparacion(id),
  recepcion_id uuid not null references almacen_operaciones.recepcion_pedido(id),
  evento_id bigint not null references public.pedido_despacho_evento(id),
  cantidad_base numeric not null check(cantidad_base>0),
  primary key(preparacion_id,recepcion_id)
);
create index consumo_recepcion_recepcion on almacen_operaciones.consumo_recepcion(recepcion_id);
create index consumo_recepcion_evento on almacen_operaciones.consumo_recepcion(evento_id);
alter table almacen_operaciones.recepcion_pedido enable row level security;
alter table almacen_operaciones.consumo_recepcion enable row level security;
revoke all on almacen_operaciones.recepcion_pedido,almacen_operaciones.consumo_recepcion from public,anon,authenticated;

create function almacen_operaciones.saldo_recepcion(p_id uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select r.cantidad_base-coalesce((select sum(c.cantidad_base) from almacen_operaciones.consumo_recepcion c
    join public.pedido_despacho_evento e on e.id=c.evento_id where c.recepcion_id=r.id and not e.revertido),0)
  from almacen_operaciones.recepcion_pedido r where id=p_id
$$;
revoke all on function almacen_operaciones.saldo_recepcion(uuid) from public,anon,authenticated;

-- Sólo las salidas de inventario/existencia consumen una compra gestionada recibida.
-- Lo retirado por Tienda o compra rápida no libera esa cobertura para volver a comprar.
create function almacen_operaciones.saldo_compra_recibida(p_linea bigint) returns numeric
language sql stable security definer set search_path='' as $$
  select greatest(coalesce((select sum(cantidad_recibida) from public.compra_solicitud where pedido_linea_id=p_linea),0)-
    coalesce((select sum(case when e.abastecimiento_origenes is null then e.cantidad_base-
      coalesce((select sum(m.cantidad_revertida) from public.pedido_despacho_movimiento m where m.evento_id=e.id),0)
      else coalesce((select sum((o->>'cantidad_base')::numeric) from jsonb_array_elements(e.abastecimiento_origenes)o where o->>'tipo'='EXISTENCIA_PERSONALIZADA'),0) end)
      from public.pedido_despacho_evento e where e.pedido_linea_id=p_linea and not e.revertido),0),0)
$$;
revoke all on function almacen_operaciones.saldo_compra_recibida(bigint) from public,anon,authenticated;

create function almacen_operaciones.activar_abastecimiento() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.modo_abastecimiento:=coalesce((select activo and pedidos_dos_actores and abastecimiento_pedidos from evidencia_operacion.configuracion where id),false);
  return new;
end $$;
revoke all on function almacen_operaciones.activar_abastecimiento() from public,anon,authenticated;
create trigger preparacion_abastecimiento before insert on public.almacen_preparacion
for each row execute function almacen_operaciones.activar_abastecimiento();

-- Las recepciones documentales ya cubiertas no compiten por stock de Almacén.
do $$ declare v text;anterior text:='pl.cantidad_base - COALESCE(pl.cantidad_despachada, 0::numeric)';nuevo text;
begin
  v:=pg_get_viewdef('public.v_pedido_linea_reserva'::regclass,true);
  if position(anterior in v)=0 then raise exception 'Cambió la vista de reservas. Revisar antes de migrar.';end if;
  nuevo:='GREATEST(pl.cantidad_base-COALESCE(pl.cantidad_despachada,0::numeric)-coalesce((select sum(r.cantidad_base-coalesce((select sum(c.cantidad_base) from almacen_operaciones.consumo_recepcion c join public.pedido_despacho_evento e on e.id=c.evento_id where c.recepcion_id=r.id and not e.revertido),0)) from almacen_operaciones.recepcion_pedido r where r.pedido_linea_id=pl.id),0),0::numeric)';
  execute 'create or replace view public.v_pedido_linea_reserva as '||replace(v,anterior,nuevo);
end $$;

-- Despacho tradicional queda para gestión y correcciones; toda nueva salida usa QR.
create or replace function evidencia_operacion.proteger_despacho_pedido() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.cantidad_despachada>old.cantidad_despachada or
    (new.estado='COMPRADO_DIRECTO' and new.estado<>old.estado) or
    (new.estado='DESPACHADA' and new.estado<>old.estado and new.cantidad_base=old.cantidad_base) then
    if not exists(select 1 from evidencia_operacion.despacho_autorizado d
      join public.almacen_preparacion t on t.id=d.preparacion_id
      where t.pedido_id=new.pedido_id and d.transaccion=txid_current()) then
      raise exception 'Este pedido se entrega desde la miniapp: alistado, verificación, fotos y retiro.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;

create function almacen_operaciones.origenes_cantidad(p_tarea bigint,p_linea bigint,p_cantidad numeric,p_origenes jsonb,p_revision boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.almacen_preparacion_linea%rowtype;r almacen_operaciones.recepcion_pedido%rowtype;
  x jsonb;salida jsonb:='[]';suma numeric:=0;q numeric;resto numeric:=p_cantidad;lista jsonb;usados uuid[]:='{}';tipo text;
begin
  select * into l from public.almacen_preparacion_linea where preparacion_id=p_tarea and pedido_linea_id=p_linea and vigente;
  if l.pedido_linea_id is null then raise exception 'Línea ajena a esta entrega.';end if;
  if p_origenes is null then
    if p_revision then
      lista:=l.origenes_preparacion;
      for x in select * from jsonb_array_elements(lista) loop
        exit when resto<=0;q:=least(resto,(x->>'cantidad_base')::numeric);
        salida:=salida||jsonb_build_array(x||jsonb_build_object('cantidad_base',q));resto:=resto-q;
      end loop;
      if resto>0 then raise exception 'La cantidad supera lo alistado por origen. Devuelve al alistador para corregir.';end if;
      return salida;
    end if;
    -- Una cantidad simple reutiliza primero material recibido para este pedido.
    for r in select * from almacen_operaciones.recepcion_pedido where pedido_linea_id=p_linea order by creado_en,id loop
      exit when resto<=0;q:=least(resto,almacen_operaciones.saldo_recepcion(r.id));
      if q>0 then salida:=salida||jsonb_build_array(jsonb_build_object('tipo',r.tipo,'recepcion_id',r.id,'referencia',r.referencia,'cantidad_base',q));resto:=resto-q;end if;
    end loop;
    if resto>0 then salida:=salida||jsonb_build_array(jsonb_build_object('tipo',case when (l.snapshot->>'es_personalizado')::boolean then 'EXISTENCIA_PERSONALIZADA' else 'ALMACEN' end,'cantidad_base',resto));end if;
    p_origenes:=salida;salida:='[]';
  end if;
  if jsonb_typeof(p_origenes)<>'array' or jsonb_array_length(p_origenes)>50 then raise exception 'Orígenes inválidos.';end if;
  for x in select * from jsonb_array_elements(p_origenes) loop
    if coalesce(x->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' then raise exception 'Cantidad de origen inválida.';end if;
    q:=(x->>'cantidad_base')::numeric;tipo:=x->>'tipo';
    if q<=0 or q>1e12 then raise exception 'Cantidad de origen inválida.';end if;
    if tipo in ('TIENDA','COMPRA_RAPIDA') then
      select * into r from almacen_operaciones.recepcion_pedido rp where rp.id=(x->>'recepcion_id')::uuid and rp.pedido_linea_id=p_linea;
      if not found or r.tipo<>tipo or r.id=any(usados) or q>almacen_operaciones.saldo_recepcion(r.id) then raise exception 'La recepción no corresponde o no tiene saldo suficiente.';end if;
      usados:=array_append(usados,r.id);
      x:=jsonb_build_object('tipo',r.tipo,'recepcion_id',r.id,'referencia',r.referencia,'cantidad_base',q);
    elsif tipo in ('ALMACEN','EXISTENCIA_PERSONALIZADA') then
      if (tipo='EXISTENCIA_PERSONALIZADA') is distinct from (l.snapshot->>'es_personalizado')::boolean then raise exception 'Origen incompatible con el producto.';end if;
      if exists(select 1 from jsonb_array_elements(salida)y where y->>'tipo'=tipo) then raise exception 'Origen repetido.';end if;
      x:=jsonb_build_object('tipo',tipo,'cantidad_base',q);
    else raise exception 'Selecciona un origen válido.';end if;
    if p_revision and not exists(select 1 from jsonb_array_elements(l.origenes_preparacion)y
      where y->>'tipo'=x->>'tipo' and y->>'recepcion_id' is not distinct from x->>'recepcion_id'
        and q<=(y->>'cantidad_base')::numeric) then raise exception 'Devuelve la preparación para cambiar su origen o aumentar lo alistado.';end if;
    suma:=suma+q;salida:=salida||jsonb_build_array(x);
  end loop;
  if suma<>p_cantidad then raise exception 'Las cantidades por origen deben sumar la cantidad de la línea.';end if;
  return salida;
end $$;

create function almacen_operaciones.resumen_pedido(p_pedido bigint) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('estado',case when p.estado='COMPLETADO' then 'COMPLETADO' when p.estado='CANCELADO' then 'CANCELADO'
    when exists(select 1 from public.pedido_linea where pedido_id=p.id and (cantidad_despachada>0 or estado in ('DESPACHADA','COMPRADO_DIRECTO'))) then 'PARCIAL' else 'PENDIENTE' end,
    'entregas',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'numero',a.numero,'estado',a.estado,'preparador',a.preparador_nombre,'revisor',a.revisor_nombre,'fecha',a.actualizado_en) order by a.id)
      from (select t.*,row_number() over(order by t.id) numero from public.almacen_preparacion t where pedido_id=p.id) a),'[]'))
  from public.pedido p where id=p_pedido
$$;
revoke all on function almacen_operaciones.resumen_pedido(bigint) from public,anon,authenticated;

create function almacen_operaciones.enriquecer_abastecimiento(p_resultado jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=p_resultado;l jsonb;ls jsonb:='[]';t public.almacen_preparacion%rowtype;pid bigint;
begin
  pid:=(r->'pedido'->>'id')::bigint;
  select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
  for l in select * from jsonb_array_elements(coalesce(r->'lineas','[]')) loop
    l:=l||jsonb_build_object('recepciones',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('saldo',almacen_operaciones.saldo_recepcion(a.id)) order by a.creado_en,a.id)
      from almacen_operaciones.recepcion_pedido a where a.pedido_linea_id=(l->>'pedido_linea_id')::bigint),'[]'),
      'compras',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'estado',c.estado,'cantidad_base',c.cantidad_base,'cantidad_recibida',c.cantidad_recibida,'referencia',c.nota_compra) order by c.id)
      from public.compra_solicitud c where c.pedido_linea_id=(l->>'pedido_linea_id')::bigint),'[]'),
      'snapshot',(l->'snapshot')||jsonb_build_object('marca',(select marca from public.producto where id=(l->'snapshot'->>'producto_id')::bigint)));
    ls:=ls||jsonb_build_array(l);
  end loop;
  if t.id is not null and not t.flujo_dos_actores and t.estado='VERIFICADO' then
    r:=r||jsonb_build_object('salida_qr_legada',true,'plan_salida',evidencia_operacion.plan_salida(t.id));
  end if;
  return r||jsonb_build_object('lineas',ls,'abastecimiento',coalesce(t.modo_abastecimiento,false),'resumen_pedido',almacen_operaciones.resumen_pedido(pid),
    'numero_entrega',(select count(*) from public.almacen_preparacion where pedido_id=pid and id<=t.id));
end $$;
revoke all on function almacen_operaciones.enriquecer_abastecimiento(jsonb) from public,anon,authenticated;

do $$ begin
  execute replace(pg_get_functiondef('evidencia_operacion.plan_salida(bigint)'::regprocedure),'FUNCTION evidencia_operacion.plan_salida(','FUNCTION evidencia_operacion.plan_salida_v1(');
  execute replace(pg_get_functiondef('evidencia_operacion.encolar_pedido(uuid,bigint,text)'::regprocedure),'FUNCTION evidencia_operacion.encolar_pedido(','FUNCTION evidencia_operacion.encolar_pedido_v1(');
end $$;
revoke all on function evidencia_operacion.plan_salida_v1(bigint),evidencia_operacion.encolar_pedido_v1(uuid,bigint,text) from public,anon,authenticated;

create or replace function evidencia_operacion.encolar_pedido(p_lote uuid,p_tarea bigint,p_destino text default null) returns void
language plpgsql security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;e evidencia_operacion.lote%rowtype;texto text;material text;numero text;v_estado text;entrega bigint;
begin
  select * into t from public.almacen_preparacion where id=p_tarea;
  if not t.modo_abastecimiento then perform evidencia_operacion.encolar_pedido_v1(p_lote,p_tarea,p_destino);return;end if;
  select * into e from evidencia_operacion.lote where id=p_lote;
  select coalesce(p.numero,'#'||p.id) into numero from public.pedido p where id=t.pedido_id;
  select count(*) into entrega from public.almacen_preparacion where pedido_id=t.pedido_id and id<=t.id;
  v_estado:=case when e.etapa='PREPARACION' then 'Alistado' when (almacen_operaciones.resumen_pedido(t.pedido_id)->>'estado')='COMPLETADO' then 'Final' else 'Parcial · pendiente de completar' end;
  select string_agg(case when q=0 then '❌ ' when q<(snapshot->>'pendiente_base')::numeric then '⚠️ ' else '✅ ' end||
    regexp_replace(coalesce(snapshot->>'nombre','Producto'),E'[\r\n]+',' ','g')||' · '||case when e.etapa='SALIDA' then 'salen ' else 'alistado ' end||
    trim_scale(q/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||' de '||trim_scale((snapshot->>'pendiente_base')::numeric/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||' '||coalesce(snapshot->>'presentacion',snapshot->>'unidad_base','unidades')||
    ' · pendiente '||trim_scale(((snapshot->>'pendiente_base')::numeric-q)/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||
    coalesce((select ' · '||string_agg(case x->>'tipo' when 'COMPRA_RAPIDA' then 'Compra rápida para este pedido' when 'TIENDA' then 'Traído de Tienda' when 'ALMACEN' then 'Almacén' else 'Existencia personalizada' end||
      ': '||trim_scale((x->>'cantidad_base')::numeric/coalesce(nullif((snapshot->>'factor')::numeric,0),1))||coalesce(' ('||nullif(x->>'referencia','')||')',''),'; ') from jsonb_array_elements(origenes)x),'')||
    case when observacion<>'' then ' · '||regexp_replace(observacion,E'[\r\n]+',' ','g') else '' end||coalesce(' · pendiente: '||pendiente_tipo,'') ,E'\n' order by pedido_linea_id)
  into material from (select l.*,case when e.etapa='SALIDA' then coalesce(revisada_base,0) else preparada_base end q,
    case when e.etapa='SALIDA' then coalesce(origenes_revision,'[]') else origenes_preparacion end origenes
    from public.almacen_preparacion_linea l where preparacion_id=p_tarea and vigente) z;
  texto:=case when e.etapa='SALIDA' then '🚚 PEDIDO RETIRADO · ' else '📦 PEDIDO ALISTADO · ' end||numero||
    E'\n🧾 Entrega '||entrega||' · '||v_estado||E'\n👷 Alistó: '||t.preparador_nombre||
    case when e.etapa='SALIDA' then E'\n🔎 Revisó y retira: '||t.revisor_nombre||E'\n📍 Destino: '||p_destino else '' end||
    E'\n🕒 '||to_char(now() at time zone 'America/La_Paz','DD/MM/YYYY HH24:MI')||E'\n'||coalesce(material,'')||E'\n📸 Ref. '||e.id;
  update evidencia_operacion.lote set estado='PENDIENTE',caption=numero||' · Entrega '||entrega||' · '||v_estado||E'\n📋 Detalle completo en los mensajes numerados.\n📸 Ref. '||e.id,
    mensajes=evidencia_operacion.partir_texto(texto),proximo_intento=now() where id=p_lote;
end $$;

create function almacen_operaciones.despachar_documental(p_tarea bigint,p_linea bigint,p_origenes jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare l public.pedido_linea%rowtype;a public.perfil%rowtype;q numeric;eid bigint;x jsonb;
begin
  if not exists(select 1 from evidencia_operacion.despacho_autorizado where preparacion_id=p_tarea and transaccion=txid_current()) then raise exception 'Salida documental no autorizada.' using errcode='42501';end if;
  select * into l from public.pedido_linea where id=p_linea for update;
  select * into a from public.perfil where id=auth.uid() and activo;
  select coalesce(sum((z->>'cantidad_base')::numeric),0) into q from jsonb_array_elements(p_origenes)z where z->>'tipo'<>'ALMACEN';
  if q=0 then return;end if;
  if a.id is null or q>l.cantidad_base-l.cantidad_despachada then raise exception 'Cantidad documental supera lo pendiente.';end if;
  insert into public.pedido_despacho_evento(pedido_linea_id,cantidad_base,creado_por,abastecimiento_origenes)
    values(l.id,q,a.nombre,p_origenes) returning id into eid;
  for x in select * from jsonb_array_elements(p_origenes) where value->>'recepcion_id' is not null loop
    if (x->>'cantidad_base')::numeric>almacen_operaciones.saldo_recepcion((x->>'recepcion_id')::uuid) then raise exception 'Saldo de recepción insuficiente.';end if;
    insert into almacen_operaciones.consumo_recepcion(preparacion_id,recepcion_id,evento_id,cantidad_base)
      values(p_tarea,(x->>'recepcion_id')::uuid,eid,(x->>'cantidad_base')::numeric);
  end loop;
  update public.pedido_linea set cantidad_despachada=cantidad_despachada+q,
    estado=case when cantidad_despachada+q=cantidad_base then 'DESPACHADA'::public.estado_linea when es_personalizado then 'ESPECIAL'::public.estado_linea else 'PENDIENTE'::public.estado_linea end,
    modificado_por=a.nombre,modificado_en=now() where id=l.id;
  perform public.recalcular_estado_pedido(l.pedido_id);
end $$;
revoke all on function almacen_operaciones.despachar_documental(bigint,bigint,jsonb) from public,anon,authenticated;
revoke all on function almacen_operaciones.origenes_cantidad(bigint,bigint,numeric,jsonb,boolean) from public,anon,authenticated;

-- Corrección autorizada de una salida documental completa: devuelve su asignación
-- al mismo pedido y no produce entradas ficticias en Kardex ni stock de Tienda.
create function almacen_operaciones.corregir_salida_documental(p_evento bigint,p_motivo text,p_intento uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.pedido_despacho_evento%rowtype;l public.pedido_linea%rowtype;a public.perfil%rowtype;pid bigint;
begin
  select * into a from public.perfil where id=auth.uid() and activo and rol in ('admin','gerente');
  if a.id is null then raise exception 'Sólo un encargado puede corregir una salida documental.' using errcode='42501';end if;
  if p_intento is null or length(btrim(coalesce(p_motivo,''))) not between 3 and 1000 then raise exception 'Indica el motivo de la corrección.';end if;
  select pl.pedido_id into pid from public.pedido_despacho_evento ev join public.pedido_linea pl on pl.id=ev.pedido_linea_id where ev.id=p_evento;
  perform 1 from public.pedido where id=pid for update;
  select * into l from public.pedido_linea where id=(select pedido_linea_id from public.pedido_despacho_evento where id=p_evento) for update;
  select * into e from public.pedido_despacho_evento where id=p_evento for update;
  if e.id is null or e.abastecimiento_origenes is null then raise exception 'Esta salida requiere su corrección de inventario habitual.';end if;
  if e.revertido then
    if e.correccion_documental_id is distinct from p_intento or e.correccion_documental_actor is distinct from a.id or e.correccion_documental_motivo<>btrim(p_motivo) then raise exception 'La salida ya fue corregida.';end if;
  else
    if l.cantidad_despachada<e.cantidad_base then raise exception 'Las cantidades cambiaron. Revisa el historial antes de corregir.';end if;
    update public.pedido_despacho_evento set revertido=true,revertido_en=now(),correccion_documental_id=p_intento,
      correccion_documental_motivo=btrim(p_motivo),correccion_documental_actor=a.id where id=e.id;
    update public.pedido_linea set cantidad_despachada=cantidad_despachada-e.cantidad_base,
      estado=case when es_personalizado then 'ESPECIAL'::public.estado_linea when cantidad_despachada-e.cantidad_base>0 then 'PENDIENTE'::public.estado_linea else 'POR_DESPACHAR'::public.estado_linea end,
      modificado_por=a.nombre,modificado_en=now() where id=l.id;
    insert into public.pedido_evento(pedido_id,accion,motivo,usuario) values(pid,'CORRECCION_SALIDA_DOCUMENTAL',btrim(p_motivo),a.nombre);
    perform public.recalcular_estado_pedido(pid);
    select * into l from public.pedido_linea where id=l.id;
  end if;
  return jsonb_build_object('linea_id',l.id,'evento_id',e.id,'cantidad_despachada',l.cantidad_despachada,'nuevo_estado_linea',l.estado,'evento_revertido_total',true);
end $$;
revoke all on function almacen_operaciones.corregir_salida_documental(bigint,text,uuid) from public,anon;
grant execute on function almacen_operaciones.corregir_salida_documental(bigint,text,uuid) to authenticated;
create function public.corregir_salida_documental(p_evento bigint,p_motivo text,p_intento uuid) returns jsonb
language sql security invoker set search_path='' as $$select almacen_operaciones.corregir_salida_documental(p_evento,p_motivo,p_intento)$$;
revoke all on function public.corregir_salida_documental(bigint,text,uuid) from public,anon;
grant execute on function public.corregir_salida_documental(bigint,text,uuid) to authenticated;


create or replace function evidencia_operacion.plan_salida(p_tarea bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.almacen_preparacion%rowtype;l record;u record;x jsonb;restante numeric;tomar numeric;
  asignaciones jsonb;plan jsonb:='[]';error text;usadas jsonb:='{}';clave text;origenes jsonb;
begin
  select * into t from public.almacen_preparacion where id=p_tarea;
  if not t.modo_abastecimiento then return evidencia_operacion.plan_salida_v1(p_tarea);end if;
  for l in select * from public.almacen_preparacion_linea where preparacion_id=p_tarea and vigente and revisada_base>0 order by pedido_linea_id loop
    restante:=0;asignaciones:='[]';error:=null;origenes:=coalesce(l.origenes_revision,'[]');
    if (select coalesce(sum((z->>'cantidad_base')::numeric),0) from jsonb_array_elements(origenes)z)<>l.revisada_base then error:='Comprueba las cantidades por origen.';end if;
    for x in select * from jsonb_array_elements(origenes) loop
      if x->>'tipo'='ALMACEN' then restante:=restante+(x->>'cantidad_base')::numeric;
      elsif x->>'recepcion_id' is not null and (x->>'cantidad_base')::numeric>coalesce(almacen_operaciones.saldo_recepcion((x->>'recepcion_id')::uuid),0) then error:='La recepción asignada ya no tiene saldo suficiente.';end if;
    end loop;
    for u in select s.ubicacion_id,sum(s.cantidad_base) as cantidad_base,concat_ws(' · ',b.codigo_zona,b.estante,b.nivel,b.compartimiento) as nombre
      from public.stock_actual s join public.ubicacion b on b.id=s.ubicacion_id
      where s.producto_id=(l.snapshot->>'producto_id')::bigint and b.sucursal_id=t.sucursal_id and not coalesce(b.excluye_disponible,false)
      group by s.ubicacion_id,b.codigo_zona,b.estante,b.nivel,b.compartimiento having sum(s.cantidad_base)>0 order by sum(s.cantidad_base) desc,s.ubicacion_id
    loop
      exit when restante<=0;clave:=(l.snapshot->>'producto_id')||':'||u.ubicacion_id;
      tomar:=least(restante,u.cantidad_base-coalesce((usadas->>clave)::numeric,0));
      if tomar<=0 then continue;end if;
      usadas:=jsonb_set(usadas,array[clave],to_jsonb(coalesce((usadas->>clave)::numeric,0)+tomar));
      asignaciones:=asignaciones||jsonb_build_array(jsonb_build_object('ubicacion_id',u.ubicacion_id,'cantidad_base',tomar,'nombre',u.nombre));restante:=restante-tomar;
    end loop;
    if restante>0 then error:='Stock insuficiente para la parte que sale de Almacén.';end if;
    plan:=plan||jsonb_build_array(jsonb_build_object('linea_id',l.pedido_linea_id,'cantidad_base',l.revisada_base,'asignaciones',asignaciones,'origenes',origenes,'error',error));
  end loop;
  return plan;
end $$;

create function almacen_operaciones.operar_abastecimiento(p_pedido bigint,p_sucursal bigint,p_tarea bigint,p_accion text,p_version integer,p_datos jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r jsonb;t public.almacen_preparacion%rowtype;a public.perfil%rowtype;l public.almacen_preparacion_linea%rowtype;
  pl public.pedido_linea%rowtype;recepcion almacen_operaciones.recepcion_pedido%rowtype;c public.compra_solicitud%rowtype;
  e evidencia_operacion.lote%rowtype;retiro evidencia_operacion.retiro%rowtype;
  accion text:=p_accion;q numeric;ref text;tipo text;saldo numeric;formal numeric;origenes jsonb;plan jsonb;x jsonb;datos jsonb;confirmacion jsonb;
begin
  -- El motor anterior autentica y bloquea pedido/líneas/preparación en su orden habitual.
  r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,p_tarea,'consultar',null,'{}');
  if accion in ('crear','escanear') then
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,p_tarea,
      case when accion='escanear' and p_tarea is null and r->'pedido'->>'estado'='ABIERTO' and r->'tarea'->>'estado' in ('DESPACHADO','ANULADO') then 'crear' else accion end,p_version,p_datos);accion:='consultar';
  end if;
  select * into t from public.almacen_preparacion where id=(r->'tarea'->>'id')::bigint;
  if not coalesce(t.modo_abastecimiento,false) then
    -- Entregas del circuito anterior conservan cantidades/revisión y retiro posterior.
    -- La confirmación de stock migra al QR; los endpoints tradicionales siguen cerrados.
    if accion='confirmar_salida_legada' then
      if t.estado='DESPACHADO' and exists(select 1 from public.almacen_preparacion_evento pe where pe.preparacion_id=t.id and pe.accion='SALIDA_QR_LEGADA' and pe.actor_id=auth.uid() and pe.detalle->'plan'=p_datos->'plan') then return almacen_operaciones.enriquecer_abastecimiento(r);end if;
      select * into a from public.perfil where id=auth.uid() and activo;
      if t.flujo_dos_actores or t.estado<>'VERIFICADO' or t.revisor_id is distinct from a.id or t.preparador_id=a.id then raise exception 'Sólo el verificador confirma esta salida anterior desde QR.' using errcode='42501';end if;
      if p_version is distinct from t.version or jsonb_array_length(r->'cambios')>0 then raise exception 'La entrega cambió. Actualiza.' using errcode='40001';end if;
      plan:=evidencia_operacion.plan_salida(t.id);
      if plan is distinct from p_datos->'plan' or jsonb_array_length(plan)=0 or exists(select 1 from jsonb_array_elements(plan) z where z->>'error' is not null) then raise exception 'Comprueba el plan de salida antes de confirmar.';end if;
      insert into evidencia_operacion.despacho_autorizado values(t.id,txid_current());
      for x in select * from jsonb_array_elements(plan) loop
        if exists(select 1 from public.pedido_linea where id=(x->>'linea_id')::bigint and es_personalizado) then perform public.entregar_personalizado((x->>'linea_id')::bigint,a.nombre);
        else
          select jsonb_agg(jsonb_build_object('ubicacion_id',z->'ubicacion_id','cantidad_base',z->'cantidad_base')) into datos from jsonb_array_elements(x->'asignaciones')z;
          perform public.despachar_linea((x->>'linea_id')::bigint,datos,a.nombre);
        end if;
      end loop;
      delete from evidencia_operacion.despacho_autorizado where preparacion_id=t.id;
      insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle) values(t.id,'SALIDA_QR_LEGADA',a.id,a.nombre,jsonb_build_object('plan',plan));
      r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,'consultar',null,'{}');
      return almacen_operaciones.enriquecer_abastecimiento(r);
    end if;
    if accion<>'consultar' then r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,p_tarea,accion,p_version,p_datos);end if;
    return almacen_operaciones.enriquecer_abastecimiento(r);
  end if;
  select * into a from public.perfil where id=auth.uid() and activo;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' or octet_length(p_datos::text)>1000000 then raise exception 'Datos inválidos.';end if;
  -- Reintentos exactos se recuperan antes de comprobar la versión que ya avanzó.
  if accion='registrar_abastecimiento' then
    select * into recepcion from almacen_operaciones.recepcion_pedido where id=(p_datos->>'id')::uuid;
    if found then
      if recepcion.actor_id<>a.id or recepcion.pedido_linea_id<>(p_datos->>'linea_id')::bigint or recepcion.tipo<>p_datos->>'tipo'
        or recepcion.cantidad_base<>(p_datos->>'cantidad_base')::numeric or recepcion.referencia<>btrim(coalesce(p_datos->>'referencia','Tercero'))
        or recepcion.costo is distinct from nullif(p_datos->>'costo','')::numeric
        or recepcion.sucursal_tienda_id is distinct from nullif(p_datos->>'sucursal_tienda_id','')::bigint
        or not exists(select 1 from public.pedido_linea where id=recepcion.pedido_linea_id and pedido_id=p_pedido) then
        raise exception 'La clave pertenece a otra recepción.' using errcode='42501';end if;
      return almacen_operaciones.enriquecer_abastecimiento(r);
    end if;
  elsif accion='preparado' then
    select * into e from evidencia_operacion.lote where id=(p_datos->>'evidencia_id')::uuid;
    if e.id is not null and e.estado<>'BORRADOR' and e.tipo='PEDIDO' and e.etapa='PREPARACION'
      and e.preparacion_id=t.id and e.actor_id=a.id and e.version=p_version then return almacen_operaciones.enriquecer_abastecimiento(r);end if;
  elsif accion='confirmar_retiro' then
    select * into retiro from evidencia_operacion.retiro where preparacion_id=t.id;
    if found then
      if retiro.transportista_id=a.id and retiro.evidencia_id=(p_datos->>'evidencia_id')::uuid
        and retiro.destino=btrim(p_datos->>'destino') and retiro.asignaciones=p_datos->'plan' then return almacen_operaciones.enriquecer_abastecimiento(r);end if;
      raise exception 'La entrega ya tiene otro retiro confirmado.';
    end if;
  end if;
  if accion<>'consultar' then
    if p_version is distinct from t.version then raise exception 'La entrega cambió. Actualiza.' using errcode='40001';end if;
    if accion not in ('sincronizar','devolver','reabrir','reasignar','anular') and jsonb_array_length(r->'cambios')>0 then raise exception 'El pedido cambió. Actualiza la preparación.' using errcode='40001';end if;
  end if;
  if accion in ('registrar_abastecimiento','declarar_pendiente','gestionar_compra','guardar_preparacion') then
    if t.estado<>'PREPARANDO' or t.preparador_id is distinct from a.id then raise exception 'Sólo el alistador asignado puede declarar el abastecimiento.' using errcode='42501';end if;
    select * into l from public.almacen_preparacion_linea where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint and vigente;
    if not found then raise exception 'La línea no pertenece a esta entrega.';end if;
    select * into pl from public.pedido_linea where id=l.pedido_linea_id;
  end if;
  if accion='registrar_abastecimiento' then
    if coalesce(p_datos->>'cantidad_base','') !~ '^\d+(\.\d{1,6})?$' or (p_datos->>'cantidad_base')::numeric<=0 then raise exception 'Indica una cantidad positiva de hasta seis decimales.';end if;
    q:=(p_datos->>'cantidad_base')::numeric;tipo:=p_datos->>'tipo';ref:=btrim(coalesce(nullif(p_datos->>'referencia',''),'Tercero'));
    if tipo not in ('TIENDA','COMPRA_RAPIDA') or length(ref)>200 or p_datos->>'id' is null then raise exception 'Indica origen y referencia válidos.';end if;
    if tipo='TIENDA' and not exists(select 1 from public.sucursal s where s.id=(p_datos->>'sucursal_tienda_id')::bigint and s.activo and s.tipo='fisica' and s.id<>p_sucursal) then raise exception 'Selecciona la Tienda de origen.';end if;
    select coalesce(sum(almacen_operaciones.saldo_recepcion(id)),0) into saldo from almacen_operaciones.recepcion_pedido where pedido_linea_id=pl.id;
    formal:=almacen_operaciones.saldo_compra_recibida(pl.id);
    if q>pl.cantidad_base-pl.cantidad_despachada-saldo-formal then raise exception 'La cantidad supera el saldo sin abastecer o ya tiene una compra recibida. Reutiliza la compra existente.';end if;
    select * into c from public.compra_solicitud where pedido_linea_id=pl.id and estado in ('SOLICITADA','COMPRADA') for update;
    if c.estado='COMPRADA' and q>greatest(pl.cantidad_base-pl.cantidad_despachada-saldo-formal-(c.cantidad_base-c.cantidad_recibida),0) then raise exception 'Existe una compra comprometida para esa cantidad. Resuélvela desde Compras antes de registrar otra.';end if;
    if c.estado='SOLICITADA' then
      update public.compra_solicitud set cantidad_base=case when c.cantidad_base-q<=c.cantidad_recibida then c.cantidad_base else c.cantidad_base-q end,
        estado=case when c.cantidad_base-q<=c.cantidad_recibida then 'CANCELADA' else estado end,
        cancelado_en=case when c.cantidad_base-q<=c.cantidad_recibida then now() end,
        cancelado_motivo=case when c.cantidad_base-q<=c.cantidad_recibida then 'Cubierta por abastecimiento directo al pedido' end
        where id=c.id;
      insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle)
        values(t.id,'SOLICITUD_REDUCIDA',a.id,a.nombre,jsonb_build_object('solicitud_id',c.id,'cantidad_anterior',c.cantidad_base,'cantidad_cubierta',q,'recepcion_id',p_datos->>'id'));
    end if;
    insert into almacen_operaciones.recepcion_pedido(id,pedido_linea_id,tipo,cantidad_base,referencia,sucursal_tienda_id,costo,actor_id,actor_nombre)
      values((p_datos->>'id')::uuid,pl.id,tipo,q,ref,nullif(p_datos->>'sucursal_tienda_id','')::bigint,nullif(p_datos->>'costo','')::numeric,a.id,a.nombre);
    if pl.estado='POR_COMPRAR' then
      update public.pedido_linea set estado='POR_DESPACHAR',modificado_por=a.nombre,modificado_en=now() where id=pl.id;
      update public.almacen_preparacion_linea set snapshot=(select datos from almacen_operaciones.lineas_actuales(p_pedido,p_sucursal) where linea_id=pl.id) where preparacion_id=t.id and pedido_linea_id=pl.id;
    end if;
    update public.almacen_preparacion set version=version+1,actualizado_en=now() where id=t.id;
  elsif accion='gestionar_compra' then
    q:=nullif(p_datos->>'cantidad_base','')::numeric;
    select coalesce(sum(almacen_operaciones.saldo_recepcion(id)),0) into saldo from almacen_operaciones.recepcion_pedido where pedido_linea_id=pl.id;
    formal:=almacen_operaciones.saldo_compra_recibida(pl.id);
    if q is null or q<=0 or q>1e12 or scale(q)>6 or q>pl.cantidad_base-pl.cantidad_despachada-saldo-formal then raise exception 'Cantidad de compra supera el saldo sin abastecer o ya tiene una compra recibida.';end if;
    select * into c from public.compra_solicitud where pedido_linea_id=pl.id and estado in ('SOLICITADA','COMPRADA') for update;
    if c.estado='COMPRADA' then raise exception 'La compra ya está comprometida. Consulta su gestión desde Compras.';
    elsif c.id is not null then update public.compra_solicitud set cantidad_base=cantidad_recibida+q,motivo=p_datos->>'observacion' where id=c.id;
    elsif pl.es_personalizado or pl.estado='POR_COMPRAR' then
      insert into public.compra_solicitud(pedido_linea_id,producto_id,descripcion,cantidad_base,origen,motivo,solicitado_por)
        values(pl.id,pl.producto_id,pl.descripcion,q,case when pl.es_personalizado then 'PERSONALIZADO' else 'ALMACEN' end,p_datos->>'observacion',a.nombre);
    else perform public.enviar_linea_a_compra(pl.id,q,p_datos->>'observacion',a.nombre);end if;
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,'sincronizar',t.version,jsonb_build_object('observacion','Compra gestionada desde la miniapp'));
    update public.almacen_preparacion_linea set pendiente_tipo='COMPRA_GESTIONADA',confirmada=true,preparada_base=0,
      observacion=coalesce(nullif(p_datos->>'observacion',''),'Pendiente de compra gestionada')
      where preparacion_id=t.id and vigente and snapshot->>'estado'='POR_COMPRAR';
    update public.almacen_preparacion_linea set origenes_preparacion='[]',origenes_revision=null where preparacion_id=t.id and not confirmada;
  elsif accion='declarar_pendiente' then
    if coalesce(p_datos->>'pendiente_tipo','') not in ('TIENDA','COMPRA_RAPIDA','COMPRA_GESTIONADA') or btrim(coalesce(p_datos->>'observacion',''))='' then raise exception 'Declara qué se hará con el faltante y su motivo.';end if;
    update public.almacen_preparacion_linea set pendiente_tipo=p_datos->>'pendiente_tipo',observacion=left(p_datos->>'observacion',1000) where preparacion_id=t.id and pedido_linea_id=pl.id;
    update public.almacen_preparacion set version=version+1,actualizado_en=now() where id=t.id;
  elsif accion in ('guardar_preparacion','guardar_revision') then
    q:=nullif(p_datos->>'cantidad_base','')::numeric;
    if q is null or q<0 or q>1e12 or scale(q)>6 then raise exception 'Cantidad inválida.';end if;
    origenes:=almacen_operaciones.origenes_cantidad(t.id,(p_datos->>'linea_id')::bigint,q,p_datos->'origenes',accion='guardar_revision');
    if accion='guardar_preparacion' and q<(l.snapshot->>'pendiente_base')::numeric then
      tipo:=coalesce(p_datos->>'pendiente_tipo',l.pendiente_tipo,case when l.snapshot->>'estado'='POR_COMPRAR' then 'COMPRA_GESTIONADA' end);
      if coalesce(tipo,'') not in ('TIENDA','COMPRA_RAPIDA','COMPRA_GESTIONADA') then raise exception 'Declara qué se hará con la cantidad pendiente.';end if;
    else tipo:=null;end if;
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,accion,p_version,p_datos);
    if accion='guardar_preparacion' then update public.almacen_preparacion_linea set origenes_preparacion=origenes,origenes_revision=null,pendiente_tipo=tipo where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint;
    else update public.almacen_preparacion_linea set origenes_revision=origenes where preparacion_id=t.id and pedido_linea_id=(p_datos->>'linea_id')::bigint;end if;
  elsif accion in ('confirmar_resto','confirmar_resto_revision') then
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,accion,p_version,p_datos);confirmacion:=r->'confirmacion_preparacion';
    for l in select * from public.almacen_preparacion_linea where preparacion_id=t.id and vigente loop
      if accion='confirmar_resto' and jsonb_array_length(l.origenes_preparacion)=0 and l.preparada_base>0 then
        update public.almacen_preparacion_linea set origenes_preparacion=almacen_operaciones.origenes_cantidad(t.id,l.pedido_linea_id,l.preparada_base,null) where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
      elsif accion='confirmar_resto_revision' and l.origenes_revision is null and l.revisada_base is not null then
        update public.almacen_preparacion_linea set origenes_revision=almacen_operaciones.origenes_cantidad(t.id,l.pedido_linea_id,l.revisada_base,null,true) where preparacion_id=t.id and pedido_linea_id=l.pedido_linea_id;
      end if;
    end loop;
    update public.almacen_preparacion_linea set pendiente_tipo='COMPRA_GESTIONADA' where preparacion_id=t.id and vigente and snapshot->>'estado'='POR_COMPRAR' and preparada_base=0 and pendiente_tipo is null;
  elsif accion='preparado' then
    if exists(select 1 from public.almacen_preparacion_linea where preparacion_id=t.id and vigente and preparada_base<(snapshot->>'pendiente_base')::numeric and pendiente_tipo is null) then raise exception 'Declara qué se hará con cada faltante antes de enviar.';end if;
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,accion,p_version,p_datos);
  elsif accion='confirmar_retiro' then
    if t.revisor_id is distinct from a.id or t.preparador_id=a.id or t.estado not in ('REVISANDO','VERIFICADO') then raise exception 'Sólo el verificador asignado puede confirmar el retiro.' using errcode='42501';end if;
    ref:=btrim(coalesce(p_datos->>'destino',''));
    if length(ref) not between 3 and 300 then raise exception 'Indica el destino de la entrega.';end if;
    e:=evidencia_operacion.validar_lote((p_datos->>'evidencia_id')::uuid,'PEDIDO',p_pedido,t.id,t.version);
    if e.etapa<>'SALIDA' then raise exception 'Adjunta fotos de la salida.';end if;
    plan:=evidencia_operacion.plan_salida(t.id);
    if plan is distinct from p_datos->'plan' then raise exception 'Cambió el plan de salida. Actualiza y comprueba los orígenes.' using errcode='40001';end if;
    if jsonb_array_length(plan)=0 or exists(select 1 from jsonb_array_elements(plan)z where z->>'error' is not null) then raise exception 'Comprueba el stock y las cantidades por origen antes de retirar.';end if;
    if t.estado='REVISANDO' then r:=almacen_operaciones.operar(p_pedido,p_sucursal,t.id,'verificado',p_version,'{}');end if;
    insert into evidencia_operacion.despacho_autorizado values(t.id,txid_current());
    for x in select * from jsonb_array_elements(plan) loop
      if jsonb_array_length(x->'asignaciones')>0 then
        select jsonb_agg(jsonb_build_object('ubicacion_id',z->'ubicacion_id','cantidad_base',z->'cantidad_base')) into datos from jsonb_array_elements(x->'asignaciones')z;
        perform public.despachar_linea((x->>'linea_id')::bigint,datos,a.nombre);
      end if;
      perform almacen_operaciones.despachar_documental(t.id,(x->>'linea_id')::bigint,x->'origenes');
    end loop;
    delete from evidencia_operacion.despacho_autorizado where preparacion_id=t.id;
    update public.almacen_preparacion set estado='DESPACHADO',verificado_en=coalesce(verificado_en,now()),version=version+1,actualizado_en=now() where id=t.id;
    insert into evidencia_operacion.retiro(preparacion_id,transportista_id,transportista_nombre,destino,evidencia_id,asignaciones) values(t.id,a.id,a.nombre,ref,e.id,plan);
    insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle) values(t.id,'REVISION_Y_RETIRO',a.id,a.nombre,jsonb_build_object('destino',ref,'evidencia_id',e.id,'asignaciones',plan));
    perform evidencia_operacion.encolar_pedido(e.id,t.id,ref);
  elsif accion<>'consultar' then
    r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,accion,p_version,p_datos);
    if accion in ('reabrir','devolver','sincronizar','reasignar') then
      update public.almacen_preparacion_linea set origenes_revision=null where preparacion_id=t.id;
      update public.almacen_preparacion_linea set origenes_preparacion='[]' where preparacion_id=t.id and not confirmada;
    end if;
  end if;
  if accion in ('registrar_abastecimiento','declarar_pendiente','gestionar_compra') then
    insert into public.almacen_preparacion_evento(preparacion_id,accion,actor_id,actor_nombre,detalle) values(t.id,upper(accion),a.id,a.nombre,p_datos);
  end if;
  r:=evidencia_operacion.preparacion_dos(p_pedido,p_sucursal,t.id,'consultar',null,'{}');
  return almacen_operaciones.enriquecer_abastecimiento(r||jsonb_build_object('confirmacion_preparacion',confirmacion));
end $$;
revoke all on function almacen_operaciones.operar_abastecimiento(bigint,bigint,bigint,text,integer,jsonb) from public,anon;
grant execute on function almacen_operaciones.operar_abastecimiento(bigint,bigint,bigint,text,integer,jsonb) to authenticated;
create or replace function public.operar_preparacion_pedido(p_pedido_id bigint,p_sucursal_id bigint,p_tarea_id bigint default null,p_accion text default 'consultar',p_version integer default null,p_datos jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select almacen_operaciones.operar_abastecimiento(p_pedido_id,p_sucursal_id,p_tarea_id,p_accion,p_version,p_datos) $$;
revoke execute on function evidencia_operacion.preparacion_dos(bigint,bigint,bigint,text,integer,jsonb) from authenticated;
notify pgrst,'reload schema';
