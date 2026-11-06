import {expect,it,vi} from 'vitest';
import {consultarStockSistema,faltaStock} from './stockOperacion';
function cliente(paginas){let n=0;const q={select:()=>q,in:()=>q,eq:()=>q,gt:()=>q,order:()=>q,range:vi.fn(()=>Promise.resolve(paginas[n++]))};return {from:()=>q,q};}
it('cero sólo con consulta exitosa y excluye stock no despachable',async()=>{
 const c=cliente([{data:[{producto_id:1,cantidad_base:6,ubicacion:{sucursal_id:1}},{producto_id:1,cantidad_base:100,ubicacion:{sucursal_id:1,excluye_disponible:true}},{producto_id:1,cantidad_base:-2,ubicacion:{sucursal_id:1}}],error:null}]);
 expect(await consultarStockSistema(c,[1,2],1)).toEqual(new Map([[1,6],[2,0]]));
});
it('nunca devuelve un saldo cero si falla o falta parte de la consulta',async()=>{
 await expect(consultarStockSistema(cliente([{data:[],error:{message:'sin permiso'}}]),[1],1)).rejects.toThrow('No se pudo consultar');
 await expect(consultarStockSistema(cliente([{data:null,error:null}]),[1],1)).rejects.toThrow('incompleta');
});
it('reconoce IDs numéricos serializados como texto sin convertir el saldo a cero',async()=>{
 const c=cliente([{data:[{producto_id:'1',cantidad_base:'6',ubicacion:{sucursal_id:'1'}}],error:null}]);
 expect((await consultarStockSistema(c,['1'],'1')).get(1)).toBe(6);
});
it('no trunca ubicaciones cuando hay más de una página',async()=>{
 const fila={producto_id:1,cantidad_base:1,ubicacion:{sucursal_id:1}};const c=cliente([{data:Array.from({length:500},()=>fila),error:null},{data:[fila],error:null}]);
 expect((await consultarStockSistema(c,[1],1)).get(1)).toBe(501);expect(c.q.range).toHaveBeenLastCalledWith(500,999);
});
it('suma el mismo producto entre líneas y sólo exige el origen Almacén de pedidos',()=>{
 const l=q=>({vigente:true,preparada_base:q,revisada_base:q,snapshot:{producto_id:1},origenes_declarados:[{tipo:'ALMACEN',cantidad_base:2},{tipo:'COMPRA_RAPIDA',cantidad_base:4}]});
 expect(faltaStock([l(6),l(6)],new Map([[1,10]]),{traslado:true,revision:true})).toEqual([{productoId:1,cantidad:12,disponible:10}]);
 expect(faltaStock([l(6),l(6)],new Map([[1,4]]))).toEqual([]);
});
