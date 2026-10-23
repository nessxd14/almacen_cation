import { beforeEach, describe, expect, it, vi } from 'vitest';
import { movimientosProductoDia, movimientosComprobantesDia } from './reportesAlmacen';

const qa = vi.hoisted(()=>({from:vi.fn(),autores:vi.fn(),calls:[],respuesta:null}));
vi.mock('../supabaseClient',()=>({supabase:{from:qa.from}}));
vi.mock('./autoria',()=>({resolverAutores:qa.autores}));
const consulta={productoId:4,ubicacionId:7,sucursalId:2,fecha:'2026-10-19',hasta:'2026-10-20T04:00:00Z'};
beforeEach(()=>{
  qa.calls=[];qa.respuesta={data:[{id:1,cantidad:10,creado_por:'a@qa.invalid'},{id:2,cantidad:-2,creado_por:'00000000-0000-0000-0000-000000000001'}],count:2};
  qa.autores.mockReset().mockResolvedValue(new Map([['a@qa.invalid','Cuenta QA']]));
  qa.from.mockReset().mockImplementation(tabla=>{
    qa.calls.push(['from',tabla]);
    const cadena={};
    for(const metodo of ['select','eq','gte','lt','order','limit','in'])cadena[metodo]=(...args)=>{qa.calls.push([metodo,...args]);return cadena;};
    cadena.then=(resolve,reject)=>Promise.resolve(tabla==='perfil'?{data:[{id:'00000000-0000-0000-0000-000000000001',nombre:'Operario QA'}]}:qa.respuesta).then(resolve,reject);
    return cadena;
  });
});

describe('consulta diaria por comprobantes', () => {
  it('pagina con el límite real del servidor, resuelve el folio VTD y conserva la sucursal y corte', async () => {
    const paginas = [[{ id: 1, referencia: 'Venta #35', producto_id: 4, cantidad: -2, producto: { nombre: 'Lápiz', unidad_base: 'UND' }, ubicacion: { codigo_zona: 'PLANTA BAJA' } }], [{ id: 2, referencia: 'Venta #35', producto_id: 5, cantidad: -4 }]];
    let pagina = 0;
    qa.from.mockImplementation(tabla => {
      const cadena = {};
      for (const metodo of ['select', 'eq', 'gte', 'lt', 'order', 'range', 'in']) cadena[metodo] = (...args) => { qa.calls.push([metodo, ...args]); return cadena; };
      cadena.then = (resolve, reject) => Promise.resolve(tabla === 'kardex_transacciones' ? { data: paginas[pagina++], count: 2 } : tabla === 'venta' ? { data: [{ id: 35, numero: 'VTD-2026-00035' }] } : { data: [] }).then(resolve, reject);
      return cadena;
    });
    const result = await movimientosComprobantesDia(consulta);
    expect(result.incompleto).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ nombre: 'Lápiz', ubicacion: 'PLANTA BAJA', comprobante: { tipo: 'VTD', numero: 'VTD-2026-00035' } });
    expect(qa.calls).toEqual(expect.arrayContaining([['range', 0, 499], ['range', 1, 500], ['eq', 'ubicacion.sucursal_id', 2], ['eq', 'ubicacion.excluye_disponible', false], ['gte', 'creado_en', '2026-10-19T00:00:00-04:00'], ['lt', 'creado_en', consulta.hasta]]));
  });
  it('no anuncia una consulta completa si hay filas pendientes y propaga los errores', async () => {
    let pagina = 0;
    qa.from.mockImplementation(() => {
      const cadena = {};
      for (const metodo of ['select', 'eq', 'gte', 'lt', 'order', 'range']) cadena[metodo] = () => cadena;
      cadena.then = (resolve, reject) => Promise.resolve(pagina++ === 0 ? { data: [{ id: 1 }], count: 3 } : { data: [], count: 3 }).then(resolve, reject);
      return cadena;
    });
    expect((await movimientosComprobantesDia(consulta)).incompleto).toBe(true);
    qa.from.mockImplementation(() => {
      const cadena = {};
      for (const metodo of ['select', 'eq', 'gte', 'lt', 'order', 'range']) cadena[metodo] = () => cadena;
      cadena.then = (resolve, reject) => Promise.resolve({ error: { message: 'Sin permiso' } }).then(resolve, reject);
      return cadena;
    });
    await expect(movimientosComprobantesDia(consulta)).rejects.toThrow('Sin permiso');
  });
});
describe('consulta del detalle diario',()=>{
  it('filtra producto, ubicación, sucursal y corte del resumen, ordena de forma estable y resuelve ambos formatos de autor',async()=>{
    const result=await movimientosProductoDia(consulta);
    expect(qa.calls).toEqual(expect.arrayContaining([['eq','producto_id',4],['eq','ubicacion_id',7],['eq','ubicacion.sucursal_id',2],['gte','creado_en','2026-10-19T00:00:00-04:00'],['lt','creado_en',consulta.hasta],['order','creado_en',{ascending:true}],['order','id',{ascending:true}],['limit',1000]]));
    expect(result.incompleto).toBe(false);expect(result.items.map(m=>m.autor)).toEqual(['Cuenta QA','Operario QA']);
  });
  it('identifica límites del servidor y propaga errores sin presentarlos como un detalle vacío',async()=>{
    qa.respuesta.count=500;expect((await movimientosProductoDia(consulta)).incompleto).toBe(true);
    qa.respuesta={error:{message:'Sin permiso'}};await expect(movimientosProductoDia(consulta)).rejects.toThrow('Sin permiso');
  });
});
