-- Tablero de Almacén v2 (2026-11-12) — pantalla tipo aeropuerto.
--
-- Una sola lectura para la TV: pedidos (PED), ventas directas de Caja–Almacén (VTD),
-- retornos y traslados (TRA), más lo que salió hoy.
--
-- Por qué una función y no vistas:
--   * caja_operacion_vtd y caja_operacion_almacen no se pueden leer como authenticated
--     (solo hermes_app); el listado de almacén ya entra por operar_caja_almacen, que es
--     security definer. Esto hace lo mismo y valida el perfil.
--   * Una sola llamada cada 20 s en vez de dos consultas cada 30 s.
--
-- Etapas que devuelve (el frontend solo las pinta, ordena y marca demoras):
--   POR_ALISTAR · ALISTANDO · POR_VERIFICAR · LISTO · EN_CAJA · EN_CAMINO · PARCIAL · RETORNO
--
-- PED: alistado activo más avanzado (VERIFICADO > REVISANDO > PREPARADO > PREPARANDO).
--      Sin alistado activo: POR_ALISTAR si quedan líneas para almacén (POR_DESPACHAR o
--      PENDIENTE); si solo queda compra o ítems especiales, PARCIAL.
-- VTD: SOLICITADO sin encargado = POR_ALISTAR; con encargado = ALISTANDO; EN_CAJA;
--      RETORNO_PENDIENTE = RETORNO. ENTREGADO va a completados.
-- TRA: SOLICITADO (con tarea QR PREPARANDO = ALISTANDO; PREPARADO o REVISANDO =
--      POR_VERIFICAR); EN_TRANSITO = EN_CAMINO; RECIBIDO va a completados.
--
-- Solo lectura: no escribe en ninguna tabla. No toca las vistas viejas
-- v_tablero_almacen_pedidos / v_tablero_almacen_ventas_directas (se pueden retirar
-- cuando la v2 esté en producción).

create or replace function public.tablero_almacen(p_sucursal_id bigint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.perfil;
  v_hoy timestamptz := (date_trunc('day', now() at time zone 'America/La_Paz')) at time zone 'America/La_Paz';
  v_filas jsonb;
  v_completados jsonb;
begin
  select * into actor from public.perfil where id = auth.uid() and activo;
  if not found or actor.rol::text not in ('admin','gerente','almacenero','operario','cajero') then
    raise exception 'Tu perfil no permite ver el tablero.' using errcode = '42501';
  end if;
  if p_sucursal_id is not null and not exists (select 1 from public.sucursal where id = p_sucursal_id) then
    raise exception 'Sucursal inexistente.' using errcode = '22023';
  end if;

  with
  lin as (
    select pl.pedido_id,
      count(*) filter (where pl.estado::text not in ('RECHAZADO','CAMBIADA')) as total,
      count(*) filter (where pl.estado::text in ('DESPACHADA','COMPRADO_DIRECTO','RETIRADA')) as resueltas,
      count(*) filter (where pl.estado::text in ('POR_DESPACHAR','PENDIENTE')) as por_almacen,
      count(*) filter (where pl.estado::text = 'POR_COMPRAR') as por_comprar,
      count(*) filter (where pl.estado::text = 'ESPECIAL') as especiales
    from public.pedido_linea pl
    join public.pedido p on p.id = pl.pedido_id
    where p.estado::text = 'ABIERTO'
    group by pl.pedido_id
  ),
  prep as (
    select distinct on (ap.pedido_id)
      ap.id, ap.pedido_id, ap.estado, ap.sucursal_id, s.nombre as sucursal_nombre,
      ap.preparador_nombre, ap.revisor_nombre, ap.actualizado_en,
      (select count(*) from public.almacen_preparacion_linea l
        where l.preparacion_id = ap.id and l.vigente and l.confirmada) as confirmadas
    from public.almacen_preparacion ap
    join public.sucursal s on s.id = ap.sucursal_id
    where ap.estado in ('PREPARANDO','PREPARADO','REVISANDO','VERIFICADO')
      and (p_sucursal_id is null or ap.sucursal_id = p_sucursal_id)
    order by ap.pedido_id,
      case ap.estado when 'VERIFICADO' then 1 when 'REVISANDO' then 2 when 'PREPARADO' then 3 else 4 end,
      ap.actualizado_en desc
  ),
  ped as (
    select
      'PED'::text as tipo,
      p.id,
      p.numero,
      coalesce(c.nombre, p.referencia, 'Pedido #' || p.id) as titulo,
      case when c.nombre is not null then p.referencia end as referencia,
      p.categoria::text as categoria,
      case
        when pr.id is null and lin.por_almacen > 0 then 'POR_ALISTAR'
        when pr.id is null then 'PARCIAL'
        when pr.estado = 'PREPARANDO' then 'ALISTANDO'
        when pr.estado = 'VERIFICADO' then 'LISTO'
        else 'POR_VERIFICAR'
      end as etapa,
      'DESPACHO'::text as puerta,
      pr.sucursal_nombre as sucursal,
      pr.preparador_nombre as encargado,
      pr.revisor_nombre as revisor,
      (lin.resueltas + coalesce(pr.confirmadas, 0))::int as hecho,
      lin.total::int as total,
      lin.resueltas::int as resueltas,
      lin.por_comprar::int as por_comprar,
      lin.especiales::int as especiales,
      p.creado_en as entro_en,
      greatest(p.creado_en, mov.ultimo) as ultimo_mov_en,
      null::text as cajero,
      null::jsonb as productos
    from public.pedido p
    join lin on lin.pedido_id = p.id
    left join public.cliente c on c.id = p.cliente_id
    left join prep pr on pr.pedido_id = p.id
    left join lateral (
      select greatest(
        (select max(ev.creado_en) from public.pedido_despacho_evento ev
           join public.pedido_linea pl2 on pl2.id = ev.pedido_linea_id
          where pl2.pedido_id = p.id),
        (select max(ap2.actualizado_en) from public.almacen_preparacion ap2 where ap2.pedido_id = p.id)
      ) as ultimo
    ) mov on true
    where p.estado::text = 'ABIERTO' and lin.total > 0
  ),
  vtd as (
    select
      'VTD'::text as tipo,
      v.id,
      v.numero,
      'Venta directa'::text as titulo,
      null::text as referencia,
      null::text as categoria,
      case
        when d.estado = 'SOLICITADO' and d.responsable_id is null then 'POR_ALISTAR'
        when d.estado = 'SOLICITADO' then 'ALISTANDO'
        when d.estado = 'EN_CAJA' then 'EN_CAJA'
        else 'RETORNO'
      end as etapa,
      case when d.estado = 'RETORNO_PENDIENTE' then 'ESTANTE' else 'CAJA' end as puerta,
      su.nombre as sucursal,
      pr.nombre as encargado,
      null::text as revisor,
      case when d.estado = 'EN_CAJA' then jsonb_array_length(d.lineas) end::int as hecho,
      coalesce(jsonb_array_length(d.lineas), 0)::int as total,
      null::int as resueltas, null::int as por_comprar, null::int as especiales,
      v.creado_en as entro_en,
      greatest(v.creado_en, d.escaneado_en, d.enviado_en) as ultimo_mov_en,
      pc.nombre as cajero,
      (select jsonb_agg(jsonb_build_object(
          'nombre', x->>'nombre',
          'cantidad', x->>'cantidad_presentacion',
          'presentacion', x->>'presentacion'))
         from (select x from jsonb_array_elements(case when jsonb_typeof(d.lineas) = 'array' then d.lineas else '[]'::jsonb end) x limit 4) q
      ) as productos
    from public.caja_operacion_vtd d
    join public.caja_operacion_almacen o on o.id = d.operacion_id
    join public.venta v on v.id = d.venta_id
    join public.ubicacion u on u.id = v.ubicacion_id
    join public.sucursal su on su.id = u.sucursal_id
    left join public.perfil pr on pr.id = d.responsable_id
    left join public.perfil pc on pc.id = o.cajero_id
    where d.estado in ('SOLICITADO','EN_CAJA','RETORNO_PENDIENTE')
      and (p_sucursal_id is null or u.sucursal_id = p_sucursal_id)
  ),
  tra as (
    select
      'TRA'::text as tipo,
      s.id,
      s.numero,
      (case s.motivo::text when 'REPOSICION' then 'Reposición' when 'DEVOLUCION' then 'Devolución' when 'VENTA_DIRECTA' then 'Venta directa' else coalesce(initcap(lower(s.motivo::text)), 'Traslado') end) || ' → ' || coalesce(sd.nombre, 'destino') as titulo,
      s.referencia,
      null::text as categoria,
      case
        when s.estado::text = 'EN_TRANSITO' then 'EN_CAMINO'
        when t.estado = 'PREPARANDO' then 'ALISTANDO'
        when t.estado in ('PREPARADO','REVISANDO') then 'POR_VERIFICAR'
        else 'POR_ALISTAR'
      end as etapa,
      upper(coalesce(sd.nombre, 'DESTINO')) as puerta,
      so.nombre as sucursal,
      t.preparador_nombre as encargado,
      t.receptor_nombre as revisor,
      (case when s.estado::text = 'EN_TRANSITO' then tl.despachadas
            else coalesce(tq.confirmadas, 0) end)::int as hecho,
      tl.total::int as total,
      null::int as resueltas, null::int as por_comprar, null::int as especiales,
      coalesce(s.solicitado_en, s.creado_en) as entro_en,
      greatest(coalesce(s.solicitado_en, s.creado_en), s.despachado_en, t.actualizado_en) as ultimo_mov_en,
      null::text as cajero,
      null::jsonb as productos
    from public.solicitud_traslado s
    left join public.sucursal so on so.id = s.sucursal_origen_id
    left join public.sucursal sd on sd.id = s.sucursal_destino_id
    left join traslado_qr.tarea t on t.solicitud_id = s.id and t.estado <> 'ANULADO'
    left join lateral (
      select count(*) filter (where l.estado::text not in ('RECHAZADO','CAMBIADA','RETIRADA')) as total,
             count(*) filter (where l.estado::text = 'DESPACHADA') as despachadas
      from public.solicitud_traslado_linea l where l.solicitud_id = s.id
    ) tl on true
    left join lateral (
      select count(*) filter (where q.vigente and q.confirmada) as confirmadas
      from traslado_qr.linea q where q.solicitud_id = s.id
    ) tq on true
    where s.estado::text in ('SOLICITADO','EN_TRANSITO')
      and (p_sucursal_id is null or s.sucursal_origen_id = p_sucursal_id)
  ),
  todas as (
    select * from ped union all select * from vtd union all select * from tra
  )
  select coalesce(jsonb_agg(to_jsonb(todas) order by entro_en), '[]'::jsonb) into v_filas from todas;

  with
  salidas_ped as (
    select 'PED'::text as tipo, p.numero, coalesce(c.nombre, p.referencia, 'Pedido #' || p.id) as titulo,
      ap.actualizado_en as hora,
      case when p.estado::text = 'COMPLETADO' then 'DESPACHADO' else 'SALIDA PARCIAL' end as estado,
      (select count(*) from public.pedido_linea pl where pl.pedido_id = p.id
         and pl.estado::text in ('DESPACHADA','COMPRADO_DIRECTO','RETIRADA'))::int as hecho,
      (select count(*) from public.pedido_linea pl where pl.pedido_id = p.id
         and pl.estado::text not in ('RECHAZADO','CAMBIADA'))::int as total
    from public.almacen_preparacion ap
    join public.pedido p on p.id = ap.pedido_id
    left join public.cliente c on c.id = p.cliente_id
    where ap.estado = 'DESPACHADO' and ap.actualizado_en >= v_hoy
      and (p_sucursal_id is null or ap.sucursal_id = p_sucursal_id)
  ),
  entregas_vtd as (
    select 'VTD'::text as tipo, v.numero, 'Caja'::text as titulo,
      coalesce(d.recibido_en, o.cerrado_en, v.completado_en, d.enviado_en) as hora,
      'ENTREGADO'::text as estado,
      coalesce(jsonb_array_length(d.lineas), 0)::int as hecho,
      coalesce(jsonb_array_length(d.lineas), 0)::int as total
    from public.caja_operacion_vtd d
    join public.caja_operacion_almacen o on o.id = d.operacion_id
    join public.venta v on v.id = d.venta_id
    join public.ubicacion u on u.id = v.ubicacion_id
    where d.estado = 'ENTREGADO'
      and coalesce(d.recibido_en, o.cerrado_en, v.completado_en, d.enviado_en) >= v_hoy
      and (p_sucursal_id is null or u.sucursal_id = p_sucursal_id)
  ),
  recibidos_tra as (
    select 'TRA'::text as tipo, s.numero,
      (case s.motivo::text when 'REPOSICION' then 'Reposición' when 'DEVOLUCION' then 'Devolución' when 'VENTA_DIRECTA' then 'Venta directa' else coalesce(initcap(lower(s.motivo::text)), 'Traslado') end) || ' → ' || coalesce(sd.nombre, 'destino') as titulo,
      s.recibido_en as hora, 'RECIBIDO'::text as estado, null::int as hecho, null::int as total
    from public.solicitud_traslado s
    left join public.sucursal sd on sd.id = s.sucursal_destino_id
    where s.estado::text = 'RECIBIDO' and s.recibido_en >= v_hoy
      and (p_sucursal_id is null or s.sucursal_origen_id = p_sucursal_id)
  ),
  hechos as (
    select * from salidas_ped union all select * from entregas_vtd union all select * from recibidos_tra
  )
  select coalesce(jsonb_agg(to_jsonb(h) order by h.hora desc), '[]'::jsonb) into v_completados
  from (select * from hechos order by hora desc limit 40) h;

  return jsonb_build_object('generado_en', now(), 'filas', v_filas, 'completados', v_completados);
end
$$;

revoke all on function public.tablero_almacen(bigint) from public, anon;
grant execute on function public.tablero_almacen(bigint) to authenticated;

comment on function public.tablero_almacen(bigint) is
  'Tablero de Almacén v2 (TV): PED, VTD de Caja–Almacén, retornos y TRA en curso, más completados del día. Solo lectura.';
