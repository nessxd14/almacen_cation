import { idOperacion } from './operacionesMovil';

export async function operarTrasladoQr(cliente, id, accion='consultar', version=null, datos={}) {
  if (!idOperacion(id)) throw new Error('La solicitud de traslado no es válida.');
  const {data,error}=await cliente.rpc('operar_traslado_qr',{p_solicitud_id:Number(id),p_accion:accion,p_version:version,p_datos:datos});
  if(error){const e=new Error(error.code==='PGRST202'?'El alistado por QR todavía no está disponible. Consulta este traslado en la bandeja de Traslados.':error.message);e.code=error.code;throw e;}
  if(!data?.solicitud)throw new Error('No se recibió la solicitud. Actualiza antes de continuar.');
  return data;
}
