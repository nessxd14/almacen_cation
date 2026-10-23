// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';

const qa = vi.hoisted(() => ({ load: vi.fn(), stock: vi.fn(), ejecutar: vi.fn(), asignar: vi.fn(), rpc: vi.fn(),
  producto: { id: 8, nombre: 'Archivador de palanca ROARI · Azul', sku_interno: '99611-AZ', marca: 'ROARI', unidad_base: 'unidad' },
  usuario: { id: 'qa', nombre: 'Cuenta QA', rol: 'almacenero' }, opciones: {}, contexto: null,
}));
vi.mock('./lib/useAuth', () => ({ useUsuarioActual: () => qa.usuario }));
vi.mock('./lib/useSucursal', () => ({ useSucursal: () => qa.contexto }));
vi.mock('./supabaseClient', () => ({ supabase: { rpc: qa.rpc, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: qa.producto }) }) }) }) } }));
vi.mock('./lib/operacionDirecta', async original => ({ ...await original(), cargarDatosOperacion: qa.load, leerStockOperacion: qa.stock }));
vi.mock('./lib/operaciones', () => ({ ejecutarOperacion: qa.ejecutar, asegurarAsignacion: qa.asignar }));
vi.mock('./TypeaheadProducto', () => ({ default: ({ onSeleccionar }) => <button type="button" onClick={() => onSeleccionar(qa.producto, qa.opciones)}>Elegir producto QA</button> }));
vi.mock('./EscanerCodigo', () => ({ default: ({ onDetect }) => <button type="button" onClick={() => onDetect('CAJA-QA')}>Leer caja QA</button> }));
import OperacionesApp from './OperacionesApp';

const nombreSucursal = id => id === 1 ? 'Almacén Central' : 'Tienda';
const sucursales = [{ id: 1, tipo: 'almacen' }, { id: 2, tipo: 'tienda' }];
const datos = {
  presentaciones: [{ id: 1, nombre: 'Unidad', factor_unidad_base: 1, es_base: true }, { id: 2, nombre: 'Caja', factor_unidad_base: 12, es_base: false }],
  ubicaciones: [
    { id: 11, label: 'Almacén Central · Planta baja · Estante A', sucursal_id: 1, asignada: true, principal: true, stock: 120 },
    { id: 12, label: 'Almacén Central · Planta arriba · Estante B', sucursal_id: 1, asignada: true, stock: 36 },
    { id: 22, label: 'Tienda · Piso de venta', sucursal_id: 2, asignada: false, stock: 60 },
  ],
};
let root, node;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const button = text => [...node.querySelectorAll('button')].find(b => b.textContent.trim() === text || b.textContent.trim().startsWith(text));
const click = async text => { await act(async () => button(text).click()); };
const change = async (selector, value) => { await act(async () => {
  const el = node.querySelector(selector);
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}); };
const submit = async () => { await act(async () => node.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };
const render = async () => { await act(async () => root.render(<OperacionesApp />)); };
const open = async (modo = 'Entrada') => { await render(); if (modo !== 'Entrada') await click(modo); await click('Elegir producto QA'); };
function snapshot(name) {
  if (!env.OPERACIONES_QA_DIR) return;
  const copia = node.cloneNode(true);
  node.querySelectorAll('select').forEach((el, index) => {
    [...copia.querySelectorAll('select')[index].options].forEach(option => { option.toggleAttribute('selected', option.value === el.value); });
  });
  node.querySelectorAll('textarea').forEach((el, index) => { copia.querySelectorAll('textarea')[index].textContent = el.value; });
  mkdirSync(env.OPERACIONES_QA_DIR, { recursive: true }); writeFileSync(`${env.OPERACIONES_QA_DIR}/${name}.html`, copia.innerHTML);
}
beforeEach(() => {
  vi.clearAllMocks(); qa.opciones = {}; qa.usuario = { id: 'qa', nombre: 'Cuenta QA', rol: 'almacenero' };
  qa.contexto = { sucursalActivaId: 1, sucursales, nombreSucursal };
  qa.load.mockReset().mockResolvedValue(structuredClone(datos));
  qa.stock.mockReset().mockImplementation(async ({ ubicacionId }) => ({ 11: 120, 12: 36, 22: 60 })[ubicacionId]);
  qa.ejecutar.mockReset().mockResolvedValue({ id: 99, error: null }); qa.asignar.mockReset().mockResolvedValue(); qa.rpc.mockReset();
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); });

describe('Operaciones con revisión inferior', () => {
  it('inicia con selección de producto y acceso al historial, sin SQL operativo', async () => {
    await render(); expect(node.textContent).toContain('Selecciona un producto para comenzar');
    expect(node.querySelector('form')).toBeNull(); expect(node.textContent).not.toContain('SQL');
    expect(node.querySelector('a').getAttribute('href')).toBe('?tab=historial'); snapshot('inicio');
  });
  it('muestra la conversión y el saldo antes de guardar la presentación elegida', async () => {
    await open(); expect(node.querySelector('#operacion-presentacion').value).toBe('1');
    await change('#operacion-ubicacion', '11'); await change('#operacion-presentacion', '2'); await change('#operacion-cantidad', '2');
    expect(node.querySelector('#operacion-equivalencia').textContent).toBe('2 × 12 = 24 unidad');
    expect(node.querySelector('.operaciones-final strong').textContent).toBe('144'); snapshot('entrada');
    await submit(); expect(qa.ejecutar).toHaveBeenCalledWith(expect.objectContaining({ modo: 'ENTRADA', presentacionId: '2', cantidad: '2', ubicacionId: '11', idempotencia: expect.any(String) }));
    expect(node.querySelector('[role="status"]').textContent).toContain('Kardex #99');
    expect(node.querySelector('.operaciones-history-list').textContent).toContain('+24 unidad'); expect(node.querySelector('#operacion-cantidad').value).toBe('');
  });
  it('un escaneo de caja en traslado deja visible su presentación y envía dos cajas, no 24 cajas', async () => {
    qa.rpc.mockResolvedValue({ data: [{ producto_id: 8, presentacion_id: 2 }] }); await render(); await click('Traslado'); await click('Escanear código'); await click('Leer caja QA');
    expect(node.querySelector('#operacion-presentacion').value).toBe('2');
    await change('#operacion-ubicacion', '11'); await change('#operacion-destino', '22'); await change('#operacion-cantidad', '2');
    expect(node.querySelector('.operaciones-final strong').textContent).toBe('84'); snapshot('traslado');
    await submit(); expect(qa.ejecutar).toHaveBeenCalledWith(expect.objectContaining({ modo: 'TRASLADO', presentacionId: '2', cantidad: '2', ubicacionDestinoId: '22' }));
  });
  it('un código ambiguo obliga a elegir una presentación y no presupone la base', async () => {
    qa.opciones = { presentacionAmbigua: true }; await open('Traslado');
    expect(node.querySelector('#operacion-presentacion').value).toBe('');
    await change('#operacion-ubicacion', '11'); await change('#operacion-destino', '22'); await change('#operacion-cantidad', '2');
    expect(button('Registrar traslado').disabled).toBe(true); await submit(); expect(qa.ejecutar).not.toHaveBeenCalled();
  });
  it('filtra origen por sucursal, permite destino físico distinto y descarta el formulario al cambiar de sucursal', async () => {
    await open('Traslado'); expect([...node.querySelector('#operacion-ubicacion').options].map(o => o.value)).toEqual(['', '11', '12']);
    await change('#operacion-ubicacion', '11'); expect([...node.querySelector('#operacion-destino').options].map(o => o.value)).toEqual(['', '12', '22']);
    await change('#operacion-cantidad', '2'); qa.contexto = { ...qa.contexto, sucursalActivaId: 2 }; await render();
    expect(node.querySelector('#operacion-cantidad').value).toBe(''); expect(node.querySelector('#operacion-ubicacion').value).toBe('');
    expect([...node.querySelector('#operacion-ubicacion').options].map(o => o.value)).toEqual(['', '22']);
    expect(qa.load).toHaveBeenLastCalledWith(expect.objectContaining({ sucursalId: 2 }));
  });
  it('no muestra cero cuando falla la consulta de stock y permite reintentar', async () => {
    qa.stock.mockRejectedValue(new Error('Conexión no disponible')); await open(); await change('#operacion-ubicacion', '11'); await change('#operacion-cantidad', '2');
    expect(node.querySelector('.operaciones-final strong').textContent).toBe('—'); expect(node.textContent).toContain('Conexión no disponible');
    expect(button('Registrar entrada').disabled).toBe(true); await submit(); expect(qa.ejecutar).not.toHaveBeenCalled();
    qa.stock.mockResolvedValue(120); await click('Reintentar'); expect(node.querySelector('.operaciones-final strong').textContent).toBe('122');
  });
  it('muestra el fallo de carga inicial y recupera los datos al reintentar', async () => {
    qa.load.mockRejectedValueOnce(new Error('Sin permisos de consulta')); await open();
    expect(node.textContent).toContain('Sin permisos de consulta'); expect(button('Registrar entrada').disabled).toBe(true);
    await click('Reintentar'); expect(node.querySelector('#operacion-presentacion').value).toBe('1');
  });
  it('rechaza el exceso convertido sin llamar al motor', async () => {
    await open('Traslado'); await change('#operacion-ubicacion', '11'); await change('#operacion-destino', '22'); await change('#operacion-presentacion', '2'); await change('#operacion-cantidad', '11');
    expect(node.textContent).toContain('supera el stock'); expect(button('Registrar traslado').disabled).toBe(true); await submit(); expect(qa.ejecutar).not.toHaveBeenCalled();
  });
  it('acepta ajuste a cero con motivo y bloquea un motivo vacío', async () => {
    await open('Ajuste'); await change('#operacion-ubicacion', '11'); await change('#operacion-cantidad', '0');
    expect(button('Registrar ajuste').disabled).toBe(true); await submit(); expect(qa.ejecutar).not.toHaveBeenCalled();
    await change('#operacion-motivo', '   '); expect(button('Registrar ajuste').disabled).toBe(true);
    await change('#operacion-motivo', 'Conteo físico verificado'); snapshot('ajuste');
    await submit(); expect(qa.ejecutar).toHaveBeenCalledWith(expect.objectContaining({ cantidadObjetivo: '0', motivo: 'Conteo físico verificado', modo: 'AJUSTE' }));
  });
  it.each(['operario', 'cajero'])('conserva la restricción de ajustes para %s', async rol => {
    qa.usuario.rol = rol; await render(); expect(button('Ajuste')).toBeUndefined();
  });
  it('si el stock cambió muestra el saldo nuevo y exige volver a revisarlo', async () => {
    await open(); await change('#operacion-ubicacion', '11'); await change('#operacion-cantidad', '2');
    qa.stock.mockResolvedValue(125); await submit(); expect(qa.ejecutar).not.toHaveBeenCalled();
    expect(node.querySelector('[role="alert"]').textContent).toContain('Las existencias cambiaron'); expect(node.querySelector('.operaciones-final strong').textContent).toBe('127');
    await submit(); expect(qa.ejecutar).toHaveBeenCalledTimes(1);
  });
  it('no repite el envío con doble confirmación y conserva la clave tras un error de entrada', async () => {
    await open(); await change('#operacion-ubicacion', '11'); await change('#operacion-cantidad', '2');
    qa.ejecutar.mockResolvedValueOnce({ error: new Error('Respuesta perdida') });
    await act(async () => { const form = node.querySelector('form'); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(qa.ejecutar).toHaveBeenCalledTimes(1); expect(node.querySelector('#operacion-cantidad').value).toBe('2');
    const clave = qa.ejecutar.mock.calls[0][0].idempotencia; await submit(); expect(qa.ejecutar.mock.calls[1][0].idempotencia).toBe(clave);
  });
  it('informa un fallo de asignación como advertencia de un movimiento que ya se registró', async () => {
    qa.asignar.mockRejectedValue(new Error('Sin permisos')); await open(); await change('#operacion-ubicacion', '11'); await change('#operacion-cantidad', '2'); await submit();
    expect(node.querySelector('[role="alert"]').textContent).toContain('ya quedó registrado'); expect(node.textContent).toContain('Kardex #99'); expect(qa.ejecutar).toHaveBeenCalledTimes(1);
  });
  it('limpia la cantidad al cambiar la presentación para no reinterpretar lo escrito', async () => {
    await open(); await change('#operacion-cantidad', '12'); await change('#operacion-presentacion', '2'); expect(node.querySelector('#operacion-cantidad').value).toBe('');
  });
  it('cambiar de sucursal durante la comprobación final cancela el envío anterior', async () => {
    await open(); await change('#operacion-ubicacion', '11'); await change('#operacion-cantidad', '2');
    let resolver; qa.stock.mockImplementationOnce(() => new Promise(resolve => { resolver = resolve; }));
    await act(async () => node.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    qa.contexto = { ...qa.contexto, sucursalActivaId: 2 }; await render();
    await act(async () => resolver(120)); expect(qa.ejecutar).not.toHaveBeenCalled();
    expect(node.querySelector('#operacion-cantidad').value).toBe('');
  });
  it('descarta un saldo atrasado de la ubicación anterior', async () => {
    await open(); let resolver; qa.stock.mockImplementationOnce(() => new Promise(resolve => { resolver = resolve; }));
    await change('#operacion-ubicacion', '11'); await change('#operacion-ubicacion', '12'); await change('#operacion-cantidad', '2');
    expect(node.querySelector('.operaciones-final strong').textContent).toBe('38');
    await act(async () => resolver(999)); expect(node.querySelector('.operaciones-final strong').textContent).toBe('38');
  });
  it.each(['Entrada', 'Salida', 'Traslado', 'Ajuste'])('en %s muestra por defecto sólo ubicaciones del producto con stock actual', async modo => {
    qa.load.mockResolvedValue({ ...datos, ubicaciones: [...datos.ubicaciones,
      { id: 13, label: 'Almacén Central · Vacía', sucursal_id: 1, stock: 0, asignada: true },
      { id: 14, label: 'Almacén Central · Sin movimientos', sucursal_id: 1, stock: 0, asignada: false },
    ] });
    await open(modo);
    expect([...node.querySelector('#operacion-ubicacion').options].map(o => o.value)).toEqual(['', '11', '12']);
    expect(node.querySelector('#operacion-ubicacion').textContent).toContain('120 unidad');
  });
  it('permite recibir en una ubicación sin stock sólo al incluirla explícitamente y descarta la selección al ocultarla', async () => {
    qa.load.mockResolvedValue({ ...datos, ubicaciones: [...datos.ubicaciones, { id: 13, label: 'Almacén Central · Nueva', sucursal_id: 1, stock: 0, asignada: false }] });
    qa.stock.mockImplementation(async ({ ubicacionId }) => ubicacionId === '13' ? 0 : 120);
    await open();
    await act(async () => node.querySelector('.operaciones-location-toggle input').click());
    await change('#operacion-ubicacion', '13'); await change('#operacion-cantidad', '2');
    expect(node.querySelector('.operaciones-final strong').textContent).toBe('2');
    expect(button('Registrar entrada').disabled).toBe(false);
    await act(async () => node.querySelector('.operaciones-location-toggle input').click());
    expect(node.querySelector('#operacion-ubicacion').value).toBe('');
    expect(button('Registrar entrada').disabled).toBe(true); await submit(); expect(qa.ejecutar).not.toHaveBeenCalled();
  });
  it('un producto sin stock no despliega todas las ubicaciones automáticamente', async () => {
    qa.load.mockResolvedValue({ ...datos, ubicaciones: datos.ubicaciones.map(u => ({ ...u, stock: 0 })) });
    await open(); expect(node.querySelector('#operacion-ubicacion').options.length).toBe(1);
    expect(node.textContent).toContain('no tiene ubicaciones con stock actual');
    await act(async () => node.querySelector('.operaciones-location-toggle input').click());
    expect([...node.querySelector('#operacion-ubicacion').options].map(o => o.value)).toEqual(['', '11', '12']);
  });
  it('filtra el destino del traslado y permite incluir una ubicación vacía para recibirlo', async () => {
    qa.load.mockResolvedValue({ ...datos, ubicaciones: [...datos.ubicaciones, { id: 23, label: 'Tienda · Nueva', sucursal_id: 2, stock: 0, asignada: false }] });
    qa.stock.mockImplementation(async ({ ubicacionId }) => ubicacionId === '23' ? 0 : 120);
    await open('Traslado'); await change('#operacion-ubicacion', '11');
    expect([...node.querySelector('#operacion-destino').options].map(o => o.value)).toEqual(['', '12', '22']);
    await act(async () => node.querySelector('.operaciones-location-toggle input').click());
    await change('#operacion-destino', '23'); await change('#operacion-cantidad', '2');
    expect(node.querySelector('.operaciones-final strong').textContent).toBe('2');
    await submit(); expect(qa.ejecutar).toHaveBeenCalledWith(expect.objectContaining({ modo: 'TRASLADO', ubicacionDestinoId: '23' }));
  });
  it('restaura Salida con presentación visible, saldo final y registro negativo en el historial', async () => {
    await open('Salida'); await change('#operacion-ubicacion', '11'); await change('#operacion-presentacion', '2'); await change('#operacion-cantidad', '2');
    await change('#operacion-referencia', 'Retiro de material para exposición');
    expect(node.querySelector('.operaciones-summary-title').textContent).toBe('−24 unidad');
    expect(node.querySelector('.operaciones-final strong').textContent).toBe('96'); snapshot('salida');
    await submit(); expect(qa.ejecutar).toHaveBeenCalledWith(expect.objectContaining({ modo: 'SALIDA', presentacionId: '2', cantidad: '2', ubicacionId: '11', referencia: 'Retiro de material para exposición' }));
    expect(qa.asignar).not.toHaveBeenCalled(); expect(node.textContent).toContain('Salida registrada');
    expect(node.querySelector('.operaciones-history-list').textContent).toContain('−24 unidad');
  });
  it('una salida no permite exceso convertido ni habilita ubicaciones sin stock', async () => {
    await open('Salida'); expect(node.querySelector('.operaciones-location-toggle')).toBeNull();
    await change('#operacion-ubicacion', '11'); await change('#operacion-presentacion', '2'); await change('#operacion-cantidad', '11');
    expect(button('Registrar salida').disabled).toBe(true); expect(node.textContent).toContain('supera el stock');
    await submit(); expect(qa.ejecutar).not.toHaveBeenCalled();
  });
  it('conserva los datos y la clave de una salida cuando debe reintentarse', async () => {
    await open('Salida'); await change('#operacion-ubicacion', '11'); await change('#operacion-cantidad', '2');
    qa.ejecutar.mockResolvedValueOnce({ error: new Error('Respuesta perdida') });
    await submit(); const clave = qa.ejecutar.mock.calls[0][0].idempotencia;
    expect(node.querySelector('#operacion-cantidad').value).toBe('2'); await submit();
    expect(qa.ejecutar.mock.calls[1][0].idempotencia).toBe(clave);
  });
});
