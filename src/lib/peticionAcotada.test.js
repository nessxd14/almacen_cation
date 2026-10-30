import {afterEach,expect,it,vi} from 'vitest';
import {peticionAcotada} from './peticionAcotada';
afterEach(()=>vi.useRealTimers());
it('termina una consulta colgada y aborta la petición sin dejar timers',async()=>{
 vi.useFakeTimers();let signal;const builder={abortSignal:s=>{signal=s;return new Promise(()=>{});}};
 const promesa=peticionAcotada(builder,{ms:50});const comprobacion=expect(promesa).rejects.toMatchObject({code:'CLIENT_TIMEOUT',incierta:false});
 await vi.advanceTimersByTimeAsync(50);await comprobacion;expect(signal.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('una escritura sin respuesta conserva la condición incierta para recuperar antes de repetir',async()=>{
 vi.useFakeTimers();const promesa=peticionAcotada(new Promise(()=>{}),{ms:50,incierta:true});const comprobacion=expect(promesa).rejects.toMatchObject({code:'CLIENT_TIMEOUT',incierta:true});await vi.advanceTimersByTimeAsync(50);await comprobacion;
});
it('no transforma un error SQL en timeout y limpia el plazo al responder',async()=>{
 vi.useFakeTimers();const respuesta={data:null,error:{code:'P0001',message:'Stock insuficiente'}};expect(await peticionAcotada(Promise.resolve(respuesta))).toEqual(respuesta);expect(vi.getTimerCount()).toBe(0);
});
