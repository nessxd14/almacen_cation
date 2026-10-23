import { beforeEach, describe, expect, it, vi } from 'vitest';
import { movimientosProductoDia } from './reportesAlmacen';

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
