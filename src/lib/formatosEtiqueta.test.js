import { describe, it, expect } from 'vitest';
import { FORMATO_INICIAL, FORMATOS_ETIQUETA, validarFormato, normalizarFormato, distribucionEtiquetas } from './formatosEtiqueta';
import { documentoImpresion } from './impresionEtiquetas';

describe('formatos e impresión de etiquetas', () => {
  const capacidadesKit = [
    ['compacto', 10, false], ['estandar', 4, true], ['ficha_grande', 4, true], ['a6', 2, true], ['mini', 25, true],
    ['estanteria', 12, false], ['caja_bulto', 10, false], ['ubicacion', 6, true], ['qr_rapido', 24, false], ['control_lote', 12, false],
  ];
  it.each(capacidadesKit)('%s conserva la capacidad del kit en A4 con margen de 10 mm y separación de 3 mm', (id, porPagina, girada) => {
    const formato = { ...FORMATO_INICIAL, ...FORMATOS_ETIQUETA.find(f => f.id === id) };
    expect(validarFormato(formato)).toEqual([]);
    const layout = distribucionEtiquetas(formato);
    expect(layout).toMatchObject({ porPagina, girada, anchoPagina: 210, altoPagina: 297 });
    expect(layout.columnas * layout.anchoCelda + (layout.columnas - 1) * 3).toBeLessThanOrEqual(190);
    expect(layout.filas * layout.altoCelda + (layout.filas - 1) * 3).toBeLessThanOrEqual(277);
  });
  it('evita QR sin espacio, dimensiones no numéricas y etiquetas mayores que la hoja', () => {
    expect(validarFormato({ ...FORMATO_INICIAL, ancho: 40, qr: 35 })).not.toEqual([]);
    expect(validarFormato({ ...FORMATO_INICIAL, ancho: NaN })).not.toEqual([]);
    expect(validarFormato({ ...FORMATO_INICIAL, ancho: 280, alto: 280 })).not.toEqual([]);
    expect(validarFormato({ ...FORMATO_INICIAL, qr: 13 })).not.toEqual([]);
    expect(validarFormato({ ...FORMATO_INICIAL, barras: true, altoBarras: 36 })).not.toEqual([]);
  });
  it('permite QR pequeño en Mini y QR central en QR rápido, sujetos a la validación del contenido real', () => {
    const mini = { ...FORMATO_INICIAL, ...FORMATOS_ETIQUETA.find(f => f.id === 'mini'), qr: 14 };
    expect(validarFormato(mini)).toEqual([]);
    const rapido = { ...FORMATO_INICIAL, ...FORMATOS_ETIQUETA.find(f => f.id === 'qr_rapido') };
    expect(validarFormato(rapido)).toEqual([]);
    expect(validarFormato({ ...rapido, qr: 38 })).not.toEqual([]);
  });
  it('gira solo la etiqueta cuando mejora la capacidad y permite desactivar el giro', () => {
    expect(distribucionEtiquetas(FORMATO_INICIAL)).toMatchObject({ porPagina: 4, anchoCelda: 70, altoCelda: 100, rotacion: 90 });
    expect(distribucionEtiquetas({ ...FORMATO_INICIAL, giroAutomatico: false })).toMatchObject({ porPagina: 3, anchoCelda: 100, altoCelda: 70, rotacion: 0 });
    expect(distribucionEtiquetas({ ...FORMATO_INICIAL, orientacion: 'horizontal' })).toMatchObject({ porPagina: 4, anchoPagina: 297, altoPagina: 210, girada: false });
  });
  it('acepta una etiqueta que solo cabe girada y la rechaza al bloquear ese giro', () => {
    const f = { ...FORMATO_INICIAL, ancho: 220, alto: 80 };
    expect(validarFormato(f)).toEqual([]);
    expect(distribucionEtiquetas(f)).toMatchObject({ girada: true, porPagina: 2 });
    expect(validarFormato({ ...f, giroAutomatico: false })).toContain('La etiqueta no cabe en una hoja A4 con estos márgenes.');
  });
  it('calcula la cuadrícula con márgenes y separación reales', () => {
    const f = { ...FORMATO_INICIAL, ancho: 60, alto: 40, margen: 10, separacion: 3 };
    expect(distribucionEtiquetas(f)).toMatchObject({ columnas: 3, filas: 6, porPagina: 18 });
    const exacto = { ...FORMATO_INICIAL, ancho: 95, separacion: 0, giroAutomatico: false };
    expect(distribucionEtiquetas(exacto)).toMatchObject({ columnas: 2, filas: 3 });
    expect(distribucionEtiquetas({ ...exacto, margen: 10.1 })).toMatchObject({ columnas: 1, filas: 3 });
  });
  it('un rollo conserva exactamente las dimensiones de cada etiqueta', () => {
    const f = { ...FORMATO_INICIAL, papel: 'rollo', ancho: 100, alto: 70 };
    expect(distribucionEtiquetas(f)).toMatchObject({ columnas: 1, filas: 1, porPagina: 1, anchoPagina: 100, altoPagina: 70, girada: false, anchoCelda: 100, altoCelda: 70 });
    const doc = documentoImpresion(['<div>A</div>', '<div>B</div>'], f);
    expect(doc).toContain('@page { size:100mm 70mm; margin:0; }');
    expect(doc.match(/<section class="print-page">/g)).toHaveLength(2);
    expect(doc).toContain('transform:none;');
    expect(doc).not.toContain('rotate(90deg)');
  });
  it('el lote salta de página sin crear una hoja vacía al final', () => {
    for (const [cantidad, paginas] of [[1, 1], [4, 1], [5, 2], [8, 2]]) {
      const doc = documentoImpresion(Array.from({ length: cantidad }, () => '<div>Etiqueta</div>'), FORMATO_INICIAL);
      expect(doc.match(/<section class="print-page">/g)).toHaveLength(paginas);
      expect(doc.match(/<div>Etiqueta<\/div>/g)).toHaveLength(cantidad);
    }
  });
  it('imprime el diseño en sus dimensiones originales dentro de celdas giradas, sin escalarlo', () => {
    const doc = documentoImpresion(['<div class="warehouse-label">Prueba</div>'], FORMATO_INICIAL);
    expect(doc).toContain('grid-template-columns:repeat(2,70mm); grid-auto-rows:100mm;');
    expect(doc).toContain('.print-label-turn { width:100mm; height:70mm;');
    expect(doc).toContain('translateX(70mm) rotate(90deg)');
    expect(doc).not.toContain('scale(');
    expect(() => documentoImpresion([], FORMATO_INICIAL)).toThrow('Selecciona al menos una etiqueta');
  });
  it('conserva las medidas y opciones de un formato antiguo al añadir las opciones nuevas', () => {
    const guardado = { id: 'compacto', ancho: 60, alto: 40, fuente: 7, qr: 22, foto: false, atributos: false, barras: true, marca: false, papel: 'rollo', margen: 8, relleno: 2 };
    expect(normalizarFormato(guardado)).toMatchObject({ ...guardado, diseno: 'compacto', presentacion: true, estilo: 'corporativo', altoBarras: 10, simbologia: 'automatico', giroAutomatico: true });
  });
  it('conserva selección de diseño, estilo, presentación y simbología guardadas', () => {
    const guardado = { ...FORMATO_INICIAL, diseno: 'caja_bulto', ancho: 88, alto: 52, presentacion: false, estilo: 'industrial', altoBarras: 13, simbologia: 'EAN13', giroAutomatico: false };
    expect(normalizarFormato(guardado)).toMatchObject({ diseno: 'caja_bulto', ancho: 88, alto: 52, presentacion: false, estilo: 'industrial', altoBarras: 13, simbologia: 'EAN13', giroAutomatico: false });
  });
  it('los formatos guardados no pueden introducir CSS o configuraciones inválidas', () => {
    expect(normalizarFormato({ ancho: '100; color:red' })).toBeNull();
    expect(normalizarFormato({ papel: 'otro' })).toBeNull();
    expect(normalizarFormato({ estilo: 'otro' })).toBeNull();
    expect(normalizarFormato({ simbologia: 'otro' })).toBeNull();
    expect(normalizarFormato({ diseno: 'otro' })).toBeNull();
    expect(normalizarFormato({ presentacion: 'true' })).toBeNull();
    expect(normalizarFormato({ ancho: 80, stock: 123 })).not.toHaveProperty('stock');
    expect(normalizarFormato(null)).toEqual(FORMATO_INICIAL);
  });
});
