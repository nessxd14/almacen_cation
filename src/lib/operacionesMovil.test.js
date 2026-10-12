import { describe, expect, it, vi } from 'vitest';
import { cantidadOperacion, idOperacion, interpretarCodigoOperacion, operarPedidoMovil, resumenOperacion } from './operacionesMovil';

describe('QR compartidos de operaciones', () => {
  it('reutiliza el QR de Seller sin seguir su dominio', () => {
    expect(interpretarCodigoOperacion('https://seller.example/pedidos/248')).toEqual({ tipo: 'pedido', id: '248' });
    expect(interpretarCodigoOperacion('/pedidos/248/')).toEqual({ tipo: 'pedido', id: '248' });
    expect(interpretarCodigoOperacion('#248')).toEqual({ tipo: 'pedido', id: '248' });
  });
  it('mantiene sucursal y presentación de las fichas', () => {
    expect(interpretarCodigoOperacion('https://almacen.example/productos/4/ficha?sucursal=2&presentacion=12')).toEqual({ tipo: 'producto', id: '4', sucursalId: '2', presentacionId: '12' });
    expect(interpretarCodigoOperacion('/ubicaciones/21/ficha?sucursal=2').tipo).toBe('ubicacion');
    expect(interpretarCodigoOperacion('EAN-CAJA-4')).toEqual({ tipo: 'barras', valor: 'EAN-CAJA-4' });
  });
  it.each(['javascript:alert(1)', 'https://user:pass@example.com/pedidos/4', 'https://example.com/otra/ruta', '/pedidos/4/productos/1', 'PDV-19', '', 'https://seller.example/pedidos/4?ne=NE-3'])('rechaza códigos de otro flujo: %s', texto => {
    expect(() => interpretarCodigoOperacion(texto)).toThrow();
  });
  it.each(['0', '-1', '2.5', 'Infinity', '9007199254740992'])('rechaza IDs inválidos %s', texto => expect(idOperacion(texto)).toBeNull());
});
describe('cantidades de la entrega', () => {
  it('admite decimales y rechaza cantidades ambiguas', () => {
    expect(cantidadOperacion('1,25')).toBe(1.25);
    expect(cantidadOperacion('0')).toBe(0);
    for (const n of ['', '-1', '1e3', '1.0000001', 'NaN', '1,000.5']) expect(() => cantidadOperacion(n)).toThrow();
  });
  it('revisa sólo las cantidades de la entrega parcial y omite líneas retiradas', () => {
    const lineas = [
      { vigente: true, confirmada: true, preparada_base: 12, revisada_base: 12, snapshot: { pendiente_base: 24 } },
      { vigente: true, confirmada: true, preparada_base: 0, revisada_base: null, snapshot: { pendiente_base: 10 } },
      { vigente: false, preparada_base: 20, snapshot: { pendiente_base: 20 } },
    ];
    expect(resumenOperacion(lineas)).toEqual({ total: 2, preparadas: 2, revisar: 1, revisadas: 1, parcial: true });
  });
});
it('envía la versión y deja que el servidor determine el responsable', async () => {
  const cliente = { rpc: vi.fn().mockResolvedValue({ data: { tarea: { version: 3 } }, error: null }) };
  await operarPedidoMovil(cliente, { pedidoId: '248', sucursalId: 1, tareaId: 10, accion: 'verificado', version: 2 });
  expect(cliente.rpc).toHaveBeenCalledWith('operar_preparacion_pedido', { p_pedido_id: '248', p_sucursal_id: 1, p_tarea_id: 10, p_accion: 'verificado', p_version: 2, p_datos: {} });
  cliente.rpc.mockResolvedValue({ data: null, error: { message: 'El pedido cambió.' } });
  await expect(operarPedidoMovil(cliente, {})).rejects.toThrow('El pedido cambió.');
});
