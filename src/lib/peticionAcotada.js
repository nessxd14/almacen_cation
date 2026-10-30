// Un timeout de escritura es incierto: el servidor puede haber confirmado.
// El llamador conserva su lote/idempotencia y consulta antes de reintentar.
export async function peticionAcotada(peticion,{ms=15000,mensaje='La base de datos no respondió a tiempo. Conservamos el avance; actualiza y reintenta.',incierta=false}={}) {
  const controlador=new AbortController();
  let timer;
  try {
    const solicitud=typeof peticion.abortSignal==='function'?peticion.abortSignal(controlador.signal):peticion;
    return await Promise.race([Promise.resolve(solicitud),new Promise((_,rechazar)=>{
      timer=setTimeout(()=>{const e=new Error(mensaje);e.code='CLIENT_TIMEOUT';e.incierta=incierta;rechazar(e);controlador.abort();},ms);
    })]);
  }finally{clearTimeout(timer);}
}
