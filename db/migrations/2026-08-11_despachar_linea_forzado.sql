-- Migración: compuerta de reserva sobre despachar_linea + despachar_linea_forzado
-- (brief "reserva de stock y faltantes", W8+S10 — los dos van juntos, nunca por
-- separado: ver S10 en nessxd14/seller, rama claude/s10-reserva-w8).
-- Proyecto Supabase Cloud: supabase_db_almacen_roari (ref zxoxougwgstrarwymlvd).
--
-- ============================================================================
-- YA APLICADA (2026-08-11) — no queda como paso manual pendiente.
--
-- Verificada primero en BEGIN…ROLLBACK contra la base viva (producto real,
-- pedido MAYOR reservando + pedido TIENDA de menor prioridad): despachar_linea
-- rechazó exceder el turno, despachar_linea_forzado sin motivo rechazó,
-- despachar_linea_forzado con motivo despachó y dejó fila en
-- despacho_sobre_reserva, y un despacho normal dentro de turno completo siguió
-- funcionando igual que antes. Todo revirtió limpio (funciones y datos de
-- prueba) antes de aplicar de verdad. Confirmado con Ness — aplicada junto con
-- S10 (nessxd14/seller, rama claude/s10-reserva-w8).
-- ============================================================================
--
-- ============================================================================
-- Qué cambia
-- ============================================================================
-- 1. Se extrae el cuerpo de despachar_linea a _despachar_linea_nucleo, con un
--    parámetro nuevo p_omitir_turno. despachar_linea sigue con la misma firma
--    (compatibilidad total con operaciones.js y el resto de los llamadores) y
--    pasa p_omitir_turno=false: ahora RECHAZA una asignación que exceda el
--    `cubierto` de v_pedido_linea_reserva para esa línea (turno FIFO — reserva
--    de clientes primero, reposición después, ver v_pedido_linea_reserva).
-- 2. despachar_linea_forzado(p_linea_id, p_asignaciones, p_motivo, p_usuario) es
--    nueva: mismo pick que despachar_linea pero con p_omitir_turno=true, y
--    escribe en despacho_sobre_reserva la porción que excede el turno. Motivo
--    obligatorio. Todo en una sola función/transacción — si la bitácora
--    fallara, el despacho entero se revierte (no es best-effort, ver brief:
--    "no repetir el patrón de marcar_inventariado").
--
-- No se toca revertir_evento, comprar_directo, crear_pedido ni las vistas —
-- ya están aplicadas y verificadas (ver brief).
--
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- PASO 1 — núcleo compartido (antes era el cuerpo de despachar_linea)
-- ----------------------------------------------------------------------------
create or replace function _despachar_linea_nucleo(
  p_linea_id       bigint,
  p_asignaciones   jsonb,
  p_usuario        text,
  p_omitir_turno   boolean
) returns jsonb
language plpgsql
as $$
declare
  v_linea               pedido_linea%rowtype;
  v_pedido              pedido%rowtype;
  v_presentacion_base_id bigint;
  v_asig                jsonb;
  v_ubicacion_id        bigint;
  v_cantidad            numeric;
  v_kardex_id           bigint;
  v_evento_id           bigint;
  v_total_asignado      numeric := 0;
  v_reversible_hasta    timestamptz;
  v_kardex_ids          jsonb := '[]'::jsonb;
  v_nueva_despachada    numeric;
  v_nuevo_estado        estado_linea;
  v_cubierto            numeric;
begin
  if jsonb_typeof(p_asignaciones) <> 'array' or jsonb_array_length(p_asignaciones) = 0 then
    raise exception 'p_asignaciones debe ser un array no vacío de {ubicacion_id, cantidad_base}';
  end if;

  select * into v_linea from pedido_linea where id = p_linea_id for update;
  if not found then
    raise exception 'Línea % no existe', p_linea_id;
  end if;
  if v_linea.estado not in ('POR_DESPACHAR', 'PENDIENTE') then
    raise exception 'La línea % está en estado % y no admite despacho', p_linea_id, v_linea.estado;
  end if;

  select * into v_pedido from pedido where id = v_linea.pedido_id;

  select id into v_presentacion_base_id
  from presentacion
  where producto_id = v_linea.producto_id and es_base = true
  limit 1;
  if v_presentacion_base_id is null then
    raise exception 'Producto % no tiene presentación base', v_linea.producto_id;
  end if;

  -- primera pasada: validar el array completo antes de tocar Kardex
  for v_asig in select * from jsonb_array_elements(p_asignaciones)
  loop
    if (v_asig->>'ubicacion_id') is null or (v_asig->>'cantidad_base') is null then
      raise exception 'Cada asignación requiere ubicacion_id y cantidad_base';
    end if;
    v_cantidad := (v_asig->>'cantidad_base')::numeric;
    if v_cantidad <= 0 then
      raise exception 'cantidad_base de la asignación debe ser positiva';
    end if;
    v_total_asignado := v_total_asignado + v_cantidad;
  end loop;

  if v_linea.cantidad_despachada + v_total_asignado > v_linea.cantidad_base + 0.0001 then
    raise exception 'La cantidad asignada (%) excede lo pendiente de la línea (%)',
      v_total_asignado, (v_linea.cantidad_base - v_linea.cantidad_despachada);
  end if;

  -- Brief W8 — la compuerta de reserva: sin turno para toda la cantidad pedida,
  -- despachar_linea rechaza (hay que pasar por despachar_linea_forzado, con
  -- motivo, que sí puede omitir esta validación). v_pedido_linea_reserva ya
  -- calcula `cubierto` con FIFO (reserva de clientes primero, reposición
  -- después) — acá no se reimplementa ese cálculo, solo se consulta.
  if not p_omitir_turno then
    select cubierto into v_cubierto from v_pedido_linea_reserva where linea_id = p_linea_id;
    if v_total_asignado > coalesce(v_cubierto, 0) + 0.0001 then
      raise exception 'La línea % solo tiene turno para % unidades de las % pedidas — el resto está reservado para otro pedido. Usá despachar_linea_forzado con motivo para despachar igual.',
        p_linea_id, coalesce(v_cubierto, 0), v_total_asignado;
    end if;
  end if;

  v_reversible_hasta := case when v_pedido.categoria = 'TIENDA' then now() + interval '30 minutes' else null end;

  insert into pedido_despacho_evento (pedido_linea_id, cantidad_base, reversible_hasta, creado_por)
  values (p_linea_id, v_total_asignado, v_reversible_hasta, p_usuario)
  returning id into v_evento_id;

  -- segunda pasada: ejecutar el pick real, ubicación por ubicación
  for v_asig in select * from jsonb_array_elements(p_asignaciones)
  loop
    v_ubicacion_id := (v_asig->>'ubicacion_id')::bigint;
    v_cantidad := (v_asig->>'cantidad_base')::numeric;

    select registrar_salida(
      p_presentacion_id => v_presentacion_base_id,
      p_ubicacion_id    => v_ubicacion_id,
      p_cantidad_pres   => v_cantidad,
      p_referencia      => 'Pedido #' || v_linea.pedido_id || ' · línea ' || p_linea_id,
      p_usuario         => p_usuario
    ) into v_kardex_id;

    insert into pedido_despacho_movimiento (evento_id, kardex_transaccion_id, ubicacion_id, cantidad_base)
    values (v_evento_id, v_kardex_id, v_ubicacion_id, v_cantidad);

    v_kardex_ids := v_kardex_ids || to_jsonb(v_kardex_id);
  end loop;

  v_nueva_despachada := v_linea.cantidad_despachada + v_total_asignado;
  v_nuevo_estado := case when v_nueva_despachada >= v_linea.cantidad_base then 'DESPACHADA' else 'PENDIENTE' end;

  update pedido_linea
     set cantidad_despachada = v_nueva_despachada,
         estado = v_nuevo_estado
   where id = p_linea_id;

  perform recalcular_estado_pedido(v_linea.pedido_id);

  return jsonb_build_object(
    'linea_id', p_linea_id,
    'evento_id', v_evento_id,
    'estado', v_nuevo_estado,
    'cantidad_despachada', v_nueva_despachada,
    'pendiente', greatest(v_linea.cantidad_base - v_nueva_despachada, 0),
    'kardex_ids', v_kardex_ids,
    'reversible_hasta', v_reversible_hasta
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- PASO 2 — despachar_linea: misma firma de siempre, ahora respeta el turno
-- ----------------------------------------------------------------------------
create or replace function despachar_linea(
  p_linea_id       bigint,
  p_asignaciones   jsonb,
  p_usuario        text default null
) returns jsonb
language plpgsql
as $$
begin
  return _despachar_linea_nucleo(p_linea_id, p_asignaciones, p_usuario, false);
end;
$$;

-- ----------------------------------------------------------------------------
-- PASO 3 — despachar_linea_forzado: pisa el turno, motivo obligatorio, deja
-- rastro en despacho_sobre_reserva por la porción que excede el turno.
-- ----------------------------------------------------------------------------
create or replace function despachar_linea_forzado(
  p_linea_id       bigint,
  p_asignaciones   jsonb,
  p_motivo         text,
  p_usuario        text default null
) returns jsonb
language plpgsql
as $$
declare
  v_resultado      jsonb;
  v_producto_id    bigint;
  v_cubierto       numeric;
  v_turno          bigint;
  v_asig           jsonb;
  v_total_asignado numeric := 0;
  v_excedente      numeric;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio para despachar por encima del turno';
  end if;

  if jsonb_typeof(p_asignaciones) <> 'array' or jsonb_array_length(p_asignaciones) = 0 then
    raise exception 'p_asignaciones debe ser un array no vacío de {ubicacion_id, cantidad_base}';
  end if;

  select producto_id into v_producto_id from pedido_linea where id = p_linea_id;
  if v_producto_id is null then
    raise exception 'Línea % no existe', p_linea_id;
  end if;

  select cubierto, turno into v_cubierto, v_turno
  from v_pedido_linea_reserva
  where linea_id = p_linea_id;

  for v_asig in select * from jsonb_array_elements(p_asignaciones)
  loop
    v_total_asignado := v_total_asignado + (v_asig->>'cantidad_base')::numeric;
  end loop;

  -- El pick real primero (falla y revierte todo si algo de esto es inválido —
  -- misma validación de estado/cantidades que despachar_linea, solo que sin
  -- el corte de turno).
  v_resultado := _despachar_linea_nucleo(p_linea_id, p_asignaciones, p_usuario, true);

  -- Bitácora obligatoria y NO best-effort: va en la misma transacción que el
  -- despacho de arriba (misma función = mismo commit), así que si esta
  -- inserción fallara, todo el despacho se revierte con ella.
  v_excedente := greatest(v_total_asignado - coalesce(v_cubierto, 0), 0);
  if v_excedente > 0 then
    insert into despacho_sobre_reserva
      (pedido_linea_id, producto_id, cantidad_base, turno_pedido, motivo, usuario)
    values
      (p_linea_id, v_producto_id, v_excedente, v_turno, p_motivo, p_usuario);
  end if;

  return v_resultado;
end;
$$;

commit;

-- ============================================================================
-- PASO 4 — Verificación post-migración (ejecutar manualmente)
-- ============================================================================
--
-- 4a. despachar_linea normal, con turno completo: sigue funcionando igual que
--     antes (sin cambios de comportamiento cuando cubierto >= pendiente).
--
-- 4b. Reservar todo el stock de un producto con un pedido MAYOR/INSTITUCIONAL/
--     MUNICIPAL, y probar despachar_linea sobre una línea TIENDA del mismo
--     producto creada después: debe fallar con el mensaje de turno.
--
-- 4c. despachar_linea_forzado sobre esa misma línea TIENDA con motivo: debe
--     despachar y dejar una fila en despacho_sobre_reserva con
--     cantidad_base = lo que excede el turno.
--
-- 4d. despachar_linea_forzado sin motivo (null o vacío): debe rechazar antes
--     de tocar Kardex.
--
-- Todo dentro de BEGIN … ROLLBACK durante la validación — no debe persistir
-- nada hasta que se corra fuera de una transacción de prueba.
