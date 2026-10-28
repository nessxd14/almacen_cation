// @vitest-environment happy-dom
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {env} from 'node:process';
import PedidoTarjetas from './PedidoTarjetas';
import OrigenesPendientesPedido from './OrigenesPendientesPedido';

vi.mock('./TypeaheadProducto',()=>({default:()=>null}));
vi.mock('./supabaseClient',()=>({supabase:{from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,then:resolve=>Promise.resolve({data:[{id:1,codigo_zona:'A-01'}],error:null}).then(resolve)};return q;}}}));
let node,root,accion;
const inicial=()=>[{pedido_linea_id:1,vigente:true,confirmada:false,preparada_base:0,revisada_base:null,snapshot:{producto_id:1,nombre:'Resma de papel carta',sku:'PAP-CARTA',factor:12,presentacion:'Caja',unidad_base:'unidades',pendiente_base:24,imagen_url:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="500" height="280" viewBox="0 0 500 280"%3E%3Crect width="500" height="280" fill="%23edf4f4"/%3E%3Cpath d="M155 70h175v145H155z" fill="white" stroke="%23c6d4d7" stroke-width="3"/%3E%3Cpath d="M175 50h175v145H175z" fill="white" stroke="%239fb7bd" stroke-width="3"/%3E%3Cpath d="M175 145h175v50H175z" fill="%230e7b70"/%3E%3Ctext x="262" y="176" text-anchor="middle" font-size="19" fill="white" font-family="Arial"%3EPAPEL CARTA%3C/text%3E%3C/svg%3E'}},{pedido_linea_id:2,vigente:true,confirmada:false,preparada_base:0,revisada_base:null,snapshot:{es_personalizado:true,nombre:'Cartulina verde especial',factor:1,unidad_base:'unidades',pendiente_base:5}}];
function Harness({fallar=false,revision=false}){
  const [lineas,setLineas]=useState(()=>inicial().map(l=>revision?{...l,confirmada:true,preparada_base:l.pedido_linea_id===1?12:0}:l));
  return <PedidoTarjetas lineas={lineas} revision={revision} ocupado={false} numeroTanda={2} ubicaciones={{1:[{id:1,codigo_zona:'A-01',estante:'B',nivel:'2'}]}} setEditor={()=>{}} accion={async(nombre,payload)=>{
    accion(nombre,payload);if(fallar)return false;
    setLineas(ls=>ls.map(l=>l.pedido_linea_id===payload.linea_id?{...l,...(nombre==='guardar_revision'?{revisada_base:payload.cantidad_base}:{preparada_base:payload.cantidad_base,confirmada:nombre!=='registrar_incidencia',incidencia_pendiente:nombre==='registrar_incidencia'}),observacion:payload.observacion}:l));return true;
  }}/>;
}
const boton=nombre=>[...node.querySelectorAll('button')].find(b=>b.textContent.trim()===nombre);
const click=async nombre=>act(async()=>boton(nombre).click());
async function cambiar(el,value){await act(async()=>{const p=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
const campo=label=>[...node.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)).querySelector('input,select');
const enviar=async()=>act(async()=>node.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
function captura(nombre){if(!env.CATION_QA_OUTPUT)return;const copia=node.cloneNode(true);node.querySelectorAll('select').forEach((select,i)=>{const options=copia.querySelectorAll('select')[i].options;for(let j=0;j<options.length;j++)if(j===select.selectedIndex)options[j].setAttribute('selected','');else options[j].removeAttribute('selected');});writeFileSync(`${env.CATION_QA_OUTPUT}/tarjetas-${nombre}.html`,`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pedidos · QA ficticia</title><style>body{margin:0;background:#f4f7f9;font-family:Arial,sans-serif;padding:0;box-sizing:border-box}${readFileSync('src/operaciones-movil.css','utf8')}${readFileSync('src/pedido-tarjetas.css','utf8')}</style><body><main class="om-app">${copia.innerHTML}</main></body></html>`);}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;accion=vi.fn();node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
it('muestra foto, ubicación, presentación y permite volver a corregir una tarjeta',async()=>{
  await act(async()=>root.render(<Harness/>));expect(node.querySelector('img').alt).toBe('Resma de papel carta');expect(node.textContent).toContain('2 Caja');expect(node.textContent).toContain('A-01');captura('alistado');
  await click('Alistado completo');expect(accion).toHaveBeenCalledWith('guardar_preparacion',{linea_id:1,cantidad_base:24});expect(node.textContent).toContain('Ítem personalizado');captura('personalizado');
  await click('Anterior');expect(node.querySelector('h3').textContent).toBe('Resma de papel carta');
});
it('guarda el problema y continúa; lo pendiente se resuelve al terminar',async()=>{
  await act(async()=>root.render(<Harness/>));await click('Hay un problema');await cambiar(campo('Cantidad disponible'),'1');await enviar();
  expect(accion.mock.calls[0]).toEqual(['registrar_incidencia',{linea_id:1,cantidad_base:12,observacion:'Solo hay una parte'}]);expect(node.textContent).toContain('Ítem personalizado');
  await click('Alistado completo');expect(node.textContent).toContain('Resolver pendientes');captura('pendientes');
  const pendiente=[...node.querySelectorAll('.pt-lista>button')].find(b=>b.textContent.includes('Resma'));await act(async()=>pendiente.click());await click('Resolver este producto');await enviar();
  expect(accion.mock.calls.at(-1)).toEqual(['guardar_preparacion',{linea_id:1,cantidad_base:12,observacion:'Solo hay una parte',pendiente_tipo:'POR_COMPLETAR'}]);expect(node.textContent).toContain('Recorrido terminado');
});
it('conserva la tarjeta y los datos cuando falla el guardado',async()=>{
  await act(async()=>root.render(<Harness fallar/>));await click('Hay un problema');await cambiar(campo('Cantidad disponible'),'1');await enviar();
  expect(node.querySelector('h3').textContent).toBe('Resma de papel carta');expect(campo('Cantidad disponible').value).toBe('1');expect(node.textContent).toContain('No se guardó');
});
it('el gesto horizontal confirma y el gesto vertical conserva la tarjeta',async()=>{
  await act(async()=>root.render(<Harness/>));const card=node.querySelector('article');
  const gesto=async(x,y)=>act(async()=>{card.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:40,clientY:40}));card.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:x,clientY:y}));});
  await gesto(70,190);expect(accion).not.toHaveBeenCalled();await gesto(170,45);expect(accion).toHaveBeenCalledTimes(1);
});
it('la revisión puede ajustar cantidades e incluir un producto que llegó después',async()=>{
  await act(async()=>root.render(<Harness revision/>));await click('Ajustar salida');await cambiar(campo('Cantidad que sale'),'2');await enviar();
  expect(accion.mock.calls[0][1]).toMatchObject({linea_id:1,cantidad_base:24,metodo:'visual'});await click('Verificado · sale');
  expect(accion.mock.calls.at(-1)[1]).toMatchObject({linea_id:2,cantidad_base:5,observacion:'Material disponible al retirar'});
});
it('permite declarar una combinación de los tres orígenes después de la salida',async()=>{
  await act(async()=>root.render(<OrigenesPendientesPedido pendientes={[{linea_id:1,nombre:'Resma carta',producto_id:1,cantidad_base:8,unidad_base:'unidades'}]} puedeDeclarar ocupado={false} accion={accion} sucursalId={1} sucursales={[{id:2,nombre:'Tienda central',tipo:'fisica'}]} setEditor={()=>{}}/>));
  await click('Declarar origen');await cambiar(campo('De Almacén'),'4');await cambiar(campo('De Tienda'),'2');await cambiar(campo('Comprado'),'2');await cambiar(campo('Ubicación de Almacén'),'1');await cambiar(campo('Tienda de origen'),'2');await cambiar(campo('Proveedor'),'Proveedor QA');captura('origen-mixto');await enviar();
  expect(accion).toHaveBeenCalledWith('declarar_origen',{linea_id:1,origenes:[{tipo:'ALMACEN',cantidad_base:4,ubicacion_id:1},{tipo:'TIENDA',cantidad_base:2,sucursal_tienda_id:2,referencia:'Tienda central'},{tipo:'COMPRA_RAPIDA',cantidad_base:2,referencia:'Proveedor QA'}]});
});
