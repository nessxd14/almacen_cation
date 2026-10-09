import { describe, it, expect } from 'vitest';
import { FORMATO_INICIAL, FORMATOS_ETIQUETA, validarFormato, normalizarFormato, distribucionEtiquetas } from './formatosEtiqueta';
import { documentoImpresion } from './impresionEtiquetas';

describe('formatos e impresión de etiquetas', () => {
  it('los formatos iniciales caben en el papel configurado', () => {
    for (const f of FORMATOS_ETIQUETA) expect(validarFormato({ ...FORMATO_INICIAL, ...f })).toEqual([]);
  });
  it('evita QR sin espacio, dimensiones no numéricas y etiquetas mayores que la hoja', () => {
    expect(validarFormato({ ...FORMATO_INICIAL, ancho: 40, qr: 35 })).not.toEqual([]);
    expect(validarFormato({ ...FORMATO_INICIAL, ancho: NaN })).not.toEqual([]);
    expect(validarFormato({ ...FORMATO_INICIAL, ancho: 220 })).not.toEqual([]);
  });
  it('calcula la cuadrícula con márgenes y separación reales', () => {
    const f = { ...FORMATO_INICIAL, ancho: 60, alto: 40, margen: 10, separacion: 3 };
    expect(distribucionEtiquetas(f)).toMatchObject({ columnas: 3, filas: 6, porPagina: 18 });
  });
  it('un rollo conserva exactamente las dimensiones de cada etiqueta', () => {
    const f = { ...FORMATO_INICIAL, papel: 'rollo', ancho: 100, alto: 70 };
    expect(distribucionEtiquetas(f)).toEqual({ columnas: 1, filas: 1, porPagina: 1, anchoPagina: 100, altoPagina: 70 });
    const doc = documentoImpresion(['<div>A</div>', '<div>B</div>'], f);
    expect(doc).toContain('@page { size:100mm 70mm; margin:0; }');
    expect(doc.match(/<section class="print-page">/g)).toHaveLength(2);
  });
  it('el lote salta de página sin crear una hoja vacía al final', () => {
    const f = { ...FORMATO_INICIAL, ancho: 60, alto: 40 };
    const doc = documentoImpresion(Array.from({ length: 19 }, () => '<div>Etiqueta</div>'), f);
    expect(doc.match(/<section class="print-page">/g)).toHaveLength(2);
    expect(doc.match(/<div>Etiqueta<\/div>/g)).toHaveLength(19);
  });
  it('los formatos guardados no pueden introducir CSS o configuraciones inválidas', () => {
    expect(normalizarFormato({ ancho: '100; color:red' })).toBeNull();
    expect(normalizarFormato({ papel: 'otro' })).toBeNull();
    expect(normalizarFormato({ ancho: 80, stock: 123 })).not.toHaveProperty('stock');
  });
});
