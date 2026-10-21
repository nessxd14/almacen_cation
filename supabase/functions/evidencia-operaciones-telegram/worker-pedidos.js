import { comprobarBot, enviarLote, limpiarFotos } from '../evidencia-vtd-telegram/worker.js';

const RPC = 'worker_evidencia_operacion';
const BUCKET = 'evidencias_operaciones';
async function rpc(admin, accion, datos={}) {
  const {data,error}=await admin.rpc(RPC,{p_accion:accion,p_datos:datos});
  if(error)throw new Error('No se pudo guardar la confirmación.');
  return data;
}
async function guardar(admin,accion,datos) {
  for(let i=0;i<3;i++) {
    try { return await rpc(admin,accion,datos); }
    catch { if(i===2)throw new Error('Comprueba la confirmación antes de repetir el envío.'); }
  }
}
const recibo = m => ({message_id:m.message_id,...(m.photo?.length?{file_id:m.photo.at(-1).file_id,file_unique_id:m.photo.at(-1).file_unique_id}:{})});
function mensajeValido(m,config) {
  return Number.isSafeInteger(m?.message_id) && String(m.chat?.id)===config.chat_id && m.message_thread_id===Number(config.tema_id);
}

// Cada respuesta positiva se guarda antes de publicar la siguiente parte.
// Un rechazo permite continuar; un resultado desconocido exige revisión.
export async function enviarPedido({admin,fetchImpl=fetch,token,config,lote}) {
  const base={id:lote.id,lease:lote.lease};
  let fotos=lote.fotos_telegram;
  async function publicar(metodo,body,validar) {
    let response,data;
    try {
      response=await fetchImpl(`https://api.telegram.org/bot${token}/${metodo}`,{method:'POST',body,signal:AbortSignal.timeout(40000)});
      data=await response.json();
      if(response.status>=500)throw new Error('Resultado desconocido');
      if(data.ok && !validar(data.result))throw new Error('Confirmación incompleta');
    } catch {
      await rpc(admin,'incierto',base);return {estado:'incierto'};
    }
    if(!data.ok) {
      await rpc(admin,'error',{...base,retry_after:Number(data.parameters?.retry_after)||null});return {estado:'error'};
    }
    return {resultado:data.result};
  }
  if(!fotos) {
    const archivos=[];
    try {
      for(const ruta of lote.rutas) {
        const {data,error}=await admin.storage.from(BUCKET).download(ruta);
        if(error || !data?.size || data.size>1048576 || data.type!=='image/jpeg')throw new Error('Foto no disponible');
        const magic=new Uint8Array(await data.slice(0,3).arrayBuffer());
        if(magic[0]!==255 || magic[1]!==216 || magic[2]!==255)throw new Error('JPEG inválido');
        archivos.push(data);
      }
    } catch { await rpc(admin,'error',base);return 'error'; }
    const body=new FormData();body.set('chat_id',config.chat_id);body.set('message_thread_id',String(config.tema_id));
    const una=archivos.length===1;
    if(una){body.set('photo',archivos[0],'evidencia.jpg');body.set('caption',lote.caption);}
    else {
      body.set('media',JSON.stringify(archivos.map((_,i)=>({type:'photo',media:`attach://foto${i}`,...(i===0?{caption:lote.caption}:{})}))));
      archivos.forEach((f,i)=>body.set(`foto${i}`,f,`evidencia-${i+1}.jpg`));
    }
    const r=await publicar(una?'sendPhoto':'sendMediaGroup',body,resultado=>{
      const mensajes=una?[resultado]:resultado;
      return Array.isArray(mensajes) && mensajes.length===archivos.length && mensajes.every(m=>mensajeValido(m,config) && m.photo?.length);
    });
    if(r.estado)return r.estado;
    fotos=(una?[r.resultado]:r.resultado).map(recibo);
    await guardar(admin,'guardar_fotos',{...base,telegram:fotos});
  }
  for(let i=0;i<lote.mensajes.length;i++) {
    if(lote.mensajes_telegram?.[String(i)])continue;
    const texto=`📋 ${lote.etapa==='PREPARACION'?'Alistado':'Salida'} · Detalle ${i+1}/${lote.mensajes.length} · Entrega #${lote.entrega_id}\n${lote.mensajes[i]}`;
    if(texto.length>4096)throw new Error('El detalle supera el límite de Telegram.');
    const body=new URLSearchParams({chat_id:config.chat_id,message_thread_id:String(config.tema_id),text:texto,
      reply_parameters:JSON.stringify({message_id:fotos[0].message_id,allow_sending_without_reply:true})});
    const r=await publicar('sendMessage',body,m=>mensajeValido(m,config) && typeof m.text==='string');
    if(r.estado)return r.estado;
    await guardar(admin,'guardar_mensaje',{...base,orden:i,telegram:recibo(r.resultado)});
  }
  await guardar(admin,'confirmar',{...base,telegram:fotos});return 'enviado';
}

export async function manejarPedidosWorker(req,{admin,token,fetchImpl=fetch}) {
  if(req.method!=='POST')return Response.json({error:'Método no permitido.'},{status:405});
  if(Number(req.headers.get('content-length'))>4096)return Response.json({error:'Solicitud inválida.'},{status:413});
  let body;
  try {const raw=await req.text();if(raw.length>4096)throw new Error();body=JSON.parse(raw);}
  catch {return Response.json({error:'Solicitud inválida.'},{status:400});}
  try {
    if(!(await rpc(admin,'autorizar',{token:typeof body?.token==='string'?body.token:''}))?.autorizado)return Response.json({error:'No autorizado.'},{status:401});
    const config=await rpc(admin,'configuracion');
    if(body.accion==='diagnostico')return Response.json({ok:true,pedidos_dos_actores:true,...await comprobarBot(fetchImpl,token,config)});
    const borrados=await limpiarFotos(admin,{rpcName:RPC,bucket:BUCKET});
    if(!config.activo)return Response.json({ok:true,activo:false,borrados});
    await comprobarBot(fetchImpl,token,config);
    const resultados=[];
    for(let i=0;i<2;i++) {
      const lote=await rpc(admin,'reclamar');if(!lote)break;
      const destino=lote.chat_id?{...config,chat_id:lote.chat_id,tema_id:lote.tema_id}:config;
      resultados.push(lote.tipo==='PEDIDO' && lote.mensajes?.length
        ?await enviarPedido({admin,token,fetchImpl,config:destino,lote})
        :await enviarLote({admin,token,fetchImpl,config:destino,lote,rpcName:RPC,bucket:BUCKET}));
    }
    return Response.json({ok:true,resultados,borrados});
  } catch {
    // No devolver errores de fetch: la URL podría contener el token del bot.
    return Response.json({error:'No se pudo completar el envío. Las evidencias se conservan.'},{status:503});
  }
}
