// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {env} from 'node:process';
import AbastecimientoLinea,{ResumenEntregasPedido} from './AbastecimientoLinea';
import CantidadPedido from './CantidadPedido';

let root,node,props;
const button=label=>node.querySelector(`button[aria-label="${label}"]`)||[...node.querySelectorAll('button')].find(b=>b.textContent.trim()===label);
const click=async label=>act(async()=>button(label).click());
const input=label=>node.querySelector(`[aria-label="${label}"]`);
async function change(el,value){await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
async function mount(component=<AbastecimientoLinea {...props}/>){await act(async()=>root.render(<MemoryRouter>{component}</MemoryRouter>));}
function capture(name){if(env.CATION_QA_OUTPUT)writeFileSync(`${env.CATION_QA_OUTPUT}/abastecimiento-${name}.html`,`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}${readFileSync('src/operaciones-movil.css','utf8')}${readFileSync('src/preparacion-checklist.css','utf8')}</style><body><main class="om-app"><article class="om-linea"><h3>Papel Bond Millenium</h3>${node.innerHTML}</article></main></body></html>`);}
beforeEach(()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;node=document.createElement('div');document.body.append(node);root=createRoot(node);
  props={linea:{pedido_linea_id:12,preparada_base:0,confirmada:false,origenes_preparacion:[],recepciones:[],snapshot:{nombre:'Papel Bond Millenium',marca:'Millenium',pendiente_base:10,cantidad_base:10,factor:1,presentacion:'Resma',unidad_base:'RESMA'}},puedeEditar:true,abierta:true,onAbrir:vi.fn(),onCerrar:vi.fn(),onGuardar:vi.fn().mockResolvedValue(true),onComprobante:vi.fn(),sucursales:[{id:1,tipo:'fisica',nombre:'Almacén'},{id:2,tipo:'fisica',nombre:'Tienda Centro'}],sucursalId:1};
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});

it('mantiene una sola operación compacta y abre cinco iconos con nombres accesibles',async()=>{
  props.abierta=false;await mount();expect(node.querySelectorAll('button')).toHaveLength(1);expect(button('Origen / resolver faltante').textContent).toBe('');await click('Origen / resolver faltante');expect(props.onAbrir).toHaveBeenCalledOnce();
  props.abierta=true;await mount();const actions=input('Acción de abastecimiento');expect(actions.querySelectorAll('button')).toHaveLength(5);expect(actions.querySelector('button[aria-pressed="true"]').getAttribute('title')).toBe('Alistar por origen');capture('origenes');
});
it('declara material recibido de Tienda sin aprobación ni acciones de traslado',async()=>{
  await mount();await click('Traído de Tienda');await change(input('Cantidad de abastecimiento'),'3');await click('Recibido para este pedido');
  expect(props.onGuardar).toHaveBeenCalledWith('registrar_abastecimiento',expect.objectContaining({tipo:'TIENDA',cantidad_base:3,sucursal_tienda_id:2,referencia:'Tienda Centro',id:expect.any(String)}));expect(props.onCerrar).toHaveBeenCalledOnce();
});
it('precarga la marca y permite Tercero para un personalizado sin costo ni comprobante',async()=>{
  props.linea.snapshot.es_personalizado=true;await mount();await click('Compra rápida para este pedido');expect(input('Marca o proveedor').value).toBe('Millenium');expect(input('Cantidad de abastecimiento').value).toBe('10');await click('Tercero');await change(input('Cantidad de abastecimiento'),'2');capture('rapida');await click('Recibido para este pedido');
  expect(props.onGuardar).toHaveBeenCalledWith('registrar_abastecimiento',expect.objectContaining({tipo:'COMPRA_RAPIDA',cantidad_base:2,referencia:'Tercero',costo:null,comprobante_en_alistado:false}));
});
it('conserva la clave y los datos de recepción al reintentar una respuesta perdida',async()=>{
  props.onGuardar.mockResolvedValueOnce(false);await mount();await click('Compra rápida para este pedido');await click('Recibido para este pedido');expect(node.textContent).toContain('Conservamos tus datos');expect(props.onCerrar).not.toHaveBeenCalled();await click('Recibido para este pedido');expect(props.onGuardar.mock.calls[0]).toEqual(props.onGuardar.mock.calls[1]);
});
it('adjunta el comprobante opcional a las fotos habituales sólo después de guardar la recepción',async()=>{
  await mount();await click('Compra rápida para este pedido');const file=new File(['jpg'],'ticket.jpg',{type:'image/jpeg'});const el=input('Comprobante de compra rápida');Object.defineProperty(el,'files',{value:[file]});await act(async()=>el.dispatchEvent(new Event('change',{bubbles:true})));await click('Recibido para este pedido');expect(props.onComprobante).toHaveBeenCalledWith(file);expect(props.onGuardar.mock.calls[0][1].comprobante_en_alistado).toBe(true);
});
it('exige situación y motivo para una entrega parcial y guarda las cantidades por origen',async()=>{
  props.linea.recepciones=[{id:'rec-1',tipo:'TIENDA',referencia:'Centro',saldo:3}];await mount();await change(input('Cantidad de Almacén'),'4');await click('Guardar alistado');expect(props.onGuardar).not.toHaveBeenCalled();await change(input('Situación del faltante'),'COMPRA_GESTIONADA');await change(node.querySelector('input[maxlength="1000"]'),'Faltan tres');await click('Guardar alistado');
  expect(props.onGuardar).toHaveBeenCalledWith('guardar_preparacion',expect.objectContaining({cantidad_base:7,pendiente_tipo:'COMPRA_GESTIONADA',origenes:[{tipo:'TIENDA',recepcion_id:'rec-1',cantidad_base:3},{tipo:'ALMACEN',cantidad_base:4}]}));
});
it('permite al verificador ajustar cada origen con motivo sin registrar nuevos abastecimientos',async()=>{
  props.revision=true;props.linea.confirmada=true;props.linea.preparada_base=6;props.linea.origenes_preparacion=[{tipo:'COMPRA_RAPIDA',recepcion_id:'rec-2',referencia:'Tercero',cantidad_base:6}];props.linea.recepciones=[{id:'rec-2',tipo:'COMPRA_RAPIDA',referencia:'Tercero',saldo:6}];await mount();expect(input('Acción de abastecimiento')).toBeNull();await change(input('Cantidad de Tercero'),'4');await change(node.querySelector('input[maxlength="1000"]'),'Dos quedan para después');capture('revision');await click('Guardar verificación');expect(props.onGuardar).toHaveBeenCalledWith('guardar_revision',expect.objectContaining({cantidad_base:4,observacion:'Dos quedan para después',origenes:[{tipo:'COMPRA_RAPIDA',recepcion_id:'rec-2',cantidad_base:4}]}));
});
it('mantiene el pedido y enlaces a cada entrega en su historial',async()=>{
  await mount(<ResumenEntregasPedido datos={{numero_entrega:2,tarea:{id:7},resumen_pedido:{estado:'PARCIAL',entregas:[{id:6,numero:1,estado:'DESPACHADO',preparador:'Ana',revisor:'Luis'},{id:7,numero:2,estado:'PREPARANDO'}]}}} pedidoId={731} sucursalId={1}/>);expect(node.textContent).toContain('Envío parcial · pendiente de completar');expect([...node.querySelectorAll('a')].map(a=>a.getAttribute('href'))).toEqual(['/operaciones/pedidos/731?sucursal=1&preparacion=6','/operaciones/pedidos/731?sucursal=1&preparacion=7']);
});
it('el ajuste rápido conserva el conducto del faltante además de su motivo',async()=>{
  await mount(<CantidadPedido linea={props.linea} abastecimiento onEditar={()=>{}} onCancelar={()=>{}} onGuardar={props.onGuardar}/>);await change(input('Cantidad alistada de Papel Bond Millenium'),'9');await change(node.querySelector('input[maxlength="1000"]'),'Una se compra');await click('Guardar ajuste');expect(props.onGuardar).not.toHaveBeenCalled();await change(input('Situación pendiente de Papel Bond Millenium'),'COMPRA_GESTIONADA');await click('Guardar ajuste');expect(props.onGuardar).toHaveBeenCalledWith(expect.objectContaining({cantidad_base:9,pendiente_tipo:'COMPRA_GESTIONADA'}));
});

it('el cero posterga la línea sin obligar a declarar una compra u origen',async()=>{
  props.linea.snapshot.preparable=true;
  await mount(<CantidadPedido linea={props.linea} abastecimiento onEditar={()=>{}} onCancelar={()=>{}} onGuardar={props.onGuardar}/>);
  await click('Dejar para otra entrega');expect(input('Cantidad alistada de Papel Bond Millenium').value).toBe('0');expect(node.textContent).toContain('No sale en esta entrega');
  await click('Se enviará después');await click('Guardar ajuste');
  expect(props.onGuardar).toHaveBeenCalledWith(expect.objectContaining({cantidad_base:0,pendiente_tipo:'POR_COMPLETAR',observacion:'Se enviará después'}));
});

it('reutiliza la recepción aunque antes se haya elegido existencia personalizada',async()=>{
  props.linea.snapshot.es_personalizado=true;props.linea.confirmada=true;props.linea.preparada_base=10;props.linea.origenes_preparacion=[{tipo:'EXISTENCIA_PERSONALIZADA',cantidad_base:10}];props.linea.recepciones=[{id:'rec-3',tipo:'COMPRA_RAPIDA',referencia:'Tercero',saldo:10}];
  await mount();expect(input('Cantidad de Almacén').value).toBe('0');expect(input('Cantidad de Tercero').value).toBe('10');await click('Guardar alistado');
  expect(props.onGuardar).toHaveBeenCalledWith('guardar_preparacion',expect.objectContaining({origenes:[{tipo:'COMPRA_RAPIDA',recepcion_id:'rec-3',cantidad_base:10}]}));
});
