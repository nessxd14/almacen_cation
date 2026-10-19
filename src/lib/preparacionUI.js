const textoBusqueda = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Una línea sin confirmar aún no es un faltante declarado.
export function estadoPreparacion(linea) {
  if (!linea.confirmada) return 'pendiente';
  const preparada = Number(linea.preparada_base);
  if (preparada === 0) return 'no_alistado';
  if (preparada < Number(linea.snapshot.pendiente_base)) return 'faltante';
  return 'completo';
}

export function revisionCompleta(linea) {
  return Number(linea.preparada_base) > 0 && linea.revisada_base != null
    && Number(linea.revisada_base) === Number(linea.preparada_base);
}

export function resumenChecklist(lineas) {
  const resumen = { total: 0, pendiente: 0, completo: 0, faltante: 0, no_alistado: 0, por_revisar: 0, revisado: 0 };
  for (const linea of lineas.filter(l => l.vigente)) {
    resumen.total++;
    resumen[estadoPreparacion(linea)]++;
    if (Number(linea.preparada_base) > 0) resumen[revisionCompleta(linea) ? 'revisado' : 'por_revisar']++;
  }
  return resumen;
}

export function coincideLineaPreparacion(linea, filtro, busqueda) {
  const estado = estadoPreparacion(linea);
  const coincide = filtro === 'todas' || filtro === estado
    || filtro === 'por_revisar' && Number(linea.preparada_base) > 0 && !revisionCompleta(linea)
    || filtro === 'revisado' && revisionCompleta(linea);
  const s = linea.snapshot;
  return coincide && textoBusqueda([s.nombre, s.sku, s.presentacion, linea.observacion].filter(Boolean).join(' ')).includes(textoBusqueda(busqueda));
}
