// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import ReportesAlmacenApp from './ReportesAlmacenApp';

const qa=vi.hoisted(()=>({rpc:vi.fn(),print:vi.fn(),movimientos:vi.fn(),detalle:null}));
vi.mock('./lib/useAuth',()=>({useUsuarioActual:()=>({id:'usuario-qa',rol:'almacenero'})}));
vi.mock('./lib/useSucursal',()=>({useSucursal:()=>({sucursalActivaId:1,nombreSucursal:()=> 'Almacén QA'})}));
vi.mock('./lib/useAppNav',()=>({useAppNav:()=>({irAConteo:vi.fn()})}));
vi.mock('./lib/reportesAlmacen',()=>({operarReporte:qa.rpc,movimientosProductoDia:qa.movimientos}));
vi.mock('./EscanerCodigo',()=>({default:({onDetect})=><div><button onClick={()=>onDetect('/productos/1/ficha?sucursal=2')}>QR otra sucursal</button><button onClick={()=>onDetect('/productos/1/ficha?sucursal=1')}>QR producto</button></div>}));
vi.mock('./lib/reporteTurno',async original=>({...await original(),imprimirHojaConteo:qa.print}));
let node,root;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const button=text=>[...node.querySelectorAll('button')].find(b=>b.textContent===text);
const click=async text=>{await act(async()=>button(text).click());};
const input=async (selector,value)=>{await act(async()=>{const el=node.querySelector(selector);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});};
const submit=async text=>{await act(async()=>button(text).closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));};
const verificarEmpaques=async()=>{await act(async()=>node.querySelector('#rapido-empaques-verificados').click());};
function snapshot(name) { if(env.REPORTES_QA_DIR) {mkdirSync(env.REPORTES_QA_DIR,{recursive:true});writeFileSync(`${env.REPORTES_QA_DIR}/${name}.html`,node.innerHTML);} }
beforeEach(()=>{
  qa.detalle={reporte:{id:1,folio:'AT-20261019-1',fecha:'2026-10-19',turno:'MANANA',estado:'BORRADOR',version:2,responsable:'Cuenta QA',creado_por:'usuario-qa',sucursal_id:1,sucursal:'Almacén QA',editable:true},
    lineas:[{id:1,numero:1,producto_id:1,ubicacion_id:1,nombre:'Bolígrafos azul punta fina',sku:'QA-01',unidad:'unidad',ubicacion:'PLANTA BAJA / Estante A / 1',empaque:'Caja x12',factor:12,origen:'MOVIMIENTO',empaques:null,sueltas:null,contado_en:null,esperado:null,declarado:null,observacion:''}],eventos:[]};
  qa.rpc.mockReset().mockImplementation(async action=> {
    if(action==='inicio')return {reportes:[]};
    return structuredClone(qa.detalle);
  });qa.print.mockReset().mockResolvedValue();qa.movimientos.mockReset();
  node=document.createElement('div');document.body.append(node);root=createRoot(node);
});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.restoreAllMocks();vi.useRealTimers();});

function prepararEnVivo() {
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-19T15:30:25Z'));
  qa.detalle.lineas.push({...qa.detalle.lineas[0],id:2,numero:2,producto_id:2,nombre:'Cuadernos QA',factor:1,empaque:'Unidad'});
  qa.rpc.mockImplementation(async (accion,id,datos)=>{
    if(accion==='inicio')return {reportes:[]};
    if(accion==='guardar') {
      for(const captura of datos.lineas) {
        const linea=qa.detalle.lineas.find(l=>l.id===captura.id);Object.assign(linea,captura,{declarado:captura.contado_en ? captura.empaques*linea.factor+captura.sueltas : null});
      }
      qa.detalle.reporte.version++;
    }
    return structuredClone(qa.detalle);
  });
}
describe('reportes de almacén',()=>{
  it('genera folio, imprime y transcribe cajas con la hora física antes de entregar',async()=>{
    await act(async()=>root.render(<ReportesAlmacenApp/>));snapshot('inicio');
    await click('Generar hoja de conteo');snapshot('captura');
    expect(node.textContent).not.toContain('107');
    await click('Imprimir / Guardar PDF');expect(qa.print).toHaveBeenCalledWith(qa.detalle,{recepcion:false});
    await input('#captura-1-empaques','8');await input('#captura-1-sueltas','9');
    expect(button('Confirmar captura y comparar').disabled).toBe(true);
    await input('#captura-1-hora','2026-10-19T12:00');
    await submit('Guardar cantidades del papel');
    expect(qa.rpc.mock.calls.find(c=>c[0]==='guardar')[2]).toMatchObject({version:2,lineas:[{id:1,empaques:8,sueltas:9,contado_en:'2026-10-19T16:00:00.000Z'}]});
  });
  it('no guarda una casilla parcial como cero ni entrega cantidades sin guardar',async()=>{
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#captura-1-sueltas','0');await submit('Guardar cantidades del papel');
    expect(node.querySelector('[role=alert]').textContent).toContain('Completa las cantidades');
    expect(qa.rpc.mock.calls.some(c=>c[0]==='guardar')).toBe(false);
  });
  it('conserva lo escrito cuando el servidor rechaza una versión desactualizada',async()=>{
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#captura-1-empaques','0');await input('#captura-1-sueltas','0');await input('#captura-1-hora','2026-10-19T12:00');
    qa.rpc.mockImplementation(async action=>{if(action==='guardar')throw new Error('El reporte cambió. Vuelve a abrirlo antes de guardar.');return {reportes:[]};});
    await submit('Guardar cantidades del papel');
    expect(node.querySelector('#captura-1-sueltas').value).toBe('0');
    expect(node.textContent).toContain('El reporte cambió');
  });
  it('muestra diferencias entregadas y no permite que el autor reciba su propio reporte',async()=>{
    qa.detalle.reporte={...qa.detalle.reporte,editable:false,estado:'ENTREGADO'};
    qa.detalle.lineas[0]={...qa.detalle.lineas[0],declarado:105,esperado:107,empaques:8,sueltas:9,contado_en:'2026-10-19T16:00:00Z',pendiente:true};
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');snapshot('entregado');
    expect(node.textContent).toContain('-2 unidad');expect(button('Recibir reporte con sus observaciones')).toBeUndefined();
    expect(button('Abrir conteo controlado')).toBeTruthy();
  });
  it('cuenta en vivo un producto a la vez, guarda su hora y avanza conservando la versión del servidor',async()=>{
    prepararEnVivo();
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');snapshot('rapido');
    expect(node.querySelector('#rapido-empaques')).toBeTruthy();expect(node.querySelector('input[type=datetime-local]')).toBeNull();
    await input('#rapido-empaques','2');
    await verificarEmpaques();
    expect(button('Confirmar captura y comparar')).toBeUndefined();expect(button('Transcribir papel').disabled).toBe(true);
    await submit('Guardar y siguiente');snapshot('rapido-siguiente');
    expect(qa.rpc.mock.calls.find(c=>c[0]==='guardar')[2]).toMatchObject({version:2,lineas:[{id:1,empaques:2,sueltas:0,contado_en:'2026-10-19T15:30:25.000Z'}]});
    expect(node.textContent).toContain('1 de 2 contados');expect(node.querySelector('.rp-quick-entry h4').textContent).toBe('Cuadernos QA');
    expect(node.querySelector('#rapido-sueltas').value).toBe('');
    await click('No hay · Guardar cero');
    const guardados=qa.rpc.mock.calls.filter(c=>c[0]==='guardar');expect(guardados[1][2]).toMatchObject({version:3,lineas:[{id:2,empaques:0,sueltas:0}]});
    expect(node.textContent).toContain('2 de 2 contados');expect(node.textContent).toContain('Recorrido completado');
    expect(button('Confirmar captura y comparar').disabled).toBe(false);
    await click('Transcribir papel');expect(node.querySelector('#captura-1-empaques').value).toBe('2');expect(node.querySelector('#captura-2-sueltas').value).toBe('0');
  });
  it('no transforma un producto sin tocar en existencia cero',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await submit('Guardar y siguiente');
    expect(node.textContent).toContain('Escribe una cantidad');expect(qa.rpc.mock.calls.some(c=>c[0]==='guardar')).toBe(false);
  });
  it('exige verificar los empaques y conserva esa declaración sin mostrar saldos esperados durante la captura',async()=>{
    prepararEnVivo();qa.detalle.lineas[0].esperado=987654;
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-empaques','2');await submit('Guardar y siguiente');
    expect(node.textContent).toContain('Confirma que verificaste');expect(qa.rpc.mock.calls.some(c=>c[0]==='guardar')).toBe(false);
    expect(node.textContent).not.toContain('987654');
    await verificarEmpaques();await submit('Guardar y siguiente');
    expect(qa.rpc.mock.calls.find(c=>c[0]==='guardar')[2].lineas[0].observacion).toContain('[Empaques verificados] 2 Caja x12');
  });
  it('mantiene las capturas sin guardar al cambiar de ubicación base y requiere verificar de nuevo si cambian los empaques',async()=>{
    prepararEnVivo();Object.assign(qa.detalle.lineas[1],{ubicacion_id:2,ubicacion:'GARAJE / Pallet A / 1'});
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-empaques','2');await verificarEmpaques();
    const base=nombre=>[...node.querySelectorAll('.rp-count-base-options button')].find(b=>b.querySelector('strong').textContent===nombre);
    await act(async()=>base('Garaje').click());await input('#rapido-sueltas','7');
    await act(async()=>base('Planta Baja').click());
    expect(node.querySelector('#rapido-empaques').value).toBe('2');expect(node.querySelector('#rapido-empaques-verificados').checked).toBe(true);
    await input('#rapido-empaques','3');expect(node.querySelector('#rapido-empaques-verificados').checked).toBe(false);
    await act(async()=>base('Garaje').click());expect(node.querySelector('#rapido-sueltas').value).toBe('7');
    expect(qa.rpc.mock.calls.some(c=>c[0]==='guardar')).toBe(false);expect(button('Transcribir papel').disabled).toBe(true);
  });
  it('mantiene separadas las declaraciones de un mismo producto en dos ubicaciones base',async()=>{
    prepararEnVivo();qa.detalle.lineas=[qa.detalle.lineas[0],{...qa.detalle.lineas[0],id:3,numero:3,ubicacion_id:3,ubicacion:'HUECO / Estante A / 1'}];
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-sueltas','5');await submit('Guardar y siguiente');
    expect(node.textContent).toContain('Terminaste Planta Baja');await click('Continuar en Hueco');
    expect(node.querySelector('#rapido-sueltas').value).toBe('');await input('#rapido-sueltas','2');await submit('Guardar y siguiente');
    const capturas=qa.rpc.mock.calls.filter(c=>c[0]==='guardar').map(c=>c[2].lineas[0]);
    expect(capturas.map(c=>[c.id,c.sueltas])).toEqual([[1,5],[3,2]]);expect(node.textContent).toContain('Recorrido completado');
  });
  it('conserva empaques, verificación y ubicación al fallar el guardado',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-empaques','2');await verificarEmpaques();
    const anterior=qa.rpc.getMockImplementation();qa.rpc.mockImplementation(async(...args)=>{if(args[0]==='guardar')throw new Error('Sin conexión');return anterior(...args);});
    await submit('Guardar y siguiente');
    expect(node.querySelector('#rapido-empaques').value).toBe('2');expect(node.querySelector('#rapido-empaques-verificados').checked).toBe(true);
    expect(node.querySelector('.rp-count-base-options button[aria-pressed=true] strong').textContent).toBe('Planta Baja');
    expect(node.querySelector('.rp-quick-entry h4').textContent).toContain('Bolígrafos');
  });
  it('preserva los borradores de otros productos y no avanza ante un error de guardado',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-sueltas','3');await click('Ver recorrido');
    await act(async()=>[...node.querySelectorAll('.rp-route-list button')].find(b=>b.textContent.includes('Cuadernos')).click());
    await input('#rapido-sueltas','5');await submit('Guardar y siguiente');
    expect(node.querySelector('.rp-quick-entry h4').textContent).toContain('Bolígrafos');expect(node.querySelector('#rapido-sueltas').value).toBe('3');
    qa.rpc.mockImplementation(async action=>{if(action==='guardar')throw new Error('Sin conexión');return {reportes:[]};});
    await submit('Guardar y siguiente');snapshot('rapido-error');
    expect(node.querySelector('#rapido-sueltas').value).toBe('3');expect(node.textContent).toContain('No se guardó este producto');
    expect(node.textContent).toContain('1 de 2 contados');expect(button('Confirmar captura y comparar')).toBeUndefined();
  });
  it('exige motivo al omitir y guarda un pendiente sin asignarle cero',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await click('No puedo contar');await submit('Guardar pendiente y siguiente');
    expect(qa.rpc.mock.calls.some(c=>c[0]==='guardar')).toBe(false);
    await input('#rapido-motivo','Ubicación temporalmente ocupada');await submit('Guardar pendiente y siguiente');
    expect(qa.rpc.mock.calls.find(c=>c[0]==='guardar')[2].lineas).toEqual([{id:1,empaques:null,sueltas:null,contado_en:null,observacion:'Ubicación temporalmente ocupada'}]);
    expect(node.textContent).toContain('0 de 2 contados');expect(node.textContent).toContain('1 con motivo');
  });
  it('rechaza el QR de otra sucursal y exige elegir ubicación cuando un producto está en varios lugares',async()=>{
    prepararEnVivo();qa.detalle.lineas.push({...qa.detalle.lineas[0],id:3,numero:3,ubicacion_id:3,ubicacion:'PLANTA ALTA / Estante B'});
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await click('Escanear QR');await click('QR otra sucursal');expect(node.textContent).toContain('otra sucursal');
    await click('Escanear QR');await click('QR producto');expect(node.querySelector('.rp-quick-entry')).toBeNull();
    expect(node.querySelectorAll('.rp-route-list button')).toHaveLength(2);
  });
  it('abre el desglose desde el resumen y filtra sin alterar los saldos de cada movimiento',async()=>{
    const linea={...qa.detalle.lineas[0],inicial:100,entradas:24,salidas:6,ajustes:0,sistema:118};
    qa.rpc.mockImplementation(async action=>action==='inicio'?{reportes:[]}: {hasta:'2026-10-20T04:00:00Z',items:[linea],fuera_turno:[]});
    qa.movimientos.mockResolvedValue({total:2,incompleto:false,items:[{id:1,cantidad:24,tipo_movimiento:'ENTRADA',creado_en:'2026-10-19T12:15:00Z',referencia:'Recepción #125',autor:'Persona QA'},{id:2,cantidad:-6,tipo_movimiento:'SALIDA',creado_en:'2026-10-19T19:40:00Z',referencia:'Venta #850',autor:'Otra persona QA'}]});
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Movimientos diarios');await click('Ver movimientos');snapshot('movimientos');
    expect(qa.movimientos).toHaveBeenCalledWith({productoId:1,ubicacionId:1,sucursalId:1,fecha:expect.any(String),hasta:'2026-10-20T04:00:00Z'});
    expect(node.querySelectorAll('.rp-movement-list>li')).toHaveLength(2);expect(node.querySelector('.rp-movement-list').textContent).toContain('124 unidad');
    await input('.rp-movement-filters select','TARDE');
    expect(node.querySelectorAll('.rp-movement-list>li')).toHaveLength(1);expect(node.querySelector('.rp-movement-list').textContent).toContain('118 unidad');
    expect(node.querySelector('.rp-movement-list').textContent).toContain('Venta #850');
  });
  it('continúa por los muebles de la misma base y espera antes de cambiar a otra zona',async()=>{
    prepararEnVivo();Object.assign(qa.detalle.lineas[1],{ubicacion_id:2,ubicacion:'PLANTA BAJA / Estante B / 1'});
    qa.detalle.lineas.push({...qa.detalle.lineas[1],id:3,numero:3,ubicacion_id:3,ubicacion:'HUECO / Estante A / 1',nombre:'Material en Hueco'});
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-empaques','1');await verificarEmpaques();await submit('Guardar y siguiente');
    expect(node.querySelector('.rp-quick-entry h4').textContent).toBe('Cuadernos QA');
    expect(node.querySelector('.rp-location').textContent).toContain('Estante B / 1');
    await click('No hay · Guardar cero');snapshot('ux-ubicacion');
    expect(node.textContent).toContain('Terminaste Planta Baja');expect(node.querySelector('.rp-quick-entry')).toBeNull();
    expect(node.textContent).toContain('Siguiente ubicación base: Hueco');
    expect(button('Confirmar captura y comparar')).toBeUndefined();
    await click('Continuar en Hueco');expect(node.querySelector('.rp-quick-entry h4').textContent).toBe('Material en Hueco');
  });
  it('corrige el último conteo con valores precargados, conserva la hora y retorna al producto que estaba contando',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-empaques','2');await verificarEmpaques();await submit('Guardar y siguiente');
    await input('#rapido-sueltas','5');vi.setSystemTime(new Date('2026-10-19T15:35:00Z'));
    await click('Corregir último conteo');snapshot('ux-corregir');
    expect(node.querySelector('#rapido-empaques').value).toBe('2');expect(node.querySelector('#rapido-sueltas').value).toBe('0');
    await input('#rapido-sueltas','1');await submit('Guardar corrección');
    const guardados=qa.rpc.mock.calls.filter(c=>c[0]==='guardar');
    expect(guardados[1][2].lineas[0]).toMatchObject({id:1,empaques:2,sueltas:1,contado_en:'2026-10-19T15:30:25.000Z'});
    expect(node.querySelector('.rp-quick-entry h4').textContent).toBe('Cuadernos QA');expect(node.querySelector('#rapido-sueltas').value).toBe('5');
    expect(node.textContent).toContain('1 de 2 contados');
  });
  it('cancela la corrección sin guardar y recupera el borrador en curso',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-empaques','2');await verificarEmpaques();await submit('Guardar y siguiente');await input('#rapido-sueltas','5');
    await click('Corregir último conteo');await input('#rapido-empaques','9');await click('Cancelar corrección');
    expect(node.querySelector('#rapido-sueltas').value).toBe('5');expect(qa.rpc.mock.calls.filter(c=>c[0]==='guardar')).toHaveLength(1);
  });
  it('Enter en empaques enfoca sueltas sin enviar una captura a medias',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-empaques','2');const evento=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
    await act(async()=>node.querySelector('#rapido-empaques').dispatchEvent(evento));
    expect(evento.defaultPrevented).toBe(true);expect(document.activeElement.id).toBe('rapido-sueltas');
    expect(qa.rpc.mock.calls.filter(c=>c[0]==='guardar')).toHaveLength(0);
  });
  it('permite elegir un motivo frecuente y separa los pendientes de lo que falta recorrer',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await click('No puedo contar');await click('No alcancé a contar');await submit('Guardar pendiente y siguiente');
    expect(qa.rpc.mock.calls.find(c=>c[0]==='guardar')[2].lineas[0].observacion).toBe('No alcancé a contar');
    expect(node.textContent).toContain('1 por contar · 1 con motivo');
    await click('No hay · Guardar cero');snapshot('ux-final');
    expect(node.textContent).toContain('Recorrido completado');expect(node.textContent).toContain('1 producto contado y 1 pendiente con motivo');
    await click('Revisar pendientes con motivo');expect(node.querySelectorAll('.rp-route-list button')).toHaveLength(1);
    expect(node.querySelector('.rp-route-list').textContent).toContain('No alcancé a contar');
  });
  it('no reemplaza por cero una cantidad escrita sin una confirmación explícita',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await input('#rapido-empaques','2');await click('No hay · Guardar cero');
    expect(qa.rpc.mock.calls.filter(c=>c[0]==='guardar')).toHaveLength(0);await click('Conservar cantidad');
    expect(node.querySelector('#rapido-empaques').value).toBe('2');
    await click('No hay · Guardar cero');await click('Guardar cero y continuar');
    expect(qa.rpc.mock.calls.find(c=>c[0]==='guardar')[2].lineas[0]).toMatchObject({id:1,empaques:0,sueltas:0});
    expect(node.querySelector('.rp-quick-entry h4').textContent).toBe('Cuadernos QA');
  });
  it('presenta el conteo guardado antes de permitir editarlo o contar de nuevo',async()=>{
    prepararEnVivo();await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await click('No hay · Guardar cero');await click('Ver recorrido');await click('Contados (1)');
    await act(async()=>node.querySelector('.rp-route-list button').click());
    expect(node.textContent).toContain('Este producto ya está contado');expect(node.querySelector('#rapido-empaques')).toBeNull();
    await click('Corregir cantidad');expect(node.querySelector('#rapido-empaques').value).toBe('0');
  });
  it('comprueba el alcance antes de comparar y usa la nueva versión del reporte',async()=>{
    prepararEnVivo();const base=qa.rpc.getMockImplementation();
    qa.rpc.mockImplementation(async(...args)=>{
      if(args[0]==='actualizar_alcance'){qa.detalle.reporte.version++;return structuredClone(qa.detalle);}
      return base(...args);
    });
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await click('No hay · Guardar cero');await click('No hay · Guardar cero');await click('Confirmar captura y comparar');
    const llamadas=qa.rpc.mock.calls.filter(c=>['actualizar_alcance','comparar'].includes(c[0]));
    expect(llamadas.map(c=>c[0])).toEqual(['actualizar_alcance','comparar']);expect(llamadas[1][2].version).toBe(5);
  });
  it('retoma productos nuevos sin comparar una hoja cuyo alcance quedó incompleto',async()=>{
    prepararEnVivo();const base=qa.rpc.getMockImplementation();
    qa.rpc.mockImplementation(async(...args)=>{
      if(args[0]==='actualizar_alcance'){
        qa.detalle.lineas.push({...qa.detalle.lineas[0],id:3,numero:3,nombre:'Producto nuevo',empaques:null,sueltas:null,declarado:null,contado_en:null});
        qa.detalle.reporte.version++;return structuredClone(qa.detalle);
      }
      return base(...args);
    });
    await act(async()=>root.render(<ReportesAlmacenApp/>));await click('Generar hoja de conteo');
    await click('No hay · Guardar cero');await click('No hay · Guardar cero');await click('Confirmar captura y comparar');snapshot('ux-nuevos');
    expect(qa.rpc.mock.calls.some(c=>c[0]==='comparar')).toBe(false);expect(node.textContent).toContain('nuevos por contar');
    await click('Continuar conteo');expect(node.querySelector('.rp-quick-entry h4').textContent).toBe('Producto nuevo');
  });
});
