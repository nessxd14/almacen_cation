// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import OperacionesMovilApp from './OperacionesMovilApp';

const qa = vi.hoisted(() => ({ datos: null, siguiente: null, rpc: vi.fn(), rol: 'almacenero', error: null, sucursalPerfil: null }));
vi.mock('./lib/useAuth', () => ({ useAuth: () => ({ usuario: { id: 'operario-qa', nombre: 'Ana QA', rol: qa.rol, activo: true, sucursalId: qa.sucursalPerfil } }) }));
vi.mock('./lib/useSucursal', () => ({ useSucursal: () => ({ sucursalActivaId: 1, sucursales: [{ id: 1, nombre: 'Almacén QA', tipo: 'fisica' }], puedeElegir: false, cargando: false }) }));
vi.mock('./supabaseClient', () => ({ supabase: {
  rpc: qa.rpc,
  from: () => {
    const query = { select: () => query, in: () => query, eq: () => query, order: () => query, limit: () => query, then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject) };
    return query;
  },
} }));
vi.mock('./EscanerCodigo', () => ({ default: ({ onDetect }) => <button onClick={() => { onDetect('https://almacen.example/productos/4/ficha?sucursal=1&presentacion=12'); onDetect('https://almacen.example/productos/999/ficha'); }}>Leer QR QA</button> }));

let root, nodo;
const buscarBoton = nombre => [...nodo.querySelectorAll('button')].find(b => b.textContent.trim() === nombre);
const campo = prefijo => { const label = [...nodo.querySelectorAll('label')].find(l => l.textContent.startsWith(prefijo)); return label?.querySelector('input,textarea') || document.getElementById(label?.htmlFor); };
async function pulsar(nombre) { await act(async () => { buscarBoton(nombre).click(); }); }
async function escribir(elemento, texto) { await act(async () => { const proto = elemento.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(elemento, texto); elemento.dispatchEvent(new Event('input', { bubbles: true })); elemento.dispatchEvent(new Event('change', { bubbles: true })); }); }
async function enviar(nombre) { await act(async () => { buscarBoton(nombre).closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function montar(ruta = '/operaciones/pedidos/248') { await act(async () => { root.render(<MemoryRouter initialEntries={[ruta]}><Routes><Route path="/operaciones" element={<OperacionesMovilApp />} /><Route path="/operaciones/pedidos/:id" element={<OperacionesMovilApp />} /></Routes></MemoryRouter>); }); }
const ultimo = () => qa.rpc.mock.calls.at(-1)[1];
function capturar(nombre) {
  if (!env.CATION_QA_OUTPUT) return;
  const css = readFileSync('src/operaciones-movil.css', 'utf8') + readFileSync('src/preparacion-checklist.css', 'utf8');
  writeFileSync(`${env.CATION_QA_OUTPUT}/operaciones-${nombre}.html`, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Operaciones · datos ficticios QA</title><style>body{margin:0;font-family:Arial,sans-serif;background:#f8fafc}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}${css}</style><body>${nodo.innerHTML}</body></html>`);
}
function estado(nombre, version) { return { ...qa.datos, tarea: { ...qa.datos.tarea, estado: nombre, version } }; }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  qa.rol = 'almacenero'; qa.error = null; qa.siguiente = null; qa.sucursalPerfil = null;
  qa.datos = { pedido: { id: 248, numero: 'P-248', cliente: 'Cliente QA', estado: 'ABIERTO' }, tarea: { id: 10, preparador_id: 'operario-qa', preparador_nombre: 'Ana QA', estado: 'PREPARANDO', version: 1 }, cambios: [], eventos: [], otras_sucursales: 0, entregada: false, lineas: [{ pedido_linea_id: 31, vigente: true, confirmada: false, preparada_base: 0, revisada_base: null, observacion: '', snapshot: { producto_id: 4, nombre: 'Bolígrafos QA', sku: 'B-4', unidad_base: 'unidad', presentacion_id: 12, presentacion: 'Caja', factor: 12, pendiente_base: 24, preparable: true, estado: 'POR_DESPACHAR' } }] };
  qa.rpc.mockReset().mockImplementation(async () => {
    if (qa.error) return { data: null, error: { message: qa.error } };
    if (qa.siguiente) { qa.datos = qa.siguiente; qa.siguiente = null; }
    return { data: structuredClone(qa.datos), error: null };
  });
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); });

describe('preparación y revisión en el celular', () => {
  it('resume antes de confirmar el resto y conserva las líneas con faltantes', async () => {
    const completa = structuredClone(qa.datos.lineas[0]);
    const parcial = { ...completa, pedido_linea_id: 32, confirmada: true, preparada_base: 12, observacion: 'Falta una caja' };
    qa.datos.lineas.push(parcial);
    await montar();
    await pulsar('Confirmar el resto completo');
    expect(qa.rpc).toHaveBeenCalledTimes(1);
    expect(nodo.textContent).toContain('1 con faltantes');
    capturar('confirmar-resto');
    expect(nodo.textContent).toContain('Confirmar 1 línea completa');
    qa.siguiente = { ...qa.datos, tarea: { ...qa.datos.tarea, version: 2 }, lineas: [{ ...completa, confirmada: true, preparada_base: 24 }, parcial], confirmacion_preparacion: { confirmadas: 1 } };
    await pulsar('Confirmar 1 línea');
    expect(qa.rpc.mock.calls.at(-1)).toEqual(['confirmar_resto_preparacion', { p_tipo: 'PEDIDO', p_documento_id: '248', p_sucursal_id: 1, p_tarea_id: 10, p_version: 1 }]);
    expect(nodo.textContent).toContain('Falta una caja');
    expect(nodo.textContent).toContain('Se conservaron los faltantes');
    expect(buscarBoton('Confirmar el resto completo')).toBeUndefined();
    expect(buscarBoton('Terminar preparación')).toBeTruthy();
    expect(buscarBoton('Confirmar revisión de esta entrega')).toBeUndefined();
  });
  it('cancelar el resumen no confirma líneas y editar una cantidad bloquea la confirmación conjunta', async () => {
    await montar(); await pulsar('Confirmar el resto completo'); await pulsar('Cancelar');
    expect(qa.rpc).toHaveBeenCalledTimes(1);
    await pulsar('Registrar faltante');
    expect(buscarBoton('Confirmar el resto completo').disabled).toBe(true);
  });
  it('conserva el resumen si falla la confirmación del resto', async () => {
    await montar(); await pulsar('Confirmar el resto completo'); qa.error = 'La preparación cambió en otro celular.';
    await pulsar('Confirmar 1 línea');
    expect(nodo.textContent).toContain('otro celular');
    expect(buscarBoton('Confirmar 1 línea')).toBeTruthy();
    expect(nodo.textContent).not.toContain('Se conservaron los faltantes');
  });
  it('la confirmación del resto no está disponible en la revisión ni para otro preparador', async () => {
    qa.datos.tarea.preparador_id = 'otra-persona';
    await montar();
    expect(buscarBoton('Confirmar el resto completo')).toBeUndefined();
  });
  it('abre el pedido del QR de Seller en la sucursal activa', async () => {
    await montar('/operaciones');
    capturar('inicio');
    await escribir(campo('QR de documento'), 'https://seller.example/pedidos/248'); await enviar('Abrir');
    expect(nodo.textContent).toContain('Pedido P-248');
    expect(ultimo()).toMatchObject({ p_pedido_id: '248', p_sucursal_id: 1, p_accion: 'escanear' });
  });
  it('convierte cajas a unidades base, exige motivo de faltante y guarda la versión', async () => {
    await montar(); await pulsar('Registrar faltante'); await escribir(campo('Preparado en'), '1');
    capturar('preparacion');
    await enviar('Guardar preparación');
    expect(nodo.textContent).toContain('Indica el motivo');
    expect(qa.rpc).toHaveBeenCalledTimes(1);
    await escribir(campo('Observación'), 'Falta una caja');
    qa.siguiente = { ...estado('PREPARANDO', 2), lineas: [{ ...qa.datos.lineas[0], confirmada: true, preparada_base: 12, observacion: 'Falta una caja' }] };
    await enviar('Guardar preparación');
    expect(ultimo()).toMatchObject({ p_accion: 'guardar_preparacion', p_version: 1, p_datos: { linea_id: 31, cantidad_base: 12, observacion: 'Falta una caja' } });
    expect(nodo.textContent).toContain('Con faltante');
    qa.siguiente = estado('PREPARADO', 3); await pulsar('Terminar preparación');
    expect(ultimo().p_accion).toBe('preparado');
    expect(buscarBoton('Tomar revisión')).toBeTruthy();
  });
  it('una lectura repetida no reemplaza el QR y contar es obligatorio', async () => {
    qa.datos = { ...estado('REVISANDO', 4), tarea: { ...estado('REVISANDO', 4).tarea, preparador_id: 'otro-operario', revisor_id: 'operario-qa' }, lineas: [{ ...qa.datos.lineas[0], confirmada: true, preparada_base: 12 }] };
    await montar(); await pulsar('Escanear y contar'); await pulsar('Leer QR QA');
    expect(campo('Código leído').value).toContain('/productos/4/');
    expect(campo('Cantidad contada').value).toBe('');
    capturar('revision');
    await escribir(campo('Cantidad contada'), '2'); await enviar('Guardar comprobación');
    expect(nodo.textContent).toContain('no coincide');
    expect(qa.rpc).toHaveBeenCalledTimes(1);
    await escribir(campo('Cantidad contada'), '1');
    qa.siguiente = { ...qa.datos, tarea: { ...qa.datos.tarea, version: 5 }, lineas: [{ ...qa.datos.lineas[0], revisada_base: 12, metodo_revision: 'escaneo', revisor_nombre: 'Ana QA' }] };
    await enviar('Guardar comprobación');
    expect(ultimo()).toMatchObject({ p_accion: 'guardar_revision', p_version: 4, p_datos: { cantidad_base: 12, metodo: 'escaneo', codigo: 'https://almacen.example/productos/4/ficha?sucursal=1&presentacion=12' } });
    qa.siguiente = estado('VERIFICADO', 6); await pulsar('Confirmar revisión de esta entrega');
    expect(ultimo().p_accion).toBe('verificado');
    expect(nodo.textContent).toContain('Quedan cantidades pendientes');
    expect(qa.rpc.mock.calls.every(([rpc]) => rpc === 'operar_preparacion_pedido')).toBe(true);
  });
  it('un cambio de Seller impide confirmar y permite actualizar las líneas', async () => {
    qa.datos.cambios = [31];
    await montar();
    expect(buscarBoton('Registrar faltante')).toBeUndefined();
    expect(buscarBoton('Terminar preparación')).toBeUndefined();
    await pulsar('Actualizar preparación');
    expect(ultimo()).toMatchObject({ p_accion: 'sincronizar', p_version: 1 });
  });
  it('conserva el formulario cuando guardar falla y no muestra éxito', async () => {
    await montar(); await pulsar('Registrar faltante');
    await escribir(campo('Preparado en'), '2');
    qa.error = 'La preparación cambió en otro celular.';
    await enviar('Guardar preparación');
    expect(nodo.textContent).toContain('cambió en otro celular');
    expect(campo('Preparado en').value).toBe('2');
    expect(nodo.textContent).not.toContain('Avance guardado');
  });
  it('permite ingresar código sin cámara y distingue la revisión visual', async () => {
    qa.datos = { ...estado('REVISANDO', 4), tarea: { ...estado('REVISANDO', 4).tarea, preparador_id: 'otro-operario', revisor_id: 'operario-qa' }, lineas: [{ ...qa.datos.lineas[0], confirmada: true, preparada_base: 24 }] };
    await montar(); await pulsar('Ingresar código'); await escribir(campo('Código leído'), 'CAJA-4'); await escribir(campo('Cantidad contada'), '2'); await enviar('Guardar comprobación');
    expect(ultimo().p_datos).toMatchObject({ cantidad_base: 24, metodo: 'escaneo', codigo: 'CAJA-4' });
    await pulsar('Comprobar visualmente'); await escribir(campo('Cantidad contada'), '2'); await enviar('Guardar comprobación');
    expect(ultimo().p_datos).toMatchObject({ metodo: 'visual', codigo: '' });
  });
  it('un pedido cancelado se conserva sin botones de confirmación', async () => {
    qa.datos.pedido.estado = 'CANCELADO'; await montar();
    expect(nodo.textContent).toContain('Pedido está cancelado');
    expect(buscarBoton('Registrar faltante')).toBeUndefined();
    expect(buscarBoton('Terminar preparación')).toBeUndefined();
  });
  it('rechaza un perfil que no tiene acceso antes de consultar', async () => {
    qa.rol = 'vendedor'; await montar();
    expect(nodo.textContent).toContain('Tu perfil puede armar traslados');
    expect(qa.rpc).not.toHaveBeenCalled();
  });
  it('permite contar en unidades base si el pendiente no forma cajas completas', async () => {
    qa.datos.lineas[0].snapshot.pendiente_base = 13;
    await montar(); await pulsar('Registrar faltante');
    expect(campo('Preparado en').value).toBe('');
    expect([...nodo.querySelectorAll('select')].find(s => s.closest('label')?.textContent.startsWith('Unidad de conteo')).value).toBe('base');
    await escribir(campo('Preparado en'), '13');
    await enviar('Guardar preparación');
    expect(ultimo().p_datos.cantidad_base).toBe(13);
  });
  it('bloquea envíos duplicados mientras el servidor guarda', async () => {
    await montar(); await pulsar('Registrar faltante');
    await escribir(campo('Preparado en'), '2');
    let resolver;
    qa.rpc.mockImplementationOnce(() => new Promise(resolve => { resolver = resolve; }));
    await enviar('Guardar preparación');
    expect(buscarBoton('Guardando…').disabled).toBe(true);
    await enviar('Guardando…');
    expect(qa.rpc).toHaveBeenCalledTimes(2);
    await act(async () => resolver({ data: structuredClone(qa.datos), error: null }));
  });
  it('bloquea enlaces de una sucursal diferente a la asignada al perfil', async () => {
    qa.sucursalPerfil = 1;
    await montar('/operaciones/pedidos/248?preparacion=10&sucursal=2');
    expect(nodo.textContent).toContain('otra sucursal');
    expect(qa.rpc).not.toHaveBeenCalled();
  });
  it('marca completo con un toque sin inventar revisión ni mover stock', async () => {
    await montar();
    expect(nodo.textContent).not.toContain('Entrega parcial');
    qa.siguiente = { ...estado('PREPARANDO', 2), lineas: [{ ...qa.datos.lineas[0], confirmada: true, preparada_base: 24 }] };
    await pulsar('Completo');
    expect(ultimo()).toMatchObject({ p_accion: 'guardar_preparacion', p_version: 1, p_datos: { linea_id: 31, cantidad_base: 24, observacion: '' } });
    expect(buscarBoton('Editar preparación')).toBeTruthy();
    expect(buscarBoton('Confirmar revisión de esta entrega')).toBeUndefined();
    expect(qa.rpc.mock.calls.every(([nombre]) => nombre === 'operar_preparacion_pedido')).toBe(true);
  });
  it('registra cero con motivo para un producto no alistado y permite filtrarlo', async () => {
    await montar(); await pulsar('No se alistó'); await enviar('Guardar preparación');
    expect(nodo.textContent).toContain('Indica el motivo');
    expect(qa.rpc).toHaveBeenCalledTimes(1);
    await pulsar('No se alistó a tiempo');
    qa.siguiente = { ...estado('PREPARANDO', 2), lineas: [{ ...qa.datos.lineas[0], confirmada: true, preparada_base: 0, observacion: 'No se alistó a tiempo' }] };
    await enviar('Guardar preparación');
    expect(ultimo().p_datos).toEqual({ linea_id: 31, cantidad_base: 0, observacion: 'No se alistó a tiempo' });
    expect(nodo.querySelector('article').textContent).toContain('No alistado');
    expect(buscarBoton('Terminar preparación').disabled).toBe(true);
    const filtro = [...nodo.querySelectorAll('.om-filters button')].find(b => b.textContent.startsWith('Completos'));
    await act(async () => filtro.click());
    expect(nodo.querySelector('article').hidden).toBe(true);
    await pulsar('Ver todos los productos');
    expect(nodo.querySelector('article').hidden).toBe(false);
  });
});
