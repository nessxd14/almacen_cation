const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const pendienteDespacho = l => Math.max(0, Number(l.cantidad_base) - Number(l.cantidad_despachada || 0));
export function grupoDespacho(linea) {
  if (['DESPACHADA', 'COMPRADO_DIRECTO'].includes(linea.estado)) return 'entregado';
  if (['RECHAZADO', 'RETIRADA', 'CAMBIADA'].includes(linea.estado)) return 'cerrado';
  if (linea.estado === 'POR_COMPRAR') return 'compra';
  return 'pendiente';
}
export function coincideLineaDespacho(linea, filtro, busqueda) {
  const texto = [linea.producto?.nombre, linea.producto?.sku_interno, linea.nombre_manual, linea.descripcion, linea.presentacion?.nombre].filter(Boolean).join(' ');
  return (filtro === 'todas' || grupoDespacho(linea) === filtro) && normalizar(texto).includes(normalizar(busqueda));
}

// No permite que el lote omita silenciosamente líneas seleccionadas sin pick.
export function planDespacho(seleccion, picksPorLinea, lineasPorId) {
  const lineas = [];
  for (const id of seleccion) {
    const linea = lineasPorId.get(id);
    const pick = picksPorLinea.get(id);
    const asignaciones = pick?.asignaciones || [];
    const pendiente = linea ? pendienteDespacho(linea) : 0;
    const total = asignaciones.reduce((s, a) => s + Number(a.cantidad_base), 0);
    let error = '';
    if (!linea || !['POR_DESPACHAR', 'PENDIENTE'].includes(linea.estado)) error = 'La línea ya no está disponible para despacho.';
    else if (!pick || pick.cargando) error = 'Calculando ubicaciones y cantidades…';
    else if (pick.error) error = pick.error;
    else if (asignaciones.some(a => !Number.isFinite(Number(a.cantidad_base)) || Number(a.cantidad_base) < 0 || !Number.isSafeInteger(Number(a.ubicacion_id)) || Number(a.ubicacion_id) <= 0)) error = 'Revisa las cantidades y ubicaciones.';
    else if (!(total > 0)) error = 'Sin cantidad asignada. Abre la línea para resolverla o quítala de la selección.';
    else if (total > pendiente + .0001) error = 'La cantidad asignada supera lo pendiente.';
    const ubicaciones = new Map((pick?.ubicaciones || []).map(u => [String(u.id), u.label]));
    lineas.push({ id, linea, asignaciones: asignaciones.map(a => ({ ...a, ubicacion_label: ubicaciones.get(String(a.ubicacion_id)) })), pendiente, total, restante: Math.max(0, pendiente - total), error });
  }
  return { lineas, listo: lineas.length > 0 && lineas.every(l => !l.error), parciales: lineas.filter(l => !l.error && l.restante > .0001).length };
}
