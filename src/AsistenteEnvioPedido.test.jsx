// @vitest-environment happy-dom
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import AsistenteEnvioPedido from './AsistenteEnvioPedido';

let root,node,confirmar;
const fila=(id=1,q=10)=>({pedido_linea_id:id,vigente:true,confirmada:true,preparada_base:q,revisada_base:null,origenes_declarados:q?[{tipo:'ALMACEN',cantidad_base:q}]:[],snapshot:{nombre:`Producto QA ${id}`,pendiente_base:10,factor:1,unidad_base:'unidades'}});
function Harness({revision=false,listas=false,cero=false}){
  const [lineas,setLineas]=useState(()=>cero?[fila(1,0)]:revision?[fila(),fila(2,0)]:[{...fila(),confirmada:listas,preparada_base:listas?10:0}]);
  const [fotos,setFotos]=useState([]),[destino,setDestino]=useState('');
  return <><button onClick={()=>setLineas(ls=>ls.map(l=>({...l,confirmada:false})))}>Invalidar línea QA</button><AsistenteEnvioPedido lineas={lineas} revision={revision} usuario="Ana QA" evidenciaLista fotos={fotos} destino={destino} onDestino={setDestino} onConfirmar={confirmar}
    onConfirmarNoSale={id=>setLineas(ls=>ls.map(l=>l.pedido_linea_id===id?{...l,revisada_base:0}:l))}
    renderProductos={({lineas:ls,lineaInicial})=><div><p>Edición: {lineaInicial||'ninguna'}</p>{ls.map(l=><button key={l.pedido_linea_id} onClick={()=>setLineas(actuales=>actuales.map(a=>a.pedido_linea_id===l.pedido_linea_id?{...a,confirmada:true,preparada_base:10,...(revision?{revisada_base:10}:{})}:a))}>{revision?'Coincide QA':'Preparar QA'}</button>)}</div>}
    evidencia={<section><button onClick={()=>setFotos([new File(['png'],'foto-qa.png',{type:'image/png'})])}>Adjuntar foto QA</button><p>Fotos conservadas: {fotos.length}</p></section>}/></>;
}
const boton=texto=>[...node.querySelectorAll('button')].find(b=>b.textContent.trim()===texto&&!b.closest('[hidden]'));
const click=texto=>act(async()=>{boton(texto).click();});
const paso=()=>[...node.querySelectorAll('[data-paso]')].find(n=>!n.hidden).dataset.paso;
async function destino(valor){await act(async()=>{const input=node.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,valor);input.dispatchEvent(new Event('input',{bubbles:true}));});}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;confirmar=vi.fn().mockResolvedValue(true);vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:qa');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.restoreAllMocks();});

it('ordena productos, fotos y confirmación sin permitir saltarse las comprobaciones',async()=>{
  await act(async()=>root.render(<Harness/>));expect(paso()).toBe('productos');expect(boton('Continuar a fotos').disabled).toBe(true);expect(boton('3Confirmar').disabled).toBe(true);
  await click('Preparar QA');await click('Continuar a fotos');expect(paso()).toBe('fotos');expect(boton('Revisar alistado').disabled).toBe(true);
  await click('Adjuntar foto QA');await click('Revisar alistado');expect(paso()).toBe('confirmar');
  expect(confirmar).not.toHaveBeenCalled();await click('Enviar a verificación');expect(confirmar).toHaveBeenCalledTimes(1);
});
it('volver y editar desde el resumen conserva las fotos y abre la línea elegida',async()=>{
  await act(async()=>root.render(<Harness listas/>));await click('Continuar a fotos');await click('Adjuntar foto QA');await click('Revisar alistado');
  const editar=node.querySelector('button[aria-label="Revisar Producto QA 1"]');await act(async()=>editar.click());expect(paso()).toBe('productos');expect(node.textContent).toContain('Edición: 1');
  await click('Continuar a fotos');expect(node.querySelector('[data-paso="fotos"]').textContent).toContain('Fotos conservadas: 1');
  expect(boton('Revisar alistado').disabled).toBe(false);
});
it('en verificación separa lo que no sale y exige fotos y destino',async()=>{
  await act(async()=>root.render(<Harness revision/>));await click('Coincide QA');expect(boton('Continuar a fotos y destino').disabled).toBe(true);
  await click('Confirmar que no sale');await click('Continuar a fotos y destino');await click('Adjuntar foto QA');expect(boton('Revisar salida').disabled).toBe(true);
  await destino('AB');expect(boton('Revisar salida').disabled).toBe(true);await destino('Obra QA');await click('Revisar salida');
  expect(paso()).toBe('confirmar');expect(node.querySelector('[data-paso="confirmar"]').textContent).toContain('Obra QA');await click('Verificar y registrar salida');expect(confirmar).toHaveBeenCalledTimes(1);
});
it('un fallo conserva el último paso y permite reintentar sin perder las fotos',async()=>{
  confirmar.mockResolvedValueOnce(false);await act(async()=>root.render(<Harness listas/>));await click('Continuar a fotos');await click('Adjuntar foto QA');await click('Revisar alistado');await click('Enviar a verificación');
  expect(paso()).toBe('confirmar');expect(node.textContent).toContain('Conservamos el avance y las fotos');expect(node.querySelector('[data-paso="confirmar"] img')).toBeTruthy();
  await click('Enviar a verificación');expect(confirmar).toHaveBeenCalledTimes(2);
});
it('ignora el doble toque mientras la confirmación está en curso',async()=>{
  let resolver;confirmar.mockImplementation(()=>new Promise(r=>{resolver=r;}));await act(async()=>root.render(<Harness listas/>));await click('Continuar a fotos');await click('Adjuntar foto QA');await click('Revisar alistado');
  await click('Enviar a verificación');await click('Enviar a verificación');expect(confirmar).toHaveBeenCalledTimes(1);await act(async()=>resolver(true));
});
it('si una línea se invalida mientras se confirma, vuelve a productos y bloquea la salida',async()=>{
  await act(async()=>root.render(<Harness listas/>));await click('Continuar a fotos');await click('Adjuntar foto QA');await click('Revisar alistado');await click('Invalidar línea QA');
  expect(paso()).toBe('productos');expect(boton('Continuar a fotos').disabled).toBe(true);expect(confirmar).not.toHaveBeenCalled();
});
it('cero y cero conserva el pedido pendiente y no permite avanzar con un envío vacío',async()=>{
  await act(async()=>root.render(<Harness cero/>));expect(paso()).toBe('productos');expect(boton('Continuar a fotos').disabled).toBe(true);
  expect(node.textContent).toContain('no se registra una salida vacía');expect(confirmar).not.toHaveBeenCalled();
});

it('bloquea una tanda migrada ya revisada hasta completar el origen, conservando la diferencia anterior',async()=>{
  const linea={...fila(),preparada_base:8,revisada_base:6,origenes_declarados:null};
  const props={revision:true,revisionAnterior:true,usuario:'Ana QA',renderProductos:()=>null,onConfirmar:confirmar};
  await act(async()=>root.render(<AsistenteEnvioPedido {...props} lineas={[linea]}/>));
  expect(boton('Continuar a fotos y destino').disabled).toBe(true);
  expect(node.textContent).toContain('sin repetir la revisión');
  await act(async()=>root.render(<AsistenteEnvioPedido {...props} lineas={[{...linea,origenes_declarados:[{tipo:'ALMACEN',cantidad_base:6}]}]}/>));
  expect(boton('Continuar a fotos y destino').disabled).toBe(false);
  expect(confirmar).not.toHaveBeenCalled();
});

it('conserva una revisión anterior de cero sin presentarla como material saliente',async()=>{
  const lineas=[{...fila(),preparada_base:8,revisada_base:6,origenes_declarados:[{tipo:'ALMACEN',cantidad_base:6}]},{...fila(2),preparada_base:4,revisada_base:0,origenes_declarados:null}];
  const renderProductos=vi.fn(()=>null);
  await act(async()=>root.render(<AsistenteEnvioPedido revision revisionAnterior lineas={lineas} usuario="Ana QA" renderProductos={renderProductos}/>));
  expect(renderProductos.mock.calls.at(-1)[0].lineas).toHaveLength(1);
  expect(node.textContent).toContain('No sale en este envío');
  expect(boton('Continuar a fotos y destino').disabled).toBe(false);
});
