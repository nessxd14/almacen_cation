import { describe, it, expect } from 'vitest';
import { presentacionesActivas, resolverPresentacion, textoPresentacion, codigosDePresentacion } from './presentacionEtiqueta';

const presentaciones = [
  { id: 3, nombre: 'Caja', activo: true, factor_unidad_base: '12', identificador: [{ id: 30, tipo: 'barra', valor: '1234567890128', activo: true }] },
  { id: 2, nombre: 'Paquete anterior', activo: false, factor_unidad_base: 6 },
  { id: 1, nombre: 'Unidad', activo: true, es_base: true, factor_unidad_base: 1, identificador: [{ id: 10, tipo: 'barra', valor: '321' }] },
];

describe('presentaciones de la etiqueta', () => {
  it('elige la base al comenzar y excluye las presentaciones inactivas sin modificar los datos', () => {
    expect(presentacionesActivas(presentaciones).map(p => p.id)).toEqual([1, 3]);
    expect(resolverPresentacion(presentaciones).id).toBe(1);
    expect(presentaciones[0].id).toBe(3);
  });
  it('no cambia silenciosamente una selección eliminada o desactivada', () => {
    expect(resolverPresentacion(presentaciones, '3').nombre).toBe('Caja');
    expect(resolverPresentacion(presentaciones, 2)).toBeNull();
    expect(resolverPresentacion(presentaciones, 999)).toBeNull();
    expect(resolverPresentacion([], null)).toBeNull();
  });
  it('expresa el factor de la presentación seleccionada en unidades base', () => {
    expect(textoPresentacion(presentaciones[0], 'UND')).toBe('Caja · 12 UND');
    expect(textoPresentacion({ nombre: 'Medio rollo', factor_unidad_base: 0.5 }, 'm')).toMatch(/Medio rollo · 0[,.]5 m/);
  });
  it('no inventa equivalencias cuando falta el factor o la unidad base', () => {
    for (const valor of [null, '', 0, -1, 'desconocido']) {
      expect(textoPresentacion({ nombre: 'Caja', factor_unidad_base: valor }, 'UND')).toContain('Equivalencia sin registrar');
    }
    expect(textoPresentacion(presentaciones[0], null)).toContain('Equivalencia sin registrar');
  });
  it('las barras pertenecen sólo a la presentación seleccionada', () => {
    expect(codigosDePresentacion(resolverPresentacion(presentaciones, 3))).toEqual([
      expect.objectContaining({ id: 30, valor: '1234567890128', presentacion: 'Caja', presentacion_id: 3 }),
    ]);
    expect(codigosDePresentacion({ ...presentaciones[0], activo: false })).toEqual([]);
  });
  it('filtra barras inactivas o vacías y prioriza la principal', () => {
    const codigos = codigosDePresentacion({ id: 7, nombre: 'Pack', identificador: [
      { id: 1, tipo: 'barra', valor: '111' }, { id: 2, tipo: 'barra', valor: '222', es_principal: true },
      { id: 3, tipo: 'barra', valor: '333', activo: false }, { id: 4, tipo: 'fabrica', valor: 'ABC' },
      { id: 5, tipo: 'barra', valor: '  ' },
    ] });
    expect(codigos.map(c => c.id)).toEqual([2, 1]);
  });
});
