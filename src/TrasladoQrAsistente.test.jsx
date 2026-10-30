// @vitest-environment happy-dom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import TrasladoQrApp from './TrasladoQrApp';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),subir:vi.fn(),evidencia:vi.fn(),stock:vi.fn(),usuario:{id:'preparador',nombre:'Almacén QA'}}));
vi.mock('./supabaseClient',()=>({supabase:{from:()=>{const q={select:()=>q,in:()=>q,eq:()=>q,gt:()=>q,order:()=>q,range:()=>mocks.stock()};return q;}}}));
vi.mock('./lib/useAuth',()=>({useAuth:()=>({usuario:mocks.usuario,signOut:vi.fn()})}));
vi.mock('./lib/trasladoQr',()=>({operarTrasladoQr:(...args)=>mocks.rpc(...args)}));
vi.mock('./lib/evidenciaOperacion',()=>({subirEvidenciaOperacion:(...args)=>mocks.subir(...args),operarEvidenciaOperacion:(...args)=>mocks.evidencia(...args)}));
vi.mock('./CodigoDocumentoQr',()=>({default:()=>null}));
vi.mock('./EvidenciaOperacion',async()=>{const {useEffect}=await import('react');return {default:function EvidenciaMock({onDatos,onFotos,fotos}){
 useEffect(()=>{onDatos({activo:true,contexto:{puede_capturar:true},envios:[]});},[onDatos]);
 return <><button onClick={()=>onFotos([new File(['foto'],'foto.jpg',{type:'image/jpeg'})])}>Adjuntar foto de esta etapa</button><p>Capturas conservadas: {fotos.length}</p></>;
}};});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,estado;
const base=()=>({solicitud:{id:112,numero:'TRA-QA-83',estado:'SOLICITADO',solicitado_por:'Caja QA',sucursal_origen_id:1,sucursal_destino_id:2},origen:'Almacén',destino:'Tienda',habilitado:true,puede_alistar:true,puede_recibir:false,cambios:[],tarea:{solicitud_id:112,estado:'PREPARANDO',version:1,preparador_id:'preparador',preparador_nombre:'Almacén QA'},lineas:[{pedido_linea_id:1,vigente:true,confirmada:false,preparada_base:0,revisada_base:null,observacion:'',snapshot:{producto_id:1,nombre:'Cuadernos',cantidad_base:24,pendiente_base:24,factor:12,presentacion:'Caja',unidad_base:'unidad',preparable:true}}]});
const button=texto=>[...container.querySelectorAll('button')].find(b=>b.textContent.includes(texto)&&!b.closest('[hidden]'));
async function click(texto){await act(async()=>{const b=button(texto);expect(b,`botón ${texto}`).toBeTruthy();b.click();});}
async function render(){await act(async()=>root.render(<MemoryRouter initialEntries={['/operaciones/traslados/112?escanear=1']}><Routes><Route path="/operaciones/traslados/:id" element={<TrasladoQrApp/>}/></Routes></MemoryRouter>));}
async function resumen(){await click('Continuar a fotos');await click('Adjuntar foto');await click(estado.tarea.estado==='REVISANDO'?'Revisar recepción':'Revisar alistado');}
beforeEach(()=>{
 vi.clearAllMocks();mocks.usuario={id:'preparador',nombre:'Almacén QA'};estado=base();
 mocks.stock.mockResolvedValue({data:[{producto_id:1,cantidad_base:48,ubicacion:{sucursal_id:1,excluye_disponible:false}}],error:null});
 mocks.rpc.mockImplementation(async(_c,_id,accion,_version,p)=>{
  if(['guardar_preparacion','guardar_revision'].includes(accion))estado={...estado,tarea:{...estado.tarea,version:estado.tarea.version+1},lineas:estado.lineas.map(l=>({...l,...(accion==='guardar_revision'?{revisada_base:p.cantidad_base}:{confirmada:true,preparada_base:p.cantidad_base})}))};
  if(accion==='preparado'||accion==='recibir')estado={...estado,tarea:{...estado.tarea,estado:accion==='preparado'?'PREPARADO':'RECIBIDO',version:estado.tarea.version+1}};
  return estado;
 });
 mocks.subir.mockImplementation(async(_c,datos)=>datos.loteId);mocks.evidencia.mockResolvedValue({activo:true,envios:[]});
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:qa');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
describe('Traslado con asistente y saldo registrado',()=>{
 it('no marca productos guardados al saltar una línea sin confirmar',async()=>{
  await render();await click('Siguiente');expect(container.textContent).toContain('Queda 1 producto por registrar');expect(container.textContent).not.toContain('Productos registrados. El avance quedó guardado.');expect(button('Continuar a fotos').disabled).toBe(true);await click('Continuar recorrido');expect(container.querySelector('input[inputmode="decimal"]').value).toBe('2');
 });
 it('precarga cajas, protege el borrador y exige fotos en los tres pasos',async()=>{
  await render();const input=container.querySelector('input[inputmode="decimal"]');expect(input.value).toBe('2');expect(button('Continuar a fotos').disabled).toBe(true);
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(button('Continuar a fotos').disabled).toBe(true);await click('Cancelar ajuste');expect(input.value).toBe('2');await click('Confirmar cantidad');
  await click('Continuar a fotos');expect(button('Revisar alistado').disabled).toBe(true);await click('Adjuntar foto');await click('Revisar alistado');await click('Terminar alistado');
  expect(mocks.subir).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({tipo:'traslado',documentoId:'112',version:2}));expect(estado.tarea.estado).toBe('PREPARADO');
 });
 it('recibe por etapas en el destino registrado sin cambiar el contrato de stock',async()=>{
  mocks.usuario={id:'receptor',nombre:'Tienda QA'};estado.tarea={...estado.tarea,estado:'REVISANDO',receptor_id:'receptor'};estado.lineas[0]={...estado.lineas[0],confirmada:true,preparada_base:12};
  await render();expect(container.querySelector('input[inputmode="decimal"]').value).toBe('1');await click('Confirmar cantidad');await resumen();
  expect(container.textContent).toContain('Tienda');expect(container.textContent).toContain('al recibir los productos del almacenero');await click('Confirmar recepción y traslado');
  expect(mocks.rpc).toHaveBeenCalledWith(expect.anything(),'112','recibir',2,{evidencia_id:expect.any(String)});
 });
 it.each(['preparado','recibir'])('recupera una respuesta perdida de %s sin repetir confirmación ni fotos',async accion=>{
  estado.lineas[0]={...estado.lineas[0],confirmada:true,preparada_base:24,revisada_base:24};
  if(accion==='recibir'){mocks.usuario={id:'receptor',nombre:'Tienda QA'};estado.tarea={...estado.tarea,estado:'REVISANDO',receptor_id:'receptor'};}
  mocks.rpc.mockImplementation(async(_c,_id,a)=>{if(a===accion){estado={...estado,tarea:{...estado.tarea,estado:accion==='recibir'?'RECIBIDO':'PREPARADO',version:2}};throw new TypeError('Se perdió la respuesta');}return estado;});
  mocks.evidencia.mockImplementation(async()=>({activo:true,envios:[{id:mocks.subir.mock.calls[0][1].loteId}]}));
  await render();await resumen();await click(accion==='recibir'?'Confirmar recepción y traslado':'Terminar alistado');await click('Reintentar confirmación');
  expect(mocks.rpc.mock.calls.filter(c=>c[2]===accion)).toHaveLength(1);expect(mocks.subir).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('ya estaba guardada');
 });
 it('avisa stock cero antes de subir fotos y libera la confirmación para corregir',async()=>{
  estado.lineas[0]={...estado.lineas[0],confirmada:true,preparada_base:24};mocks.stock.mockResolvedValue({data:[],error:null});
  await render();await resumen();await click('Terminar alistado');expect(container.textContent).toContain('no hay stock en sistema');expect(mocks.subir).not.toHaveBeenCalled();expect(button('Terminar alistado').disabled).toBe(false);
  await click('Volver a productos');await click('Cuadernos');expect(container.textContent).toContain('No hay stock disponible en sistema');expect(container.textContent).toContain('Capturas conservadas: 1');
 });
 it('no confunde un error de consulta con stock cero y permite actualizar',async()=>{
  mocks.stock.mockResolvedValue({data:null,error:{message:'sin conexión'}});await render();expect(container.textContent).toContain('No se considera stock cero');
  mocks.stock.mockResolvedValue({data:[{producto_id:1,cantidad_base:12,ubicacion:{sucursal_id:1}}],error:null});
  const actualizar=container.querySelector('button[aria-label="Actualizar stock de Cuadernos"]');await act(async()=>actualizar.click());expect(container.textContent).toContain('Stock insuficiente');expect(container.textContent).toContain('1 Caja');
 });
});
