// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import VtdCajaAlmacen from './VtdCajaAlmacen';

const qa = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabaseClient', () => ({ supabase: { rpc: qa.rpc } }));
vi.mock('./EvidenciaVtd', () => ({ default: function EvidenciaMock({ onConfiguracion, onFotos }) { return <><button data-config onClick={() => onConfiguracion(true)}>Activar fotos</button><button data-foto onClick={() => onFotos([new File(['qa'], 'qa.jpg', { type: 'image/jpeg' })])}>Adjuntar foto QA</button><button data-inactivo onClick={() => onConfiguracion(false)}>Sin integración</button></>; } }));
const evidenciaQa = vi.hoisted(() => ({ subir: vi.fn() }));
vi.mock('./lib/evidenciaVtd', () => ({ subirEvidenciaVtd: evidenciaQa.subir }));
let root, node;
const registro = (estado='SOLICITADO', escaneado='2026-10-17T14:00:00Z') => ({ operacion: { id:'op',estado:'ACTIVA' }, vtds:[{venta_id:7,numero:'VTD-QA-7',cliente:'Cliente de prueba',estado,version:2,escaneado_en:escaneado,lineas:[{linea_id:10,nombre:'Bolígrafos de prueba',presentacion:'Caja x12',cantidad_presentacion:2,cantidad_base:24}]}] });
async function mount(data) { const changed=vi.fn();await act(async()=>root.render(<MemoryRouter><VtdCajaAlmacen registro={data} ventaId="7" onChanged={changed} /></MemoryRouter>));await act(async()=>node.querySelector('[data-inactivo]').click());return changed; }
async function input(selector,value) { await act(async()=>{ const el=node.querySelector(selector);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true})); }); }
const button = () => node.querySelector('button.om-primary');
function capture(name) { if (env.CATION_QA_OUTPUT) writeFileSync(`${env.CATION_QA_OUTPUT}/${name}.html`,`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif;background:#f7fafc}${readFileSync('src/operaciones-movil.css','utf8')}</style><body>${node.innerHTML}</body></html>`); }
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;qa.rpc.mockReset();evidenciaQa.subir.mockReset();node=document.createElement('div');document.body.append(node);root=createRoot(node);});
afterEach(async()=>{await act(async()=>root.unmount());node.remove();});

it('un encargado declara las cantidades y envía a Caja sin otro verificador',async()=>{
  const next=registro('EN_CAJA');qa.rpc.mockResolvedValue({data:next,error:null});const changed=await mount(registro());
  expect(button().disabled).toBe(true);await input('input','24');expect(button().disabled).toBe(false);capture('caja-almacen-verificacion');
  await act(async()=>button().click());
  expect(qa.rpc).toHaveBeenCalledWith('operar_caja_almacen',expect.objectContaining({p_accion:'enviar',p_datos:expect.objectContaining({venta_id:7,version:2,cantidades:[{linea_id:10,cantidad_base:24}]})}));
  expect(changed).toHaveBeenCalledWith(next);expect(node.textContent).not.toContain('Tomar revisión');
});
it('recibir un retorno exige comprobar las cantidades y conserva errores del servidor',async()=>{
  qa.rpc.mockResolvedValue({data:null,error:{message:'La entrega cambió'}});await mount(registro('RETORNO_PENDIENTE'));
  expect(node.textContent).toContain('El rechazo no repuso el stock');await input('input','12');expect(button().disabled).toBe(true);
  await input('input','24');capture('caja-almacen-retorno');await act(async()=>button().click());
  expect(qa.rpc.mock.calls[0][1].p_accion).toBe('recibir_retorno');expect(node.textContent).toContain('La entrega cambió');
});
it('regularizar sin escaneo requiere motivo y no inventa una lectura de QR',async()=>{
  qa.rpc.mockResolvedValue({data:registro('EN_CAJA',null),error:null});await mount(registro('SOLICITADO',null));await input('input','24');expect(button().disabled).toBe(true);
  await input('textarea','Material comprobado ahora, se omitió el escaneo');expect(button().disabled).toBe(false);await act(async()=>button().click());
  expect(qa.rpc.mock.calls[0][1].p_accion).toBe('enviar');expect(qa.rpc).toHaveBeenCalledTimes(1);
});

it('exige fotos y las sube antes de registrar una salida',async()=>{
  await mount(registro());await act(async()=>node.querySelector('[data-config]').click());await input('input','24');
  expect(button().disabled).toBe(true);
  await act(async()=>node.querySelector('[data-foto]').click());expect(button().disabled).toBe(false);
  evidenciaQa.subir.mockResolvedValue('lote-qa');qa.rpc.mockResolvedValue({data:registro('EN_CAJA'),error:null});
  await act(async()=>button().click());
  expect(evidenciaQa.subir).toHaveBeenCalledTimes(1);
  expect(qa.rpc.mock.calls[0][1].p_datos.evidencia_id).toBe('lote-qa');
});
it('un fallo al subir conserva las fotos y no registra stock ni salida',async()=>{
  await mount(registro());await act(async()=>{node.querySelector('[data-config]').click();node.querySelector('[data-foto]').click();});await input('input','24');
  evidenciaQa.subir.mockRejectedValueOnce(new Error('Foto pendiente')).mockResolvedValueOnce('lote-qa');
  await act(async()=>button().click());expect(qa.rpc).not.toHaveBeenCalled();expect(node.textContent).toContain('Foto pendiente');
  const primerId=evidenciaQa.subir.mock.calls[0][3];qa.rpc.mockResolvedValue({data:registro('EN_CAJA'),error:null});
  await act(async()=>button().click());expect(evidenciaQa.subir.mock.calls[1][3]).toBe(primerId);
});
it('recupera una salida confirmada cuya respuesta se perdió sin volver a subir ni enviar',async()=>{
  const changed=await mount(registro());await act(async()=>{node.querySelector('[data-config]').click();node.querySelector('[data-foto]').click();});await input('input','24');
  evidenciaQa.subir.mockResolvedValue('lote-qa');qa.rpc.mockResolvedValueOnce({data:null,error:{message:'Respuesta perdida'}}).mockResolvedValueOnce({data:registro('EN_CAJA'),error:null});
  await act(async()=>button().click());await act(async()=>button().click());
  expect(evidenciaQa.subir).toHaveBeenCalledTimes(1);expect(qa.rpc.mock.calls.map(c=>c[1].p_accion)).toEqual(['enviar','consultar_vtd']);
  expect(changed).toHaveBeenCalledWith(registro('EN_CAJA'));
});
