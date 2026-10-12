import { describe, expect, it } from 'vitest';
import { esEAN13Valido, resolverSimbologia, tieneDesbordeEtiqueta } from './codigoEtiqueta';

describe('códigos de las etiquetas', () => {
  it('valida longitud y dígito de control sin alterar el identificador registrado', () => {
    expect(esEAN13Valido('4006381333931')).toBe(true);
    expect(esEAN13Valido('4006381333932')).toBe(false);
    expect(esEAN13Valido('400638133393')).toBe(false);
    expect(esEAN13Valido(' 4006381333931')).toBe(false);
  });
  it('escoge EAN-13 solo si es válido y conserva códigos internos como Code 128', () => {
    expect(resolverSimbologia('4006381333931')).toBe('EAN13');
    expect(resolverSimbologia('4006381333932')).toBe('CODE128');
    expect(resolverSimbologia('CAJA-A123')).toBe('CODE128');
    expect(resolverSimbologia('4006381333931', 'CODE128')).toBe('CODE128');
    expect(() => resolverSimbologia('400638133393', 'EAN13')).toThrow('dígito de control válido');
  });
});

describe('desborde del contenido impreso', () => {
  const campo = (rect = {}, extra = {}) => ({ clientWidth: 50, scrollWidth: 50, clientHeight: 10, scrollHeight: 10,
    getBoundingClientRect: () => ({ left: 5, top: 5, right: 55, bottom: 15, width: 50, ...rect }), ...extra });
  const etiqueta = (hijos, extra = {}) => ({ offsetWidth: 100, clientWidth: 100, scrollWidth: 100, clientHeight: 50, scrollHeight: 50,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 50, width: 100 }), querySelectorAll: () => hijos, ...extra });
  it('detecta campos cortados aunque la caja externa no cambie de tamaño', () => {
    expect(tieneDesbordeEtiqueta(etiqueta([campo({}, { scrollHeight: 20 })]))).toBe(true);
    expect(tieneDesbordeEtiqueta(etiqueta([campo({ bottom: 60 })]))).toBe(true);
    expect(tieneDesbordeEtiqueta(etiqueta([campo()]))).toBe(false);
  });
  it('considera las coordenadas escaladas de una vista previa móvil', () => {
    const movil = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 50, bottom: 25, width: 50 }) };
    expect(tieneDesbordeEtiqueta(etiqueta([campo({ right: 35, bottom: 20 })], movil))).toBe(false);
    expect(tieneDesbordeEtiqueta(etiqueta([campo({ right: 35, bottom: 30 })], movil))).toBe(true);
  });
});
