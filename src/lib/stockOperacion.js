import {peticionAcotada} from './peticionAcotada';
import {stockDespachable} from './stockSucursal';

export async function consultarStockSistema(cliente,productoIds,sucursalId) {
  const ids=[...new Set(productoIds.map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))];
  if(!ids.length||!Number(sucursalId))throw new Error('No se pudo identificar el producto o la sucursal para consultar stock.');
  const filas=[],inicio=Date.now();
  for(let grupo=0;grupo<ids.length;grupo+=100){
    for(let offset=0;;offset+=500){
      const ms=15000-(Date.now()-inicio);
      if(ms<=0)throw new Error('La consulta de stock tardó demasiado. Actualiza el stock para reintentar.');
      const {data,error}=await peticionAcotada(cliente.from('stock_actual')
        .select('producto_id, cantidad_base, ubicacion:ubicacion_id!inner(sucursal_id, excluye_disponible)')
        .in('producto_id',ids.slice(grupo,grupo+100)).eq('ubicacion.sucursal_id',Number(sucursalId))
        .gt('cantidad_base',0).order('producto_id').order('ubicacion_id').range(offset,offset+499),
      {ms,mensaje:'No se pudo consultar el stock a tiempo. No significa que esté en cero. Actualiza el stock para reintentar.'});
      if(error)throw new Error('No se pudo consultar el stock en sistema. Actualiza el stock para reintentar.');
      if(!Array.isArray(data)||data.some(r=>r.cantidad_base==null||!Number.isFinite(Number(r.cantidad_base))||!r.ubicacion||!Number.isSafeInteger(Number(r.producto_id))))throw new Error('La consulta de stock quedó incompleta. Actualiza el stock para reintentar.');
      filas.push(...data.map(r=>({...r,producto_id:Number(r.producto_id),ubicacion:{...r.ubicacion,sucursal_id:Number(r.ubicacion.sucursal_id)}})));
      if(data.length<500)break;
    }
  }
  const mapa=stockDespachable(filas,Number(sucursalId));
  // Sólo una consulta completa y exitosa permite interpretar ausencia como cero.
  for(const id of ids)if(!mapa.has(id))mapa.set(id,0);
  return mapa;
}

export function cantidadAlmacen(linea,traslado=false,revision=false) {
  if(traslado)return Number(revision?linea.revisada_base??linea.preparada_base:linea.preparada_base)||0;
  return (linea.origenes_declarados||[]).filter(o=>o.tipo==='ALMACEN').reduce((n,o)=>n+Number(o.cantidad_base),0);
}
export function faltaStock(lineas,mapa,{traslado=false,revision=false}={}) {
  const uso=new Map();
  for(const l of lineas.filter(l=>l.vigente)){
    const id=Number(l.reemplazo?.producto_id||l.snapshot.producto_id);
    uso.set(id,(uso.get(id)||0)+cantidadAlmacen(l,traslado,revision));
  }
  return [...uso].filter(([id,q])=>q>0&&(mapa.get(id)==null||q>mapa.get(id)+1e-6)).map(([id,q])=>({productoId:id,cantidad:q,disponible:mapa.get(id)}));
}
