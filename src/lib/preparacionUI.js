const textoBusqueda = texto => String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Una línea sin confirmar aún no es un faltante declarado.
export function estadoPreparacion(linea, ajustable = false) {
  if (!linea.confirmada) return 'pendiente';
  const preparada = Number(ajustable && linea.revisada_base!=null ? linea.revisada_base : linea.preparada_base);
  if (preparada === 0) return 'no_alistado';
  if (preparada < Number(linea.snapshot.pendiente_base)) return 'faltante';
  return 'completo';
}

export function revisionCompleta(linea, ajustable = false) {
  return (Number(linea.preparada_base) > 0 || ajustable && linea.snapshot?.preparable) && linea.revisada_base != null
    && (ajustable || Number(linea.revisada_base) === Number(linea.preparada_base));
}

export function resumenChecklist(lineas, ajustable = false) {
  const resumen = { total: 0, pendiente: 0, completo: 0, faltante: 0, no_alistado: 0, por_revisar: 0, revisado: 0 };
  for (const linea of lineas.filter(l => l.vigente)) {
    resumen.total++;
    resumen[estadoPreparacion(linea, ajustable)]++;
    if (Number(linea.preparada_base) > 0 || ajustable && linea.snapshot?.preparable) resumen[revisionCompleta(linea, ajustable) ? 'revisado' : 'por_revisar']++;
  }
  return resumen;
}

export function coincideLineaPreparacion(linea, filtro, busqueda, ajustable = false) {
  const estado = estadoPreparacion(linea, ajustable);
  const coincide = filtro === 'todas' || filtro === estado
    || filtro === 'por_revisar' && (Number(linea.preparada_base) > 0 || ajustable && linea.snapshot?.preparable) && !revisionCompleta(linea, ajustable)
    || filtro === 'revisado' && revisionCompleta(linea, ajustable);
  const s = linea.snapshot;
  return coincide && textoBusqueda([s.nombre, s.sku, s.presentacion, linea.observacion].filter(Boolean).join(' ')).includes(textoBusqueda(busqueda));
}
