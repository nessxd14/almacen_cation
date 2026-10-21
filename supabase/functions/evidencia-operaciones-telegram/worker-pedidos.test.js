// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest';
import {enviarPedido,manejarPedidosWorker} from './worker-pedidos.js';

const config={activo:true,chat_id:'-1003058173908',tema_id:9};
const photo={message_id:1,chat:{id:Number(config.chat_id)},message_thread_id:9,photo:[{file_id:'qa',file_unique_id:'qa-1'}]};
const mensaje=n=>({message_id:n,chat:photo.chat,message_thread_id:9,text:'Detalle QA'});
let admin,fetchImpl,lote,server,call,download;
const ok=r=>Response.json({ok:true,result:r});
beforeEach(()=>{
  lote={id:'qa',lease:'reserva',tipo:'PEDIDO',entrega_id:10,caption:'📦 Alistado QA',rutas:['qa/1.jpg'],mensajes:['✅ Producto 1 · 12 cajas','⚠️ Producto 2 · 3 de 5 paquetes'],mensajes_telegram:{}};
  server=structuredClone(lote);
  call=vi.fn().mockImplementation(async(_,{p_accion,p_datos})=>{
    if(p_accion==='guardar_fotos')server.fotos_telegram=p_datos.telegram;
    if(p_accion==='guardar_mensaje')server.mensajes_telegram[String(p_datos.orden)]=p_datos.telegram;
    return {data:{ok:true},error:null};
  });
  download=vi.fn().mockResolvedValue({data:new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'}),error:null});
  admin={rpc:call,storage:{from:()=>({download,remove:vi.fn()})}};
  let numero=2;fetchImpl=vi.fn().mockImplementation(async url=>url.endsWith('/sendPhoto')?ok(photo):ok(mensaje(numero++)));
});
const enviar=()=>enviarPedido({admin,fetchImpl,token:'TOKEN_QA',config,lote});
it('publica fotos y todo el detalle por partes con recibos separados en el tema Pedidos',async()=>{
  expect(await enviar()).toBe('enviado');
  expect(fetchImpl.mock.calls.map(([url])=>url.split('/').at(-1))).toEqual(['sendPhoto','sendMessage','sendMessage']);
  expect(fetchImpl.mock.calls[1][1].body.get('text')).toContain('Detalle 1/2');
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body.get('reply_parameters')).message_id).toBe(1);
  expect(fetchImpl.mock.calls[2][1].body.get('text')).toContain('⚠️ Producto 2');
  expect(fetchImpl.mock.calls.every(([,r])=>r.body.get('message_thread_id')==='9')).toBe(true);
  expect(call.mock.calls.map(([,p])=>p.p_accion)).toEqual(['guardar_fotos','guardar_mensaje','guardar_mensaje','confirmar']);
});
it('después de un rechazo continúa desde el detalle pendiente sin repetir fotos ni mensajes confirmados',async()=>{
  fetchImpl.mockResolvedValueOnce(ok(photo)).mockResolvedValueOnce(ok(mensaje(2))).mockResolvedValueOnce(Response.json({ok:false,parameters:{retry_after:60}},{status:429}));
  expect(await enviar()).toBe('error');expect(server.fotos_telegram).toHaveLength(1);expect(server.mensajes_telegram['0'].message_id).toBe(2);
  lote=structuredClone(server);fetchImpl.mockClear();expect(await enviar()).toBe('enviado');expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0]).toMatch(/sendMessage$/);expect(fetchImpl.mock.calls[0][1].body.get('text')).toContain('Detalle 2/2');
});
it('un timeout de un detalle deja incierto el envío y no continúa con más mensajes',async()=>{
  fetchImpl.mockResolvedValueOnce(ok(photo)).mockRejectedValueOnce(new Error('timeout TOKEN_QA'));
  expect(await enviar()).toBe('incierto');expect(fetchImpl).toHaveBeenCalledTimes(2);expect(call.mock.calls.at(-1)[1].p_accion).toBe('incierto');
});
it('si no puede guardar un recibo no repite la publicación ni manda la siguiente parte',async()=>{
  call.mockResolvedValue({error:{message:'red'}});await expect(enviar()).rejects.toThrow('confirmación');
  expect(fetchImpl).toHaveBeenCalledTimes(1);expect(call).toHaveBeenCalledTimes(3);
});
it('rechaza un recibo de otro tema',async()=>{
  fetchImpl.mockResolvedValueOnce(ok({...photo,message_thread_id:17226}));expect(await enviar()).toBe('incierto');
  expect(call.mock.calls.at(-1)[1].p_accion).toBe('incierto');
});
it('el worker no expone el token ni envía nada cuando falla su autorización',async()=>{
  call.mockResolvedValue({data:{autorizado:false},error:null});
  const r=await manejarPedidosWorker(new Request('https://qa.invalid',{method:'POST',body:'{}'}),{admin,fetchImpl,token:'TOKEN_QA'});
  expect(r.status).toBe(401);expect(await r.text()).not.toContain('TOKEN_QA');expect(fetchImpl).not.toHaveBeenCalled();
});
