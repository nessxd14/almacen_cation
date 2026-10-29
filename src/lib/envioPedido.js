// Las cantidades de cero son declaraciones físicas, nunca valores ausentes.
export function cantidadEnvio(linea, revision = false) {
  return Number(revision ? linea.revisada_base ?? linea.preparada_base ?? 0 : linea.preparada_base ?? 0);
}

export function filasEnvio(lineas, revision = false) {
  return lineas.filter(l => l.vigente).map(linea => {
    const cantidad = cantidadEnvio(linea, revision);
    const pendiente = Math.max(0, Number(linea.snapshot.pendiente_base) - cantidad);
    const origenes = linea.origenes_declarados;
    const fisica = cantidad * Number(linea.reemplazo?.factor ?? 1);
    const origenCompleto = Array.isArray(origenes) && Math.abs(origenes.reduce((n, o) => n + Number(o.cantidad_base), 0) - fisica) < 1e-6;
    return { linea, cantidad, pendiente, origenCompleto,
      revisada: linea.revisada_base != null,
      preparada: Boolean(linea.confirmada) && !linea.incidencia_pendiente,
    };
  });
}

export function textoCantidadEnvio(cantidad, snapshot) {
  const factor = Number(snapshot.factor) > 0 ? Number(snapshot.factor) : 1;
  const valor = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 6 }).format(cantidad / factor);
  return `${valor} ${snapshot.presentacion || snapshot.unidad_base || 'unidades'}`;
}

export function estadoAlistado(linea) {
  if (!linea.confirmada || linea.incidencia_pendiente) return 'Sin alistar';
  const cantidad = cantidadEnvio(linea);
  if (cantidad === 0) return 'No alistado';
  if (cantidad < Number(linea.snapshot.pendiente_base)) return 'Parcial';
  return linea.origenes_declarados?.some(o => o.tipo !== 'ALMACEN' && Number(o.cantidad_base) > 0) ? 'Solucionado' : 'Completado';
}
