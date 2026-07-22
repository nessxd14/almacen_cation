-- ============================================================
-- Fix: typo de marca "GXIN" -> "GIXIN" (brief_fix_marca_duplicada.md)
--
-- Detectado durante Fase 1: el nombre de ambos productos ya dice "GIXIN"
-- pero producto.marca quedó cargado como "GXIN" (falta la I). Esto hizo
-- que el título nuevo de Shopify quedara con la marca dos veces escrita
-- distinto ("...GIXIN G-210 GXIN"), ya corregido aparte quitando la marca
-- duplicada del título.
--
-- Afecta 8 productos (variantes) de las 2 familias:
--   - MARCADO ACRILICO GIXIN G-210 (3 variantes: Negro, Azul, Rojo)
--   - RESALTADOR GIXIN G-342 (5 variantes: Celeste, Amarillo, Verde,
--     Naranja, Rosado)
--
-- Validado con BEGIN...ROLLBACK contra la base viva (supabase_db_almacen_roari,
-- zxoxougwgstrarwymlvd) el 2026-07-22 antes de este commit. Aplicar
-- manualmente después de revisión humana.
-- ============================================================

update producto
set marca = 'GIXIN'
where marca = 'GXIN';
