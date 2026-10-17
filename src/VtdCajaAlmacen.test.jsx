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
let root, node;
const registro = (estado='SOLICITADO', escaneado='2026-10-17T14:00:00Z') => ({ operacion: { id:'op',estado:'ACTIVA' }, vtds:[{venta_id:7,numero:'VTD-QA-7',cliente:'Cliente de prueba',estado,version:2,escaneado_en:escaneado,lineas:[{linea_id:10,nombre:'Bolígrafos de prueba',presentacion:'Caja x12',cantidad_presentacion:2,cantidad_base:24}]}] });
async function mount(data) { const changed=vi.fn();await act(async()=>root.render(<MemoryRouter><VtdCajaAlmacen registro={data} ventaId="7" onChanged={changed} /></MemoryRouter>));return changed; }
async function input(selector,value) { await act(async()=>{ const el=node.querySelector(selector);Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true})); }); }
const button = () => node.querySelector('button');
function capture(name) { if (env.CATION_QA_OUTPUT) writeFileSync(`${env.CATION_QA_OUTPUT}/${name}.html`,`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif;background:#f7fafc}${readFileSync('src/operaciones-movil.css','utf8')}</style><body>${node.innerHTML}</body></html>`); }
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;qa.rpc.mockReset();node=document.createElement('div');document.body.append(node);root=createRoot(node);});
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
