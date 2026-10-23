import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('../supabaseClient', () => ({ supabase: api }));
import { cargarDatosOperacion, leerStockOperacion, resumenOperacion, cantidadOperacion } from './operacionDirecta';
import { ejecutarOperacion, asegurarAsignacion } from './operaciones';

const nombres = id => ({ 1: 'Almacén Central', 2: 'Tienda' })[id];
const sucursales = [{ id: 1, tipo: 'almacen' }, { id: 2, tipo: 'tienda' }, { id: 3, tipo: 'virtual' }];
const ubicaciones = [{ id: 11, codigo_zona: 'PISO', sucursal_id: 1 }, { id: 22, codigo_zona: 'PISO', sucursal_id: 2 }];
let llamadas, respuestas;
beforeEach(() => {
  vi.clearAllMocks(); llamadas = [];
  respuestas = { presentacion: [{ id: 1, nombre: 'Unidad', factor_unidad_base: 1, es_base: true }], ubicacion: ubicaciones, producto_ubicacion: [{ id: 1, ubicacion_id: 11, es_principal: true }], stock_actual: [{ ubicacion_id: 11, cantidad_base: '120' }] };
  api.from.mockImplementation(tabla => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn(async () => ({ data: respuestas[tabla], error: null })), maybeSingle: vi.fn(async () => ({ data: { cantidad_base: '120' } })), then: resolve => Promise.resolve({ count: 0 }).then(resolve), insert: vi.fn(async () => ({})) };
    llamadas.push({ tabla, query }); return query;
  });
  api.rpc.mockResolvedValue({ data: 99, error: null });
});

describe('lecturas de operaciones directas', () => {
  it('limita ubicaciones a sucursales físicas y conserva nombres distintos aunque la zona coincida', async () => {
    const datos = await cargarDatosOperacion({ productoId: 8, sucursalId: 1, sucursales, nombreSucursal: nombres });
    expect(llamadas.find(l => l.tabla === 'ubicacion').query.in).toHaveBeenCalledWith('sucursal_id', [1, 2]);
    expect(datos.ubicaciones.map(u => u.label)).toEqual(['Almacén Central · PISO', 'Tienda · PISO']);
    expect(datos.ubicaciones[0]).toMatchObject({ asignada: true, stock: 120 });
    expect(datos.ubicaciones[1]).toMatchObject({ asignada: false, stock: 0 });
  });
  it('no consulta si la sucursal activa es virtual o no está disponible', async () => {
    await expect(cargarDatosOperacion({ productoId: 8, sucursalId: 3, sucursales, nombreSucursal: nombres })).rejects.toThrow('sucursal física');
    expect(api.from).not.toHaveBeenCalled();
  });
  it('propaga un fallo de stock en vez de convertirlo en cero', async () => {
    api.from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ error: new Error('Sin conexión') }) }) }) }) });
    await expect(leerStockOperacion({ productoId: 8, ubicacionId: 11 })).rejects.toThrow('Sin conexión');
  });
  it('distingue ausencia de movimiento de una respuesta con saldo inválido', async () => {
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { cantidad_base: 'inválido' } });
    const query = { select: () => query, eq: () => query, maybeSingle }; api.from.mockReturnValue(query);
    expect(await leerStockOperacion({ productoId: 8, ubicacionId: 11 })).toBe(0);
    await expect(leerStockOperacion({ productoId: 8, ubicacionId: 11 })).rejects.toThrow('no es válido');
  });
  it('propaga errores al cargar ubicaciones y presentaciones', async () => {
    const q = { select: () => q, eq: () => q, in: () => q, order: () => q, range: async () => ({ error: new Error('Consulta rechazada') }) }; api.from.mockReturnValue(q);
    await expect(cargarDatosOperacion({ productoId: 8, sucursalId: 1, sucursales, nombreSucursal: nombres })).rejects.toThrow('Consulta rechazada');
  });
});

describe('cantidades del resumen y envío', () => {
  it('convierte dos cajas de doce y calcula ambos saldos de un traslado', () => {
    expect(resumenOperacion({ modo: 'TRASLADO', cantidad: '2', factor: 12, stockOrigen: 120, stockDestino: 60 })).toMatchObject({ error: '', cantidadBase: 24, delta: -24, origenFinal: 96, destinoFinal: 84 });
  });
  it('bloquea el exceso convertido aunque la cantidad de cajas parezca pequeña', () => {
    expect(resumenOperacion({ modo: 'TRASLADO', cantidad: '2', factor: 100, stockOrigen: 120, stockDestino: 0 }).error).toContain('supera el stock');
  });
  it('permite ajustar a cero y calcula una diferencia negativa', () => {
    expect(resumenOperacion({ modo: 'AJUSTE', cantidadObjetivo: '0', stockOrigen: 12 })).toMatchObject({ error: '', cantidadBase: 0, delta: -12, origenFinal: 0 });
  });
  it.each(['', '-1', 'NaN', 'Infinity', '0'])('rechaza cantidades no válidas para entrada: %s', cantidad => {
    expect(resumenOperacion({ modo: 'ENTRADA', cantidad, factor: 12, stockOrigen: 120 }).error).not.toBe('');
  });
  it('acepta cuatro decimales, rechaza pérdida de precisión y no inventa stock al cargar', () => {
    expect(resumenOperacion({ modo: 'ENTRADA', cantidad: '0.0001', factor: 1, stockOrigen: 0 }).origenFinal).toBe(0.0001);
    expect(resumenOperacion({ modo: 'ENTRADA', cantidad: '0.00001', factor: 1, stockOrigen: 0 }).error).toContain('4 decimales');
    expect(resumenOperacion({ modo: 'ENTRADA', cantidad: '2', factor: 12, stockOrigen: null }).origenFinal).toBeNull();
    expect(cantidadOperacion(null)).toBe('—');
  });
  it('reutiliza la clave de entrada en los reintentos del mismo envío', async () => {
    const payload = { modo: 'ENTRADA', productoId: 8, presentacionId: 2, ubicacionId: 11, cantidad: '2', usuario: 'QA', idempotencia: 'clave-del-envio' };
    await ejecutarOperacion(payload); await ejecutarOperacion(payload);
    expect(api.rpc.mock.calls.every(c => c[1].p_idempotencia === 'clave-del-envio')).toBe(true);
  });
  it('el traslado envía la presentación visible y la cantidad de presentaciones, sin multiplicar dos veces', async () => {
    await ejecutarOperacion({ modo: 'TRASLADO', presentacionId: 2, ubicacionId: 11, ubicacionDestinoId: 22, cantidad: '2', usuario: 'QA' });
    expect(api.rpc).toHaveBeenCalledWith('registrar_traslado', expect.objectContaining({ p_presentacion_id: 2, p_cantidad_pres: 2, p_ubicacion_origen: 11, p_ubicacion_destino: 22 }));
  });
  it('la confirmación estricta de asignación informa un error sin cambiar a otros consumidores', async () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ error: new Error('Sin permiso') }) }; api.from.mockReturnValue(q);
    await expect(asegurarAsignacion(8, 11, { estricto: true })).rejects.toThrow('Sin permiso');
  });
  it('la salida calcula el saldo descontando las cajas y bloquea un exceso', () => {
    expect(resumenOperacion({ modo: 'SALIDA', cantidad: '2', factor: 12, stockOrigen: 120 })).toMatchObject({ error: '', cantidadBase: 24, delta: -24, origenFinal: 96, destinoFinal: null });
    expect(resumenOperacion({ modo: 'SALIDA', cantidad: '11', factor: 12, stockOrigen: 120 }).error).toContain('supera el stock');
    expect(resumenOperacion({ modo: 'SALIDA', cantidad: '120', factor: 1, stockOrigen: 120 }).origenFinal).toBe(0);
  });
  it('envía la salida al procedimiento existente sin sobregiro y reutiliza su clave al reintentar', async () => {
    const payload = { modo: 'SALIDA', presentacionId: 2, ubicacionId: 11, cantidad: '2', referencia: 'Retiro QA', usuario: 'QA', idempotencia: 'salida-qa' };
    await ejecutarOperacion(payload); await ejecutarOperacion(payload);
    expect(api.rpc).toHaveBeenCalledWith('registrar_salida', expect.objectContaining({ p_presentacion_id: 2, p_ubicacion_id: 11, p_cantidad_pres: 2, p_permitir_sobregiro: false, p_idempotencia: 'salida-qa' }));
    expect(api.rpc.mock.calls.every(c => c[1].p_idempotencia === 'salida-qa')).toBe(true);
  });
});
