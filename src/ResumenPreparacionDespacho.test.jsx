// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResumenPreparacionDespacho from './ResumenPreparacionDespacho';
const qa = vi.hoisted(() => ({ data: null, error: null, rpc: vi.fn() }));
vi.mock('./supabaseClient', () => ({ supabase: { rpc: qa.rpc } }));
let root, nodo;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  qa.error = null;
  qa.data = { tarea: { estado: 'VERIFICADO', preparador_nombre: 'Ana QA', revisor_nombre: 'Luis QA' }, pedido: { estado: 'ABIERTO' }, entregada: false, cambios: [], lineas: [{ pedido_linea_id: 31, vigente: true, confirmada: true, preparada_base: 12, revisada_base: 12, snapshot: { nombre: 'Bolígrafos QA', pendiente_base: 24, factor: 12, presentacion: 'Caja', unidad_base: 'unidad' } }] };
  qa.rpc.mockReset().mockImplementation(async () => ({ data: qa.error ? null : structuredClone(qa.data), error: qa.error ? { message: qa.error } : null }));
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); });
async function montar() { await act(async () => root.render(<MemoryRouter><ResumenPreparacionDespacho pedidoId="248" preparacionId="10" sucursalId="1" nombreSucursal="Almacén QA" /></MemoryRouter>)); }
it('muestra las cantidades de la entrega parcial y los responsables sin despachar', async () => {
  await montar();
  expect(nodo.textContent).toContain('entrega parcial');
  expect(nodo.textContent).toContain('12 unidad · 1 Caja');
  expect(nodo.textContent).toContain('Ana QA'); expect(nodo.textContent).toContain('Luis QA');
  expect(qa.rpc).toHaveBeenCalledWith('operar_preparacion_pedido', expect.objectContaining({ p_accion: 'consultar', p_tarea_id: '10', p_sucursal_id: '1' }));
  expect(nodo.querySelector('a').getAttribute('href')).toContain('sucursal=1');
});
it('un pedido modificado no se presenta como verificación vigente', async () => {
  qa.data.cambios = [31]; await montar();
  expect(nodo.textContent).toContain('necesita comprobarse nuevamente');
  expect(nodo.textContent).not.toContain('Usa las cantidades de abajo');
});
it('distingue una entrega ya despachada', async () => {
  qa.data.entregada = true; await montar();
  expect(nodo.textContent).toContain('ya figuran despachadas');
  expect(nodo.textContent).not.toContain('Usa las cantidades de abajo');
});
it('una consulta fallida no afirma que la preparación está verificada', async () => {
  qa.error = 'Sin conexión'; await montar();
  expect(nodo.querySelector('[role="alert"]').textContent).toContain('Sin conexión');
  expect(nodo.textContent).not.toContain('verificada');
});
