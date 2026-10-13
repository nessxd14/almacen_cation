-- =====================================================================
-- Ubicaciones: los muebles se identifican con LETRA y los compartimientos
-- con NÚMERO (pedido de Ness, 2026-10-12).
--
-- Antes:  PLANTA BAJA › Estante 1 › A … H        Pallet 0 / Pallet 1
-- Ahora:  PLANTA BAJA › Estante A › 1 … 8        Pallet A
--
-- Se conservan las columnas (para no romper vistas, RPCs ni etiquetas);
-- cambia lo que guarda cada una:
--   codigo_zona     zona                     (sin cambios)
--   estante         tipo de mueble           'Estante' | 'Pallet'  (sin cambios)
--   nivel           LETRA del mueble         A–Z, una por mueble dentro de la zona
--   compartimiento  NÚMERO del compartimiento 1, 2, 3…  (NULL = mueble sin divisiones)
--
-- Las filas se corrigen en su lugar: los ids no cambian, así que el kardex,
-- el stock, las asignaciones y las etiquetas QR (que apuntan al id) siguen
-- igual. Las ubicaciones que no son muebles (SALÓN, VENTAS DIRECTAS,
-- SHOPIFY, SOBREGIRO ONLINE) no se tocan.
--
-- Validar en BEGIN…ROLLBACK antes de aplicar.
-- =====================================================================

-- 1. Letra de cada mueble: se numeraban 0, 1, 2… dentro de su zona y tipo;
--    pasan a A, B, C… respetando ese orden.
with muebles as (
  select codigo_zona, estante, nivel,
         chr(64 + dense_rank() over (partition by codigo_zona, estante
                                     order by nullif(regexp_replace(nivel, '\D', '', 'g'), '')::int nulls last, nivel)::int) letra
    from public.ubicacion
   where estante in ('Estante', 'Pallet')
     and nivel !~ '^[A-Z]$'
   group by codigo_zona, estante, nivel
)
update public.ubicacion u
   set nivel = m.letra
  from muebles m
 where u.codigo_zona = m.codigo_zona
   and u.estante = m.estante
   and u.nivel = m.nivel;

-- 2. Compartimientos: A → 1, B → 2, …
update public.ubicacion
   set compartimiento = (ascii(upper(compartimiento)) - 64)::text
 where estante in ('Estante', 'Pallet')
   and compartimiento ~ '^[A-Za-z]$';

-- 3. Desde ahora la base exige el formato nuevo en los muebles.
alter table public.ubicacion drop constraint if exists ubicacion_mueble_formato;
alter table public.ubicacion add constraint ubicacion_mueble_formato check (
  estante is null
  or estante not in ('Estante', 'Pallet')
  or (nivel ~ '^[A-Z]$' and (compartimiento is null or compartimiento ~ '^[1-9][0-9]?$'))
);

-- 4. Los muebles deben pertenecer a una sucursal; el alta desde Administración
--    no la mandaba y fallaba con "null value in column sucursal_id".
--    (Sin cambio de esquema: la app ahora la envía. Se deja anotado.)
