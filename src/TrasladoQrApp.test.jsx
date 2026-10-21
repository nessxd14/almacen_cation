// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TrasladoQrApp from './TrasladoQrApp';

const mocks=vi.hoisted(()=>({rpc:vi.fn(),subir:vi.fn(),evidencia:vi.fn(),usuario:{id:'preparador',nombre:'Almacén QA'}}));
vi.mock('./supabaseClient',()=>({supabase:{}}));
vi.mock('./lib/useAuth',()=>({useAuth:()=>({usuario:mocks.usuario,signOut:vi.fn()})}));
vi.mock('./lib/trasladoQr',()=>({operarTrasladoQr:(...args)=>mocks.rpc(...args)}));
vi.mock('./lib/evidenciaOperacion',()=>({subirEvidenciaOperacion:(...args)=>mocks.subir(...args),operarEvidenciaOperacion:(...args)=>mocks.evidencia(...args)}));
vi.mock('./CodigoDocumentoQr',()=>({default:()=>null}));
vi.mock('./EvidenciaOperacion',async()=>{const {useEffect}=await import('react');return {default:function EvidenciaMock({onDatos,onFotos}){
 useEffect(()=>{onDatos({activo:true,contexto:{puede_capturar:true},envios:[]});},[onDatos]);
 return <button onClick={()=>onFotos([new File(['foto'],'foto.jpg',{type:'image/jpeg'})])}>Adjuntar foto de esta etapa</button>;
}};});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,estado;
const base=()=>({solicitud:{id:112,numero:'TRA-2026-00083',estado:'SOLICITADO',solicitado_por:'Caja QA'},origen:'Almacén',destino:'Tienda',habilitado:true,puede_alistar:true,puede_recibir:false,cambios:[],tarea:{solicitud_id:112,estado:'PREPARANDO',version:1,preparador_id:'preparador',preparador_nombre:'Almacén QA'},lineas:[{pedido_linea_id:1,vigente:true,confirmada:false,preparada_base:0,revisada_base:null,observacion:'',snapshot:{nombre:'Cuadernos',cantidad_base:24,pendiente_base:24,factor:12,presentacion:'Caja',unidad_base:'unidad',preparable:true}}]});
const button=texto=>[...container.querySelectorAll('button')].find(b=>b.textContent.includes(texto));
async function click(texto){await act(async()=>button(texto).click());}
async function render(){await act(async()=>{root.render(<MemoryRouter initialEntries={['/operaciones/traslados/112?escanear=1']}><Routes><Route path="/operaciones/traslados/:id" element={<TrasladoQrApp/>}/></Routes></MemoryRouter>);});}
beforeEach(()=>{vi.clearAllMocks();mocks.usuario={id:'preparador',nombre:'Almacén QA'};estado=base();mocks.rpc.mockImplementation(async(_c,_id,accion)=>{
 if(accion==='confirmar_resto'){estado={...estado,tarea:{...estado.tarea,version:2},lineas:estado.lineas.map(l=>({...l,confirmada:true,preparada_base:24}))};}
 if(accion==='preparado'){estado={...estado,tarea:{...estado.tarea,estado:'PREPARADO',version:3}};}
 return estado;
});mocks.subir.mockImplementation(async(_c,datos)=>datos.loteId);mocks.evidencia.mockResolvedValue({activo:true,envios:[]});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
describe('Entrega de traslado con QR',()=>{
 it('precarga cajas, protege cambios sin guardar y exige fotos al terminar alistado',async()=>{
  await render();const input=container.querySelector('input[inputmode="decimal"]');expect(input.value).toBe('2');
  expect(button('Terminar alistado').disabled).toBe(true);
  await act(async()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'1');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(button('Todo lo demás preparado').disabled).toBe(true);await click('Cancelar ajuste');
  await click('Todo lo demás preparado');expect(button('Terminar alistado').disabled).toBe(true);
  await click('Adjuntar foto');await click('Terminar alistado');
  expect(mocks.subir).toHaveBeenCalledWith({},expect.objectContaining({tipo:'traslado',documentoId:'112',entregaId:'112',version:2}));
  expect(mocks.rpc).toHaveBeenCalledWith({},'112','preparado',2,{evidencia_id:expect.any(String)});
 });
 it('el receptor confirma en la entrega física; permite ver cantidades y otro responsable',async()=>{
  mocks.usuario={id:'receptor',nombre:'Tienda QA'};estado=base();estado.puede_recibir=true;estado.tarea={...estado.tarea,estado:'REVISANDO',receptor_id:'receptor',receptor_nombre:'Tienda QA'};estado.lineas[0]={...estado.lineas[0],confirmada:true,preparada_base:12,revisada_base:12};
  await render();expect(container.querySelector('input[inputmode="decimal"]').value).toBe('1');
  expect(button('Confirmar recepción y traslado').disabled).toBe(true);expect(container.textContent).toContain('al recibir los productos del almacenero');
  await click('Adjuntar foto');await click('Confirmar recepción y traslado');expect(mocks.rpc).toHaveBeenCalledWith({},'112','recibir',1,{evidencia_id:expect.any(String)});
 });
 it.each(['preparado','recibir'])('recupera una respuesta perdida de %s sin repetir confirmación ni fotos',async accion=>{
  estado=base();estado.lineas[0]={...estado.lineas[0],confirmada:true,preparada_base:24,revisada_base:24};
  if(accion==='recibir'){mocks.usuario={id:'receptor',nombre:'Tienda QA'};estado.tarea={...estado.tarea,estado:'REVISANDO',receptor_id:'receptor'};}
  mocks.rpc.mockImplementation(async(_c,_id,a)=>{if(a===accion){estado={...estado,tarea:{...estado.tarea,estado:accion==='recibir'?'RECIBIDO':'PREPARADO',version:2}};throw new TypeError('Se perdió la respuesta');}return estado;});
  mocks.evidencia.mockImplementation(async()=>({activo:true,envios:[{id:mocks.subir.mock.calls[0][1].loteId}]}));
  await render();await click('Adjuntar foto');const texto=accion==='recibir'?'Confirmar recepción y traslado':'Terminar alistado';await click(texto);await click(texto);
  expect(mocks.rpc.mock.calls.filter(c=>c[2]===accion)).toHaveLength(1);expect(mocks.subir).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('ya estaba guardada');
 });
});
