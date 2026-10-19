import { describe, expect, it } from 'vitest';
import { coincideLineaPreparacion, estadoPreparacion, resumenChecklist } from './preparacionUI';
import { resumenOperacion } from './operacionesMovil';

const linea = (props = {}) => ({ vigente: true, confirmada: false, preparada_base: 0, revisada_base: null, snapshot: { nombre: 'Bolígrafos azules', sku: 'B-12', pendiente_base: 24 }, ...props });
describe('estados visibles del alistado', () => {
  it('distingue una línea sin trabajar de un cero confirmado y de un faltante parcial', () => {
    expect(estadoPreparacion(linea())).toBe('pendiente');
    expect(estadoPreparacion(linea({ confirmada: true }))).toBe('no_alistado');
    expect(estadoPreparacion(linea({ confirmada: true, preparada_base: 12 }))).toBe('faltante');
    expect(estadoPreparacion(linea({ confirmada: true, preparada_base: 24 }))).toBe('completo');
    expect(resumenOperacion([linea()]).parcial).toBe(false);
  });
  it('cuenta por separado el trabajo pendiente, los faltantes y la revisión real', () => {
    const ls = [linea(), linea({ confirmada: true }), linea({ confirmada: true, preparada_base: 12 }), linea({ confirmada: true, preparada_base: 24, revisada_base: 24 }), linea({ vigente: false })];
    expect(resumenChecklist(ls)).toEqual({ total: 4, pendiente: 1, completo: 1, faltante: 1, no_alistado: 1, por_revisar: 1, revisado: 1 });
  });
  it('permite buscar sin tildes, por código o motivo y no confunde revisión parcial con terminada', () => {
    expect(coincideLineaPreparacion(linea(), 'todas', 'boligrafos')).toBe(true);
    expect(coincideLineaPreparacion(linea(), 'completo', 'B-12')).toBe(false);
    expect(coincideLineaPreparacion(linea({ confirmada: true, observacion: 'Pendiente de compra' }), 'no_alistado', 'compra')).toBe(true);
    expect(coincideLineaPreparacion(linea({ preparada_base: 12, revisada_base: 6 }), 'por_revisar', '')).toBe(true);
    expect(coincideLineaPreparacion(linea({ preparada_base: 12, revisada_base: 6 }), 'revisado', '')).toBe(false);
  });
});
