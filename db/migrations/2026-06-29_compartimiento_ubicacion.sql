-- Migración: agregar nivel "compartimiento" (letra) a la jerarquía de ubicaciones.
-- Aplicada en Supabase Cloud (proyecto supabase_db_almacen_roari) el 2026-06-29.
-- Se conserva codigo_zona / estante / nivel; solo se agrega `compartimiento`
-- (nullable) para no romper vistas, RPCs ni el helper etiquetaUbicacion.
--
-- Mapeo árbol → columna:
--   Zona            -> codigo_zona
--   Tipo            -> estante  ("Pallet" | "Estante")
--   Posición (núm.) -> nivel
--   Compartimiento  -> compartimiento (letra, opcional)
--
-- Pallet:  compartimiento siempre NULL.
-- Estante: o subdividido (una fila por letra) o una sola fila con NULL.

-- 1a. Columna + índice único (incluye compartimiento; coalesce porque NULL
--     no es comparable en índices únicos).
alter table ubicacion add column if not exists compartimiento varchar;

create unique index if not exists ux_ubicacion_full
  on ubicacion (codigo_zona, estante, nivel, coalesce(compartimiento, ''));

-- 1b. Migración de datos existentes.
--     Los estantes guardaban "número - letra" dentro de `nivel`. Se separan
--     en nivel (número) + compartimiento (letra). Mapeo confirmado con el
--     usuario: la fila "C" (sin número) pertenece al Estante 1.
--       id 4: "1 - A" -> nivel="1", compartimiento="A"
--       id 5: "1 - B" -> nivel="1", compartimiento="B"
--       id 6: "C"     -> nivel="1", compartimiento="C"
update ubicacion set nivel = '1', compartimiento = 'A' where id = 4 and codigo_zona = 'HUECO' and nivel = '1 - A';
update ubicacion set nivel = '1', compartimiento = 'B' where id = 5 and codigo_zona = 'HUECO' and nivel = '1 - B';
update ubicacion set nivel = '1', compartimiento = 'C' where id = 6 and codigo_zona = 'HUECO' and nivel = 'C';

-- 1c. Vistas que arman la etiqueta de ubicación: se agrega el compartimiento
--     al final para no perder la letra tras separar `nivel`.
create or replace view v_stock as
 SELECT st.producto_id,
    st.ubicacion_id,
    p.nombre AS producto,
    p.sku_interno AS sku,
    ((((((u.codigo_zona)::text || '-'::text) || (u.estante)::text) || '-'::text) || (u.nivel)::text) || COALESCE(('-'::text || (u.compartimiento)::text), ''::text)) AS ubicacion,
    st.cantidad_base,
    st.actualizado_en
   FROM ((stock_actual st
     JOIN producto p ON ((p.id = st.producto_id)))
     JOIN ubicacion u ON ((u.id = st.ubicacion_id)))
  WHERE (st.cantidad_base <> (0)::numeric);

create or replace view v_kardex_movimientos as
 SELECT kt.id,
    kt.producto_id,
    kt.presentacion_id,
    kt.ubicacion_id,
    p.nombre AS producto,
    p.sku_interno AS sku,
    pr.nombre AS presentacion,
    ((((((u.codigo_zona)::text || '-'::text) || (u.estante)::text) || '-'::text) || (u.nivel)::text) || COALESCE(('-'::text || (u.compartimiento)::text), ''::text)) AS ubicacion,
    kt.tipo_movimiento,
    kt.cantidad_origen,
    kt.factor_a_base_snap,
    kt.cantidad AS cantidad_base,
    sum(kt.cantidad) OVER (PARTITION BY kt.producto_id, kt.ubicacion_id ORDER BY kt.creado_en, kt.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo_base,
    kt.referencia,
    kt.motivo,
    kt.creado_por,
    kt.fecha_efectiva,
    kt.creado_en
   FROM (((kardex_transacciones kt
     JOIN producto p ON ((p.id = kt.producto_id)))
     JOIN presentacion pr ON ((pr.id = kt.presentacion_id)))
     JOIN ubicacion u ON ((u.id = kt.ubicacion_id)));

create or replace view v_traslados as
 SELECT kt.traslado_grupo_id,
    kt.producto_id,
    p.nombre AS producto,
    p.sku_interno AS sku,
    kt.presentacion_id,
    pr.nombre AS presentacion,
    kt.ubicacion_id,
    ((((((u.codigo_zona)::text || '-'::text) || (u.estante)::text) || '-'::text) || (u.nivel)::text) || COALESCE(('-'::text || (u.compartimiento)::text), ''::text)) AS ubicacion,
    kt.cantidad AS cantidad_base,
    kt.referencia,
    kt.motivo,
    kt.creado_por,
    kt.fecha_efectiva,
    kt.creado_en
   FROM (((kardex_transacciones kt
     JOIN producto p ON ((p.id = kt.producto_id)))
     JOIN presentacion pr ON ((pr.id = kt.presentacion_id)))
     JOIN ubicacion u ON ((u.id = kt.ubicacion_id)))
  WHERE (kt.tipo_movimiento = 'TRASLADO'::tipo_movimiento);

-- v_inventario_detalle: se agrega compartimiento al final (CREATE OR REPLACE
-- sólo permite anexar columnas) para que InventarioApp (select *) lo reciba.
create or replace view v_inventario_detalle as
 SELECT sa.producto_id,
    p.nombre AS producto_nombre,
    p.sku_interno,
    p.precio_base,
    p.unidad_base,
    p.imagen_url,
    p.shopify_variant_id,
    sa.ubicacion_id,
    u.codigo_zona,
    u.estante,
    u.nivel,
    sa.cantidad_base,
    COALESCE((sa.cantidad_base * p.precio_base), (0)::numeric) AS valor_linea,
    sa.actualizado_en,
    u.compartimiento
   FROM ((stock_actual sa
     JOIN producto p ON ((p.id = sa.producto_id)))
     JOIN ubicacion u ON ((u.id = sa.ubicacion_id)))
  WHERE (p.activo = true);
