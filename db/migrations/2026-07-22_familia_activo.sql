-- ============================================================
-- familia.activo: marcar familias huérfanas (producto de Shopify ya
-- borrado, familia_id sin producto real) sin borrar la fila.
--
-- Detectadas al aplicar productType de Fase 2: 3 familias cuyo
-- shopify_product_id ya no existe en Shopify ("El producto no existe" al
-- intentar productUpdate). Las tres ya tenían marca=null en producto,
-- señal de que quedaron huérfanas desde hace tiempo.
--   - 060 FINE
--   - BENMA SÚPER GEL RT
--   - PAPEL CREPÉ ROARI
--
-- Validado con BEGIN...ROLLBACK contra la base viva (supabase_db_almacen_roari,
-- zxoxougwgstrarwymlvd) el 2026-07-22 antes de este commit. Aplicar
-- manualmente después de revisión humana.
-- ============================================================

alter table familia add column activo boolean not null default true;

update familia
set activo = false
where nombre in ('060 FINE', 'BENMA SÚPER GEL RT', 'PAPEL CREPÉ ROARI');
