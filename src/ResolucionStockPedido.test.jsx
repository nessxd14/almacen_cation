// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ResolucionStockPedido from './ResolucionStockPedido';
const qa=vi.hoisted(()=>({op:vi.fn(),sync:vi.fn(),comprimir:vi.fn()}));
vi.mock('./lib/conteoControlado',()=>({operarConteo:qa.op,sincronizarCaptura:qa.sync,dispositivoConteo:()=> 'dispositivo-qa'}));
vi.mock('./lib/evidenciaVtd',()=>({comprimirFotoVtd:qa.comprimir}));
let root,node,props,d;
const button=t=>[...node.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
const click=async t=>act(async()=>button(t).click());
async function change(label,value){const e=node.querySelector(`[aria-label="${label}"]`);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));});}
async function mount(){await act(async()=>root.render(<ResolucionStockPedido {...props}/>));}
beforeEach(()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;node=document.createElement('div');document.body.append(node);root=createRoot(node);
  props={linea:{snapshot:{producto_id:22,unidad_base:'UNIDADES'},stock_almacen:[{ubicacion_id:12,nombre:'Planta baja · A1',cantidad_base:-158,presentacion_base_id:22}]},encargado:true,usuarioId:'admin-qa',pedidoNumero:'QA-740',onActualizado:vi.fn(),onOcupado:vi.fn()};
  d={sesion:{id:50,estado:'CAPTURA',metodo:'SIMPLE',version:1},productos:[{producto_id:22,teorico:-158}],rondas:[],capturas:[]};
  qa.op.mockReset().mockImplementation(async accion=>{if(accion==='tomar_ronda')d.rondas=[{mia:true,dispositivo:'dispositivo-qa',finalizada:false}];if(accion==='finalizar_ronda'){d.sesion.estado='REVISION';d.productos[0].conteo_1=150;}if(accion==='aplicar')d.sesion.estado='APLICADA';if(accion!=='detalle')d.sesion.version++;return structuredClone(d);});
  qa.sync.mockReset().mockImplementation(async c=>{d.capturas=[{uuid:c.uuid,anulada:false}];return structuredClone(d);});qa.comprimir.mockReset().mockImplementation(async f=>f);
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
it('exige la cuenta de un encargado y no ofrece suplantar el rol',async()=>{
  props.encargado=false;await mount();expect(node.textContent).toContain('con su propia cuenta');expect(node.querySelectorAll('button')).toHaveLength(0);expect(qa.op).not.toHaveBeenCalled();
});
it('solicita total físico y foto sin inferir la existencia a partir del pedido',async()=>{
  await mount();await click('Iniciar conteo de esta ubicación');expect(node.querySelector('[aria-label="Total físico en la ubicación"]').value).toBe('');
  await change('Total físico en la ubicación','150');await click('Registrar y revisar conteo');expect(node.textContent).toContain('Adjunta la foto');expect(qa.sync).not.toHaveBeenCalled();
  const file=node.querySelector('[type=file]');Object.defineProperty(file,'files',{value:[new File(['jpeg'],'conteo.jpg',{type:'image/jpeg'})]});await act(async()=>file.dispatchEvent(new Event('change',{bubbles:true})));await click('Registrar y revisar conteo');
  expect(qa.sync.mock.calls[0][0].datos).toMatchObject({cantidad:150,presentacion_id:22});expect(node.textContent).toContain('150 UNIDADES');
  await change('Motivo del conteo','Diferencia comprobada físicamente');await click('Aplicar conteo y revalidar');expect(qa.op.mock.calls.some(c=>c[0]==='resolver')).toBe(false);
  await act(async()=>node.querySelector('[type=checkbox]').click());await click('Aplicar conteo y revalidar');expect(qa.op.mock.calls.map(c=>c[0])).toEqual(['crear','tomar_ronda','finalizar_ronda','detalle','detalle','resolver','aplicar']);expect(props.onActualizado).toHaveBeenCalledTimes(2);
});
it('continúa una captura guardada tras recargar sin duplicar foto ni cantidades',async()=>{
  props.linea.stock_almacen[0].conteo_id=50;d.rondas=[{mia:true,dispositivo:'dispositivo-qa',finalizada:false}];d.capturas=[{uuid:'ya-capturada',anulada:false}];await mount();await click('Continuar conteo');await click('Continuar con la captura guardada');expect(qa.sync).not.toHaveBeenCalled();expect(qa.op).toHaveBeenLastCalledWith('finalizar_ronda',50,expect.objectContaining({capturas:['ya-capturada']}));
});
it('conserva el alcance de un conteo activo de varios productos',async()=>{
  props.linea.stock_almacen[0].conteo_id=50;d.productos.push({producto_id:23});await mount();await click('Continuar conteo');expect(node.textContent).toContain('con su alcance original');expect(node.querySelector('input[inputmode]')).toBeNull();expect(qa.op.mock.calls.map(c=>c[0])).toEqual(['detalle']);
});
