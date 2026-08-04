/**
 * Sanea texto libre antes de meterlo en un filtro .or()/.ilike() de PostgREST.
 * La coma separa condiciones dentro de un or=(...) y el paréntesis cierra el grupo:
 * cualquiera de los dos, sin escapar, produce un 400 y una lista vacía en silencio.
 * El % y el _ son comodines de LIKE y hacen que la búsqueda traiga de más.
 */
export function sanearFiltro(texto) {
  return (texto || '').trim().replace(/[%,()_]/g, ' ').replace(/\s+/g, ' ').trim();
}
