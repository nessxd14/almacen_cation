const comparar = new Intl.Collator('es', { numeric: true, sensitivity: 'base' }).compare;
const clave = valor => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('es').replace(/\s+/g, ' ').trim();
const basesPreferidas = ['PLANTA BAJA', 'HUECO', 'GARAJE'];
const nombresBase = { 'PLANTA BAJA': 'Planta Baja', HUECO: 'Hueco', GARAJE: 'Garaje' };

export function ubicacionRecorridoTurno(linea) {
  // El reporte conserva la ubicación como «codigo_zona / mueble / compartimiento».
  // Se usa esa fotografía del documento, sin modificar ni reagrupar sus renglones.
  const partes = String(linea.ubicacion || '').split(/\s*\/\s*/).map(p => p.trim()).filter(Boolean);
  const base = String(linea.codigo_zona || partes[0] || 'Sin ubicación base').trim();
  const id = clave(base);
  return { id, nombre: nombresBase[id] || base, detalle: partes.slice(1).join(' / ') || String(linea.ubicacion || base) };
}

export function ordenarRecorridoTurno(lineas) {
  return [...lineas].sort((a, b) => {
    const za = ubicacionRecorridoTurno(a), zb = ubicacionRecorridoTurno(b);
    const ia = basesPreferidas.indexOf(za.id), ib = basesPreferidas.indexOf(zb.id);
    return (ia < 0 ? basesPreferidas.length : ia) - (ib < 0 ? basesPreferidas.length : ib)
      || comparar(za.id, zb.id) || comparar(za.detalle, zb.detalle)
      || comparar(String(a.ubicacion_id), String(b.ubicacion_id)) || a.numero - b.numero;
  });
}

export function basesRecorridoTurno(lineas) {
  const bases = new Map();
  for (const linea of ordenarRecorridoTurno(lineas)) {
    const base = ubicacionRecorridoTurno(linea);
    if (!bases.has(base.id)) bases.set(base.id, { ...base, lineas: [] });
    bases.get(base.id).lineas.push(linea);
  }
  return [...bases.values()];
}

const prefijoEmpaques = '[Empaques verificados]';
export const tieneVerificacionEmpaques = observacion => String(observacion || '').split('\n').some(n => n.startsWith(prefijoEmpaques));
export const notaSinVerificacionEmpaques = observacion => String(observacion || '').split('\n').filter(n => !n.startsWith(prefijoEmpaques)).join('\n').trim();

export function observacionEmpaquesTurno(valor, linea) {
  const nota = notaSinVerificacionEmpaques(valor.observacion);
  if (Number(linea.factor) <= 1 || Number(valor.empaques || 0) <= 0) return nota;
  if (!valor.empaquesVerificados) throw new Error('Confirma que verificaste los empaques completos y su presentación.');
  const evidencia = `${prefijoEmpaques} ${Number(valor.empaques)} ${linea.empaque}; equivalencia: ${Number(linea.factor)} ${linea.unidad} por empaque.`;
  if ([nota, evidencia].filter(Boolean).join('\n').length > 2000) throw new Error('Acorta la observación para guardar también la verificación de empaques.');
  return [nota, evidencia].filter(Boolean).join('\n');
}
