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
const comoReponedor=extra=>{mocks.usuario={id:'reponedor',nombre:'Josias QA',rol:'reponedor'};estado={...estado,...extra};};
describe('Traslado para el reponedor',()=>{
 it('el botón de tomar la comprobación dice «Comprobar y retirar»',async()=>{
  comoReponedor({puede_alistar:false,puede_recibir:true,tarea:{...estado.tarea,estado:'PREPARADO',preparador_id:'otro'}});
  await render();expect(button('Comprobar y retirar')).toBeTruthy();expect(container.textContent).not.toContain('Comprobar lo que recibo');
 });
 it('el almacenero/receptor sin rol reponedor conserva «Comprobar lo que recibo»',async()=>{
  mocks.usuario={id:'receptor',nombre:'Tienda QA',rol:'vendedor'};
  estado={...estado,puede_alistar:false,puede_recibir:true,tarea:{...estado.tarea,estado:'PREPARADO',preparador_id:'otro'}};
  await render();expect(button('Comprobar lo que recibo')).toBeTruthy();expect(container.textContent).not.toContain('Comprobar y retirar');
 });
 it('mantiene el mensaje de espera mientras Almacén no alista',async()=>{
  comoReponedor({puede_alistar:false,puede_recibir:false,tarea:null});
  await render();expect(container.textContent).toContain('Almacén de origen debe alistar antes de que puedas recibir.');
 });
 it('al confirmar dice «Confirmar retiro» y avisa que el stock pasa a su nombre',async()=>{
  comoReponedor({puede_alistar:false,puede_recibir:true,tarea:{...estado.tarea,estado:'REVISANDO',preparador_id:'otro',receptor_id:'reponedor'}});
  estado.lineas[0]={...estado.lineas[0],confirmada:true,preparada_base:12};
  await render();await click('Completo · 1 Caja');await resumen();
  expect(container.textContent).toContain('Al confirmar, el stock pasa de Almacén a Tienda a tu nombre.');
  await click('Confirmar retiro');
  expect(mocks.rpc).toHaveBeenCalledWith(expect.anything(),'112','recibir',2,{evidencia_id:expect.any(String)});
 });
});
