// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {env} from 'node:process';
import OperacionesMovilApp from './OperacionesMovilApp';

const qa=vi.hoisted(()=>({rpc:vi.fn(),upload:vi.fn(),comprimir:vi.fn(),id:'prepara',doc:null,envios:[],perder:''}));
vi.mock('./lib/useAuth',()=>({useAuth:()=>({usuario:{id:qa.id,nombre:qa.id==='prepara'?'Ana QA':'Luis QA',rol:'operario',sucursalId:1}})}));
vi.mock('./lib/useSucursal',()=>({useSucursal:()=>({sucursalActivaId:1,sucursales:[{id:1,nombre:'Almacén QA',tipo:'fisica'}],cargando:false,puedeElegir:false})}));
vi.mock('./lib/evidenciaVtd',async original=>({...await original(),comprimirFotoVtd:qa.comprimir}));
vi.mock('./supabaseClient',()=>({supabase:{rpc:qa.rpc,storage:{from:()=>({upload:qa.upload})},from:()=>{
  const q={select:()=>q,in:()=>q,eq:()=>q,order:()=>q,then:r=>Promise.resolve({data:[],error:null}).then(r)};return q;
}}}));
let root,node;
const boton=nombre=>[...node.querySelectorAll('button')].find(b=>b.textContent.trim()===nombre);
const input=label=>node.querySelector(`input[aria-label="${label}"]`);
const click=async nombre=>act(async()=>boton(nombre).click());
async function change(el,value){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
async function fotos(){const el=node.querySelector('input[multiple]');Object.defineProperty(el,'files',{configurable:true,value:[new File(['jpeg'],'foto.jpg',{type:'image/jpeg'})]});await act(async()=>el.dispatchEvent(new Event('change',{bubbles:true})));}
async function mount(){await act(async()=>root.render(<MemoryRouter initialEntries={['/operaciones/pedidos/902']}><Routes><Route path="/operaciones/pedidos/:id" element={<OperacionesMovilApp/>}/></Routes></MemoryRouter>));}
const calls=accion=>qa.rpc.mock.calls.filter(([n,p])=>n==='operar_preparacion_pedido'&&p.p_accion===accion);
function capture(nombre){if(env.CATION_QA_OUTPUT)writeFileSync(`${env.CATION_QA_OUTPUT}/pedido-dos-${nombre}.html`,`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}${readFileSync('src/operaciones-movil.css','utf8')}${readFileSync('src/preparacion-checklist.css','utf8')}</style><body>${node.innerHTML}</body></html>`);}
beforeEach(()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;qa.id='prepara';qa.envios=[];qa.perder='';
  vi.stubGlobal('URL',class extends URL{static createObjectURL(){return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="lightblue"/></svg>';}static revokeObjectURL(){}});
  qa.doc={pedido_dos_actores:true,pedido:{id:902,numero:'PED-QA-DOS',cliente:'Cliente QA',estado:'ABIERTO'},tarea:{id:10,estado:'PREPARANDO',version:1,preparador_id:'prepara',preparador_nombre:'Ana QA',revisor_id:'revisa',revisor_nombre:'Luis QA'},eventos:[],cambios:[],entregada:false,plan_salida:[{linea_id:1,cantidad_base:12,asignaciones:[{ubicacion_id:1,nombre:'A · 01',cantidad_base:12}],error:null}],lineas:[1,2].map(id=>({pedido_linea_id:id,vigente:true,confirmada:false,preparada_base:0,revisada_base:null,observacion:'',snapshot:{producto_id:id,nombre:`Producto ${id}`,presentacion:'Caja',factor:12,unidad_base:'unidades',pendiente_base:24,preparable:true}}))};
  qa.upload.mockReset().mockResolvedValue({error:null});qa.comprimir.mockReset().mockResolvedValue(new Blob(['jpeg'],{type:'image/jpeg'}));
  qa.rpc.mockReset().mockImplementation(async(n,p)=>{
    if(n==='operar_evidencia_operacion')return {data:p.p_accion==='crear'?{id:p.p_datos.id,rutas:['qa/1.jpg'],subidas:[]}:{activo:true,contexto:{etapa:qa.doc.tarea.estado==='PREPARANDO'?'PREPARACION':'SALIDA',puede_capturar:true},envios:structuredClone(qa.envios),retiro:qa.doc.retiro||null},error:null};
    const accion=p.p_accion;
    if(accion==='confirmar_resto')qa.doc.lineas.forEach(l=>{if(!l.confirmada){l.preparada_base=l.snapshot.pendiente_base;l.confirmada=true;}});
    if(accion==='guardar_preparacion'){const l=qa.doc.lineas.find(l=>l.pedido_linea_id===p.p_datos.linea_id);Object.assign(l,{preparada_base:p.p_datos.cantidad_base,observacion:p.p_datos.observacion,confirmada:true});}
    if(accion==='guardar_revision'){const l=qa.doc.lineas.find(l=>l.pedido_linea_id===p.p_datos.linea_id);Object.assign(l,{revisada_base:p.p_datos.cantidad_base,observacion_revision:p.p_datos.observacion});}
    if(accion==='confirmar_resto_revision')qa.doc.lineas.forEach(l=>{if(l.revisada_base==null)l.revisada_base=l.preparada_base;});
    if(['guardar_revision','confirmar_resto_revision'].includes(accion))qa.doc.plan_salida=qa.doc.lineas.filter(l=>l.revisada_base>0).map(l=>({linea_id:l.pedido_linea_id,cantidad_base:l.revisada_base,asignaciones:[{ubicacion_id:l.pedido_linea_id,nombre:`A · 0${l.pedido_linea_id}`,cantidad_base:l.revisada_base}],error:null}));
    if(accion==='preparado'){qa.doc.tarea.estado='PREPARADO';qa.envios.push({id:p.p_datos.evidencia_id,estado:'PENDIENTE',cantidad:1,etapa:'PREPARACION'});}
    if(accion==='confirmar_retiro'){qa.doc.tarea.estado='DESPACHADO';qa.doc.retiro={preparacion_id:10,transportista_nombre:'Luis QA',destino:p.p_datos.destino,evidencia_id:p.p_datos.evidencia_id};qa.doc.entregada=true;qa.envios.push({id:p.p_datos.evidencia_id,estado:'PENDIENTE',cantidad:1,etapa:'SALIDA'});}
    if(accion!=='consultar')qa.doc.tarea.version++;
    if(qa.perder===accion)return {data:null,error:{message:'Respuesta perdida'}};
    return {data:structuredClone(qa.doc),error:null};
  });
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.unstubAllGlobals();});

it('precarga lo solicitado con teclado decimal y conserva ajustes antes del preparado rápido',async()=>{
  await mount();const qty=input('Cantidad alistada de Producto 1');expect(qty.value).toBe('2');expect(qty.inputMode).toBe('decimal');expect(qty.type).toBe('text');
  await change(qty,'1');expect(boton('Todo lo demás preparado').disabled).toBe(true);
  const motivo=[...node.querySelectorAll('label')].find(l=>l.textContent.startsWith('Motivo del faltante')).querySelector('input');await change(motivo,'Falta una caja');
  await click('Guardar ajuste');expect(calls('guardar_preparacion')[0][1].p_datos).toMatchObject({cantidad_base:12,observacion:'Falta una caja'});
  await click('Todo lo demás preparado');await click('Confirmar 1 línea');expect(calls('confirmar_resto')).toHaveLength(1);
  expect(input('Cantidad alistada de Producto 1').value).toBe('1');expect(input('Cantidad alistada de Producto 2').value).toBe('2');
  expect(node.textContent).toContain('Fotos del alistado');expect(boton('Enviar a verificación').disabled).toBe(true);await fotos();capture('alistador');await click('Enviar a verificación');
  expect(calls('preparado')[0][1].p_datos.evidencia_id).toBeTruthy();expect(node.textContent).toContain('Presenta el QR a otra persona');
});
it('precarga lo alistado, permite diferencias, verifica el resto y retira con el mismo usuario',async()=>{
  qa.id='revisa';qa.doc.tarea.estado='REVISANDO';qa.doc.lineas.forEach(l=>{l.confirmada=true;l.preparada_base=12;});
  await mount();expect(input('Cantidad a retirar de Producto 1').value).toBe('1');
  await change(input('Cantidad a retirar de Producto 1'),'0,5');
  const motivo=[...node.querySelectorAll('label')].find(l=>l.textContent.startsWith('Motivo de la diferencia')).querySelector('input');await change(motivo,'Se encontraron seis');await click('Guardar ajuste');
  await click('Todo lo demás coincide');expect(input('Cantidad a retirar de Producto 1').value).toBe('0.5');expect(qa.doc.lineas[0].revisada_base).toBe(6);
  expect(node.textContent).not.toContain('tercera persona');expect(boton('Confirmar revisión y retirar').disabled).toBe(true);
  await change(node.querySelector('input[maxlength="300"]'),'Obra QA');await fotos();capture('verificador');await click('Confirmar revisión y retirar');
  expect(calls('confirmar_retiro')[0][1].p_datos).toMatchObject({destino:'Obra QA',plan:qa.doc.plan_salida,evidencia_id:expect.any(String)});
  expect(node.textContent).toContain('Luis QA');expect(node.textContent).toContain('En transporte');expect(calls('verificado')).toHaveLength(0);
});
it('marca cero con No se alistó y exige guardar su motivo antes del atajo general',async()=>{
  await mount();await click('No se alistó');expect(input('Cantidad alistada de Producto 1').value).toBe('0');expect(boton('Todo lo demás preparado').disabled).toBe(true);
  await click('Guardar ajuste');expect(node.textContent).toContain('Indica el motivo del faltante');expect(calls('guardar_preparacion')).toHaveLength(0);
  const motivo=[...node.querySelectorAll('label')].find(l=>l.textContent.startsWith('Motivo del faltante')).querySelector('input');await change(motivo,'No encontrado');await click('Guardar ajuste');
  expect(calls('guardar_preparacion')[0][1].p_datos).toMatchObject({cantidad_base:0,observacion:'No encontrado'});
});
it('permite al revisor cerrar con fotos una entrega anterior ya despachada',async()=>{
  qa.id='revisa';qa.doc.tarea.estado='DESPACHADO';qa.doc.tarea.salida_previa=true;qa.doc.entregada=true;qa.doc.lineas.forEach(l=>{l.confirmada=true;l.preparada_base=24;l.revisada_base=24;});
  await mount();expect(node.textContent).toContain('no volverá a descontar stock');expect(node.querySelector('input[inputmode]')).toBeNull();
  await change(node.querySelector('input[maxlength="300"]'),'Destino previo');await fotos();await click('Confirmar revisión y retirar');expect(calls('confirmar_retiro')).toHaveLength(1);expect(node.textContent).toContain('En transporte');
});
it.each(['preparado','confirmar_retiro'])('recupera %s tras perder la respuesta sin volver a subir fotos ni confirmar',async accion=>{
  qa.perder=accion;qa.doc.lineas.forEach(l=>{l.confirmada=true;l.preparada_base=24;l.revisada_base=24;});
  if(accion==='confirmar_retiro'){qa.id='revisa';qa.doc.tarea.estado='REVISANDO';}
  await mount();if(accion==='confirmar_retiro')await change(node.querySelector('input[maxlength="300"]'),'Obra QA');await fotos();
  const nombre=accion==='preparado'?'Enviar a verificación':'Confirmar revisión y retirar';await click(nombre);expect(node.textContent).toContain('Respuesta perdida');
  await click(nombre);expect(calls(accion)).toHaveLength(1);expect(qa.upload).toHaveBeenCalledTimes(1);expect(node.textContent).toContain('Recuperamos esta entrega');
});
