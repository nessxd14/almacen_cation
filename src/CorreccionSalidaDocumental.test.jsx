// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import CorreccionSalidaDocumental from './CorreccionSalidaDocumental';
const qa=vi.hoisted(()=>({rol:'operario',rpc:vi.fn()}));
vi.mock('./lib/useAuth',()=>({useUsuarioActual:()=>({rol:qa.rol})}));
vi.mock('./supabaseClient',()=>({supabase:{rpc:qa.rpc}}));
let root,node;const actualizado=vi.fn();
async function mount(evento={id:1}){await act(async()=>root.render(<CorreccionSalidaDocumental evento={evento} onCorregido={actualizado}/>));}
async function click(label){await act(async()=>node.querySelector(`button[aria-label="${label}"]`).click());}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;qa.rol='operario';qa.rpc.mockReset();actualizado.mockReset();node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
it('reserva la corrección al encargado y conserva el motivo de los eventos corregidos',async()=>{await mount();expect(node.querySelector('button')).toBeNull();await mount({id:1,revertido:true,correccion_documental_motivo:'Retorno completo'});expect(node.textContent).toContain('Retorno completo');});
it('conserva la clave y el motivo para recuperar una corrección con respuesta perdida',async()=>{
  qa.rol='admin';qa.rpc.mockResolvedValueOnce({error:{message:'Respuesta perdida'}}).mockResolvedValueOnce({data:{cantidad_despachada:4}});await mount();await click('Corregir salida documental');const el=node.querySelector('input');await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Retorno completo');el.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('Confirmar corrección documental');expect(node.textContent).toContain('Respuesta perdida');expect(actualizado).not.toHaveBeenCalled();await click('Confirmar corrección documental');expect(qa.rpc.mock.calls[0]).toEqual(qa.rpc.mock.calls[1]);expect(actualizado).toHaveBeenCalledWith({cantidad_despachada:4});
});
