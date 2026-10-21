-- Reportes operativos: nunca escriben stock, Kardex ni aprobaciones de conteo.
-- Versión alineada con el historial remoto después de crearla con la CLI.
-- Esquema privado; únicamente el wrapper INVOKER se expone por la Data API.
create schema reportes_almacen;
revoke all on schema reportes_almacen from public, anon, authenticated;

create table reportes_almacen.turno (
  id bigint generated always as identity primary key,
  solicitud uuid not null unique,
  sucursal_id bigint not null references public.sucursal(id),
  fecha date not null, turno text not null check(turno in ('MANANA','TARDE')),
  inicio timestamptz not null, fin timestamptz not null,
  estado text not null default 'BORRADOR' check(estado in ('BORRADOR','REVISION','ENTREGADO','RECIBIDO')),
  version integer not null default 1,
  creado_por uuid not null references public.perfil(id), creado_en timestamptz not null default clock_timestamp(),
  anterior_id bigint references reportes_almacen.turno(id),
  observacion text not null default '', entregado_en timestamptz,
  recibido_por uuid references public.perfil(id), recibido_en timestamptz, recepcion_nota text,
  unique(sucursal_id,fecha,turno)
);
create table reportes_almacen.linea (
  id bigint generated always as identity primary key,
  reporte_id bigint not null references reportes_almacen.turno(id),
  numero integer not null, producto_id bigint not null references public.producto(id),
  ubicacion_id bigint not null references public.ubicacion(id),
  nombre text not null, sku text, unidad text not null, ubicacion text not null,
  empaque text not null, factor numeric not null check(factor>=1 and factor<1000000000000),
  origen text not null, empaques numeric, sueltas numeric, contado_en timestamptz,
  declarado numeric generated always as (empaques*factor+sueltas) stored,
  esperado numeric, observacion text not null default '',
  ver_empaques numeric, ver_sueltas numeric, ver_en timestamptz, ver_por uuid references public.perfil(id),
  ver_declarado numeric generated always as (ver_empaques*factor+ver_sueltas) stored,
  ver_esperado numeric, ver_nota text, movimientos_antes_verificar integer,
  resuelta_en timestamptz, resuelta_por uuid references public.perfil(id), resolucion text,
  sesion_resolucion bigint references public.sesion_conteo(id),
  unique(reporte_id,producto_id,ubicacion_id), unique(reporte_id,numero),
  check((empaques is null and sueltas is null and contado_en is null) or
    (empaques>=0 and empaques=trunc(empaques) and empaques<1000000000000 and sueltas>=0 and sueltas<1000000000000 and contado_en is not null)),
  check((ver_empaques is null and ver_sueltas is null and ver_en is null) or
    (ver_empaques>=0 and ver_empaques=trunc(ver_empaques) and ver_empaques<1000000000000 and ver_sueltas>=0 and ver_sueltas<1000000000000 and ver_en is not null))
);
create index reporte_linea_cobertura on reportes_almacen.linea(producto_id,ubicacion_id,contado_en desc);
create index reporte_linea_pendiente on reportes_almacen.linea(producto_id,ubicacion_id) where resuelta_en is null;
create index reporte_turno_sucursal on reportes_almacen.turno(sucursal_id,fecha desc);
create table reportes_almacen.plan (
  producto_id bigint not null references public.producto(id), ubicacion_id bigint not null references public.ubicacion(id),
  frecuencia_dias integer not null check(frecuencia_dias between 1 and 365),
  actualizado_por uuid not null references public.perfil(id), actualizado_en timestamptz not null default clock_timestamp(),
  primary key(producto_id,ubicacion_id)
);
create table reportes_almacen.evento (
  id bigint generated always as identity primary key, reporte_id bigint not null references reportes_almacen.turno(id),
  actor uuid not null references public.perfil(id), accion text not null, datos jsonb not null,
  creado_en timestamptz not null default clock_timestamp()
);
create index reporte_evento_reporte on reportes_almacen.evento(reporte_id,id);
create index if not exists idx_kardex_reporte_hora on public.kardex_transacciones(creado_en,producto_id,ubicacion_id);
alter table reportes_almacen.turno enable row level security;
alter table reportes_almacen.linea enable row level security;
alter table reportes_almacen.plan enable row level security;
alter table reportes_almacen.evento enable row level security;
revoke all on all tables in schema reportes_almacen from public,anon,authenticated;
revoke all on all sequences in schema reportes_almacen from public,anon,authenticated;

-- Conserva el saldo histórico anterior al periodo: no presupone que todo el
-- saldo actual pueda reconstruirse sumando el Kardex desde su origen.
create function reportes_almacen.saldo(p_producto bigint,p_ubicacion bigint,p_hora timestamptz)
returns numeric language sql stable set search_path='' as $$
  select coalesce((select cantidad_base from public.stock_actual where producto_id=p_producto and ubicacion_id=p_ubicacion),0)
    -coalesce((select sum(cantidad) from public.kardex_transacciones where producto_id=p_producto and ubicacion_id=p_ubicacion and creado_en>p_hora),0)
$$;

create function reportes_almacen.candidatos(p_sucursal bigint,p_inicio timestamptz,p_fin timestamptz)
returns table(producto_id bigint,ubicacion_id bigint,nombre text,sku text,unidad text,ubicacion text,
  empaque text,factor numeric,movido boolean,ultimo_conteo timestamptz,frecuencia_dias integer,pendiente boolean)
language sql stable set search_path='' as $$
  with pares as (
    select s.producto_id,s.ubicacion_id from public.stock_actual s
    union select pu.producto_id,pu.ubicacion_id from public.producto_ubicacion pu
    union select k.producto_id,k.ubicacion_id from public.kardex_transacciones k where k.creado_en>=p_inicio and k.creado_en<p_fin
  ), movimientos as (
    select distinct k.producto_id,k.ubicacion_id from public.kardex_transacciones k where k.creado_en>=p_inicio and k.creado_en<p_fin
  ), cobertura as (
    select l.producto_id,l.ubicacion_id,max(l.contado_en) as ultima,
      bool_or(l.resuelta_en is null and (l.declarado is null or l.declarado<>l.esperado)) as pendiente
    from reportes_almacen.linea l join reportes_almacen.turno t on t.id=l.reporte_id
    where t.sucursal_id=p_sucursal and t.estado in ('ENTREGADO','RECIBIDO') group by l.producto_id,l.ubicacion_id
  )
  select p.id,u.id,p.nombre::text,p.sku_interno::text,p.unidad_base::text,
    concat_ws(' / ',u.codigo_zona,nullif(concat_ws(' ',u.estante,u.nivel),''),u.compartimiento),
    coalesce(pr.nombre::text,p.unidad_base::text),coalesce(pr.factor_unidad_base,1),
    m.producto_id is not null,c.ultima,coalesce(pl.frecuencia_dias,30),coalesce(c.pendiente,false)
  from pares b join public.producto p on p.id=b.producto_id
  join public.ubicacion u on u.id=b.ubicacion_id and u.sucursal_id=p_sucursal and not u.excluye_disponible
  left join movimientos m on m.producto_id=b.producto_id and m.ubicacion_id=b.ubicacion_id
  left join cobertura c on c.producto_id=b.producto_id and c.ubicacion_id=b.ubicacion_id
  left join reportes_almacen.plan pl on pl.producto_id=b.producto_id and pl.ubicacion_id=b.ubicacion_id
  left join lateral (select x.nombre,x.factor_unidad_base from public.presentacion x
    where x.producto_id=p.id and x.activo and x.factor_unidad_base>=1
    order by x.factor_unidad_base desc,x.id limit 1) pr on true
$$;

create function reportes_almacen.operar(p_accion text,p_reporte_id bigint,p_datos jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.perfil%rowtype; r reportes_almacen.turno%rowtype; l reportes_almacen.linea%rowtype;
  item record; d jsonb; resultado jsonb; sid bigint; dia date; ini timestamptz; fin timestamptz;
  v_id bigint; v_num integer; v_fecha timestamptz; v_empaques numeric; v_sueltas numeric;
  v_motivo text; v_turno text; v_solicitud uuid; v_receptor boolean;
begin
  select * into actor from public.perfil where id=auth.uid() and activo;
  if not found or actor.rol not in ('admin','gerente','almacenero','operario') then
    raise exception 'No autorizado para reportes de almacén.' using errcode='42501';
  end if;
  if p_datos is null or jsonb_typeof(p_datos)<>'object' then raise exception 'Datos inválidos.'; end if;

  if p_accion in ('inicio','crear','resumen','buscar','plan','programar') then
    sid:=(p_datos->>'sucursal_id')::bigint;
    if sid is null or (actor.sucursal_id is not null and actor.sucursal_id<>sid)
      or not exists(select 1 from public.sucursal where id=sid and tipo<>'virtual' and activo) then
      raise exception 'Sucursal no autorizada.' using errcode='42501';
    end if;
    dia:=coalesce((p_datos->>'fecha')::date,(clock_timestamp() at time zone 'America/La_Paz')::date);
    if dia>(clock_timestamp() at time zone 'America/La_Paz')::date then raise exception 'No se permite una fecha futura.'; end if;
    ini:=dia::timestamp at time zone 'America/La_Paz';
    fin:=least(ini+interval '1 day',clock_timestamp());
  end if;

  if p_accion='inicio' then
    return jsonb_build_object('reportes',coalesce((select jsonb_agg(x order by x.fecha desc,x.inicio desc) from (
      select t.*,pe.nombre as responsable,rec.nombre as receptor,
        (select count(*) from reportes_almacen.linea li where li.reporte_id=t.id and li.resuelta_en is null and t.estado in ('ENTREGADO','RECIBIDO') and (li.declarado is null or li.declarado<>li.esperado)) as pendientes
      from reportes_almacen.turno t join public.perfil pe on pe.id=t.creado_por left join public.perfil rec on rec.id=t.recibido_por
      where t.sucursal_id=sid and (t.fecha=dia or t.estado in ('BORRADOR','REVISION','ENTREGADO') or exists(select 1 from reportes_almacen.linea li where li.reporte_id=t.id and t.estado='RECIBIDO' and li.resuelta_en is null and (li.declarado is null or li.declarado<>li.esperado)))
      order by t.fecha desc,t.inicio desc limit 100) x),'[]'::jsonb));
  end if;
  if p_accion in ('plan','buscar') then
    return jsonb_build_object('items',coalesce((select jsonb_agg(x) from (
      select c.* from reportes_almacen.candidatos(sid,ini,fin) c
      where p_accion='plan' or (c.nombre ilike '%'||left(coalesce(p_datos->>'busqueda',''),100)||'%' or c.sku ilike '%'||left(coalesce(p_datos->>'busqueda',''),100)||'%')
      order by c.pendiente desc,c.ultimo_conteo asc nulls first,c.ubicacion,c.nombre
      limit case when p_accion='plan' then 5000 else 50 end) x),'[]'::jsonb));
  end if;
  if p_accion='programar' then
    if actor.rol not in ('admin','gerente') then raise exception 'Solo supervisión puede programar conteos.' using errcode='42501'; end if;
    if not exists(select 1 from reportes_almacen.candidatos(sid,ini,fin) c where c.producto_id=(p_datos->>'producto_id')::bigint and c.ubicacion_id=(p_datos->>'ubicacion_id')::bigint) then raise exception 'Producto y ubicación fuera del alcance.'; end if;
    insert into reportes_almacen.plan(producto_id,ubicacion_id,frecuencia_dias,actualizado_por)
    values((p_datos->>'producto_id')::bigint,(p_datos->>'ubicacion_id')::bigint,(p_datos->>'frecuencia_dias')::integer,actor.id)
    on conflict(producto_id,ubicacion_id) do update set frecuencia_dias=excluded.frecuencia_dias,actualizado_por=actor.id,actualizado_en=clock_timestamp();
    return jsonb_build_object('guardado',true);
  end if;
  if p_accion='resumen' then
    return jsonb_build_object('hasta',fin,'items',coalesce((select jsonb_agg(x order by x.ubicacion,x.nombre) from (
      select c.*,reportes_almacen.saldo(c.producto_id,c.ubicacion_id,ini-interval '1 microsecond') as inicial,
        reportes_almacen.saldo(c.producto_id,c.ubicacion_id,fin-interval '1 microsecond') as sistema,
        coalesce(m.entradas,0) as entradas,coalesce(m.salidas,0) as salidas,coalesce(m.ajustes,0) as ajustes,coalesce(m.fuera_turno,0) as fuera_turno
      from reportes_almacen.candidatos(sid,ini,fin) c
      join lateral (select count(*) as n,
        sum(k.cantidad) filter(where k.cantidad>0 and k.tipo_movimiento::text<>'AJUSTE') as entradas,
        -sum(k.cantidad) filter(where k.cantidad<0 and k.tipo_movimiento::text<>'AJUSTE') as salidas,
        sum(k.cantidad) filter(where k.tipo_movimiento::text='AJUSTE') as ajustes,
        count(*) filter(where not ((k.creado_en at time zone 'America/La_Paz')::time >= time '07:30' and (k.creado_en at time zone 'America/La_Paz')::time < time '12:30')
          and not ((k.creado_en at time zone 'America/La_Paz')::time >= time '14:30' and (k.creado_en at time zone 'America/La_Paz')::time < time '21:30')) as fuera_turno
        from public.kardex_transacciones k where k.producto_id=c.producto_id and k.ubicacion_id=c.ubicacion_id and k.creado_en>=ini and k.creado_en<fin) m on m.n>0
    ) x),'[]'::jsonb),'fuera_turno',coalesce((select jsonb_agg(x order by x.creado_en) from (
      select k.id,k.producto_id,p.nombre,k.ubicacion_id,k.cantidad,k.referencia,k.creado_por,k.creado_en,coalesce(pe.nombre,k.creado_por,'Sin autor registrado') as autor
      from public.kardex_transacciones k join public.ubicacion u on u.id=k.ubicacion_id and u.sucursal_id=sid and not u.excluye_disponible
      join public.producto p on p.id=k.producto_id
      left join public.perfil pe on pe.id::text=k.creado_por
      where k.creado_en>=ini and k.creado_en<fin
        and not ((k.creado_en at time zone 'America/La_Paz')::time >= time '07:30' and (k.creado_en at time zone 'America/La_Paz')::time < time '12:30')
        and not ((k.creado_en at time zone 'America/La_Paz')::time >= time '14:30' and (k.creado_en at time zone 'America/La_Paz')::time < time '21:30')
      order by k.creado_en limit 1000) x),'[]'::jsonb));
  end if;
  if p_accion='crear' then
    v_turno:=p_datos->>'turno'; v_solicitud:=(p_datos->>'solicitud')::uuid;
    if v_turno is null or v_turno not in ('MANANA','TARDE') or v_solicitud is null then raise exception 'Indica turno y solicitud.'; end if;
    ini:=(dia+case when v_turno='MANANA' then time '07:30' else time '14:30' end) at time zone 'America/La_Paz';
    fin:=(dia+case when v_turno='MANANA' then time '12:30' else time '21:30' end) at time zone 'America/La_Paz';
    if ini>clock_timestamp() then raise exception 'El turno todavía no ha comenzado.'; end if;
    perform pg_advisory_xact_lock(hashtextextended('reporte:'||sid||':'||dia||':'||v_turno,0));
    select * into r from reportes_almacen.turno where solicitud=v_solicitud;
    if found then
      if r.sucursal_id<>sid or r.fecha<>dia or r.turno<>v_turno or r.creado_por<>actor.id then raise exception 'Solicitud ya utilizada con otro contenido.'; end if;
      p_accion:='detalle';
    else
      if exists(select 1 from reportes_almacen.turno where sucursal_id=sid and fecha=dia and turno=v_turno) then raise exception 'Ya existe el reporte de este turno. Ábrelo desde el listado.'; end if;
      select id into v_id from reportes_almacen.turno where sucursal_id=sid
        and fecha=case when v_turno='MANANA' then dia-1 else dia end and turno=case when v_turno='MANANA' then 'TARDE' else 'MANANA' end;
      insert into reportes_almacen.turno(solicitud,sucursal_id,fecha,turno,inicio,fin,creado_por,anterior_id)
      values(v_solicitud,sid,dia,v_turno,ini,fin,actor.id,v_id) returning * into r;
      insert into reportes_almacen.evento(reporte_id,actor,accion,datos) values(r.id,actor.id,'crear',p_datos);
    end if;
    p_reporte_id:=r.id;
  end if;

  select * into r from reportes_almacen.turno where id=p_reporte_id for update;
  if not found or (actor.sucursal_id is not null and r.sucursal_id<>actor.sucursal_id) then raise exception 'Reporte no disponible en tu sucursal.' using errcode='42501'; end if;
  v_receptor:=actor.id<>r.creado_por;
  if p_accion not in ('detalle','crear','movimientos') then
    if (p_datos->>'version')::integer is distinct from r.version then raise exception 'El reporte cambió. Vuelve a abrirlo antes de guardar.' using errcode='40001'; end if;
  end if;

  if p_accion in ('crear','actualizar_alcance','agregar') then
    if r.estado<>'BORRADOR' or r.creado_por<>actor.id then raise exception 'Solo el responsable puede modificar su hoja en borrador.' using errcode='42501'; end if;
    select coalesce(max(numero),0) into v_num from reportes_almacen.linea where reporte_id=r.id;
    for item in
      with candidatos as (select c.*,row_number() over(partition by (c.movido or c.pendiente) order by c.ultimo_conteo asc nulls first,c.ubicacion,c.nombre) as prioridad
        from reportes_almacen.candidatos(r.sucursal_id,r.inicio,least(r.fin,clock_timestamp())) c
        where not exists(select 1 from reportes_almacen.linea li where li.reporte_id=r.id and li.producto_id=c.producto_id and li.ubicacion_id=c.ubicacion_id))
      select * from candidatos c where
        (p_accion='agregar' and c.producto_id=(p_datos->>'producto_id')::bigint and c.ubicacion_id=(p_datos->>'ubicacion_id')::bigint)
        or (p_accion<>'agregar' and (c.movido or c.pendiente or (p_accion='crear' and c.prioridad<=10 and (c.ultimo_conteo is null or c.ultimo_conteo<clock_timestamp()-make_interval(days=>c.frecuencia_dias)))))
      order by c.ubicacion,c.nombre,c.producto_id,c.ubicacion_id
    loop
      v_num:=v_num+1;
      insert into reportes_almacen.linea(reporte_id,numero,producto_id,ubicacion_id,nombre,sku,unidad,ubicacion,empaque,factor,origen)
      values(r.id,v_num,item.producto_id,item.ubicacion_id,item.nombre,item.sku,item.unidad,item.ubicacion,item.empaque,item.factor,
        case when item.pendiente then 'PENDIENTE' when item.movido then 'MOVIMIENTO' when p_accion='agregar' then 'MANUAL' else 'CICLICO' end);
    end loop;
    if not exists(select 1 from reportes_almacen.linea where reporte_id=r.id) then raise exception 'No hay ítems asignados o con existencias para generar la hoja.'; end if;
    update reportes_almacen.turno set version=version+1 where id=r.id returning * into r;
    insert into reportes_almacen.evento(reporte_id,actor,accion,datos) values(r.id,actor.id,'alcance',jsonb_build_object('lineas',v_num));
  elsif p_accion='guardar' then
    if r.estado<>'BORRADOR' or r.creado_por<>actor.id then raise exception 'El reporte ya está entregado o pertenece a otra persona.' using errcode='42501'; end if;
    if jsonb_typeof(p_datos->'lineas') is distinct from 'array' then raise exception 'Indica las líneas a registrar.'; end if;
    if (select count(*)<>count(distinct e->>'id') from jsonb_array_elements(p_datos->'lineas') e) then raise exception 'Hay líneas duplicadas.'; end if;
    for d in select value from jsonb_array_elements(p_datos->'lineas') loop
      select * into l from reportes_almacen.linea where id=(d->>'id')::bigint and reporte_id=r.id;
      if not found then raise exception 'Línea fuera del reporte.'; end if;
      v_empaques:=(d->>'empaques')::numeric;v_sueltas:=(d->>'sueltas')::numeric;v_fecha:=(d->>'contado_en')::timestamptz;
      v_motivo:=left(trim(coalesce(d->>'observacion','')),2000);
      if (v_empaques is null)<>(v_sueltas is null) or (v_empaques is null)<>(v_fecha is null) then raise exception 'Completa empaque, sueltas y hora; cero no es una casilla vacía.'; end if;
      if v_fecha is not null and (v_fecha<r.inicio or v_fecha>r.fin or v_fecha>clock_timestamp()) then raise exception 'La hora del conteo debe estar dentro del turno y no puede ser futura.'; end if;
      if v_sueltas is not null and l.factor>1 and v_sueltas>=l.factor then raise exception 'Convierte las unidades sueltas en empaques completos.'; end if;
      if v_empaques is not null and not (v_empaques>=0 and v_empaques=trunc(v_empaques) and v_sueltas>=0 and v_sueltas=round(v_sueltas,4) and v_empaques*l.factor+v_sueltas<1000000000000) then raise exception 'Cantidades inválidas: empaques enteros, hasta cuatro decimales y total menor a un billón.'; end if;
      insert into reportes_almacen.evento(reporte_id,actor,accion,datos) values(r.id,actor.id,'captura',jsonb_build_object('antes',to_jsonb(l),'despues',d));
      update reportes_almacen.linea set empaques=v_empaques,sueltas=v_sueltas,contado_en=v_fecha,observacion=v_motivo where id=l.id;
    end loop;
    update reportes_almacen.turno set observacion=left(trim(coalesce(p_datos->>'observacion','')),4000),version=version+1 where id=r.id returning * into r;
  elsif p_accion='comparar' then
    if r.estado<>'BORRADOR' or r.creado_por<>actor.id then raise exception 'Solo el responsable puede comparar su borrador.' using errcode='42501'; end if;
    if exists(select 1 from reportes_almacen.linea where reporte_id=r.id and declarado is null and trim(observacion)='') then raise exception 'Completa los conteos o indica el motivo de cada ítem pendiente.'; end if;
    update reportes_almacen.linea set esperado=case when contado_en is not null then reportes_almacen.saldo(producto_id,ubicacion_id,contado_en) else null end where reporte_id=r.id;
    update reportes_almacen.turno set estado='REVISION',version=version+1 where id=r.id returning * into r;
    insert into reportes_almacen.evento(reporte_id,actor,accion,datos) values(r.id,actor.id,'comparar',jsonb_build_object('version',r.version));
  elsif p_accion='reabrir' then
    if r.estado<>'REVISION' or r.creado_por<>actor.id then raise exception 'Solo el responsable puede reabrir una comparación sin entregar.' using errcode='42501'; end if;
    v_motivo:=left(trim(coalesce(p_datos->>'observacion','')),2000);
    if v_motivo='' then raise exception 'Indica por qué corriges la transcripción.'; end if;
    insert into reportes_almacen.evento(reporte_id,actor,accion,datos) values(r.id,actor.id,'reabrir',jsonb_build_object('motivo',v_motivo,'lineas',(select jsonb_agg(to_jsonb(li)) from reportes_almacen.linea li where li.reporte_id=r.id)));
    update reportes_almacen.linea set esperado=null where reporte_id=r.id;
    update reportes_almacen.turno set estado='BORRADOR',version=version+1 where id=r.id returning * into r;
  elsif p_accion='entregar' then
    if r.estado<>'REVISION' or r.creado_por<>actor.id then raise exception 'Compara y revisa las cantidades antes de entregar el reporte.' using errcode='42501'; end if;
    if clock_timestamp()<r.fin then raise exception 'Entrega el reporte al finalizar el turno.'; end if;
    select id into v_id from reportes_almacen.turno where sucursal_id=r.sucursal_id
      and fecha=case when r.turno='MANANA' then r.fecha-1 else r.fecha end and turno=case when r.turno='MANANA' then 'TARDE' else 'MANANA' end;
    if v_id is not null and exists(select 1 from reportes_almacen.turno where id=v_id and estado<>'RECIBIDO') then raise exception 'El reporte del turno anterior debe estar recibido antes de entregar este turno.'; end if;
    update reportes_almacen.turno set anterior_id=v_id where id=r.id;
    if exists(select 1 from public.kardex_transacciones k join public.ubicacion u on u.id=k.ubicacion_id and u.sucursal_id=r.sucursal_id and not u.excluye_disponible
      where k.creado_en>=r.inicio and k.creado_en<r.fin and not exists(select 1 from reportes_almacen.linea li where li.reporte_id=r.id and li.producto_id=k.producto_id and li.ubicacion_id=k.ubicacion_id)) then
      raise exception 'Hay nuevos ítems con movimiento. Actualiza el alcance y completa su conteo antes de entregar.';
    end if;
    if exists(select 1 from reportes_almacen.linea where reporte_id=r.id and declarado is null and trim(observacion)='') then raise exception 'Completa los conteos o indica el motivo de cada ítem pendiente.'; end if;
    if exists(select 1 from reportes_almacen.linea where reporte_id=r.id and contado_en is not null and esperado is distinct from reportes_almacen.saldo(producto_id,ubicacion_id,contado_en)) then raise exception 'Cambió el respaldo histórico. Reabre la transcripción y compara de nuevo antes de entregar.'; end if;
    v_motivo:=left(trim(coalesce(p_datos->>'observacion',r.observacion)),4000);
    if exists(select 1 from reportes_almacen.linea where reporte_id=r.id and (declarado is null or declarado<>esperado)) and v_motivo='' then raise exception 'Describe los pendientes en la observación de entrega.'; end if;
    update reportes_almacen.turno set estado='ENTREGADO',observacion=v_motivo,entregado_en=clock_timestamp(),version=version+1 where id=r.id returning * into r;
    insert into reportes_almacen.evento(reporte_id,actor,accion,datos) values(r.id,actor.id,'entregar',jsonb_build_object('version',r.version));
  elsif p_accion='verificar' then
    if r.estado<>'ENTREGADO' or not v_receptor then raise exception 'La verificación corresponde a otra persona al recibir el turno.' using errcode='42501'; end if;
    select * into l from reportes_almacen.linea where id=(p_datos->>'linea_id')::bigint and reporte_id=r.id;
    if not found or l.resuelta_en is not null or (l.declarado is not null and l.declarado=l.esperado) then raise exception 'La línea no tiene una verificación pendiente.'; end if;
    if l.ver_por is not null and l.ver_por<>actor.id then raise exception 'Otro almacenero comenzó la recepción.'; end if;
    if exists(select 1 from reportes_almacen.linea where reporte_id=r.id and ver_por is not null and ver_por<>actor.id) then raise exception 'Otro almacenero comenzó la recepción.'; end if;
    v_empaques:=(p_datos->>'empaques')::numeric;v_sueltas:=(p_datos->>'sueltas')::numeric;v_fecha:=(p_datos->>'contado_en')::timestamptz;
    if v_empaques is null or v_sueltas is null or v_fecha is null or v_fecha<r.fin or v_fecha>clock_timestamp() then raise exception 'Indica cantidades y hora de la verificación después del cierre.'; end if;
    if l.factor>1 and v_sueltas>=l.factor then raise exception 'Convierte las unidades sueltas en empaques completos.'; end if;
    if not (v_empaques>=0 and v_empaques=trunc(v_empaques) and v_sueltas>=0 and v_sueltas=round(v_sueltas,4) and v_empaques*l.factor+v_sueltas<1000000000000) then raise exception 'Cantidades de verificación inválidas.'; end if;
    update reportes_almacen.linea set ver_empaques=v_empaques,ver_sueltas=v_sueltas,ver_en=v_fecha,ver_por=actor.id,
      ver_nota=left(trim(coalesce(p_datos->>'observacion','')),2000),ver_esperado=reportes_almacen.saldo(producto_id,ubicacion_id,v_fecha),
      movimientos_antes_verificar=(select count(*) from public.kardex_transacciones k where k.producto_id=l.producto_id and k.ubicacion_id=l.ubicacion_id and k.creado_en>r.fin and k.creado_en<=v_fecha)
      where id=l.id;
    update reportes_almacen.turno set version=version+1 where id=r.id returning * into r;
    insert into reportes_almacen.evento(reporte_id,actor,accion,datos) values(r.id,actor.id,'verificar',p_datos-'version');
  elsif p_accion='recibir' then
    if r.estado<>'ENTREGADO' or not v_receptor then raise exception 'La recepción corresponde a otra persona.' using errcode='42501'; end if;
    if exists(select 1 from reportes_almacen.linea where reporte_id=r.id and ver_por is not null and ver_por<>actor.id) then raise exception 'Otro almacenero comenzó la recepción.'; end if;
    v_motivo:=left(trim(coalesce(p_datos->>'observacion','')),4000);
    if v_motivo='' then raise exception 'Deja constancia de la recepción y de sus observaciones.'; end if;
    if exists(select 1 from reportes_almacen.linea where reporte_id=r.id and resuelta_en is null and (declarado is null or declarado<>esperado) and ver_en is null) then raise exception 'Verifica cada pendiente antes de recibir el reporte.'; end if;
    update reportes_almacen.turno set estado='RECIBIDO',recibido_por=actor.id,recibido_en=clock_timestamp(),recepcion_nota=v_motivo,version=version+1 where id=r.id returning * into r;
    insert into reportes_almacen.evento(reporte_id,actor,accion,datos) values(r.id,actor.id,'recibir',p_datos-'version');
  elsif p_accion='resolver' then
    if actor.rol not in ('admin','gerente') or r.estado not in ('ENTREGADO','RECIBIDO') then raise exception 'Solo supervisión puede resolver un pendiente entregado.' using errcode='42501'; end if;
    select * into l from reportes_almacen.linea where id=(p_datos->>'linea_id')::bigint and reporte_id=r.id;
    if not found or l.resuelta_en is not null or (l.declarado is not null and l.declarado=l.esperado) then raise exception 'Pendiente no disponible.'; end if;
    v_motivo:=left(trim(coalesce(p_datos->>'observacion','')),2000);
    v_id:=(p_datos->>'sesion_id')::bigint;
    if v_motivo='' or not exists(select 1 from inventario_control.sesion cs join inventario_control.producto cp on cp.sesion_id=cs.id
      where cs.id=v_id and cs.sucursal_id=r.sucursal_id and cs.ubicacion_id=l.ubicacion_id and cp.producto_id=l.producto_id and cs.estado='APLICADA' and cs.cerrada_en>=r.entregado_en) then
      raise exception 'Vincula un conteo controlado aplicado después de la entrega para este producto y ubicación, e indica el motivo.';
    end if;
    update reportes_almacen.linea set resuelta_en=clock_timestamp(),resuelta_por=actor.id,resolucion=v_motivo,sesion_resolucion=v_id where id=l.id;
    update reportes_almacen.turno set version=version+1 where id=r.id returning * into r;
    insert into reportes_almacen.evento(reporte_id,actor,accion,datos) values(r.id,actor.id,'resolver',p_datos-'version');
  elsif p_accion='movimientos' then
    return jsonb_build_object('movimientos',coalesce((select jsonb_agg(x order by x.creado_en,x.id) from (
      select k.id,k.cantidad,k.tipo_movimiento,k.referencia,k.motivo,k.creado_por,k.creado_en,coalesce(pe.nombre,k.creado_por,'Sin autor registrado') as autor from public.kardex_transacciones k
      left join public.perfil pe on pe.id::text=k.creado_por
      where exists(select 1 from reportes_almacen.linea li where li.reporte_id=r.id and li.id=(p_datos->>'linea_id')::bigint and li.producto_id=k.producto_id and li.ubicacion_id=k.ubicacion_id)
        and k.creado_en>=r.inicio and k.creado_en<=coalesce(r.recibido_en,clock_timestamp()) order by k.creado_en,k.id limit 1000) x),'[]'::jsonb));
  elsif p_accion<>'detalle' then raise exception 'Operación desconocida.';
  end if;

  select to_jsonb(t)||jsonb_build_object('folio','AT-'||to_char(t.fecha,'YYYYMMDD')||'-'||t.id,
    'responsable',pe.nombre,'sucursal',su.nombre,'receptor',rec.nombre,'editable',t.estado='BORRADOR' and t.creado_por=actor.id)
    into resultado from reportes_almacen.turno t join public.perfil pe on pe.id=t.creado_por
    join public.sucursal su on su.id=t.sucursal_id left join public.perfil rec on rec.id=t.recibido_por where t.id=r.id;
  return jsonb_build_object('reporte',resultado,'lineas',coalesce((select jsonb_agg(
    (to_jsonb(li)-'esperado'-'ver_esperado')||jsonb_build_object('esperado',case when r.estado<>'BORRADOR' then li.esperado end,
    'ver_esperado',case when li.ver_por=actor.id or r.estado='RECIBIDO' then li.ver_esperado end,
    'pendiente',r.estado<>'BORRADOR' and li.resuelta_en is null and (li.declarado is null or li.declarado<>li.esperado)) order by li.numero)
    from reportes_almacen.linea li where li.reporte_id=r.id),'[]'::jsonb),
    'anterior',(select jsonb_build_object('id',t.id,'fecha',t.fecha,'turno',t.turno,'estado',t.estado,'responsable',pe.nombre)
      from reportes_almacen.turno t join public.perfil pe on pe.id=t.creado_por where t.id=(select anterior_id from reportes_almacen.turno where id=r.id)),
    'eventos',coalesce((select jsonb_agg(x order by x.id desc) from (select e.id,e.accion,e.creado_en,pe.nombre as actor from reportes_almacen.evento e join public.perfil pe on pe.id=e.actor where e.reporte_id=r.id order by e.id desc limit 100) x),'[]'::jsonb));
end $$;

revoke all on all functions in schema reportes_almacen from public,anon,authenticated;
grant usage on schema reportes_almacen to authenticated;
grant execute on function reportes_almacen.operar(text,bigint,jsonb) to authenticated;
create function public.operar_reporte_almacen(p_accion text,p_reporte_id bigint default null,p_datos jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
  select reportes_almacen.operar(p_accion,p_reporte_id,p_datos)
$$;
revoke all on function public.operar_reporte_almacen(text,bigint,jsonb) from public,anon;
grant execute on function public.operar_reporte_almacen(text,bigint,jsonb) to authenticated;
