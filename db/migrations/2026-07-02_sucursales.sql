-- Migración: nivel "sucursal" como agrupador de `ubicacion` + creación de
-- v_disponible_shopify con aislamiento de stock de tienda.
-- Proyecto Supabase Cloud: supabase_db_almacen_roari (ref zxoxougwgstrarwymlvd).
-- NO aplicada automáticamente — revisar y ejecutar manualmente desde el SQL
-- Editor de Supabase.
--
-- ============================================================================
-- PASO 0 — Evidencia recogida contra la base viva (2026-07-02)
-- ============================================================================
--
-- 0a. Estructura real de `ubicacion`:
--   id              bigint            NOT NULL
--   codigo_zona     character varying NOT NULL
--   estante         character varying NULL
--   nivel           character varying NULL
--   compartimiento  character varying NULL
--
-- 0b. Ubicaciones existentes (16 filas). La ubicación virtual SHOPIFY es
--     id=20, codigo_zona='SHOPIFY', estante='Virtual', nivel='1',
--     compartimiento=NULL. Resto: HUECO (4,5,6), PLANTA BAJA (12-19,23),
--     PLANTA ARRIBA (21), PLANTA GARRAGE (22), SECTOR ARTE (24).
--
-- 0c. Rol contable de la ubicación SHOPIFY (id=20) — HALLAZGO IMPORTANTE:
--     Hoy no tiene saldo en stock_actual (0 filas) ni movimientos en
--     kardex_transacciones (0 filas): la tienda Shopify recién está siendo
--     configurada y aún no procesó ninguna orden/refund reales.
--     Sin embargo su ROL FUNCIONAL está fijado en código: la Edge Function
--     `shopify-webhook` postea `registrar_salida` (orders/fulfilled, con
--     p_permitir_sobregiro=true) y `registrar_entrada` (refunds/create)
--     contra `WMS_UBICACION_SHOPIFY` (=20). Es decir: las ventas online
--     descuentan de esa ubicación con sobregiro permitido, por lo que su
--     saldo tenderá a volverse negativo y DEBE participar del neto de
--     `v_disponible_shopify` (regla explícita del brief 0c). Por eso la
--     sucursal Shopify se crea con visible_online = TRUE.
--
-- 0d. HALLAZGO BLOQUEANTE: `v_disponible_shopify` NO EXISTE en la base
--     (pg_get_viewdef falla con 42P01) y no hay ninguna referencia a ese
--     nombre en el repo ni en las Edge Functions desplegadas. El brief la
--     trata como una vista a "corregir", pero en realidad se crea de cero
--     en este PASO 5. Este archivo fue re-alcanzado con el usuario antes de
--     escribir DDL (ver decisión más abajo).
--
--     Además: la Edge Function `shopify-stock-push` (la que realmente
--     empuja "available" a Shopify) NO consulta ninguna vista — suma
--     `stock_actual.cantidad_base` de TODAS las ubicaciones del producto,
--     sin filtrar por sucursal. Ahí es donde vive hoy el bug que motiva
--     este brief (stock de tienda contaría como disponible online), no en
--     una vista inexistente.
--
--     DECISIÓN (confirmada con el usuario): se crea `v_disponible_shopify`
--     tal como describe el brief (columnas producto_id, shopify_variant_id,
--     shopify_inventory_item_id, disponible_variante; filtro por
--     sucursal.visible_online) para dejar la base de datos correcta y lista.
--     La vista queda SIN CONSUMIDOR todavía — `shopify-stock-push` sigue
--     sumando stock_actual directo. Cerrar el bug end-to-end requiere una
--     fase separada que actualice esa Edge Function para leer de esta
--     vista en lugar de sumar todas las ubicaciones. Fuera de alcance de
--     esta migración (Edge Functions no cambian, según el brief).
--
--     Asunción de diseño no cubierta por el brief (al no existir definición
--     previa que preservar): la vista solo incluye productos con
--     shopify_variant_id NOT NULL (productos sin mapeo a Shopify no tienen
--     "variante" que reportar).
--
-- 0e. FKs que referencian `ubicacion` (no se rompen; solo se agrega columna
--     nullable primero):
--     conciliacion_linea_ubicacion_id_fkey, conteo_fisico_inicial_ubicacion_id_fkey,
--     kardex_transacciones_ubicacion_id_fkey, producto_ubicacion_ubicacion_id_fkey,
--     stock_actual_ubicacion_id_fkey.
--
-- 0f. Confirmado: no existe tabla `sucursal` ni columna `ubicacion.sucursal_id`.
--
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- PASO 1 — Tabla `sucursal`
-- ----------------------------------------------------------------------------
create table sucursal (
  id             bigint generated always as identity primary key,
  nombre         text not null unique,
  tipo           text not null check (tipo in ('fisica','virtual')),
  visible_online boolean not null default true,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now()
);

comment on table  sucursal is 'Agrupador de ubicaciones: almacenes, tiendas y sucursales virtuales';
comment on column sucursal.visible_online is 'Si TRUE, el stock de sus ubicaciones participa en v_disponible_shopify';

-- ----------------------------------------------------------------------------
-- PASO 2 — Seed de sucursales
-- ----------------------------------------------------------------------------
insert into sucursal (nombre, tipo, visible_online) values
  ('Almacén Central', 'fisica',  true),
  ('Tienda',          'fisica',  false),
  ('Shopify',         'virtual', true);  -- ver 0c: saldo negativo participa del neto

-- ----------------------------------------------------------------------------
-- PASO 3 — Columna `sucursal_id` en `ubicacion`
-- ----------------------------------------------------------------------------
alter table ubicacion add column sucursal_id bigint references sucursal(id);

-- Backfill: la ubicación virtual SHOPIFY (id=20, ver 0b) -> sucursal Shopify;
-- todas las demás ubicaciones existentes -> Almacén Central.
update ubicacion
   set sucursal_id = (select id from sucursal where nombre = 'Shopify')
 where codigo_zona = 'SHOPIFY';

update ubicacion
   set sucursal_id = (select id from sucursal where nombre = 'Almacén Central')
 where sucursal_id is null;

-- Verificación: debe devolver 0.
-- select count(*) from ubicacion where sucursal_id is null;

alter table ubicacion alter column sucursal_id set not null;

create index idx_ubicacion_sucursal on ubicacion (sucursal_id);

-- ----------------------------------------------------------------------------
-- PASO 4 — Ubicación PISO de la sucursal Tienda
-- ----------------------------------------------------------------------------
insert into ubicacion (codigo_zona, estante, nivel, compartimiento, sucursal_id)
values ('PISO', null, null, null, (select id from sucursal where nombre = 'Tienda'));

-- Documentar aquí el id resultante tras aplicar en Supabase Cloud:
-- id PISO = <completar tras aplicar>

-- ----------------------------------------------------------------------------
-- PASO 5 — Crear `v_disponible_shopify`
-- ----------------------------------------------------------------------------
-- No existía (ver 0d) -> CREATE VIEW directo, no CREATE OR REPLACE / DROP.
-- El LEFT JOIN se mantiene: productos sin stock en sucursales visible_online
-- siguen apareciendo con disponible_variante = 0 (el filtro de sucursal va
-- dentro de la subquery de agregación, no en un WHERE del join externo).
create view v_disponible_shopify as
select
  p.id                          as producto_id,
  p.shopify_variant_id          as shopify_variant_id,
  p.shopify_inventory_item_id   as shopify_inventory_item_id,
  coalesce(disp.disponible, 0)  as disponible_variante
from producto p
left join (
  select sa.producto_id, sum(sa.cantidad_base) as disponible
  from stock_actual sa
  join ubicacion u on u.id = sa.ubicacion_id
  join sucursal s  on s.id = u.sucursal_id
  where s.visible_online = true
  group by sa.producto_id
) disp on disp.producto_id = p.id
where p.shopify_variant_id is not null;

commit;

-- ============================================================================
-- PASO 6 — Verificación post-migración (ejecutar manualmente, revisar antes
-- de confiar en los resultados; 6d corre en transacción propia con ROLLBACK)
-- ============================================================================

-- 6a. Nota: v_disponible_shopify no existía antes de esta migración (0d), así
--     que no hay "antes" real con el que comparar. Como sustituto, el total
--     recién creado debe reflejar únicamente stock en sucursales
--     visible_online=TRUE; hoy Tienda nace sin stock (PISO recién creado y
--     vacío), así que este total ya es el "correcto" post-fix:
-- select sum(disponible_variante) from v_disponible_shopify;

-- 6b. Toda ubicación tiene sucursal:
-- select count(*) from ubicacion where sucursal_id is null;   -- 0

-- 6c. La ubicación PISO existe y pertenece a Tienda:
-- select u.id, u.codigo_zona, s.nombre
-- from ubicacion u join sucursal s on s.id = u.sucursal_id
-- where s.nombre = 'Tienda';

-- 6d. Prueba funcional del aislamiento (en transacción con ROLLBACK):
--     traslada 1 unidad de un producto con stock y mapeo a Shopify hacia
--     PISO -> SUM(v_disponible_shopify) debe BAJAR en 1. Elige el producto
--     dinámicamente (no hardcodear IDs de entrega). ROLLBACK al final.
--
-- begin;
-- do $$
-- declare
--   v_producto_id      bigint;
--   v_presentacion_id  bigint;
--   v_ubicacion_origen bigint;
--   v_ubicacion_piso   bigint;
--   v_total_antes      numeric;
--   v_total_despues    numeric;
-- begin
--   select sa.producto_id, sa.ubicacion_id
--     into v_producto_id, v_ubicacion_origen
--   from stock_actual sa
--   join ubicacion u on u.id = sa.ubicacion_id
--   join sucursal s  on s.id = u.sucursal_id
--   join producto p  on p.id = sa.producto_id
--   where sa.cantidad_base >= 1
--     and s.visible_online = true
--     and p.shopify_variant_id is not null
--   order by sa.cantidad_base desc
--   limit 1;
--
--   select id into v_presentacion_id
--   from presentacion
--   where producto_id = v_producto_id and es_base = true
--   limit 1;
--
--   select u.id into v_ubicacion_piso
--   from ubicacion u join sucursal s on s.id = u.sucursal_id
--   where s.nombre = 'Tienda' and u.codigo_zona = 'PISO';
--
--   select coalesce(sum(disponible_variante), 0) into v_total_antes
--   from v_disponible_shopify;
--
--   perform registrar_traslado(
--     v_presentacion_id, v_ubicacion_origen, v_ubicacion_piso, 1,
--     'Test aislamiento sucursal (rollback)', 'migracion', current_date
--   );
--
--   select coalesce(sum(disponible_variante), 0) into v_total_despues
--   from v_disponible_shopify;
--
--   raise notice 'antes=%, despues=%, diferencia=%',
--     v_total_antes, v_total_despues, (v_total_antes - v_total_despues);
--   assert (v_total_antes - v_total_despues) = 1,
--     'FALLO: el traslado a PISO no redujo v_disponible_shopify en 1';
-- end $$;
-- rollback;
--
-- Criterio de éxito: el traslado a tienda reduce lo disponible online. Si el
-- total no cambia, el filtro de sucursal en la vista no está funcionando.
