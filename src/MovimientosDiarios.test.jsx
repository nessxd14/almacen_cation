// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MovimientosDiarios from './MovimientosDiarios';

const qa = vi.hoisted(() => ({ cargar: vi.fn() }));
vi.mock('./lib/reportesAlmacen', () => ({ movimientosProductoDia: qa.cargar }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let node, root;
const linea = { producto_id: 1, ubicacion_id: 2, nombre: 'Bolígrafos QA', sku: 'QA-01', ubicacion: 'Estante A', unidad: 'unidad', factor: 1, inicial: 100, sistema: 111, entradas: 20, salidas: 6, ajustes: -3 };
const data = { hasta: '2026-10-24T04:00:00Z', items: [linea, { ...linea, producto_id: 2, nombre: 'Cuadernos QA' }], fuera_turno: [] };
const movimientos = [
  { id: 1, cantidad: 20, tipo_movimiento: 'ENTRADA', creado_en: '2026-10-23T12:15:00Z', referencia: 'Recepción #125' },
  { id: 2, cantidad: -6, tipo_movimiento: 'SALIDA', creado_en: '2026-10-23T13:40:00Z', referencia: 'Venta #850' },
  { id: 3, cantidad: -3, tipo_movimiento: 'AJUSTE', creado_en: '2026-10-23T15:20:00Z', referencia: 'Ajuste #23' },
];
const alcance = () => document.querySelector('.rp-movements-dialog') || node;
const boton = (texto, scope = alcance()) => [...scope.querySelectorAll('button')].find(b => b.textContent === texto);
const click = async texto => act(async () => boton(texto).click());
const cambio = async (elemento, valor) => act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(elemento), 'value').set.call(elemento, valor); elemento.dispatchEvent(new Event('input', { bubbles: true })); elemento.dispatchEvent(new Event('change', { bubbles: true })); });
const montar = async () => act(async () => root.render(<div className="rp-app"><MovimientosDiarios data={data} fecha="2026-10-23" sucursalId={1} preferenciaId="persona-qa" /></div>));
beforeEach(() => {
  localStorage.clear();
  qa.cargar.mockReset().mockResolvedValue({ items: movimientos, total: 3, incompleto: false });
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); });

describe('tres presentaciones de movimientos diarios', () => {
  it('abre una página de detalle y vuelve a la misma búsqueda, posición y botón de la lista', async () => {
    await montar();
    await cambio(node.querySelector('.rp-daily-search input'), 'Bolígrafos');
    const lista = node.querySelector('.rp-diario-list'); lista.scrollTop = 173;
    const trigger = boton('Ver movimientos'); await act(async () => trigger.click());
    expect(lista.hidden).toBe(true); expect(node.querySelector('[aria-label="Página de detalle de movimientos"]')).toBeTruthy();
    expect(node.querySelectorAll('.rp-movement-list>li')).toHaveLength(3);
    lista.scrollTop = 0;
    await click('Volver a movimientos diarios');
    expect(lista.hidden).toBe(false); expect(lista.scrollTop).toBe(173);
    expect(node.querySelector('.rp-daily-search input').value).toBe('Bolígrafos'); expect(document.activeElement).toBe(trigger);
  });
  it('cambia entre página, panel y ventana conservando producto y filtros sin volver a consultar', async () => {
    await montar(); await click('Ver movimientos');
    await cambio(alcance().querySelectorAll('.rp-movement-filters select')[1], 'AJUSTE');
    await click('Panel lateral');
    expect(node.querySelector('.rp-diario-layout.is-panel')).toBeTruthy();
    expect(node.querySelector('.rp-diario-list').hidden).toBe(false);
    expect(node.querySelectorAll('.rp-movement-filters select')[1].value).toBe('AJUSTE');
    await click('Ventana');
    const dialog = document.querySelector('dialog.rp-movements-dialog');
    expect(dialog).toBeTruthy(); expect(dialog.open).toBe(true);
    expect(dialog.querySelectorAll('.rp-movement-filters select')[1].value).toBe('AJUSTE');
    expect(dialog.querySelectorAll('.rp-movement-list>li')).toHaveLength(1);
    expect(dialog.querySelector('.rp-movement-list').textContent).toContain('Ajuste #23');
    await click('Página');
    expect(document.querySelector('dialog.rp-movements-dialog')).toBeNull();
    expect(node.querySelectorAll('.rp-movement-filters select')[1].value).toBe('AJUSTE');
    expect(qa.cargar).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('wms_reportes_vista_movimientos_v1:persona-qa')).toBe('pagina');
  });
  it('recuerda la preferencia por persona y cierra la ventana con Escape', async () => {
    localStorage.setItem('wms_reportes_vista_movimientos_v1:otra-persona', 'panel');
    localStorage.setItem('wms_reportes_vista_movimientos_v1:persona-qa', 'ventana');
    await montar(); expect(boton('Ventana').getAttribute('aria-pressed')).toBe('true');
    await click('Ver movimientos');
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => document.querySelector('dialog').dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })));
    expect(document.querySelector('dialog')).toBeNull(); expect(document.body.style.overflow).not.toBe('hidden');
    expect(localStorage.getItem('wms_reportes_vista_movimientos_v1:otra-persona')).toBe('panel');
  });
  it('permite seguir con otro producto desde el panel y vuelve a mostrar los tipos sin filtro heredado', async () => {
    await montar(); await click('Panel lateral'); await click('Ver movimientos');
    await cambio(node.querySelectorAll('.rp-movement-filters select')[1], 'AJUSTE');
    await act(async () => node.querySelectorAll('.rp-open-movements')[1].click());
    expect(node.querySelector('.rp-movement-detail h4').textContent).toBe('Cuadernos QA');
    expect(node.querySelectorAll('.rp-movement-filters select')[1].value).toBe('');
    expect(qa.cargar).toHaveBeenCalledTimes(2);
    expect(node.querySelector('.rp-open-movements[aria-current=true]').getAttribute('aria-label')).toContain('Cuadernos');
  });
  it('conserva el detalle y la presentación elegida ante un error de consulta y permite reintentar', async () => {
    qa.cargar.mockRejectedValueOnce(new Error('Consulta interrumpida'));
    await montar(); await click('Panel lateral'); await click('Ver movimientos');
    expect(node.querySelector('[role=alert]').textContent).toBe('Consulta interrumpida');
    await click('Ventana'); expect(document.querySelector('dialog [role=alert]').textContent).toBe('Consulta interrumpida');
    await click('Reintentar consulta'); expect(alcance().querySelectorAll('.rp-movement-list>li')).toHaveLength(3);
  });
  it('tolera preferencias inválidas o almacenamiento bloqueado', async () => {
    localStorage.setItem('wms_reportes_vista_movimientos_v1:persona-qa', 'invalida');
    await montar(); expect(boton('Página').getAttribute('aria-pressed')).toBe('true');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Almacenamiento bloqueado'); });
    await click('Panel lateral'); expect(boton('Panel lateral').getAttribute('aria-pressed')).toBe('true');
    await click('Ver movimientos'); expect(node.querySelector('.rp-daily-detail-panel')).toBeTruthy();
  });
});
