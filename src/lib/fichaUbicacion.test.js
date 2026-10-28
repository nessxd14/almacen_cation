import { describe, it, expect } from 'vitest';
import { cargarFichaUbicacion, enlaceFichaUbicacion, listarUbicacionesEtiqueta, resumirProductosUbicacion } from './fichaUbicacion';

const producto = (id, nombre) => ({ id, nombre, sku_interno: `SKU-${id}`, unidad_base: 'UND' });
const ubicacion = { id: 9, sucursal_id: 1, codigo_zona: 'A', estante: '2', nivel: '1', compartimiento: 'B', excluye_disponible: false };

function clienteSimulado(respuestas) {
  const consultas = [];
  return {
    consultas,
    from(tabla) {
      const consulta = { tabla, filtros: [], orden: [], rango: null };
      consultas.push(consulta);
      const resolver = () => {
        const resultado = respuestas[tabla];
        if (resultado?.error) return resultado;
        let data = resultado?.data ?? [];
        if (consulta.rango && Array.isArray(data)) data = data.slice(consulta.rango[0], consulta.rango[1] + 1);
        return { data, error: null };
      };
      const query = {
        select(campos) { consulta.campos = campos; return query; },
        eq(campo, valor) { consulta.filtros.push([campo, valor]); return query; },
        order(campo) { consulta.orden.push(campo); return query; },
        range(desde, hasta) { consulta.rango = [desde, hasta]; return query; },
        maybeSingle() { return query; },
        then(ok, fail) { return Promise.resolve(resolver()).then(ok, fail); },
      };
      return query;
    },
  };
}

describe('identificación y listado de ubicaciones', () => {
  it('el QR apunta a la ubicación y sucursal sin datos variables', () => {
    expect(enlaceFichaUbicacion(9, 1, 'https://almacen.example')).toBe('https://almacen.example/ubicaciones/9/ficha?sucursal=1');
    expect(() => enlaceFichaUbicacion('../producto', 1, 'https://almacen.example')).toThrow();
    expect(() => enlaceFichaUbicacion(9, 'virtual', 'https://almacen.example')).toThrow();
  });
  it('pagina las ubicaciones físicas con orden estable, incluso si hay más de mil', async () => {
    const cliente = clienteSimulado({ ubicacion: { data: Array.from({ length: 1001 }, (_, i) => ({ ...ubicacion, id: i + 1 })) } });
    expect(await listarUbicacionesEtiqueta(cliente, 1)).toHaveLength(1001);
    expect(cliente.consultas.map(c => c.rango)).toEqual([[0, 999], [1000, 1999]]);
    for (const c of cliente.consultas) {
      expect(c.filtros).toEqual([['sucursal_id', 1], ['excluye_disponible', false], ['activo', true]]);
      expect(c.orden).toEqual(['id']);
    }
  });
});

describe('productos de una ubicación', () => {
  it('une asignaciones y existencias, conservando la falta de registro y el cero explícito', () => {
    const productos = resumirProductosUbicacion([
      { producto_id: 1, producto: producto(1, 'A'), es_principal: true },
      { producto_id: 2, producto: producto(2, 'B') },
    ], [
      { producto_id: 2, producto: producto(2, 'B'), cantidad_base: '0' },
      { producto_id: 3, producto: producto(3, 'C'), cantidad_base: '-2.5' },
    ]);
    expect(productos).toHaveLength(3);
    expect(productos[0]).toMatchObject({ cantidad: null, asignado: true, es_principal: true });
    expect(productos[1]).toMatchObject({ cantidad: 0, asignado: true });
    expect(productos[2]).toMatchObject({ cantidad: -2.5, asignado: false });
  });
  it('un valor nulo o no numérico no se transforma en existencia cero', () => {
    for (const cantidad of [null, '', ' ', 'desconocida']) {
      expect(resumirProductosUbicacion([], [{ producto_id: 1, producto: producto(1, 'A'), cantidad_base: cantidad }])[0].cantidad).toBeNull();
    }
  });
  it('no presenta saldos viejos cuando falla la consulta de stock', () => {
    expect(resumirProductosUbicacion([{ producto_id: 1, producto: producto(1, 'A') }], [{ producto_id: 1, cantidad_base: 10 }], false)[0].cantidad).toBeNull();
  });
  it('rechaza ubicaciones de otra sucursal antes de consultar productos', async () => {
    const cliente = clienteSimulado({ ubicacion: { data: { ...ubicacion, sucursal_id: 2 } } });
    await expect(cargarFichaUbicacion(cliente, 9, 1)).rejects.toThrow('no existe en esta sucursal');
    expect(cliente.consultas.map(c => c.tabla)).toEqual(['ubicacion']);
  });
  it('no consulta productos de ubicaciones excluidas o inaccesibles', async () => {
    for (const data of [null, { ...ubicacion, excluye_disponible: true }]) {
      const cliente = clienteSimulado({ ubicacion: { data } });
      await expect(cargarFichaUbicacion(cliente, 9, 1)).rejects.toThrow();
      expect(cliente.consultas).toHaveLength(1);
    }
  });
  it('un fallo de stock conserva productos asignados y marca la cantidad como desconocida', async () => {
    const cliente = clienteSimulado({
      ubicacion: { data: ubicacion },
      producto_ubicacion: { data: [{ id: 1, producto_id: 1, producto: producto(1, 'A') }] },
      stock_actual: { data: null, error: { message: 'red' } },
    });
    const ficha = await cargarFichaUbicacion(cliente, 9, 1);
    expect(ficha.errores.stock).toContain('existencias');
    expect(ficha.productos[0]).toMatchObject({ cantidad: null, asignado: true });
  });
  it('una falla de asignaciones no oculta productos cuya existencia pudo consultarse', async () => {
    const cliente = clienteSimulado({
      ubicacion: { data: ubicacion },
      producto_ubicacion: { data: null, error: { message: 'red' } },
      stock_actual: { data: [{ producto_id: 2, producto: producto(2, 'B'), cantidad_base: '12' }] },
    });
    const ficha = await cargarFichaUbicacion(cliente, 9, 1);
    expect(ficha.errores.asignaciones).toContain('asignados');
    expect(ficha.productos[0].cantidad).toBe(12);
    const consultasStock = cliente.consultas.filter(c => c.tabla === 'stock_actual');
    expect(consultasStock[0].filtros).toEqual([['ubicacion_id', 9]]);
    expect(consultasStock[0].orden).toEqual(['producto_id']);
  });
});
