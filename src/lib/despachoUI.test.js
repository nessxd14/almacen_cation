import { describe, expect, it } from 'vitest';
import { coincideLineaDespacho, grupoDespacho, planDespacho } from './despachoUI';

const ls = new Map([[1, { id: 1, estado: 'POR_DESPACHAR', cantidad_base: 24, cantidad_despachada: 12 }], [2, { id: 2, estado: 'PENDIENTE', cantidad_base: 10, cantidad_despachada: 0 }]]);
const pick = (n, props = {}) => ({ asignaciones: [{ ubicacion_id: 7, cantidad_base: n }], ...props });
describe('revisión completa del despacho por lote', () => {
  it('bloquea el lote completo si cualquiera de los productos aún calcula o no tiene salida', () => {
    for (const segundo of [undefined, pick(0), pick(10, { cargando: true }), pick(10, { error: 'Sin conexión' })]) {
      const p = planDespacho(new Set([1, 2]), new Map([[1, pick(12)], [2, segundo]]), ls);
      expect(p.listo).toBe(false);
      expect(p.lineas).toHaveLength(2);
      expect(p.lineas[1].error).toBeTruthy();
    }
  });
  it('rechaza cantidades negativas, no numéricas, superiores al pendiente y ubicaciones inválidas', () => {
    for (const asignaciones of [[{ ubicacion_id: 7, cantidad_base: -1 }], [{ ubicacion_id: 7, cantidad_base: 'abc' }], [{ ubicacion_id: 7, cantidad_base: 13 }], [{ ubicacion_id: null, cantidad_base: 12 }]]) {
      expect(planDespacho(new Set([1]), new Map([[1, { asignaciones }]]), ls).listo).toBe(false);
    }
  });
  it('resume lo que realmente sale y lo que resta, sin volver a sumar lo ya despachado', () => {
    const p = planDespacho(new Set([1, 2]), new Map([[1, pick(5, { ubicaciones: [{ id: 7, label: 'Almacén · A-1' }] })], [2, pick(10)]]), ls);
    expect(p.listo).toBe(true); expect(p.parciales).toBe(1);
    expect(p.lineas[0]).toMatchObject({ pendiente: 12, total: 5, restante: 7 });
    expect(p.lineas[0].asignaciones[0].ubicacion_label).toBe('Almacén · A-1');
    expect(planDespacho(new Set(), new Map(), ls).listo).toBe(false);
    expect(planDespacho(new Set([3]), new Map(), ls).listo).toBe(false);
  });
  it('separa compras, entregas y líneas cerradas y encuentra productos por SKU', () => {
    expect(grupoDespacho({ estado: 'POR_COMPRAR' })).toBe('compra');
    expect(grupoDespacho({ estado: 'RECHAZADO' })).toBe('cerrado');
    expect(grupoDespacho({ estado: 'COMPRADO_DIRECTO' })).toBe('entregado');
    expect(coincideLineaDespacho({ estado: 'POR_DESPACHAR', producto: { nombre: 'Lápices', sku_interno: 'L-12' } }, 'pendiente', 'lapices')).toBe(true);
    expect(coincideLineaDespacho({ estado: 'POR_COMPRAR', producto: { sku_interno: 'L-12' } }, 'pendiente', 'L-12')).toBe(false);
  });
});
