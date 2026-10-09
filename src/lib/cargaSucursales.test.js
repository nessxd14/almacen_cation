import { describe, it, expect } from 'vitest';
import { elegirSucursalDisponible, estadoCargaSucursales } from './cargaSucursales';

const sucursales = [{ id: 1, nombre: 'Almacén Central', tipo: 'fisica' }, { id: 2, nombre: 'Tienda', tipo: 'fisica' }];

describe('carga de sucursales al iniciar sesión', () => {
  it('espera la consulta autenticada en lugar de reutilizar una lista vacía del login', () => {
    const anterior = { usuarioId: null, intento: 0, data: [] };
    expect(estadoCargaSucursales('operario', 0, anterior)).toEqual({ sucursales: [], cargando: true, error: null });
    expect(estadoCargaSucursales('operario', 0, { usuarioId: 'operario', intento: 0, data: sucursales })).toEqual({ sucursales, cargando: false, error: null });
  });
  it('no conserva datos al cerrar o cambiar de cuenta', () => {
    const consulta = { usuarioId: 'primero', intento: 0, data: sucursales };
    expect(estadoCargaSucursales(null, 0, consulta)).toEqual({ sucursales: [], cargando: false, error: null });
    expect(estadoCargaSucursales('segundo', 0, consulta).cargando).toBe(true);
  });
  it('un reintento deja de mostrar el error anterior mientras consulta', () => {
    const consulta = { usuarioId: 'operario', intento: 0, error: { message: 'sin conexión' } };
    expect(estadoCargaSucursales('operario', 0, consulta).error).toContain('Reintenta');
    expect(estadoCargaSucursales('operario', 1, consulta)).toEqual({ sucursales: [], cargando: true, error: null });
  });
  it('distingue una lista vacía de una selección pendiente y omite sucursales virtuales', () => {
    const consulta = { usuarioId: 'operario', intento: 0, data: [{ id: 3, tipo: 'virtual' }] };
    expect(estadoCargaSucursales('operario', 0, consulta).error).toContain('no tiene almacenes');
  });
  it('reconoce de inmediato una elección válida o la primera disponible', () => {
    expect(elegirSucursalDisponible(sucursales, '2')).toBe(2);
    expect(elegirSucursalDisponible(sucursales, null)).toBe(1);
    expect(elegirSucursalDisponible(sucursales, 3)).toBe(1);
    expect(elegirSucursalDisponible([], 1)).toBeNull();
  });
});
