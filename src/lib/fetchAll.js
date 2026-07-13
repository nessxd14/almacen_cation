/**
 * fetchAll — trae TODAS las filas de una tabla, sin importar cuántas sean.
 *
 * Supabase/PostgREST aplica un límite por defecto de 1.000 filas a
 * cualquier select sin .range()/.limit() explícito — en silencio, sin
 * error, simplemente corta el resultado. Cualquier pantalla que necesite
 * el catálogo COMPLETO en memoria (búsqueda offline, selector con todo el
 * universo de opciones) tiene que paginar hasta agotar la tabla, no
 * asumir que un solo select alcanza.
 *
 * No es la solución por defecto: si lo que hace falta es "las
 * presentaciones de este producto", filtrá con .eq(producto_id) en vez de
 * traer todo y filtrar en el cliente (ver ubicacionesParaOperacion). Usar
 * fetchAll solo cuando el caso de uso realmente necesita el universo
 * completo en memoria.
 *
 * queryFactory: función que construye un query builder NUEVO en cada
 * llamada (no reutilizable — cada .range() distinto necesita su propia
 * instancia). Debe incluir un .order(...) estable, si no la paginación
 * puede repetir o saltear filas entre páginas.
 */
export async function fetchAll(queryFactory, pageSize = 1000) {
  const filas = [];
  let desde = 0;
  while (true) {
    const { data, error } = await queryFactory().range(desde, desde + pageSize - 1);
    if (error) throw error;
    const pagina = data || [];
    filas.push(...pagina);
    if (pagina.length < pageSize) break;
    desde += pageSize;
  }
  return filas;
}
