import { describe, it, expect } from 'vitest';
import { cargarFichaProducto, codigosDePresentaciones, enlaceFicha, resumirUbicaciones, sucursalDeFicha } from './fichaProducto';

const u = (id, extra = {}) => ({ id, codigo_zona: `A${id}`, sucursal_id: 1, excluye_disponible: false, ...extra });
const sucursales = [{ id: 1, tipo: 'fisica' }, { id: 2, tipo: 'fisica' }, { id: 3, tipo: 'virtual' }];

describe('ficha: cantidades y sucursales', () => {
  it('separa falta de registro de una existencia explícita de cero', () => {
    const asignaciones = [{ es_principal: true, ubicacion: u(1) }];
    expect(resumirUbicaciones(asignaciones, [], 1).total).toBeNull();
    expect(resumirUbicaciones(asignaciones, [], 1).ubicaciones[0].cantidad).toBeNull();
    expect(resumirUbicaciones(asignaciones, [{ ubicacion: u(1), cantidad_base: '0' }], 1).total).toBe(0);
  });
  it('excluye otras sucursales y ubicaciones no disponibles sin perder ajustes negativos', () => {
    const stock = [
      { ubicacion: u(1), cantidad_base: '10.5' },
      { ubicacion: u(2), cantidad_base: '-2' },
      { ubicacion: u(3, { sucursal_id: 2 }), cantidad_base: 999 },
      { ubicacion: u(4, { excluye_disponible: true }), cantidad_base: 999 },
      { ubicacion: u(5, { sucursal: { tipo: 'virtual' } }), cantidad_base: 999 },
    ];
    expect(resumirUbicaciones([], stock, 1).total).toBe(8.5);
    expect(resumirUbicaciones([], stock, 1).ubicaciones.map(r => r.id)).toEqual([1, 2]);
  });
  it('un error de consulta conserva las ubicaciones pero no presenta stock viejo como actual', () => {
    const r = resumirUbicaciones([{ ubicacion: u(1), es_principal: true }], [{ ubicacion: u(1), cantidad_base: 10 }], 1, false);
    expect(r.total).toBeNull();
    expect(r.ubicaciones[0].cantidad).toBeNull();
  });
  it('conserva y prioriza la ubicación principal aunque otra tenga más stock', () => {
    const r = resumirUbicaciones([{ ubicacion: u(9), es_principal: true }], [{ ubicacion: u(1), cantidad_base: 100 }, { ubicacion: u(9), cantidad_base: 2 }], 1);
    expect(r.ubicaciones[0]).toMatchObject({ id: 9, es_principal: true, cantidad: 2 });
  });
  it('no permite que el QR cambie la sucursal fija del operario', () => {
    expect(() => sucursalDeFicha('2', 1, 1, sucursales)).toThrow('otra sucursal');
    expect(sucursalDeFicha('1', 1, 2, sucursales)).toBe(1);
    expect(sucursalDeFicha('2', null, 1, sucursales)).toBe(2);
  });
  it('rechaza sucursales virtuales e identificadores inválidos', () => {
    expect(() => sucursalDeFicha('3', null, 1, sucursales)).toThrow('almacén o la tienda');
    expect(() => sucursalDeFicha('NaN', null, 1, sucursales)).toThrow('no es válida');
  });
  it('el enlace usa identidad y sucursal, sin stock ni sesión en el QR', () => {
    expect(enlaceFicha(42, 1, 'https://almacen.example')).toBe('https://almacen.example/productos/42/ficha?sucursal=1');
    expect(enlaceFicha(42, 1, 'https://almacen.example', 18)).toBe('https://almacen.example/productos/42/ficha?sucursal=1&presentacion=18');
    expect(() => enlaceFicha(42, 1, 'https://almacen.example', '../otro')).toThrow('Presentación inválida');
    expect(() => enlaceFicha('../otro', 1, 'https://almacen.example')).toThrow();
  });
  it('solo ofrece barras activas y etiqueta a qué presentación pertenecen', () => {
    const r = codigosDePresentaciones([
      { id: 1, nombre: 'Unidad', es_base: true, identificador: [{ id: 1, tipo: 'barra', valor: '123' }, { tipo: 'fabrica', valor: 'ABC' }, { tipo: 'barra', valor: '456', activo: false }] },
      { id: 2, nombre: 'Caja', activo: false, identificador: [{ tipo: 'barra', valor: '789' }] },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ valor: '123', presentacion: 'Unidad' });
  });
});

function clienteSimulado(stockError) {
  return {
    from(tabla) {
      const respuesta = tabla === 'producto' ? { data: { id: 42, nombre: 'Prueba' } }
        : tabla === 'stock_actual' && stockError ? { data: null, error: { message: 'red' } }
          : { data: [] };
      const query = new Proxy({}, { get: (_target, propiedad) => propiedad === 'then'
        ? (ok, fail) => Promise.resolve(respuesta).then(ok, fail)
        : () => query });
      return query;
    },
    rpc: async name => ({ data: name === 'operar_conteo' ? null : [{ producto_id: 42, vendible: 0, reservado: 0 }] }),
  };
}

describe('lectura de ficha', () => {
  it('una falla de stock no cancela la identificación ni se convierte en cero', async () => {
    const ficha = await cargarFichaProducto(clienteSimulado(true), 42, 1);
    expect(ficha.producto.nombre).toBe('Prueba');
    expect(ficha.stock).toBeNull();
    expect(ficha.errores.stock).toContain('existencias');
    expect(ficha.disponibilidad.reservado).toBe(0);
  });
  it('una respuesta vacía válida no se reporta como falla', async () => {
    const ficha = await cargarFichaProducto(clienteSimulado(false), 42, 1);
    expect(ficha.stock).toEqual([]);
    expect(ficha.errores).toEqual({});
  });
  it('muestra la verificación sin diferencia aunque no haya movimiento de ajuste', async () => {
    const cliente = clienteSimulado(false), original = cliente.rpc;
    cliente.rpc = async (name, args) => name === 'operar_conteo'
      ? { data: { sesion_id: 9, creado_en: '2026-10-19T12:00:00Z', creado_por: 'Supervisión QA', origen_conciliacion_id: 5 } }
      : original(name, args);
    const ficha = await cargarFichaProducto(cliente, 42, 1);
    expect(ficha.conteo).toMatchObject({ sesion_id: 9, creado_por: 'Supervisión QA' });
  });
});
