import { afterEach, describe, expect, it, vi } from 'vitest';
import { rechazarPedido, rechazarPedidoLinea } from './operaciones';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }));
afterEach(() => vi.resetAllMocks());

const operaciones = [
  ['pedido', rechazarPedido, { pedidoId: '21', motivo: 'Sin disponibilidad', usuario: 'Suplantado' }, 'rechazar_pedido_auditado', { p_pedido_id: 21, p_motivo: 'Sin disponibilidad' }],
  ['línea', rechazarPedidoLinea, { lineaId: '31', motivo: 'Sin disponibilidad', usuario: 'Suplantado' }, 'rechazar_linea_pedido_auditada', { p_pedido_linea_id: 31, p_motivo: 'Sin disponibilidad' }],
];

describe.each(operaciones)('rechazo auditado de %s', (_name, operar, input, nombreRpc, parametros) => {
  it('usa la operación auditada y deja la identidad del responsable al servidor', async () => {
    rpc.mockResolvedValue({ data: { lineas_rechazadas: 1 }, error: null });
    const result = await operar(input);
    expect(result).toEqual({ resultado: { lineas_rechazadas: 1 }, error: null });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(nombreRpc, parametros);
  });
  it('se detiene cuando falta la migración y no reintenta con la operación antigua', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Función no encontrada' } });
    const result = await operar(input);
    expect(result.error.message).toContain('rechazo con historial aún no está habilitado');
    expect(rpc).toHaveBeenCalledExactlyOnceWith(nombreRpc, parametros);
  });
  it('conserva el error de permisos o de entrega del servidor', async () => {
    const error = { code: '42501', message: 'No puedes rechazar una línea despachada' };
    rpc.mockResolvedValue({ data: null, error });
    const result = await operar(input);
    expect(result.error).toBe(error);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
