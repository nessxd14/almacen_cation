const OPCIONES_BASE = {
  foto: false, atributos: false, codigo: true, ubicacion: true, unidad: false,
  barras: false, marca: false, presentacion: true,
  estilo: 'corporativo', altoBarras: 10, simbologia: 'automatico',
};

export const FORMATOS_ETIQUETA = [
  { id: 'compacto', nombre: 'Compacto · 80 × 50 mm', grupo: 'Productos', descripcion: 'Identificación diaria con producto, presentación y ubicación.', ancho: 80, alto: 50, fuente: 8, qr: 22, relleno: 2 },
  { id: 'estandar', nombre: 'Estándar · 100 × 70 mm', grupo: 'Productos', descripcion: 'Ficha habitual para reconocer y localizar cada producto.', ancho: 100, alto: 70, fuente: 10, qr: 25, relleno: 3, marca: true, atributos: true, unidad: true },
  { id: 'ficha_grande', nombre: 'Ficha grande · 100 × 70 mm', grupo: 'Productos', descripcion: 'Distribución con identidad destacada y espacio para código de barras.', ancho: 100, alto: 70, fuente: 9, qr: 23, relleno: 3, barras: true, altoBarras: 11, marca: true },
  { id: 'a6', nombre: 'A6 · 105 × 148 mm', grupo: 'Productos', descripcion: 'Ficha vertical con fotografía y características cuando estén registradas.', ancho: 105, alto: 148, fuente: 12, qr: 32, relleno: 4, foto: true, atributos: true, marca: true, unidad: true, barras: true, altoBarras: 14 },
  { id: 'mini', nombre: 'Mini · 50 × 30 mm', grupo: 'Productos', descripcion: 'Identificación breve para productos y espacios pequeños.', ancho: 50, alto: 30, fuente: 6, qr: 15, relleno: 1.5, ubicacion: false },
  { id: 'estanteria', nombre: 'Estantería · 70 × 40 mm', grupo: 'Almacén', descripcion: 'Producto y ubicación visibles en el frente de la repisa.', ancho: 70, alto: 40, fuente: 7, qr: 19, relleno: 2 },
  { id: 'caja_bulto', nombre: 'Caja y bulto · 90 × 50 mm', grupo: 'Almacén', descripcion: 'Presentación y equivalencia registradas para identificar el contenido.', ancho: 90, alto: 50, fuente: 8, qr: 22, relleno: 2.5 },
  { id: 'caja_grande', nombre: 'Caja grande · 150 × 100 mm', grupo: 'Almacén', descripcion: 'Código destacado y características en casillas, adaptadas a cada producto. El contenido procede de la presentación elegida.', ancho: 150, alto: 100, fuente: 10, qr: 28, relleno: 4, atributos: true, ubicacion: false, marca: true },
  { id: 'lectura_distancia', nombre: 'Lectura a distancia · 150 × 100 mm', grupo: 'Almacén', descripcion: 'Nombre grande primero, código en franja y características del producto. Para reconocer cajas, paquetes y bolsas a distancia.', ancho: 150, alto: 100, fuente: 10, qr: 28, relleno: 4, atributos: true, ubicacion: false, marca: true, estilo: 'industrial' },
  { id: 'ubicacion', nombre: 'Ubicación · 100 × 50 mm', grupo: 'Almacén', descripcion: 'Código del lugar destacado y QR para consultar sus productos.', ancho: 100, alto: 50, fuente: 10, qr: 26, relleno: 3, codigo: false, presentacion: false },
  { id: 'qr_rapido', nombre: 'QR rápido · 40 × 40 mm', grupo: 'Productos', descripcion: 'Acceso a la ficha digital con un QR central y código breve.', ancho: 40, alto: 40, fuente: 6, qr: 24, relleno: 1.5, ubicacion: false, presentacion: false },
  { id: 'control_lote', nombre: 'Control de lote · 70 × 40 mm', grupo: 'Recepción', descripcion: 'Producto y presentación con campos manuales de lote y fecha de ingreso.', ancho: 70, alto: 40, fuente: 6.5, qr: 18, relleno: 1.5, ubicacion: false },
].map(formato => ({ ...OPCIONES_BASE, ...formato, diseno: formato.id }));

export const FORMATO_INICIAL = {
  ...FORMATOS_ETIQUETA.find(formato => formato.id === 'estandar'),
  papel: 'hoja', orientacion: 'vertical', margen: 10, separacion: 3, giroAutomatico: true,
};

const DISENOS = new Set(FORMATOS_ETIQUETA.map(formato => formato.id));
export const esEtiquetaDeEmpaque = diseno => ['caja_bulto', 'caja_grande', 'lectura_distancia'].includes(diseno);
const ENUMERACIONES = {
  papel: ['hoja', 'rollo'], orientacion: ['vertical', 'horizontal'],
  estilo: ['corporativo', 'industrial', 'minimalista'], simbologia: ['automatico', 'CODE128', 'EAN13'],
};
const NUMERICOS = {
  ancho: [35, 297], alto: [25, 420], fuente: [6, 24], qr: [14, 60],
  margen: [0, 30], separacion: [0, 20], relleno: [1, 10], altoBarras: [5, 35],
};
const BOOLEANOS = ['foto', 'atributos', 'codigo', 'ubicacion', 'unidad', 'barras', 'marca', 'presentacion', 'giroAutomatico'];

function calcularDistribucion(formato, girada = false) {
  const ancho = Number(formato.ancho), alto = Number(formato.alto);
  if (formato.papel === 'rollo') return { columnas: 1, filas: 1, porPagina: 1, anchoPagina: ancho, altoPagina: alto, anchoCelda: ancho, altoCelda: alto, girada: false, rotacion: 0 };
  const [anchoPagina, altoPagina] = formato.orientacion === 'horizontal' ? [297, 210] : [210, 297];
  const margen = Number(formato.margen), gap = Number(formato.separacion);
  const [anchoCelda, altoCelda] = girada ? [alto, ancho] : [ancho, alto];
  const columnas = Math.max(0, Math.floor((anchoPagina - 2 * margen + gap) / (anchoCelda + gap)));
  const filas = Math.max(0, Math.floor((altoPagina - 2 * margen + gap) / (altoCelda + gap)));
  return { columnas, filas, porPagina: columnas * filas, anchoPagina, altoPagina, anchoCelda, altoCelda, girada, rotacion: girada ? 90 : 0 };
}

export function validarFormato(formato) {
  if (!formato || typeof formato !== 'object') return ['El formato no es válido.'];
  const errores = [];
  for (const [campo, [min, max]] of Object.entries(NUMERICOS)) {
    // Las preferencias anteriores a los diseños no incluían altoBarras.
    const valor = campo === 'altoBarras' && formato[campo] == null ? FORMATO_INICIAL[campo] : formato[campo];
    if (!Number.isFinite(Number(valor)) || Number(valor) < min || Number(valor) > max) errores.push(`${campo}: debe estar entre ${min} y ${max}.`);
  }
  for (const [campo, valores] of Object.entries(ENUMERACIONES)) {
    const valor = formato[campo] ?? FORMATO_INICIAL[campo];
    if (!valores.includes(valor)) errores.push(`${campo}: la opción elegida no es válida.`);
  }
  if (formato.diseno != null && !DISENOS.has(formato.diseno)) errores.push('El diseño elegido no es válido.');
  for (const campo of BOOLEANOS) if (formato[campo] != null && typeof formato[campo] !== 'boolean') errores.push(`${campo}: la opción debe estar activada o desactivada.`);
  const qr = Number(formato.qr), relleno = Number(formato.relleno);
  const ancho = Number(formato.ancho), alto = Number(formato.alto);
  const espacioNombre = formato.diseno === 'qr_rapido' ? 0 : 15;
  if (qr + relleno * 2 + espacioNombre > ancho) errores.push('El ancho no deja espacio suficiente para el QR y el nombre.');
  if (qr + relleno * 2 > alto) errores.push('El QR no cabe en la altura elegida.');
  if (formato.barras && Number(formato.altoBarras ?? FORMATO_INICIAL.altoBarras) + relleno * 2 + 8 > alto) errores.push('La altura no deja espacio suficiente para el código de barras y el producto.');
  if (formato.papel === 'hoja') {
    const cabe = calcularDistribucion(formato).porPagina > 0;
    const cabeGirada = formato.giroAutomatico !== false && calcularDistribucion(formato, true).porPagina > 0;
    if (!cabe && !cabeGirada) errores.push('La etiqueta no cabe en una hoja A4 con estos márgenes.');
  }
  return errores;
}

export function distribucionEtiquetas(formato) {
  if (validarFormato(formato).length) return null;
  const normal = calcularDistribucion(formato);
  if (formato.papel === 'rollo' || formato.giroAutomatico === false) return normal;
  const girada = calcularDistribucion(formato, true);
  // En un empate se conserva la orientación del diseño.
  return girada.porPagina > normal.porPagina ? girada : normal;
}

// Solo dimensiones y opciones de presentación: nunca cantidades de inventario.
export function normalizarFormato(valor) {
  if (valor != null && (typeof valor !== 'object' || Array.isArray(valor))) return null;
  const diseno = valor?.diseno ?? (DISENOS.has(valor?.id) ? valor.id : FORMATO_INICIAL.diseno);
  if (!DISENOS.has(diseno)) return null;
  // Los valores guardados tienen prioridad: un antiguo compacto de 60 × 40 mm
  // sigue midiendo lo mismo aunque el nuevo modelo compacto mida 80 × 50 mm.
  const preset = FORMATOS_ETIQUETA.find(formato => formato.id === diseno);
  const nuevo = { ...FORMATO_INICIAL, ...preset };
  for (const campo of Object.keys(NUMERICOS)) if (valor?.[campo] != null) nuevo[campo] = Number(valor[campo]);
  for (const campo of BOOLEANOS) if (valor?.[campo] != null) {
    if (typeof valor[campo] !== 'boolean') return null;
    nuevo[campo] = valor[campo];
  }
  for (const campo of Object.keys(ENUMERACIONES)) if (valor?.[campo] != null) nuevo[campo] = valor[campo];
  return validarFormato(nuevo).length ? null : nuevo;
}
