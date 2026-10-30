import {useCallback,useEffect,useRef,useState} from 'react';
import {consultarStockSistema} from './stockOperacion';

export default function useStockSistema(cliente,ids,sucursalId,activo=true) {
  const clave=activo&&ids&&Number(sucursalId)?`${sucursalId}:${ids}`:'';
  const [datos,setDatos]=useState({clave:'',estado:'inactivo',mapa:new Map()});
  const generacion=useRef({version:0});
  const consultar=useCallback(async()=>{
    const g=++generacion.current.version;
    if(!clave)return null;
    setDatos(prev=>({...prev,clave,estado:'cargando',error:''}));
    try{
      const mapa=await consultarStockSistema(cliente,ids.split(','),sucursalId);
      if(g===generacion.current.version)setDatos({clave,estado:'listo',mapa,actualizado:new Date(),error:''});
      return mapa;
    }catch(e){if(g===generacion.current.version)setDatos(prev=>({...prev,clave,estado:'error',error:e.message}));throw e;}
  },[clave,cliente,ids,sucursalId]);
  useEffect(()=>{
    // Consulta externa inicial; cada actualización invalida respuestas anteriores.
    const registro=generacion.current;
    if(clave)void consultar().catch(()=>{});
    return()=>{registro.version++;};
  },[clave,consultar]);
  const actual=datos.clave===clave?datos:{estado:clave?'cargando':'inactivo',mapa:new Map()};
  return {...actual,consultar,reintentar:()=>{void consultar().catch(()=>{});}};
}
