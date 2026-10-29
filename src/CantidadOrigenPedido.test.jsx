// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import CantidadOrigenPedido from './CantidadOrigenPedido';

let node,root,guardar;
const linea=(almacen=0)=>({snapshot:{nombre:'Trijet azul',pendiente_base:10,factor:1,unidad_base:'unidades'},propuesta_almacen_base:almacen});
const campo=texto=>[...node.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(texto)).querySelector('input');
async function cambiar(texto,valor){await act(async()=>{const el=campo(texto);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,valor);el.dispatchEvent(new Event('input',{bubbles:true}));});}
const enviar=()=>act(async()=>node.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;guardar=vi.fn().mockResolvedValue(true);node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
it('propone Almacén sin pedir nuevamente su procedencia y calcula el faltante',async()=>{
  await act(async()=>root.render(<CantidadOrigenPedido linea={linea(6)} guardar={guardar}/>));
  expect(campo('De Almacén').value).toBe('6');expect(node.textContent).toContain('Pendiente de compra: 4 unidades');
  await enviar();expect(guardar).toHaveBeenCalledWith('guardar_alistado',{almacen_base:6,externa_base:0,observacion:''});
});
it('permite enviar ocho comprados de diez solicitados y conserva dos por comprar',async()=>{
  await act(async()=>root.render(<CantidadOrigenPedido linea={linea()} guardar={guardar}/>));
  await cambiar('Conseguido por fuera','8');await cambiar('Proveedor o procedencia','Proveedor QA');
  expect(node.textContent).toContain('Preparado: 8 unidades');expect(node.textContent).toContain('Pendiente de compra: 2 unidades');
  await enviar();expect(guardar).toHaveBeenCalledWith('guardar_alistado',{almacen_base:0,externa_base:8,observacion:'',tipo_externo:'COMPRA_RAPIDA',referencia:'Proveedor QA'});
});
it('conserva cero y cero como pendiente y no ofrece rechazar la venta',async()=>{
  await act(async()=>root.render(<CantidadOrigenPedido linea={linea()} guardar={guardar}/>));
  expect(node.textContent).toContain('No sale esta línea. Sigue pendiente');
  await enviar();expect(guardar).toHaveBeenCalledWith('guardar_alistado',{almacen_base:0,externa_base:0,observacion:''});
});
it('impide guardar más de lo solicitado y conserva los valores ante error',async()=>{
  guardar.mockResolvedValue(false);await act(async()=>root.render(<CantidadOrigenPedido linea={linea(6)} guardar={guardar}/>));
  await cambiar('Conseguido por fuera','5');await enviar();expect(guardar).not.toHaveBeenCalled();
  await cambiar('Conseguido por fuera','2');await cambiar('Proveedor o procedencia','Proveedor QA');await enviar();
  expect(campo('Conseguido por fuera').value).toBe('2');expect(node.textContent).toContain('Conservamos tus cantidades');
});
