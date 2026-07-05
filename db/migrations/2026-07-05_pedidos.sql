-- Migración: Despacho de pedidos con backorder (Fase C).
-- Proyecto Supabase Cloud: supabase_db_almacen_roari (ref zxoxougwgstrarwymlvd).
-- NO aplicada automáticamente — revisar y ejecutar manualmente desde el SQL
-- Editor de Supabase, validando primero en BEGIN … ROLLBACK.
--
-- ============================================================================
-- PASO 0 — Evidencia recogida contra la base viva (2026-07-05)
-- ============================================================================
--
-- 0a. Tipos reales que debe calzar esta migración:
--     producto.id, presentacion.id, ubicacion.id, kardex_transacciones.id -> bigint
--     stock_actual.cantidad_base, kardex_transacciones.cantidad -> numeric
--     producto/kardex timestamps -> timestamp with time zone
--     registrar_salida / registrar_entrada usan p_fecha DATE (no timestamptz).
--
-- 0b. Firmas confirmadas (pg_get_function_arguments):
--   registrar_entrada(p_presentacion_id bigint, p_ubicacion_id bigint,
--     p_cantidad_pres numeric, p_referencia text,
--     p_usuario varchar default null, p_fecha date default current_date,
--     p_costo_unitario numeric default null, p_idempotencia text default null)
--     RETURNS bigint
--   registrar_salida(p_presentacion_id bigint, p_ubicacion_id bigint,
--     p_cantidad_pres numeric, p_referencia text,
--     p_usuario varchar default null, p_fecha date default current_date,
--     p_idempotencia text default null, p_permitir_sobregiro boolean default false)
--     RETURNS bigint
--   Sin p_motivo en registrar_salida -> la categoría de venta vive en `pedido`,
--   no en el Kardex (igual que ya resolvimos en Fase B para "Vender ahora").
--
-- 0c. kardex_transacciones.idempotencia_clave tiene UNIQUE (uq_kardex_idem):
--     duplicado -> devuelve el id existente (comportamiento ya usado por
--     ConteoApp/OperacionesApp, no hay que replicarlo acá; despachar_linea no
--     pasa p_idempotencia explícita porque cada línea de pedido se despacha
--     una sola vez por asignación real).
--
-- 0d. Presentación base: `presentacion.es_base = true`, única por producto
--     (asumido por el resto del sistema; no hay constraint UNIQUE parcial
--     existente que lo garantice — no se agrega acá, fuera de alcance).
--
-- 0e. No existían tablas `pedido*` ni tipos enum `categoria_pedido` /
--     `estado_pedido` / `estado_linea` antes de esta migración (verificado
--     contra information_schema.tables y pg_type). Sin colisión de nombres.
--
-- 0f. Desviación de diseño respecto al brief (documentada, no silenciosa):
--     se agrega `pedido_despacho_movimiento.cantidad_revertida numeric
--     default 0`, columna no listada explícitamente en el brief. Es necesaria
--     para soportar reversión PARCIAL y REPETIBLE dentro de la ventana de
--     30 min sin mutar ni borrar el movimiento original (mantiene el rastro
--     de auditoría de qué SALIDA se hizo a qué ubicación). El saldo
--     reversible de cada movimiento es `cantidad_base - cantidad_revertida`;
--     el evento completo queda `revertido = true` cuando ese saldo llega a
--     cero en todos sus movimientos. Sin esta columna, dos reversiones
--     parciales sucesivas sobre el mismo evento no podrían determinar cuánto
--     de cada ubicación ya se devolvió.
--
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- PASO 1 — Enums
-- ----------------------------------------------------------------------------
create type categoria_pedido as enum ('MAYOR', 'TIENDA');
create type estado_pedido    as enum ('ABIERTO', 'COMPLETADO', 'CANCELADO');
create type estado_linea     as enum ('POR_DESPACHAR', 'DESPACHADA', 'PENDIENTE', 'COMPRADO_DIRECTO');

-- ----------------------------------------------------------------------------
-- PASO 2 — Tablas
-- ----------------------------------------------------------------------------
create table pedido (
  id         bigint generated always as identity primary key,
  categoria  categoria_pedido not null,
  referencia text null,
  estado     estado_pedido not null default 'ABIERTO',
  creado_por character varying null,
  creado_en  timestamptz not null default now()
);
comment on table pedido is 'Pedido de despacho manual (Mayor/Tienda). Online se descuenta vía webhook Shopify, nunca por acá.';

create table pedido_linea (
  id                    bigint generated always as identity primary key,
  pedido_id             bigint not null references pedido(id),
  producto_id           bigint not null references producto(id),
  cantidad_base         numeric not null check (cantidad_base > 0),
  estado                estado_linea not null default 'POR_DESPACHAR',
  cantidad_despachada   numeric not null default 0 check (cantidad_despachada >= 0),
  compra_directa_nota   text null,
  compra_directa_costo  numeric null,
  creado_en             timestamptz not null default now()
);
comment on column pedido_linea.cantidad_base is 'Requerido, en unidad base del producto.';
comment on column pedido_linea.cantidad_despachada is 'Acumulado ya salido. Pendiente = cantidad_base - cantidad_despachada cuando estado = PENDIENTE.';

create table pedido_despacho_evento (
  id                bigint generated always as identity primary key,
  pedido_linea_id   bigint not null references pedido_linea(id),
  cantidad_base     numeric not null check (cantidad_base > 0),
  reversible_hasta  timestamptz null,
  revertido         boolean not null default false,
  revertido_en      timestamptz null,
  creado_por        character varying null,
  creado_en         timestamptz not null default now()
);
comment on table pedido_despacho_evento is 'Un despacho de despachar_linea() (puede cubrir varias ubicaciones). reversible_hasta solo se setea para pedidos de categoría TIENDA.';

create table pedido_despacho_movimiento (
  id                     bigint generated always as identity primary key,
  evento_id              bigint not null references pedido_despacho_evento(id),
  kardex_transaccion_id  bigint not null references kardex_transacciones(id),
  ubicacion_id           bigint not null references ubicacion(id),
  cantidad_base          numeric not null check (cantidad_base > 0),
  cantidad_revertida     numeric not null default 0 check (cantidad_revertida >= 0 and cantidad_revertida <= cantidad_base)
);
comment on table pedido_despacho_movimiento is 'Puente evento<->Kardex (no se toca kardex_transacciones). Una fila por ubicación usada en el pick. Ver 0f para cantidad_revertida.';

create index idx_pedido_linea_pedido      on pedido_linea (pedido_id);
create index idx_pedido_linea_producto    on pedido_linea (producto_id);
create index idx_pedido_linea_estado      on pedido_linea (estado);
create index idx_evento_linea             on pedido_despacho_evento (pedido_linea_id);
create index idx_movimiento_evento        on pedido_despacho_movimiento (evento_id);
create index idx_movimiento_kardex        on pedido_despacho_movimiento (kardex_transaccion_id);

-- ----------------------------------------------------------------------------
-- PASO 3 — Helper interno: recalcula pedido.estado a partir de sus líneas
-- ----------------------------------------------------------------------------
create or replace function recalcular_estado_pedido(p_pedido_id bigint)
returns void
language plpgsql
as $$
begin
  update pedido p
     set estado = case
           when not exists (
             select 1 from pedido_linea pl
             where pl.pedido_id = p.id
               and pl.estado not in ('DESPACHADA', 'COMPRADO_DIRECTO')
           ) then 'COMPLETADO'::estado_pedido
           when p.estado = 'COMPLETADO' then 'ABIERTO'::estado_pedido -- se reabrió (p.ej. tras una reversión)
           else p.estado
         end
   where p.id = p_pedido_id
     and p.estado <> 'CANCELADO';
end;
$$;

-- ----------------------------------------------------------------------------
-- PASO 4 — crear_pedido
-- ----------------------------------------------------------------------------
create or replace function crear_pedido(
  p_categoria  categoria_pedido,
  p_referencia text,
  p_lineas     jsonb,
  p_usuario    text default null
) returns bigint
language plpgsql
as $$
declare
  v_pedido_id bigint;
  v_linea     jsonb;
begin
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'p_lineas debe ser un array no vacío de {producto_id, cantidad_base}';
  end if;

  insert into pedido (categoria, referencia, creado_por)
  values (p_categoria, p_referencia, p_usuario)
  returning id into v_pedido_id;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    if (v_linea->>'producto_id') is null or (v_linea->>'cantidad_base') is null then
      raise exception 'Cada línea requiere producto_id y cantidad_base';
    end if;
    if (v_linea->>'cantidad_base')::numeric <= 0 then
      raise exception 'cantidad_base debe ser positiva (producto_id=%)', v_linea->>'producto_id';
    end if;

    insert into pedido_linea (pedido_id, producto_id, cantidad_base)
    values (
      v_pedido_id,
      (v_linea->>'producto_id')::bigint,
      (v_linea->>'cantidad_base')::numeric
    );
  end loop;

  return v_pedido_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- PASO 5 — despachar_linea
-- ----------------------------------------------------------------------------
create or replace function despachar_linea(
  p_linea_id       bigint,
  p_asignaciones   jsonb,
  p_usuario        text default null
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
-- PASO 6 — revertir_evento
-- ----------------------------------------------------------------------------
create or replace function revertir_evento(
  p_evento_id     bigint,
  p_cantidad_base numeric default null,
  p_usuario       text default null
) returns jsonb
language plpgsql
as $$
declare
  v_evento              pedido_despacho_evento%rowtype;
  v_linea               pedido_linea%rowtype;
  v_presentacion_base_id bigint;
  v_disponible_evento   numeric;
  v_monto_revertir      numeric;
  v_restante            numeric;
  v_mov                 pedido_despacho_movimiento%rowtype;
  v_tomar               numeric;
  v_kardex_id           bigint;
  v_movimientos         jsonb := '[]'::jsonb;
  v_nueva_despachada    numeric;
  v_nuevo_estado        estado_linea;
  v_evento_completo     boolean;
begin
  select * into v_evento from pedido_despacho_evento where id = p_evento_id for update;
  if not found then
    raise exception 'Evento % no existe', p_evento_id;
  end if;
  if v_evento.revertido then
    raise exception 'El evento % ya fue revertido por completo', p_evento_id;
  end if;
  if v_evento.reversible_hasta is null or now() > v_evento.reversible_hasta then
    raise exception 'El evento % no admite reversión (solo Tienda, ventana de 30 min vencida o no aplica)', p_evento_id;
  end if;

  select * into v_linea from pedido_linea where id = v_evento.pedido_linea_id for update;

  select id into v_presentacion_base_id
  from presentacion
  where producto_id = v_linea.producto_id and es_base = true
  limit 1;
  if v_presentacion_base_id is null then
    raise exception 'Producto % no tiene presentación base', v_linea.producto_id;
  end if;

  select coalesce(sum(cantidad_base - cantidad_revertida), 0) into v_disponible_evento
  from pedido_despacho_movimiento
  where evento_id = p_evento_id;

  v_monto_revertir := coalesce(p_cantidad_base, v_disponible_evento);
  if v_monto_revertir <= 0 then
    raise exception 'Cantidad a revertir inválida';
  end if;
  if v_monto_revertir > v_disponible_evento + 0.0001 then
    raise exception 'La cantidad a revertir (%) excede lo disponible del evento (%)', v_monto_revertir, v_disponible_evento;
  end if;

  v_restante := v_monto_revertir;

  -- mayor aporte primero
  for v_mov in
    select * from pedido_despacho_movimiento
    where evento_id = p_evento_id and (cantidad_base - cantidad_revertida) > 0
    order by (cantidad_base - cantidad_revertida) desc, id
    for update
  loop
    exit when v_restante <= 0;
    v_tomar := least(v_restante, v_mov.cantidad_base - v_mov.cantidad_revertida);

    select registrar_entrada(
      p_presentacion_id => v_presentacion_base_id,
      p_ubicacion_id    => v_mov.ubicacion_id,
      p_cantidad_pres   => v_tomar,
      p_referencia      => 'Reversión pedido #' || v_linea.pedido_id || ' · evento ' || p_evento_id,
      p_usuario         => p_usuario
    ) into v_kardex_id;

    update pedido_despacho_movimiento
       set cantidad_revertida = cantidad_revertida + v_tomar
     where id = v_mov.id;

    v_movimientos := v_movimientos || jsonb_build_object(
      'ubicacion_id', v_mov.ubicacion_id,
      'cantidad_base', v_tomar,
      'kardex_id', v_kardex_id
    );

    v_restante := v_restante - v_tomar;
  end loop;

  v_nueva_despachada := greatest(v_linea.cantidad_despachada - v_monto_revertir, 0);
  v_nuevo_estado := case
    when v_nueva_despachada <= 0 then 'POR_DESPACHAR'
    when v_nueva_despachada < v_linea.cantidad_base then 'PENDIENTE'
    else v_linea.estado
  end;

  update pedido_linea
     set cantidad_despachada = v_nueva_despachada,
         estado = v_nuevo_estado
   where id = v_linea.id;

  select (coalesce(sum(cantidad_base - cantidad_revertida), 0) <= 0) into v_evento_completo
  from pedido_despacho_movimiento
  where evento_id = p_evento_id;

  update pedido_despacho_evento
     set revertido = v_evento_completo,
         revertido_en = case when v_evento_completo then now() else revertido_en end
   where id = p_evento_id;

  perform recalcular_estado_pedido(v_linea.pedido_id);

  return jsonb_build_object(
    'evento_id', p_evento_id,
    'linea_id', v_linea.id,
    'monto_revertido', v_monto_revertir,
    'movimientos', v_movimientos,
    'nuevo_estado_linea', v_nuevo_estado,
    'cantidad_despachada', v_nueva_despachada,
    'evento_revertido_total', v_evento_completo
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- PASO 7 — comprar_directo
-- ----------------------------------------------------------------------------
create or replace function comprar_directo(
  p_linea_id bigint,
  p_nota     text,
  p_costo    numeric default null,
  p_usuario  text default null
) returns jsonb
language plpgsql
as $$
declare
  v_linea pedido_linea%rowtype;
begin
  select * into v_linea from pedido_linea where id = p_linea_id for update;
  if not found then
    raise exception 'Línea % no existe', p_linea_id;
  end if;
  if v_linea.estado in ('DESPACHADA', 'COMPRADO_DIRECTO') then
    raise exception 'La línea % ya está cerrada (%)', p_linea_id, v_linea.estado;
  end if;
  if p_nota is null or btrim(p_nota) = '' then
    raise exception 'La nota de compra directa es obligatoria';
  end if;

  update pedido_linea
     set estado = 'COMPRADO_DIRECTO',
         compra_directa_nota = p_nota,
         compra_directa_costo = p_costo
   where id = p_linea_id;

  perform recalcular_estado_pedido(v_linea.pedido_id);

  return jsonb_build_object('linea_id', p_linea_id, 'estado', 'COMPRADO_DIRECTO');
end;
$$;

-- ----------------------------------------------------------------------------
-- PASO 8 — Vista de líneas pendientes "habilitadas" (con stock nuevo)
-- ----------------------------------------------------------------------------
create view v_pedido_linea_despachable as
select pl.*
from pedido_linea pl
where pl.estado = 'PENDIENTE'
  and exists (
    select 1 from stock_actual sa
    where sa.producto_id = pl.producto_id and sa.cantidad_base > 0
  );

commit;

-- ============================================================================
-- PASO 9 — Verificación post-migración (ejecutar manualmente)
-- ============================================================================

-- 9a. Tablas y tipos presentes:
-- select table_name from information_schema.tables where table_schema='public' and table_name like 'pedido%';
-- select typname from pg_type where typtype='e' and typnamespace='public'::regnamespace and typname like '%pedido%' or typname='estado_linea';

-- 9b. Prueba funcional completa (en transacción con ROLLBACK): crea un pedido
--     Mayor de 1 línea, la despacha, y verifica el estado resultante.
--     Elige el producto dinámicamente. ROLLBACK al final — nada persiste.
--
-- begin;
-- do $$
-- declare
--   v_producto_id  bigint;
--   v_pedido_id    bigint;
--   v_linea_id     bigint;
--   v_ubicacion_id bigint;
--   v_resultado    jsonb;
--   v_estado_final estado_pedido;
-- begin
--   select sa.producto_id into v_producto_id
--   from stock_actual sa
--   where sa.cantidad_base >= 1
--   order by sa.cantidad_base desc
--   limit 1;
--
--   select ubicacion_id into v_ubicacion_id
--   from stock_actual
--   where producto_id = v_producto_id and cantidad_base >= 1
--   order by cantidad_base desc
--   limit 1;
--
--   v_pedido_id := crear_pedido('MAYOR', 'Test Fase C (rollback)',
--     jsonb_build_array(jsonb_build_object('producto_id', v_producto_id, 'cantidad_base', 1)),
--     'migracion');
--
--   select id into v_linea_id from pedido_linea where pedido_id = v_pedido_id limit 1;
--
--   v_resultado := despachar_linea(v_linea_id,
--     jsonb_build_array(jsonb_build_object('ubicacion_id', v_ubicacion_id, 'cantidad_base', 1)),
--     'migracion');
--
--   select estado into v_estado_final from pedido where id = v_pedido_id;
--
--   raise notice 'despacho: %', v_resultado;
--   raise notice 'pedido.estado final: %', v_estado_final;
--   assert (v_resultado->>'estado') = 'DESPACHADA', 'FALLO: la línea no quedó DESPACHADA';
--   assert v_estado_final = 'COMPLETADO', 'FALLO: el pedido de 1 línea despachada debería quedar COMPLETADO';
-- end $$;
-- rollback;
--
-- Criterio de éxito: pedido_linea queda DESPACHADA, pedido.estado queda
-- COMPLETADO, pedido_despacho_evento y pedido_despacho_movimiento tienen
-- filas correspondientes, y kardex_transacciones registró la SALIDA. Todo
-- dentro del ROLLBACK, no debe persistir nada.
