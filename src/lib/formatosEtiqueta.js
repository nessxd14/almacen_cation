export const FORMATOS_ETIQUETA = [
  { id: 'compacto', nombre: 'Compacto · 60 × 40 mm', ancho: 60, alto: 40, fuente: 7, qr: 22, foto: false, atributos: false },
  { id: 'estandar', nombre: 'Estándar · 100 × 70 mm', ancho: 100, alto: 70, fuente: 10, qr: 25, foto: false, atributos: true },
  { id: 'a6', nombre: 'Ficha de estante · A6', ancho: 105, alto: 148, fuente: 13, qr: 30, foto: true, atributos: true },
];
export const FORMATO_INICIAL = { ...FORMATOS_ETIQUETA[1], papel: 'hoja', orientacion: 'vertical', margen: 10, separacion: 3, relleno: 3, codigo: true, ubicacion: true, unidad: true, barras: false, marca: true };

export function validarFormato(formato) {
  const limites = { ancho: [35, 297], alto: [25, 420], fuente: [6, 24], qr: [20, 60], margen: [0, 30], separacion: [0, 20], relleno: [1, 10] };
  const errores = [];
  for (const [campo, [min, max]] of Object.entries(limites)) {
    if (!Number.isFinite(Number(formato[campo])) || Number(formato[campo]) < min || Number(formato[campo]) > max) errores.push(`${campo}: debe estar entre ${min} y ${max}.`);
  }
  if (!['hoja', 'rollo'].includes(formato.papel) || !['vertical', 'horizontal'].includes(formato.orientacion)) errores.push('Tipo de papel u orientación inválidos.');
  if (Number(formato.qr) + Number(formato.relleno) * 2 + 15 > Number(formato.ancho)) errores.push('El ancho no deja espacio suficiente para el QR y el nombre.');
  if (Number(formato.qr) + Number(formato.relleno) * 2 > Number(formato.alto)) errores.push('El QR no cabe en la altura elegida.');
  if (formato.papel === 'hoja') {
    const [ancho, alto] = formato.orientacion === 'horizontal' ? [297, 210] : [210, 297];
    if (Number(formato.ancho) > ancho - Number(formato.margen) * 2 || Number(formato.alto) > alto - Number(formato.margen) * 2) errores.push('La etiqueta no cabe en una hoja A4 con estos márgenes.');
  }
  return errores;
}

export function distribucionEtiquetas(formato) {
  if (validarFormato(formato).length) return null;
  if (formato.papel === 'rollo') return { columnas: 1, filas: 1, porPagina: 1, anchoPagina: Number(formato.ancho), altoPagina: Number(formato.alto) };
  const [anchoPagina, altoPagina] = formato.orientacion === 'horizontal' ? [297, 210] : [210, 297];
  const margen = Number(formato.margen), gap = Number(formato.separacion);
  const columnas = Math.floor((anchoPagina - 2 * margen + gap) / (Number(formato.ancho) + gap));
  const filas = Math.floor((altoPagina - 2 * margen + gap) / (Number(formato.alto) + gap));
  return { columnas, filas, porPagina: columnas * filas, anchoPagina, altoPagina };
}

// Solo dimensiones y opciones de presentación: nunca cantidades de inventario.
export function normalizarFormato(valor) {
  const nuevo = { ...FORMATO_INICIAL };
  for (const campo of ['ancho', 'alto', 'fuente', 'qr', 'margen', 'separacion', 'relleno']) if (valor?.[campo] != null) nuevo[campo] = Number(valor[campo]);
  for (const campo of ['foto', 'atributos', 'codigo', 'ubicacion', 'unidad', 'barras', 'marca']) if (typeof valor?.[campo] === 'boolean') nuevo[campo] = valor[campo];
  for (const campo of ['papel', 'orientacion']) if (typeof valor?.[campo] === 'string') nuevo[campo] = valor[campo];
  return validarFormato(nuevo).length ? null : nuevo;
}
