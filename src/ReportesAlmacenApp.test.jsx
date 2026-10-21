// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import ReportesAlmacenApp from './ReportesAlmacenApp';

const qa=vi.hoisted(()=>({rpc:vi.fn(),print:vi.fn(),detalle:null}));
vi.mock('./lib/useAuth',()=>({useUsuarioActual:()=>({id:'usuario-qa',rol:'almacenero'})}));
vi.mock('./lib/useSucursal',()=>({useSucursal:()=>({sucursalActivaId:1,nombreSucursal:()=> 'Almacén QA'})}));
vi.mock('./lib/useAppNav',()=>({useAppNav:()=>({irAConteo:vi.fn()})}));
vi.mock('./lib/reportesAlmacen',()=>({operarReporte:qa.rpc}));
vi.mock('./lib/reporteTurno',async original=>({...await original(),imprimirHojaConteo:qa.print}));
let node,root;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const button=text=>[...node.querySelectorAll('button')].find(b=>b.textContent===text);
const click=async text=>{await act(async()=>button(text).click());};
const input=async (selector,value)=>{await act(async()=>{const el=node.querySelector(selector);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});};
const submit=async text=>{await act(async()=>button(text).closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));};
function snapshot(name) { if(env.REPORTES_QA_DIR) {mkdirSync(env.REPORTES_QA_DIR,{recursive:true});writeFileSync(`${env.REPORTES_QA_DIR}/${name}.html`,node.innerHTML);} }
beforeEach(()=>{
  qa.detalle={reporte:{id:1,folio:'AT-20261019-1',fecha:'2026-10-19',turno:'MANANA',estado:'BORRADOR',version:2,responsable:'Cuenta QA',creado_por:'usuario-qa',sucursal_id:1,sucursal:'Almacén QA',editable:true},
    lineas:[{id:1,numero:1,producto_id:1,ubicacion_id:1,nombre:'Bolígrafos azul punta fina',sku:'QA-01',unidad:'unidad',ubicacion:'PLANTA BAJA / Estante A / 1',empaque:'Caja x12',factor:12,origen:'MOVIMIENTO',empaques:null,sueltas:null,contado_en:null,esperado:null,declarado:null,observacion:''}],eventos:[]};
  qa.rpc.mockReset().mockImplementation(async action=> {
    if(action==='inicio')return {reportes:[]};
    return structuredClone(qa.detalle);
  });qa.print.mockReset().mockResolvedValue();
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.restoreAllMocks();});
describe('reportes de almacén',()=>{
  it('genera folio, imprime y transcribe cajas con la hora física antes de entregar',async()=>{
    await act(async()=>root.render(<ReportesAlmacenApp/>));snapshot('inicio');
    await click('Generar hoja de conteo');snapshot('captura');
    expect(node.textContent).not.toContain('107');
    await click('Imprimir / Guardar PDF');expect(qa.print).toHaveBeenCalledWith(qa.detalle,{recepcion:false});
    await input('#captura-1-empaques','8');await input('#captura-1-sueltas','9');
    expect(button('Confirmar captura y comparar').disabled).toBe(true);
    await input('#captura-1-hora','2026-10-19T12:00');
    await submit('Guardar cantidades del papel');
    expect(qa.rpc.mock.calls.find(c=>c[0]==='guardar')[2]).toMatchObject({version:2,lineas:[{id:1,empaques:8,sueltas:9,contado_en:'2026-10-19T16:00:00.000Z'}]});
  });
  it('no guarda una casilla parcial como cero ni entrega cantidades sin guardar',async()=>{
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#captura-1-sueltas','0');await submit('Guardar cantidades del papel');
    expect(node.querySelector('[role=alert]').textContent).toContain('Completa las cantidades');
    expect(qa.rpc.mock.calls.some(c=>c[0]==='guardar')).toBe(false);
  });
  it('conserva lo escrito cuando el servidor rechaza una versión desactualizada',async()=>{
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#captura-1-empaques','0');await input('#captura-1-sueltas','0');await input('#captura-1-hora','2026-10-19T12:00');
    qa.rpc.mockImplementation(async action=>{if(action==='guardar')throw new Error('El reporte cambió. Vuelve a abrirlo antes de guardar.');return {reportes:[]};});
    await submit('Guardar cantidades del papel');
    expect(node.querySelector('#captura-1-sueltas').value).toBe('0');
    expect(node.textContent).toContain('El reporte cambió');
  });
  it('muestra diferencias entregadas y no permite que el autor reciba su propio reporte',async()=>{
    qa.detalle.reporte={...qa.detalle.reporte,editable:false,estado:'ENTREGADO'};
    qa.detalle.lineas[0]={...qa.detalle.lineas[0],declarado:105,esperado:107,empaques:8,sueltas:9,contado_en:'2026-10-19T16:00:00Z',pendiente:true};
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');snapshot('entregado');
    expect(node.textContent).toContain('-2 unidad');expect(button('Recibir reporte con sus observaciones')).toBeUndefined();
    expect(button('Abrir conteo controlado')).toBeTruthy();
  });
});
