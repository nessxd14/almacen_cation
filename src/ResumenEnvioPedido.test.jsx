// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ResumenEnvioPedido from './ResumenEnvioPedido';

let node,root;
const lineas=()=>[
  {pedido_linea_id:1,vigente:true,confirmada:true,preparada_base:300,revisada_base:300,origenes_declarados:[{tipo:'COMPRA_RAPIDA',cantidad_base:300,referencia:'Proveedor QA'}],snapshot:{nombre:'Trijet azul',factor:1,unidad_base:'unidades',pendiente_base:300}},
  {pedido_linea_id:2,vigente:true,confirmada:true,preparada_base:0,revisada_base:0,snapshot:{nombre:'Sobre manila TOP oficio',factor:100,presentacion:'paquete',unidad_base:'sobres',pendiente_base:100}},
];
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
it('separa lo despachado del paquete pendiente y no afirma recepción del cliente',async()=>{
  await act(async()=>root.render(<ResumenEnvioPedido lineas={lineas()} cerrado numero={1}/>));
  expect(node.querySelector('.pt-envio-sale').textContent).toContain('Despachado: 300 unidades');
  expect(node.querySelector('.pt-envio-sale').textContent).not.toContain('Sobre manila');
  expect(node.querySelector('.pt-envio-pendiente').textContent).toContain('Pendiente: 1 paquete');
  expect(node.textContent).toContain('la recepción del cliente se registra por separado');
});
it('no pone listo en una revisión incompleta y permite abrir la línea sin confirmarla',async()=>{
  const editar=vi.fn(),ls=lineas();ls[0].revisada_base=null;
  await act(async()=>root.render(<ResumenEnvioPedido lineas={ls} revision onEditar={editar}/>));
  expect(node.textContent).toContain('0/1 verificados');expect(node.textContent).toContain('Falta verificar físicamente');
  await act(async()=>node.querySelector('.pt-envio-sale button').click());
  expect(editar).toHaveBeenCalledWith(1);
});
it('un origen ausente queda visible sin inventar procedencia de Almacén',async()=>{
  const ls=lineas();ls[0].origenes_declarados=null;
  await act(async()=>root.render(<ResumenEnvioPedido lineas={ls}/>));
  expect(node.textContent).toContain('Origen pendiente de completar');
});
