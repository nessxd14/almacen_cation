// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import ConteoControlado from './ConteoControlado';

const qa = vi.hoisted(() => ({ detalle: null, queue: [], online: true, errorSync: null, rpc: vi.fn(), sync: vi.fn(), prefill: null }));
vi.mock('./lib/useAuth', () => ({ useUsuarioActual: () => ({ id: 'usuario-qa', rol: 'admin' }) }));
vi.mock('./lib/useSucursal', () => ({ useSucursal: () => ({ sucursalActivaId: 1 }) }));
vi.mock('./lib/useAppNav', () => ({ useAppNav: () => ({ conteoPrefill: qa.prefill, setConteoPrefill: () => {} }) }));
vi.mock('./supabaseClient', () => ({ supabase: { from: table => { const q = { table, select: () => q, eq: () => q, order: () => q }; return q; } } }));
vi.mock('./lib/fetchAll', () => ({ fetchAll: async factory => {
  const table = factory().table;
  if (table === 'ubicacion') return [{ id: 1, sucursal_id: 1, codigo_zona: 'PLANTA BAJA', estante: 'Estante', nivel: 'A', compartimiento: '1' }];
  if (table === 'identificador') return [{ presentacion_id: 2, valor: '779000001' }];
  return [{ id: 1, producto_id: 1, nombre: 'Unidad', factor_unidad_base: 1, es_base: true, producto: { id: 1, nombre: 'Bolígrafos QA', unidad_base: 'unidad' } }, { id: 2, producto_id: 1, nombre: 'Caja x12', factor_unidad_base: 12, producto: { id: 1, nombre: 'Bolígrafos QA', unidad_base: 'unidad' } }];
} }));
vi.mock('./lib/conteoControlado', async importOriginal => ({ ...await importOriginal(),
  operarConteo: qa.rpc, dispositivoConteo: () => 'dispositivo-qa',
  abrirColaConteo: async () => ({ listar: async () => qa.queue, guardar: async c => { qa.queue = [...qa.queue.filter(x => x.uuid !== c.uuid), c]; }, quitar: async id => { qa.queue = qa.queue.filter(c => c.uuid !== id); }, cerrar: () => {} }),
  sincronizarCaptura: qa.sync, fotoConteoControlado: async () => 'data:image/png;base64,iVBORw0KGgo=',
}));
vi.mock('./EscanerCodigo', () => ({ default: ({ onDetect }) => <button type="button" onClick={() => onDetect('https://almacen.example/productos/1/ficha?sucursal=1&presentacion=2')}>Leer etiqueta QA</button> }));

let root, node;
const button = text => [...node.querySelectorAll('button')].find(b => b.textContent.trim() === text);
const field = prefix => [...node.querySelectorAll('label')].find(l => l.textContent.startsWith(prefix))?.querySelector('input,select,textarea');
const click = async text => { await act(async () => { button(text).click(); }); };
async function write(el, value) {
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function submit(text) { await act(async () => { button(text).closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function mount(revision = false) {
  await act(async () => { root.render(<ConteoControlado revision={revision} />); });
  await act(async () => { await new Promise(r => setTimeout(r, 15)); });
}
async function openFirst(revision = false) { await mount(revision); const b = node.querySelector('.conteo-session'); await act(async () => b.click()); }
function snapshot(name) {
  if (!env.CATION_QA_OUTPUT) return;
  const css = readFileSync('src/conteo-controlado.css', 'utf8');
  writeFileSync(`${env.CATION_QA_OUTPUT}/conteo-${name}.html`, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conteo · QA sintético</title><style>body{margin:0;background:#f3f6fa;font-family:Arial,sans-serif}*{box-sizing:border-box}${css}</style><body>${node.innerHTML}</body></html>`);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  qa.queue = []; qa.online = true; qa.errorSync = null; qa.prefill = null;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => qa.online });
  qa.detalle = { sesion: { id: 1, nombre: 'Piloto Estante A', estado: 'CAPTURA', metodo: 'DOBLE_CIEGO', tipo: 'VERIFICACION', alcance: 'PARCIAL', ubicacion_id: 1, corte_en: '2026-10-19T12:00:00Z', version: 1 }, rondas: [], productos: [{ producto_id: 1, nombre: 'Bolígrafos QA', unidad_base: 'unidad', contado: false, teorico: null, conteo_1: null, conteo_2: null }], capturas: [], puede_revisar: false, puede_cancelar: true, sin_catalogo: [], evidencias: [], eventos: [] };
  qa.rpc.mockReset().mockImplementation(async (action, id, data) => {
    if (action === 'listar') return { sesiones: [qa.detalle.sesion], anteriores: 3 };
    if (action === 'tomar_ronda') qa.detalle.rondas = [{ numero: data.ronda, mia: true, finalizada: false, dispositivo: data.dispositivo }];
    if (action === 'resolver') qa.detalle.productos[0] = { ...qa.detalle.productos[0], cantidad_final: data.cantidad_base, aprobada: true, motivo: data.motivo };
    if (action === 'finalizar_ronda') { qa.detalle.rondas[0].finalizada = true; }
    if (action === 'aplicar') qa.detalle.sesion.estado = 'APLICADA';
    return structuredClone(qa.detalle);
  });
  qa.sync.mockReset().mockImplementation(async c => {
    if (qa.errorSync) throw new Error(qa.errorSync);
    qa.detalle.capturas.push({ ...c.datos, factor: 12, anulada: false }); qa.detalle.productos[0].contado = true;
    return structuredClone(qa.detalle);
  });
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

describe('conteo controlado', () => {
  it('define alcance y advierte el bloqueo antes de iniciar', async () => {
    await mount(); await click('Nuevo conteo');
    expect(button('Iniciar y bloquear ubicación').disabled).toBe(true);
    await write(field('Ubicación'), '1');
    expect(node.textContent).toContain('se bloquearán entradas y salidas');
    snapshot('inicio');
    await submit('Iniciar y bloquear ubicación');
    const data = qa.rpc.mock.calls.find(c => c[0] === 'crear')[2];
    expect(data).toMatchObject({ ubicacion_id: 1, alcance: 'UBICACION', tipo: 'VERIFICACION' });
    expect(data).not.toHaveProperty('actor'); expect(data.solicitud).toBeTruthy();
  });
  it('retoma la sesión y escanea la presentación exacta del QR', async () => {
    await openFirst(); await click('Tomar ronda 1');
    expect(button('Tomar ronda 2').disabled).toBe(true);
    expect(node.textContent).not.toContain('Registrado al corte');
    await click('Escanear código'); await click('Leer etiqueta QA');
    expect(node.textContent).toContain('12 unidad por presentación');
    await write(field('Cantidad de Caja x12'), '2');
    expect(node.textContent).toContain('24 unidad');
    snapshot('captura');
  });
  it('acepta cero pero exige reconteo y motivo al resolver diferencias', async () => {
    qa.detalle.sesion.estado = 'REVISION'; qa.detalle.puede_revisar = true;
    qa.detalle.productos[0] = { ...qa.detalle.productos[0], teorico: 10, conteo_1: 8, conteo_2: 7 };
    await openFirst(true);
    await write(field('Cantidad final'), '0'); await write(field('Causa y revisión'), 'Se confirmó estante vacío en reconteo');
    expect(button('Aprobar producto').disabled).toBe(true);
    await act(async () => field('Confirmo que se recontó').click());
    expect(button('Aprobar producto').disabled).toBe(false);
    snapshot('revision');
    await submit('Aprobar producto');
    expect(qa.rpc.mock.calls.find(c => c[0] === 'resolver')[2]).toMatchObject({ cantidad_base: 0, reconteo_confirmado: true, version: 1 });
    expect(node.textContent).toContain('Aprobado: 0');
  });
  it('no finaliza con una captura pendiente y conserva el error de subida', async () => {
    qa.errorSync = 'La foto no se pudo subir';
    qa.queue = [{ uuid: 'pendiente', usuarioId: 'usuario-qa', sesionId: 1, etiqueta: 'Bolígrafos QA · 0', datos: {}, foto: {} }];
    qa.detalle.rondas = [{ numero: 1, mia: true, finalizada: false, dispositivo: 'dispositivo-qa' }];
    qa.detalle.productos[0].contado = true;
    await openFirst();
    await act(async () => field('Terminé el recorrido').click());
    expect(button('Finalizar mi ronda').disabled).toBe(true);
    expect(node.textContent).toContain('La foto no se pudo subir');
    expect(qa.queue).toHaveLength(1); snapshot('pendiente');
  });
  it('finaliza con el manifiesto completo y no muestra la ronda ajena', async () => {
    qa.detalle.rondas = [{ numero: 1, mia: true, finalizada: false, dispositivo: 'dispositivo-qa' }];
    qa.detalle.productos[0].contado = true;
    qa.detalle.capturas = [{ uuid: 'captura-1', presentacion_id: 1, cantidad: 0, factor: 1, foto_ref: 'foto', anulada: false }];
    await openFirst();
    await act(async () => field('Terminé el recorrido').click()); await click('Finalizar mi ronda');
    expect(qa.rpc.mock.calls.find(c => c[0] === 'finalizar_ronda')[2]).toMatchObject({ capturas: ['captura-1'], confirmo_sin_pendientes: true });
    expect(node.textContent).toContain('La otra persona debe completar');
  });
  it('conserva capturas al fallar la red y no mezcla la cola de otros usuarios', async () => {
    qa.online = false;
    qa.queue = [{ uuid: 'ajena', usuarioId: 'otra-persona', sesionId: 1, etiqueta: 'No mostrar', datos: {}, foto: {} }];
    await openFirst();
    expect(node.textContent).not.toContain('No mostrar'); expect(qa.sync).not.toHaveBeenCalled();
    expect(node.textContent).toContain('Sin conexión');
  });
});
