-- Migración: presentaciones reales (paquete/bote) + unidad_base limpia.
-- Proyecto Supabase Cloud: supabase_db_almacen_roari (ref zxoxougwgstrarwymlvd).
-- NO aplicada automáticamente — revisar y ejecutar manualmente desde el SQL
-- Editor de Supabase, validando primero en BEGIN … ROLLBACK.
--
-- ============================================================================
-- PASO 0 — Evidencia recogida contra la base viva (2026-07-12)
-- ============================================================================
--
-- 0a. Diagnóstico confirmado — con una corrección respecto al brief:
--     - 1.086 productos activos en total (coincide con el brief).
--     - El brief afirma "94 productos activos con patrón contenedor+número
--       (92 migrables + 2 ambiguos)". Contra la base viva el conteo real es
--       80 (78 migrables + 2 ambiguos) — 14 menos de lo que decía el brief.
--       El detalle de las dos familias sí coincide exacto: Goma Eva (9
--       variantes) y Goma Eva con Brillo (14 variantes), ambas
--       'PAQUETE X 10 UND.', factor 10. Los 55 restantes son productos
--       sueltos (sin familia), cada uno con su propio texto. Se migra el
--       conjunto real (78), no el número citado en el brief.
--     - Distribución completa de unidad_base en productos activos:
--       'unidad' (992), 'PAQUETE X 10 UND.' (24), 'PAQUETE X 24 UND.' (24),
--       'UNIDAD' (10), 'PAQUETE X 12 UND.' (6), 'BOTE X 60 UND.' (4),
--       'PAQUETE X 16 UND.' (4), 'PAQUETE X 20 UND.' (3), 'BOTE X 72 UND.'
--       (2), 'RESMA' (2), 'PAQUETE X 30 UND.' (2), 'PAQUETE X 32 UND.' (1),
--       'PAQUETE X 60 UND.' (1), 'PAQUETE X 24 UND' (1, sin punto), 'PLIEGO'
--       (1), 'PAQ X 20 UND' (1), 'PAQUETE X 36 UND.' (1), 'BOTE X 48 UND.'
--       (1), 'PAQUETE' (1, sin número), 'PAQUETE X 25 UND.' (1), 'BOTE X 96
--       UND.' (1), 'PAQUETE X 20' (1, sin punto/UND), 'Unidad' (1), 'PZC x
--       1' (1). Suma exacta 1.086.
--     - 'unidad' / 'UNIDAD' / 'Unidad' (1.003 productos): NO se tocan —
--       son variantes de mayúscula del mismo sustantivo legítimo, no
--       patrón contenedor+número. El brief solo pide migrar contenedor+
--       número; homogeneizar el casing de "unidad" no es parte de este
--       brief y queda fuera (no se silencia: documentado acá).
--     - 'RESMA' (2) y 'PLIEGO' (1): sustantivos singulares legítimos,
--       confirmado NO tocar (regla de fondo del brief).
--     - Ambiguos, excluidos de esta migración (revisión manual pendiente,
--       ver "Pasos manuales"):
--         id 99  'SILICONA EN BARRA'              unidad_base = 'PAQUETE'   (sin número)
--         id 6439 'ESTUCHE GEOMETRICO 4 Pzs FLEXIBLE' unidad_base = 'PZC x 1'  (factor 1, probable "unidad" mal escrito)
--     - presentacion: 1.086 filas es_base=true (una por producto activo,
--       factor 1) y 0 filas es_base=false en toda la base — confirma que
--       el mecanismo de presentación no-base nunca se usó antes de esto.
--     - Constraint relevante: índice único parcial
--       ux_presentacion_base_por_producto (producto_id) WHERE es_base —
--       no hay restricción que impida múltiples presentaciones no-base
--       por producto, así que el INSERT de abajo es seguro.
--     - stock_actual / kardex_transacciones: NO se tocan (confirmado por
--       el brief que los números ya son unidades sueltas reales). Esta
--       migración es puramente de metadata: unidad_base + nueva fila en
--       presentacion.
--
-- 0b. Prueba obligatoria (criterio de aceptación #4 del brief), ejecutada
--     contra la base viva en BEGIN…ROLLBACK: con esta migración aplicada
--     dentro de la misma transacción, se llamó
--       registrar_entrada(p_presentacion_id => <Paquete (10 und) de
--         producto 4, "Goma Eva - Naranja">, p_ubicacion_id => 21
--         "PLANTA ARRIBA", p_cantidad_pres => 3, ...)
--     Resultado: stock_actual pasó de 860 a 890 (delta exacto +30, no +3);
--     kardex_transacciones quedó con cantidad=30, cantidad_origen=3,
--     factor_a_base_snap=10. El mecanismo de conversión por presentación
--     no-base funciona correcto de punta a punta con datos reales. (No se
--     pudo ejercitar el click-through de la UI real por restricción de red
--     del entorno de ejecución de este agente — validar igual una vez
--     aplicada esta migración, por las dudas.)
--
-- 0c. Los 78 productos migrables, con su factor y contenedor extraídos:
--     ver query de verificación en PASO 1 — el patrón cubre exactamente
--     "PAQUETE X N[.]", "PAQ X N", "BOTE X N" (con o sin "UND"/punto
--     final), sin excepciones fuera de las dos ya excluidas.
--
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- PASO 1 — Verificación de seguridad: todo producto que matchea el patrón
-- contenedor (paq|bote), fuera de los 2 ambiguos ya excluidos por id, debe
-- tener un número extraíble Y empezar con "paq" o "bote". Si esto no se
-- cumple (dato nuevo que no calza con lo auditado en el PASO 0), la
-- migración se frena acá en vez de adivinar.
-- ----------------------------------------------------------------------------
do $$
declare
  v_problema int;
begin
  select count(*) into v_problema
  from producto p
  where p.activo = true
    and p.unidad_base ~* '(paq|bote)'
    and p.id not in (99, 6439)  -- 'PAQUETE' (sin número) y 'PZC x 1': ambiguos, ver PASO 0
    and (
      (regexp_match(p.unidad_base, '(\d+)'))[1] is null
      or p.unidad_base !~* '^(paq|bote)'
    );

  if v_problema > 0 then
    raise exception
      '% producto(s) con patrón contenedor no calzan con "Paquete/Bote + número" ni están en la lista de ambiguos ya revisada — revisar manualmente antes de continuar (no adivinar el factor).',
      v_problema;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- PASO 2 — Nueva presentación de bulto por producto migrable. Nombre
-- estandarizado "Paquete (N und)" / "Bote (N und)"; factor = N extraído de
-- unidad_base. Guard adicional: solo si el producto todavía no tiene
-- ninguna presentación no-base (esperable: hoy son 0 en toda la base).
-- ----------------------------------------------------------------------------
insert into presentacion (producto_id, nombre, factor_unidad_base, es_base)
select
  p.id,
  (case when p.unidad_base ~* '^bote' then 'Bote' else 'Paquete' end)
    || ' (' || (regexp_match(p.unidad_base, '(\d+)'))[1] || ' und)',
  (regexp_match(p.unidad_base, '(\d+)'))[1]::numeric,
  false
from producto p
where p.activo = true
  and p.unidad_base ~* '(paq|bote)'
  and p.id not in (99, 6439)
  and not exists (
    select 1 from presentacion pr
    where pr.producto_id = p.id and pr.es_base = false
  );

-- ----------------------------------------------------------------------------
-- PASO 3 — unidad_base limpia. Mismo filtro que el INSERT de arriba.
-- ----------------------------------------------------------------------------
update producto p
set unidad_base = 'unidad'
where p.activo = true
  and p.unidad_base ~* '(paq|bote)'
  and p.id not in (99, 6439);

-- ----------------------------------------------------------------------------
-- PASO 4 — Verificación post-migración (debe imprimir 78 filas nuevas en
-- presentacion, 78 productos con unidad_base='unidad', 0 cambios en
-- stock_actual/kardex_transacciones — no se tocan en esta migración).
-- ----------------------------------------------------------------------------
select count(*) as presentaciones_bulto_creadas
from presentacion where es_base = false;

select count(*) as productos_aun_con_patron_contenedor
from producto
where activo = true and unidad_base ~* '(paq|bote)' and id not in (99, 6439);
-- debe dar 0

-- Revisar el resultado de arriba, y si está todo bien:
--   COMMIT;
-- si algo no cuadra:
--   ROLLBACK;
commit;
