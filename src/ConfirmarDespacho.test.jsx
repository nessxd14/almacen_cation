// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConfirmarDespacho from './ConfirmarDespacho';

vi.mock('./CatalogDialog', () => ({ default: ({ children, label }) => <div role="dialog" aria-label={label}>{children}</div> }));
let root, node;
const confirmar = vi.fn(), cerrar = vi.fn();
const plan = { listo: true, parciales: 1, lineas: [{ id: 31, linea: { producto: { nombre: 'Bolígrafos', unidad_base: 'unidad' } }, asignaciones: [{ ubicacion_id: 7, ubicacion_label: 'Almacén · A-1', cantidad_base: 12 }], total: 12, restante: 12 }] };
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; confirmar.mockReset(); cerrar.mockReset(); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
async function render(props = {}) { await act(async () => root.render(<ConfirmarDespacho plan={plan} pedidoId={248} ocupado={false} onConfirmar={confirmar} onClose={cerrar} {...props} />)); }
const boton = texto => [...node.querySelectorAll('button')].find(b => b.textContent.includes(texto));

it('exige la comprobación física y muestra cantidades y ubicaciones antes de llamar al despacho', async () => {
  await render();
  expect(boton('Confirmar salida').disabled).toBe(true);
  expect(confirmar).not.toHaveBeenCalled();
  expect(node.textContent).toContain('12 unidad');
  expect(node.textContent).toContain('Almacén · A-1: 12');
  expect(node.textContent).toContain('1 producto saldrá parcialmente');
  await act(async () => node.querySelector('input').click());
  expect(boton('Confirmar salida').disabled).toBe(false);
  await act(async () => boton('Confirmar salida').click());
  expect(confirmar).toHaveBeenCalledTimes(1);
});
it('mantiene la revisión y la comprobación tras un fallo para permitir reintentar', async () => {
  await render(); await act(async () => node.querySelector('input').click());
  await render({ error: 'El stock cambió' });
  expect(node.querySelector('[role="alert"]').textContent).toBe('El stock cambió');
  expect(node.querySelector('input').checked).toBe(true);
  expect(boton('Confirmar salida').disabled).toBe(false);
  await render({ ocupado: true });
  expect(boton('Registrando salida').disabled).toBe(true);
  expect(boton('Volver a editar').disabled).toBe(true);
  expect(node.querySelector('input').disabled).toBe(true);
});
it('bloquea una selección incompleta aunque alguien haya confirmado la comprobación física', async () => {
  await render(); await act(async () => node.querySelector('input').click());
  await render({ plan: { ...plan, listo: false, lineas: [{ ...plan.lineas[0], error: 'Sin cantidad asignada' }] } });
  expect(boton('Confirmar salida').disabled).toBe(true);
  expect(node.querySelector('[role="alert"]').textContent).toBe('Sin cantidad asignada');
  expect(confirmar).not.toHaveBeenCalled();
});
