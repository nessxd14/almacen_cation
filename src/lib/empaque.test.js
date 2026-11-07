import { describe, expect, it } from 'vitest';
import { separarEmpaque, textoEmpaque, unirEmpaque } from './empaque';

describe('cajas y sueltas', () => {
  it('reparte unidades base en cajas completas y sueltas', () => {
    expect(separarEmpaque('24', 12)).toEqual(['2', '']);
    expect(separarEmpaque('29', 12)).toEqual(['2', '5']);
    expect(separarEmpaque('6', 12)).toEqual(['0', '6']);
    expect(separarEmpaque('', 12)).toEqual(['', '']);
    expect(separarEmpaque('7', 1)).toEqual(['7', '']);
  });
  it('suma cajas y sueltas en unidades base sin errores de redondeo', () => {
    expect(unirEmpaque('2', '5', 12)).toBe('29');
    expect(unirEmpaque('1', '', 12)).toBe('12');
    expect(unirEmpaque('0,5', '', 12)).toBe('6');
    expect(unirEmpaque('', '', 12)).toBe('');
    expect(unirEmpaque('0.1', '0.2', 1)).toBe('0.3');
  });
  it('marca como inválido lo que no es un número para que el formulario lo rechace', () => {
    expect(Number.isNaN(Number(unirEmpaque('dos', '', 12)))).toBe(true);
  });
  it('describe la cantidad en el idioma del almacén', () => {
    expect(textoEmpaque(24, { factor: 12, presentacion: 'Caja', unidad_base: 'unidades' })).toBe('2 Caja');
    expect(textoEmpaque(13, { factor: 12, presentacion: 'Caja', unidad_base: 'unidades' })).toBe('1 Caja + 1 unidades');
    expect(textoEmpaque(6, { factor: 12, presentacion: 'Caja', unidad_base: 'unidades' })).toBe('6 unidades');
  });
});
