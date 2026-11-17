// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistorialMovimientos } from './HistorialApp';

const qa = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), autores: vi.fn(), sucursal: 1 }));
vi.mock('./supabaseClient', () => ({ supabase: { rpc: qa.rpc, from: qa.from } }));
vi.mock('./lib/useSucursal', () => ({ useSucursal: () => ({ sucursalActivaId: qa.sucursal, nombreSucursal: id => `Sucursal ${id}` }) }));
vi.mock('./lib/autoria', () => ({ resolverAutores: qa.autores, nombreAutor: email => email || '—' }));
vi.mock('./ImagenProducto', () => ({ default: () => null }));
vi.mock('./EscanerCodigo', () => ({ default: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let node, root;
const fila = id => ({
  id, producto_id: 1, cantidad: -10, tipo_movimiento: 'SALIDA', referencia: 'Despacho QA',
  creado_en: '2026-11-16T12:00:00.123456+00:00', creado_por: 'qa@example.invalid',
  producto: { nombre: `Producto ${id}`, sku_interno: 'QA-01', unidad_base: 'unidad' },
  ubicacion: { codigo_zona: 'PB', estante: 'A', nivel: '1', sucursal_id: 1 },
  saldo_base: 90, stock_disponible_actual: 145,
});
const pagina = () => Array.from({ length: 51 }, (_, i) => fila(200-i));
const boton = texto => [...node.querySelectorAll('button')].find(b => b.textContent.trim() === texto);
const filas = () => [...node.querySelectorAll('.history-row')];
const avanzar = async (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const montar = async (props = {}) => {
  await act(async () => root.render(<HistorialMovimientos {...props} />));
  await avanzar();
};
const click = async texto => act(async () => boton(texto).click());
const cambiar = async (selector, valor) => {
  await act(async () => {
    const el = node.querySelector(selector);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  qa.sucursal = 1;
  qa.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  qa.from.mockReset();
  qa.autores.mockReset().mockResolvedValue(new Map());
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe('historial global paginado', () => {
  it('carga 50 filas y continúa por cursor conservando microsegundos, saldos y stock actual', async () => {
    qa.rpc.mockResolvedValueOnce({ data: pagina(), error: null })
      .mockResolvedValueOnce({ data: [fila(150),fila(149)], error: null });
    await montar();
    expect(qa.rpc).toHaveBeenCalledWith('obtener_historial_global', {
      p_sucursal_id: 1, p_tipo: null, p_busqueda: null, p_limit: 51,
      p_antes_creado_en: null, p_antes_id: null,
    });
    expect(filas()).toHaveLength(50);
    expect(node.textContent).not.toContain('Producto 150');
    expect(filas()[0].textContent).toContain('Saldo en ubicación90');
    expect(filas()[0].textContent).toContain('Stock disponible actual145');
    await click('Cargar más');
    expect(qa.rpc).toHaveBeenLastCalledWith('obtener_historial_global', expect.objectContaining({
      p_antes_creado_en: '2026-11-16T12:00:00.123456+00:00', p_antes_id: 151,
    }));
    expect(filas()).toHaveLength(52);
    expect(boton('Cargar más')).toBeUndefined();
    expect(qa.from).not.toHaveBeenCalled();
  });

  it('busca en el servidor y reinicia el cursor al cambiar búsqueda o tipo', async () => {
    qa.rpc.mockResolvedValue({ data: pagina(), error: null });
    await montar(); await click('Cargar más');
    await cambiar('[aria-label="Buscar movimientos"]', '  Antiguo  ');
    await avanzar(299);
    expect(qa.rpc).toHaveBeenCalledTimes(2);
    await avanzar(1);
    expect(qa.rpc).toHaveBeenLastCalledWith('obtener_historial_global', expect.objectContaining({
      p_busqueda: 'Antiguo', p_antes_creado_en: null, p_antes_id: null,
    }));
    expect(filas()).toHaveLength(50);
    await cambiar('[aria-label="Tipo de movimiento"]', 'AJUSTE'); await avanzar(300);
    expect(qa.rpc).toHaveBeenLastCalledWith('obtener_historial_global', expect.objectContaining({
      p_tipo: 'AJUSTE', p_busqueda: 'Antiguo', p_antes_id: null,
    }));
  });

  it('reintenta la página fallida sin perder movimientos ni volver a empezar', async () => {
    qa.rpc.mockResolvedValueOnce({ data: pagina(), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Interrumpido' } })
      .mockResolvedValueOnce({ data: [fila(150)], error: null });
    await montar(); await click('Cargar más');
    expect(node.querySelector('[role=alert]').textContent).toContain('No se pudo cargar');
    expect(filas()).toHaveLength(50);
    const fallida = qa.rpc.mock.calls[1];
    await click('Reintentar');
    expect(qa.rpc.mock.calls[2]).toEqual(fallida);
    expect(filas()).toHaveLength(51);
    expect(node.querySelector('[role=alert]')).toBeNull();
  });

  it('descarta una respuesta de la sucursal anterior', async () => {
    let resolver;
    qa.rpc.mockReturnValueOnce(new Promise(resolve => { resolver = resolve; }))
      .mockResolvedValueOnce({ data: [fila(20)], error: null });
    await montar();
    qa.sucursal = 2; await montar();
    expect(qa.rpc).toHaveBeenLastCalledWith('obtener_historial_global', expect.objectContaining({ p_sucursal_id: 2, p_antes_id: null }));
    await act(async () => resolver({ data: [fila(10)], error: null }));
    expect(filas()).toHaveLength(1);
    expect(node.textContent).toContain('Producto 20');
    expect(node.textContent).not.toContain('Producto 10');
  });

  it('permite reintentar un fallo inicial sin consultar tablas como respaldo', async () => {
    qa.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ data: [fila(1)], error: null });
    await montar();
    expect(node.querySelector('[role=alert]')).not.toBeNull();
    expect(node.textContent).not.toContain('Sin movimientos registrados');
    await click('Reintentar');
    expect(filas()).toHaveLength(1);
    expect(qa.from).not.toHaveBeenCalled();
  });

  it('mantiene la RPC existente y el saldo histórico total en el panel por producto', async () => {
    qa.rpc.mockResolvedValueOnce({ data: [{ ...fila(1), ubicacion_id: 1, codigo_zona: 'PB', sucursal_id: 1,
      saldo_en_ubicacion: 90, saldo_total_almacen: 120 }], error: null });
    qa.from.mockImplementation(tabla => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { id: 1, nombre: 'Producto QA' } }),
        in: async () => ({ data: tabla === 'ubicacion' ? [{ id: 1, estante: 'A', nivel: '1' }] : [] }),
      };
      return query;
    });
    await montar({ productoId: 1 });
    expect(qa.rpc).toHaveBeenCalledWith('obtener_kardex_producto', { p_producto_id: 1, p_limit: 50, p_offset: 0 });
    expect(filas()).toHaveLength(1);
    expect(filas()[0].textContent).toContain('Saldo total después120');
  });
});
