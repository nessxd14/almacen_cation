-- ============================================================
-- Fase 5 (parcial) — Limpieza de atributos en WMS (Brief 1/2)
-- No toca Shopify. Cubre 3 de los 4 puntos de Fase 5:
--   1) Consolidar duplicados de valores de Color (grafía/mayúsculas/punto).
--   2) Fusionar Numero + Numeracion + # en un solo atributo "Número".
--   3) Retirar el atributo Marca (redundante con producto.marca).
--
-- NO incluye "dividir Color y clasificacion en dos atributos": las 13
-- variantes de ese atributo son íntegramente de la familia ESTUCHE
-- GEOMETRICO MADISON y requieren el mismo mapeo de
-- split_atributos_compuestos.xlsx que usa la Fase 3 (Shopify Options) —
-- ese archivo no está disponible en esta sesión. Queda pendiente de un
-- mapeo explícito antes de tocarlo.
--
-- Validado con BEGIN...ROLLBACK contra la base viva (supabase_db_almacen_roari,
-- zxoxougwgstrarwymlvd) el 2026-07-22 antes de este commit — ver resultados
-- en la conversación. Aplicar manualmente después de revisión humana.
-- ============================================================

-- ---------- 1) Color: consolidar duplicados ----------
-- keeper_id = fila con grafía limpia (Title Case, sin punto final) ya
-- existente; duplicate_id = variantes de mayúscula/minúscula/punto final
-- del mismo color, detectadas agrupando por lower(trim(trailing '.' from
-- trim(valor))) sobre la base viva.
with mapeo(duplicate_id, keeper_id) as (
  values
    (30, 3),   (91, 3),          -- Amarillo.  / AMARILLO      -> Amarillo
    (52, 10),                    -- AZUL                       -> Azul
    (444, 174),                  -- AZUL MARINO                -> Azul marino
    (437, 9),  (23, 9),          -- BLANCO / Blanco.           -> Blanco
    (50, 12),                    -- CAFE                       -> Cafe
    (101, 22),                   -- CELESTE                    -> Celeste
    (440, 19),                   -- DORADO                     -> Dorado
    (448, 29),                   -- FUCSIA                     -> Fucsia
    (445, 16), (26, 16),         -- LILA / Lila.               -> Lila
    (94, 1),                     -- NARANJA                    -> Naranja
    (53, 7),                     -- NEGRO                      -> Negro
    (93, 8),                     -- PLOMO                      -> Plomo
    (51, 13),  (17, 13),         -- ROJO / Rojo.               -> Rojo
    (92, 4),                     -- ROSADO                     -> Rosado
    (89, 46)                     -- VERDE                      -> Verde
)
update producto_atributo pa
set atributo_valor_id = m.keeper_id
from mapeo m
where pa.atributo_valor_id = m.duplicate_id
  and not exists (
    select 1 from producto_atributo pa2
    where pa2.producto_id = pa.producto_id and pa2.atributo_valor_id = m.keeper_id
  );

-- Filas que ya tenían el keeper asociado al mismo producto (colisión real;
-- no se detectó ninguna al validar, se deja por seguridad) se descartan en
-- vez de violar la PK compuesta (producto_id, atributo_valor_id).
with mapeo(duplicate_id, keeper_id) as (
  values
    (30, 3),   (91, 3),   (52, 10),  (444, 174), (437, 9),  (23, 9),
    (50, 12),  (101, 22), (440, 19), (448, 29),  (445, 16), (26, 16),
    (94, 1),   (53, 7),   (93, 8),   (51, 13),   (17, 13),  (92, 4),
    (89, 46)
)
delete from producto_atributo pa
using mapeo m
where pa.atributo_valor_id = m.duplicate_id;

with mapeo(duplicate_id, keeper_id) as (
  values
    (30, 3),   (91, 3),   (52, 10),  (444, 174), (437, 9),  (23, 9),
    (50, 12),  (101, 22), (440, 19), (448, 29),  (445, 16), (26, 16),
    (94, 1),   (53, 7),   (93, 8),   (51, 13),   (17, 13),  (92, 4),
    (89, 46)
)
delete from atributo_valor av
using mapeo m
where av.id = m.duplicate_id;

-- ---------- 2) Fusionar Numero + Numeracion + # -> "Número" ----------
-- No hay colisiones de `valor` entre los tres atributos (verificado contra
-- la base viva), así que el UPDATE de atributo_valor no pisa la unicidad
-- (atributo_id, valor).
do $$
declare
  v_numero_id bigint;
begin
  insert into atributo (nombre) values ('Número')
  on conflict (nombre) do update set nombre = excluded.nombre
  returning id into v_numero_id;

  update atributo_valor
  set atributo_id = v_numero_id
  where atributo_id in (select id from atributo where nombre in ('Numero', 'Numeracion', '#'));

  delete from atributo where nombre in ('Numero', 'Numeracion', '#');
end $$;

-- ---------- 3) Retirar atributo Marca (redundante con producto.marca) ----------
-- Verificado: el único producto que usa este atributo (RESMA PAPEL BOND
-- T/OFICIO - Millenium) ya tiene producto.marca = 'MILLENIUM', igual al
-- valor del atributo -> no hay pérdida de información al retirarlo.
delete from producto_atributo
where atributo_valor_id in (
  select av.id from atributo_valor av
  join atributo a on a.id = av.atributo_id
  where a.nombre = 'Marca'
);

delete from atributo_valor
where atributo_id = (select id from atributo where nombre = 'Marca');

delete from atributo
where nombre = 'Marca';
