import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cargarPendientesAuditoria } from './auditoriaAlmacen';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabaseClient', () => ({ supabase: { rpc } }));

const fecha = '2026-11-27';
const pagina = (items, siguiente = null, dia = fecha) => ({
  error: null,
  data: { fecha: dia, items, siguiente },
});

beforeEach(() => rpc.mockReset());

describe('lista de pendientes para Spotlight', () => {
  it('recorre todos los cursores y conserva una fila por ítem de auditoría', async () => {
    rpc.mockResolvedValueOnce(pagina([{ id: 1 }, { id: 2, estado: 'PENDIENTE' }], 2))
      .mockResolvedValueOnce(pagina([{ id: 2, estado: 'RECONTEO' }, { id: 3 }]));
    expect(await cargarPendientesAuditoria(4)).toEqual({
      fecha, items: [{ id: 1 }, { id: 2, estado: 'RECONTEO' }, { id: 3 }],
    });
    expect(rpc.mock.calls).toEqual([
      ['operar_auditoria_almacen', { p_accion: 'listar', p_sucursal_id: 4, p_datos: { filtro: 'abiertos', incluir_movimiento: true } }],
      ['operar_auditoria_almacen', { p_accion: 'listar', p_sucursal_id: 4, p_datos: { filtro: 'abiertos', incluir_movimiento: true, cursor: 2 } }],
    ]);
  });

  it('evita mezclar jornadas durante el cambio de día', async () => {
    rpc.mockResolvedValueOnce(pagina([{ id: 1 }], 1))
      .mockResolvedValueOnce(pagina([{ id: 2 }], null, '2026-11-28'));
    await expect(cargarPendientesAuditoria(4)).rejects.toThrow('Comenzó otra jornada');
  });

  it('detiene la paginación si el servidor repite el cursor', async () => {
    rpc.mockResolvedValue(pagina([{ id: 1 }], 1));
    await expect(cargarPendientesAuditoria(4)).rejects.toThrow('La lista de Auditoría cambió');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('deja de pedir páginas si cambia la sucursal antes de la respuesta', async () => {
    const controlador = new AbortController();
    rpc.mockImplementationOnce(async () => {
      controlador.abort();
      return pagina([{ id: 1 }], 1);
    });
    await expect(cargarPendientesAuditoria(4, controlador.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
