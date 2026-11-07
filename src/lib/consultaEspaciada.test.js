// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consultaEspaciada } from './consultaEspaciada';

describe('consulta espaciada', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('espacia las consultas mientras siga pendiente y se detiene al terminar', async () => {
    const consultar = vi.fn().mockResolvedValue('seguir');
    const detener = consultaEspaciada(consultar);
    await vi.advanceTimersByTimeAsync(0); expect(consultar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000); expect(consultar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000); expect(consultar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15000); expect(consultar).toHaveBeenCalledTimes(3);
    consultar.mockResolvedValue('listo');
    await vi.advanceTimersByTimeAsync(60000); expect(consultar).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(600000); expect(consultar).toHaveBeenCalledTimes(4);
    detener();
  });
  it('no consulta de nuevo al volver a la ventana antes de 10 segundos', async () => {
    const consultar = vi.fn().mockResolvedValue('listo');
    const detener = consultaEspaciada(consultar);
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0);
    expect(consultar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(11000);
    window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0);
    expect(consultar).toHaveBeenCalledTimes(2);
    detener();
  });
});
