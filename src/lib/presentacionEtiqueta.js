const numero = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 20 });

export function tieneContenidoRegistrado(presentacion, unidadBase) {
  return !!presentacion && presentacion.activo !== false && !!String(presentacion.nombre ?? '').trim()
    && Number.isFinite(Number(presentacion.factor_unidad_base)) && Number(presentacion.factor_unidad_base) > 0
    && !!String(unidadBase ?? '').trim();
}

export function textoContenidoPresentacion(presentacion, unidadBase) {
  return tieneContenidoRegistrado(presentacion, unidadBase)
    ? `${numero.format(Number(presentacion.factor_unidad_base))} ${unidadBase}` : 'Equivalencia sin registrar';
}

export function presentacionesActivas(presentaciones) {
  return (presentaciones || []).filter(p => p && p.activo !== false).slice().sort((a, b) =>
    Number(!!b.es_base) - Number(!!a.es_base) || Number(a.id) - Number(b.id));
}

// Una selección explícita debe conservar su identidad aunque deje de existir.
// Cambiarla por otra presentación podría imprimir una equivalencia equivocada.
export function resolverPresentacion(presentaciones, seleccionId) {
  const activas = presentacionesActivas(presentaciones);
  if (seleccionId != null && seleccionId !== '') {
    return activas.find(p => String(p.id) === String(seleccionId)) ?? null;
  }
  return activas.find(p => p.es_base) ?? activas[0] ?? null;
}

export function textoPresentacion(presentacion, unidadBase) {
  if (!presentacion) return 'Sin presentación seleccionada';
  const nombre = presentacion.nombre || 'Presentación sin nombre';
  const factor = Number(presentacion.factor_unidad_base);
  if (!Number.isFinite(factor) || factor <= 0 || !unidadBase) return `${nombre} · Equivalencia sin registrar`;
  return `${nombre} · ${numero.format(factor)} ${unidadBase}`;
}

export function codigosDePresentacion(presentacion) {
  if (!presentacion || presentacion.activo === false) return [];
  return (presentacion.identificador || [])
    .filter(i => i.activo !== false && i.tipo === 'barra' && String(i.valor ?? '').trim())
    .map(i => ({ ...i, presentacion_id: presentacion.id, presentacion: presentacion.nombre, es_base: presentacion.es_base }))
    .sort((a, b) => Number(!!b.es_principal) - Number(!!a.es_principal));
}
