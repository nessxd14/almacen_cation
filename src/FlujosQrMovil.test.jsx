// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import OperacionesMovilApp from './OperacionesMovilApp';

const qa = vi.hoisted(() => ({ rpc:vi.fn(), qr:vi.fn(), rol:'vendedor', id:'vende', sucursal:2, codigo:'', doc:null, fallo:'' }));
vi.mock('./supabaseClient', () => ({ supabase:{rpc:qa.rpc,from:() => {
  const q={select:()=>q,in:()=>q,eq:()=>q,order:()=>q,then:r=>Promise.resolve({data:[],error:null}).then(r)};return q;
}} }));
vi.mock('./lib/useAuth', () => ({useAuth:()=>({usuario:{id:qa.id,nombre:'Persona QA',rol:qa.rol,sucursalId:qa.sucursal}})}));
vi.mock('./lib/useSucursal', () => ({useSucursal:()=>({sucursalActivaId:qa.sucursal,sucursales:[{id:1,nombre:'Almacén QA',tipo:'fisica'},{id:2,nombre:'Tienda QA',tipo:'fisica'}],cargando:false,puedeElegir:false})}));
vi.mock('./EscanerCodigo', () => ({default:({onDetect})=><button onClick={()=>{onDetect(qa.codigo);onDetect('/productos/999/ficha');}}>Leer QA</button>}));
vi.mock('qrcode', () => ({default:{toDataURL:qa.qr}}));
let node,root;
const button = nombre => [...node.querySelectorAll('button')].find(b=>b.textContent.trim()===nombre);
const field = nombre => [...node.querySelectorAll('label')].find(l=>l.textContent.startsWith(nombre))?.querySelector('input,textarea,select');
const click = async nombre => act(async()=>button(nombre).click());
const change = async (el,value) => act(async()=>{
  const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
});
const submit = async nombre => act(async()=>button(nombre).closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
const mount = async ruta => act(async()=>root.render(<MemoryRouter initialEntries={[ruta]}><Routes>
  <Route path="/operaciones/carrito" element={<OperacionesMovilApp tipoDocumento="carrito"/>}/>
  <Route path="/operaciones/carrito/:id" element={<OperacionesMovilApp tipoDocumento="carrito"/>}/>
  <Route path="/operaciones/traslados-virtuales/:id" element={<OperacionesMovilApp tipoDocumento="traslado_virtual"/>}/>
  <Route path="/operaciones/vtd/:id" element={<OperacionesMovilApp tipoDocumento="vtd"/>}/>
  <Route path="/operaciones/pedidos/:id" element={<OperacionesMovilApp/>}/>
</Routes></MemoryRouter>));
const calls = accion => qa.rpc.mock.calls.filter(([,p])=>p.p_accion===accion);
const data = () => structuredClone(qa.doc);
function capture(name){
  if(!env.CATION_QA_OUTPUT)return;
  const copy=node.cloneNode(true);
  for(const [i,el] of [...node.querySelectorAll('select,input,textarea')].entries()){
    const target=copy.querySelectorAll('select,input,textarea')[i];
    if(el.tagName==='SELECT')for(const [j,option] of [...target.options].entries()){if(j===el.selectedIndex)option.setAttribute('selected','');else option.removeAttribute('selected');}
    else if(el.tagName==='TEXTAREA')target.textContent=el.value;
    else target.setAttribute('value',el.value);
  }
  const css=readFileSync('src/operaciones-movil.css','utf8');
  writeFileSync(`${env.CATION_QA_OUTPUT}/qr-${name}.html`,`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}${css}</style><body>${copy.innerHTML}</body></html>`);
}
beforeEach(()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;qa.id='vende';qa.rol='vendedor';qa.sucursal=2;qa.fallo='';
  qa.codigo='/productos/1/ficha?sucursal=1&presentacion=2';
  qa.doc={documento:{id:9,numero:'TV-9',estado:'ABIERTO',cliente:'Destino: Tienda QA',tipo:'traslado_virtual',sucursal_origen_id:1,sucursal_destino_id:2},tarea:{id:9,tipo:'TRASLADO_VIRTUAL',sucursal_origen_id:1,sucursal_destino_id:2,estado:'BORRADOR',version:1,preparador_id:'vende',preparador_nombre:'Persona QA'},lineas:[],eventos:[],cambios:[],entregada:false};
  qa.qr.mockReset().mockResolvedValue('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=');
  qa.rpc.mockReset().mockImplementation(async(_,p)=>{
    if(qa.fallo && ['agregar','enviar','autorizar'].includes(p.p_accion))return {data:null,error:{message:qa.fallo}};
    if(p.p_accion==='contexto')return {data:{sucursales:[{id:1,nombre:'Almacén QA'},{id:2,nombre:'Tienda QA'}],sucursal_asignada_id:qa.sucursal},error:null};
    if(p.p_accion==='producto')return {data:{producto:{id:1,nombre:'Bolígrafos QA',sku:'QA-1',unidad_base:'UNIDAD'},presentacion_id:2,presentaciones:[{id:1,nombre:'Unidad',factor:1,es_base:true},{id:2,nombre:'Caja',factor:12}],ubicaciones:[{id:1,nombre:'A · 01',cantidad_base:100}]},error:null};
    return {data:data(),error:null};
  });
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
const linea = () => ({id:10,producto_id:1,presentacion_id:2,ubicacion_origen_id:1,declarada_base:24,preparada_base:24,confirmada:true,vigente:true,revisada_base:null,snapshot:{producto_id:1,nombre:'Bolígrafos QA',sku:'QA-1',unidad_base:'UNIDAD',presentacion_id:2,presentacion:'Caja',factor:12,pendiente_base:24,preparable:true,ubicacion:'A · 01'}});

it('escanea la ficha existente una vez y declara dos cajas en la ubicación correcta',async()=>{
  await mount('/operaciones/carrito');expect(field('Tienda destino').disabled).toBe(true);
  await submit('Comenzar carrito');expect(calls('crear')[0][1].p_datos).toEqual({sucursal_origen_id:1,sucursal_destino_id:2});
  await click('Escanear producto o ubicación');await click('Leer QA');expect(calls('producto')).toHaveLength(1);
  expect(calls('producto')[0][1].p_datos.codigo).toBe(qa.codigo);expect(field('Presentación').value).toBe('2');
  await change(field('Cantidad que'), '2');capture('carrito-articulo');qa.doc.lineas=[linea()];qa.doc.tarea.version=2;
  await submit('Añadir al carrito');expect(calls('agregar')[0][1]).toMatchObject({p_version:1,p_datos:{producto_id:1,presentacion_id:2,ubicacion_id:1,cantidad_base:24}});
  expect(node.textContent).toContain('Origen: A · 01');capture('carrito');
});
it('conserva la cantidad y no anuncia guardado cuando falla el servidor',async()=>{
  await mount('/operaciones/carrito');await submit('Comenzar carrito');await change(field('QR o barras'),qa.codigo);await submit('Añadir código');
  await change(field('Cantidad que'), '2');qa.fallo='La operación cambió en otro celular';await submit('Añadir al carrito');
  expect(field('Cantidad que').value).toBe('2');expect(node.textContent).toContain('otro celular');expect(node.textContent).not.toContain('Carrito guardado');
});
it('rechaza una ubicación de otra sucursal sin consultar productos',async()=>{
  await mount('/operaciones/carrito');await submit('Comenzar carrito');await change(field('QR o barras'),'/ubicaciones/3/ficha?sucursal=2');await submit('Añadir código');
  expect(node.textContent).toContain('otra sucursal');expect(calls('producto')).toHaveLength(0);
});
it('el carrito enviado presenta su QR y el vendedor no puede autorizar la salida',async()=>{
  qa.doc.lineas=[linea()];await mount('/operaciones/carrito/9');qa.doc.tarea.estado='PREPARADO';qa.doc.tarea.version=3;await click('Terminar alistado y enviar a verificar');
  expect(calls('enviar')[0][1].p_version).toBe(1);expect(qa.qr).toHaveBeenCalledWith('https://almacen-cation.vercel.app/operaciones/traslados-virtuales/9?escanear=1',expect.any(Object));
  expect(node.querySelector('img')?.alt).toContain('traslado virtual 9');expect(button('Autorizar salida hacia Tienda')).toBeUndefined();expect(node.textContent).toContain('otra persona de Almacén');capture('enviado');
});
it('el escaneo VTD toma el rol una vez y actualizar sólo consulta',async()=>{
  qa.id='prepara';qa.rol='almacenero';qa.sucursal=1;qa.doc.documento={id:38,numero:'VTD-2026-00038',tipo:'vtd',estado:'ABIERTO',sucursal_origen_id:1,pago:'POR COBRAR'};qa.doc.tarea={...qa.doc.tarea,estado:'PREPARANDO',preparador_id:'prepara'};
  await mount('/operaciones/vtd/38?escanear=1');expect(calls('escanear')[0][1]).toMatchObject({p_tipo:'VTD',p_documento_id:'38'});await click('Actualizar');expect(calls('escanear')).toHaveLength(1);expect(calls('consultar')).toHaveLength(1);expect(node.textContent).toContain('POR COBRAR');
});
it('la VTD verificada puede autorizarse sólo por su verificador y conserva el bloqueo de cobro',async()=>{
  qa.id='verifica';qa.rol='operario';qa.sucursal=1;qa.doc.documento={...qa.doc.documento,tipo:'vtd',numero:'VTD-2026-00038'};qa.doc.tarea={...qa.doc.tarea,estado:'VERIFICADO',preparador_id:'prepara',revisor_id:'verifica',version:7};qa.doc.lineas=[{...linea(),revisada_base:24}];
  await mount('/operaciones/vtd/38');qa.fallo='Debe cobrarse en Caja';await click('Autorizar salida y entregar VTD');expect(calls('autorizar')[0][1]).toMatchObject({p_tipo:'VTD',p_version:7});expect(button('Autorizar salida y entregar VTD')).toBeTruthy();expect(node.textContent).toContain('Debe cobrarse');
});
it('un vendedor no consulta pedidos ni VTD con una URL directa',async()=>{
  await mount('/operaciones/vtd/38');expect(qa.rpc).not.toHaveBeenCalled();expect(node.textContent).toContain('Los pedidos y VTD los prepara Almacén');
});
it('la recepción exige contar cada línea antes de guardar',async()=>{
  qa.id='recibe';qa.rol='operario';qa.sucursal=2;qa.doc.tarea={...qa.doc.tarea,estado:'EN_TRANSITO',preparador_id:'vende',revisor_id:'verifica',version:9};qa.doc.documento={...qa.doc.documento,estado:'COMPLETADO',traslado_id:77,traslado_estado:'EN_TRANSITO'};qa.doc.entregada=true;qa.doc.lineas=[linea()];qa.doc.recepcion=[{id:42,nombre:'Bolígrafos QA',cantidad_base:24,unidad_base:'UNIDAD'}];
  await mount('/operaciones/traslados-virtuales/9');await submit('Confirmar recepción');expect(calls('recibir')).toHaveLength(0);
  await change(field('Bolígrafos QA'), '24');await submit('Confirmar recepción');expect(calls('recibir')[0][1]).toMatchObject({p_version:9,p_datos:{lineas:[{linea_id:42,cantidad_base:24}]}});capture('recepcion');
});
