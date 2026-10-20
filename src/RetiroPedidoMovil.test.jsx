// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OperacionesMovilApp from './OperacionesMovilApp';

const qa = vi.hoisted(() => ({ rpc:vi.fn(), upload:vi.fn(), comprimir:vi.fn(), doc:null, evidencia:null, perder:false }));
vi.mock('./supabaseClient', () => ({ supabase:{ rpc:qa.rpc, storage:{from:()=>({upload:qa.upload})}, from:()=>{
  const q={select:()=>q,in:()=>q,eq:()=>q,order:()=>q,then:r=>Promise.resolve({data:[],error:null}).then(r)};return q;
}} }));
vi.mock('./lib/evidenciaVtd', async original => ({ ...await original(), comprimirFotoVtd:qa.comprimir }));
vi.mock('./lib/useAuth', () => ({useAuth:()=>({usuario:{id:'tercero',nombre:'Luis QA',rol:'operario',sucursalId:1}})}));
vi.mock('./lib/useSucursal', () => ({useSucursal:()=>({sucursalActivaId:1,sucursales:[{id:1,nombre:'Almacén QA',tipo:'fisica'}],cargando:false,puedeElegir:false})}));
let node,root;
const boton = nombre => [...node.querySelectorAll('button')].find(b=>b.textContent.trim()===nombre);
const retiroCalls = () => qa.rpc.mock.calls.filter(([n,p])=>n==='operar_evidencia_operacion' && p.p_accion==='retirar');
async function mount(tipo='pedido') { await act(async()=>root.render(<MemoryRouter initialEntries={['/operaciones/901']}><Routes><Route path="/operaciones/:id" element={<OperacionesMovilApp tipoDocumento={tipo}/>}/></Routes></MemoryRouter>)); }
async function click(nombre) { await act(async()=>boton(nombre).click()); }
async function prepararRetiro() {
  const destino=node.querySelector('input[maxlength="300"]');
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(destino,'Obra QA');destino.dispatchEvent(new Event('input',{bubbles:true}));});
  const fotos=node.querySelector('input[multiple]');
  Object.defineProperty(fotos,'files',{configurable:true,value:[new File(['foto'],'retiro.jpg',{type:'image/jpeg'})]});
  await act(async()=>fotos.dispatchEvent(new Event('change',{bubbles:true})));
}
beforeEach(()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  vi.stubGlobal('URL',class extends URL {static createObjectURL(){return 'blob:qa';} static revokeObjectURL(){}});
  qa.perder=false;qa.doc={pedido:{id:901,numero:'P-901',cliente:'Cliente QA',estado:'ABIERTO'},tarea:{id:10,estado:'DESPACHADO',version:8,preparador_id:'primero',revisor_id:'segundo'},lineas:[],eventos:[],cambios:[],entregada:true};
  qa.evidencia={activo:true,contexto:{puede_capturar:true},retiro:null,envios:[]};
  qa.upload.mockReset().mockResolvedValue({error:null});qa.comprimir.mockReset().mockResolvedValue(new Blob(['jpeg'],{type:'image/jpeg'}));
  qa.rpc.mockReset().mockImplementation(async(n,p)=>{
    if(n!=='operar_evidencia_operacion')return {data:structuredClone(qa.doc),error:null};
    if(p.p_accion==='crear')return {data:{id:p.p_datos.id,rutas:['tercero/lote/1.jpg'],subidas:[]},error:null};
    if(p.p_accion==='retirar'){
      qa.evidencia.retiro={preparacion_id:10,transportista_id:'tercero',transportista_nombre:'Luis QA',destino:p.p_datos.destino,estado:'EN_TRANSPORTE',retirado_en:'2026-10-20T12:00:00Z'};
      qa.evidencia.contexto.puede_capturar=false;
      if(qa.perder)return {data:null,error:{message:'Se perdió la respuesta'}};
    }
    return {data:structuredClone(qa.evidencia),error:null};
  });
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.unstubAllGlobals();});

it('el tercer responsable confirma destino y fotos con su propia sesión, sin otro despacho',async()=>{
  await mount();expect(boton('Confirmar retiro para transporte').disabled).toBe(true);
  await prepararRetiro();await click('Confirmar retiro para transporte');
  expect(retiroCalls()).toHaveLength(1);
  expect(retiroCalls()[0][1]).toMatchObject({p_tipo:'PEDIDO',p_documento_id:901,p_entrega_id:10,p_datos:{destino:'Obra QA',version:8,evidencia_id:expect.any(String)}});
  expect(Object.keys(retiroCalls()[0][1].p_datos).sort()).toEqual(['destino','evidencia_id','version']);
  expect(qa.upload.mock.calls[0][2].upsert).toBe(false);
  expect(node.textContent).toContain('En transporte');expect(node.textContent).toContain('Luis QA');
  expect(boton('Confirmar retiro para transporte')).toBeUndefined();
  expect(qa.rpc.mock.calls.filter(([,p])=>['despachar','autorizar'].includes(p.p_accion))).toHaveLength(0);
});
it('una respuesta perdida conserva la captura y recupera el retiro sin repetirlo ni subir fotos de nuevo',async()=>{
  qa.perder=true;await mount();await prepararRetiro();await click('Confirmar retiro para transporte');
  expect(node.textContent).toContain('Se perdió la respuesta');
  expect(node.querySelector('input[maxlength="300"]').disabled).toBe(true);
  await click('Confirmar retiro para transporte');
  expect(retiroCalls()).toHaveLength(1);expect(qa.upload).toHaveBeenCalledTimes(1);
  expect(node.textContent).toContain('En transporte');expect(node.textContent).not.toContain('Se perdió la respuesta');
});
it('quien preparó o revisó sólo consulta el retiro y no recibe controles de captura',async()=>{
  qa.evidencia.contexto.puede_capturar=false;await mount();
  expect(node.querySelector('input[type=file]')).toBeNull();expect(boton('Confirmar retiro para transporte')).toBeUndefined();
});
it('mantiene accesible una entrega parcial anterior mientras ya se prepara la siguiente',async()=>{
  qa.doc.tarea.estado='PREPARANDO';qa.doc.retiros_pendientes=[{id:8,preparador:'Ana QA',revisor:'José QA'}];
  await mount();
  expect(node.textContent).toContain('Otras entregas pendientes de retiro');
  expect(node.querySelector('a[href*="preparacion=8"]').href).toContain('/operaciones/pedidos/901?sucursal=1&preparacion=8');
});
it('un traslado pide fotos a su revisor sin presentar campos de transportista',async()=>{
  qa.doc={documento:{id:901,tipo:'traslado_virtual',numero:'TV-901',estado:'ABIERTO',sucursal_origen_id:1,sucursal_destino_id:2},tarea:{id:901,estado:'VERIFICADO',version:8,preparador_id:'primero',revisor_id:'tercero'},lineas:[],eventos:[],cambios:[],entregada:false};
  await mount('traslado_virtual');
  expect(boton('Autorizar salida hacia Tienda').disabled).toBe(true);
  expect(node.textContent).toContain('Fotos del traslado');expect(node.textContent).not.toContain('Retiro para transporte');
  expect(node.querySelector('input[maxlength="300"]')).toBeNull();expect(retiroCalls()).toHaveLength(0);
});
