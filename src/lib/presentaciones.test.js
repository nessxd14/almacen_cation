import { describe, it, expect } from 'vitest';
import {
  advertenciaPrecioBajo, factorDeCadena, opcionesContenedor, precioCalculado,
  puedeEditarPrecios, textoEquivalencia,
} from './presentaciones';

const base = { id: 1, nombre: 'Hoja', es_base: true, activo: true, factor_unidad_base: 1 };
const paquete = { id: 2, nombre: 'PAQUETE', es_base: false, activo: true, factor_unidad_base: 500 };
const master = { id: 3, nombre: 'CAJA MASTER', es_base: false, activo: true, factor_unidad_base: 12000, contiene_presentacion_id: 2, contiene_cantidad: 24 };
const vieja = { id: 4, nombre: 'BOLSA', es_base: false, activo: false, factor_unidad_base: 100 };
const lista = [base, paquete, master, vieja];

describe('textoEquivalencia', () => {
  it('muestra la cadena completa hasta la unidad base', () => {
    expect(textoEquivalencia({ nombre: 'CAJA MASTER', factor: 12000, baseNombre: 'Hoja', contiene: paquete, cantidad: 24 }))
      .toBe('1 CAJA MASTER = 24 PAQUETE = 12.000 Hoja');
  });
  it('sin cadena, o si contiene directamente a la base, va directo a la base', () => {
    expect(textoEquivalencia({ nombre: 'PAQUETE', factor: 500, baseNombre: 'Hoja' })).toBe('1 PAQUETE = 500 Hoja');
    expect(textoEquivalencia({ nombre: 'PAQUETE', factor: 500, baseNombre: 'Hoja', contiene: base, cantidad: 500 }))
      .toBe('1 PAQUETE = 500 Hoja');
  });
  it('no inventa un factor que todavía no se puede calcular', () => {
    expect(textoEquivalencia({ nombre: 'CAJA', factor: null, baseNombre: 'Pieza' })).toBe('1 CAJA');
    expect(textoEquivalencia({ nombre: '', factor: 10, baseNombre: '' })).toBe('1 presentación = 10 Unidad');
  });
});

describe('factorDeCadena', () => {
  it('multiplica la cantidad por el factor de la contenida', () => {
    expect(factorDeCadena(lista, 2, 24)).toBe(12000);
    expect(factorDeCadena(lista, '1', '50')).toBe(50);
  });
  it('devuelve null si falta la contenida o la cantidad', () => {
    expect(factorDeCadena(lista, 99, 24)).toBeNull();
    expect(factorDeCadena(lista, 2, '')).toBeNull();
  });
});

describe('opcionesContenedor', () => {
  it('lista las activas del producto, base incluida, sin la propia', () => {
    expect(opcionesContenedor(lista, 2).map(p => p.id)).toEqual([1]);
    expect(opcionesContenedor(lista, null).map(p => p.id)).toEqual([1, 2, 3]);
  });
  it('excluye las que ya la contienen (evita ciclos)', () => {
    expect(opcionesContenedor(lista, 3).map(p => p.id)).toEqual([1, 2]);
  });
});

describe('advertenciaPrecioBajo', () => {
  it('avisa cuando el precio por unidad base es menos de la mitad del de la base', () => {
    const msg = advertenciaPrecioBajo({ nombre: 'PAQUETE', precio: 30, factor: 500, baseNombre: 'Hoja', precioBase: 36 });
    expect(msg).toContain('PAQUETE sale a Bs 0,06 por Hoja');
    expect(msg).toContain('1 Hoja cuesta Bs 36,00');
  });
  it('no avisa en el límite ni por encima', () => {
    expect(advertenciaPrecioBajo({ nombre: 'CAJA', precio: 50, factor: 10, baseNombre: 'Pieza', precioBase: 10 })).toBeNull();
    expect(advertenciaPrecioBajo({ nombre: 'CAJA', precio: 90, factor: 10, baseNombre: 'Pieza', precioBase: 10 })).toBeNull();
  });
  it('no avisa si falta algún dato', () => {
    expect(advertenciaPrecioBajo({ nombre: 'CAJA', precio: null, factor: 10, precioBase: 10 })).toBeNull();
    expect(advertenciaPrecioBajo({ nombre: 'CAJA', precio: 1, factor: 10, precioBase: null })).toBeNull();
    expect(advertenciaPrecioBajo({ nombre: 'CAJA', precio: 1, factor: 0, precioBase: 10 })).toBeNull();
  });
});

describe('precioCalculado y roles', () => {
  it('calcula el fallback desde la fila base de la vista', () => {
    expect(precioCalculado({ precio_retail: 36 }, 'precio_retail', 500)).toBe(18000);
    expect(precioCalculado({ precio_retail: null }, 'precio_retail', 500)).toBeNull();
  });
  it('solo admin y gerente editan precios', () => {
    expect(puedeEditarPrecios('admin')).toBe(true);
    expect(puedeEditarPrecios('gerente')).toBe(true);
    expect(puedeEditarPrecios('almacenero')).toBe(false);
    expect(puedeEditarPrecios(undefined)).toBe(false);
  });
});
