// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({sol:vi.fn(),lineas:vi.fn(),guardar:vi.fn(),despachar:vi.fn(),rpc:vi.fn(),borradores:[]}));
vi.mock('./supabaseClient',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('./lib/traslados',async importOriginal=>({...await importOriginal(),cargarLineasTraslado:mocks.lineas,cargarSolicitudesTraslado:mocks.sol}));
vi.mock('./lib/operaciones',()=>({despacharTraslado:mocks.despachar,recibirTraslado:vi.fn(),cerrarSolicitudTraslado:vi.fn(),stockDisponibleSucursal:async()=>new Map([[1,100]]),codigosGrisPorProducto:async()=>new Map()}));
vi.mock('./lib/useAuth',()=>({useUsuarioActual:()=>({id:'u',nombre:'QA',rol:'almacenero'})}));
vi.mock('./lib/useSucursal',()=>({useSucursal:()=>({sucursalActivaId:1,nombreSucursal:id=>`Sucursal ${id}`})}));
vi.mock('./lib/borradores',()=>({listarBorradores:async()=>({data:mocks.borradores}),guardarBorrador:mocks.guardar,eliminarBorrador:vi.fn(),estaVencido:()=>false,antiguedadTexto:()=>'',vencimientoTexto:()=>''}));
vi.mock('./CodigosLinea',()=>({default:()=>null}));
import TrasladosApp from './TrasladosApp';
let root,node;
const sol={id:1,estado:'SOLICITADO',motivo:'REPOSICION',sucursal_origen_id:1,sucursal_destino_id:2};
const line={id:11,solicitud_id:1,producto_id:1,cantidad_base:5,cantidad_despachada:0,estado:'POR_DESPACHAR',producto:{nombre:'QA producto',unidad_base:'unidades'}};
const button=text=>[...node.querySelectorAll('button')].find(b=>b.textContent.includes(text));
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();mocks.borradores=[];mocks.sol.mockResolvedValue([sol]);mocks.lineas.mockResolvedValue([line]);node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});
async function open(){await act(async()=>root.render(<TrasladosApp/>));await act(async()=>node.querySelector('button[aria-expanded]').click());}
it('un fallo de consulta aparece con reintento en vez de una bandeja vacía',async()=>{
  mocks.sol.mockRejectedValue(new Error('Conexión no disponible'));await act(async()=>root.render(<TrasladosApp/>));
  expect(node.querySelector('[role="alert"]').textContent).toContain('Conexión no disponible');expect(button('Reintentar')).toBeTruthy();
});
it('restaura y guarda la acción Faltante junto con las cantidades del borrador',async()=>{
  mocks.borradores=[{id:2,contenido:{solicitud_id:1,cantidades:{11:3},acciones:{11:'FALTANTE'}}}];
  mocks.guardar.mockResolvedValue({data:{id:2,contenido:{solicitud_id:1}}});await open();
  expect(node.textContent).toContain('Va a faltante');
  await act(async()=>node.querySelector('[aria-label="Guardar borrador"]').click());
  expect(mocks.guardar.mock.calls[0][0].contenido).toEqual({solicitud_id:1,cantidades:{11:3},acciones:{11:'FALTANTE'}});
});
it('expone un máximo y rechaza el exceso antes de llamar a la base',async()=>{
  mocks.borradores=[{id:2,contenido:{solicitud_id:1,cantidades:{11:8}}}];await open();
  expect(node.querySelector('input[type="number"]').max).toBe('5');
  await act(async()=>[...node.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Despachar').at(-1).click());
  expect(mocks.despachar).not.toHaveBeenCalled();expect(node.textContent).toContain('no superar lo solicitado');
});
