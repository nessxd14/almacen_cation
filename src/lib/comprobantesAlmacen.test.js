import { describe, expect, it } from 'vitest';
import { agruparComprobantes, referenciaComprobante, periodoMovimiento } from './comprobantesAlmacen';

const m = (id, referencia, extra = {}) => ({ id, referencia, creado_en: '2026-10-23T12:00:00Z', tipo_movimiento: 'SALIDA', cantidad: -2, producto_id: id, ...extra });
describe('comprobantes de movimientos de almacén', () => {
  it('identifica las ventas y los envíos de Caja como el mismo documento y reúne las líneas del pedido', () => {
    expect(referenciaComprobante(m(1, 'Envío Caja VTD #35')).id).toBe('35');
    const grupos = agruparComprobantes([m(1, 'Pedido #828 · línea 4927'), m(2, 'Pedido #828 · línea 4930'), m(3, 'Pedido #829 · línea 4931'), m(4, 'Venta #35'), m(5, 'Envío Caja VTD #35')]);
    expect(grupos).toHaveLength(3);
    expect(grupos.find(g => g.id === '828').items).toHaveLength(2);
    expect(grupos.find(g => g.id === '35').items).toHaveLength(2);
  });
  it('no fusiona motivos libres o referencias vacías; conserva ambas ubicaciones y signos de un traslado', () => {
    const items = [m(1, 'Reconteo'), m(2, 'Reconteo'), m(3, ''), m(4, ''), m(5, 'Traslado #117', { cantidad: -10, ubicacion_id: 1 }), m(6, 'Traslado #117', { cantidad: 10, ubicacion_id: 2 })];
    const grupos = agruparComprobantes(items);
    expect(grupos).toHaveLength(5);
    expect(grupos.find(g => g.id === '117').items.map(x => x.cantidad)).toEqual([-10, 10]);
  });
  it('filtra los movimientos antes de agrupar sin traer líneas de otro turno y busca el documento completo', () => {
    const items = [m(1, 'Pedido #828 · línea 1', { nombre: 'Lápiz' }), m(2, 'Pedido #828 · línea 2', { nombre: 'Goma' }), m(3, 'Pedido #828 · línea 3', { creado_en: '2026-10-23T20:00:00Z' })];
    expect(agruparComprobantes(items, { periodo: 'MANANA', busqueda: 'lápiz', tipo: 'PEDIDO' })[0].items).toHaveLength(2);
    expect(agruparComprobantes(items, { tipo: 'TRASLADO' })).toHaveLength(0);
  });
  it('respeta las fronteras de ambos turnos en hora de Bolivia', () => {
    const horas = ['07:29', '07:30', '12:29', '12:30', '14:29', '14:30', '21:29', '21:30'];
    expect(horas.map(h => periodoMovimiento({ creado_en: `2026-10-23T${h}:00-04:00` }))).toEqual(['fuera', 'MANANA', 'MANANA', 'fuera', 'fuera', 'TARDE', 'TARDE', 'fuera']);
  });
});
