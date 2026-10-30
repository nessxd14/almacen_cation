import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('../supabaseClient',()=>({supabase:{rpc:mocks.rpc}}));
import {despacharTraslado} from './operaciones';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('el despacho anterior devuelve el timeout como error y permite liberar su botón',async()=>{
 vi.useFakeTimers();mocks.rpc.mockReturnValue(new Promise(()=>{}));
 const resultado=despacharTraslado({solicitudId:1,lineas:[],usuario:'QA'});
 await vi.advanceTimersByTimeAsync(15000);
 expect(await resultado).toMatchObject({resultado:null,error:{code:'CLIENT_TIMEOUT',incierta:true}});
});
