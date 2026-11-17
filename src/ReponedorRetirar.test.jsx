// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { seccionesTrasladosPiso } from './lib/trasladosPiso';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), codigo: '' }));
vi.mock('./supabaseClient', () => ({ supabase: { rpc: (...a) => mocks.rpc(...a) } }));
vi.mock('./lib/useAuth', () => ({
  useAuth: () => ({ usuario: { id: 'u1', nombre: 'Josias', rol: 'reponedor', activo: true, sucursalId: 2 }, signOut: vi.fn() }),
}));
vi.mock('./lib/useSucursal', () => ({
  useSucursal: () => ({ sucursales: [{ id: 2, nombre: 'Tienda', tipo: 'fisica' }] }),
}));
vi.mock('./EscanerCodigo', () => ({ default: ({ onDetect }) => <button onClick={() => onDetect(mocks.codigo)}>LEER</button> }));
import ReponedorRetirar from './ReponedorRetirar';

const hora = '2026-11-17T15:30:00Z';
const traslados = [
  { id: 1, numero: 'TRA-1', estado: 'PREPARADO', tarea_estado: 'PREPARADO', mio: true, alista: 'Ivar', alistado_en: hora, lineas: 3, retiro_mio: false },
  { id: 2, numero: 'TRA-2', estado: 'REVISANDO', tarea_estado: 'REVISANDO', mio: false, alista: 'Ivar', alistado_en: hora, lineas: 2, retiro_mio: true },
  { id: 3, numero: 'TRA-3', estado: 'REVISANDO', tarea_estado: 'REVISANDO', mio: false, alista: 'Ivar', alistado_en: hora, lineas: 4, retiro_mio: false },
  { id: 4, numero: 'TRA-4', estado: 'PREPARANDO', tarea_estado: 'PREPARANDO', mio: false, alista: 'Gabriel', lineas: 5, retiro_mio: false },
  { id: 5, numero: 'TRA-5', estado: 'SOLICITADO', tarea_estado: null, mio: true, alista: null, lineas: 1, retiro_mio: false },
  { id: 6, numero: 'TRA-6', estado: 'RECIBIDO', tarea_estado: 'RECIBIDO', mio: true, alista: 'Ivar', alistado_en: hora, lineas: 1, retiro_mio: false },
];

describe('secciones de traslados del reponedor', () => {
  it('reparte PREPARADO/REVISANDO propio y oculta el resto', () => {
    const { listo, todavia } = seccionesTrasladosPiso(traslados);
    expect(listo.map(t => [t.id, t.continuar])).toEqual([[1, false], [2, true]]);
    expect(todavia.map(t => [t.id, t.etiqueta])).toEqual([[4, 'En alistado'], [5, 'Pedido']]);
  });
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
const ruta = vi.fn();
function Ruta() { const l = useLocation(); useEffect(() => { ruta(l.pathname + l.search); }, [l.pathname, l.search]); return null; }
const rutaActual = () => ruta.mock.calls.at(-1)[0];
const boton = texto => [...container.querySelectorAll('button')].find(b => b.textContent.includes(texto));
async function montar() {
  await act(async () => root.render(<MemoryRouter initialEntries={['/operaciones']}><Routes><Route path="/operaciones" element={<ReponedorRetirar />} /><Route path="*" element={null} /></Routes><Ruta /></MemoryRouter>));
}
beforeEach(() => {
  vi.clearAllMocks();
  ruta.mockClear();
  mocks.rpc.mockResolvedValue({ data: { sucursal_id: 2, traslados }, error: null });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('inicio «Retirar material»', () => {
  it('muestra cabecera, listo para retirar y todavía en alistado', async () => {
    await montar();
    const t = container.textContent;
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('traslados_piso', { p_dias: 14 });
    expect(t).toContain('Retirar material');
    expect(t).toContain('Josias · reponedor · Tienda');
    expect(t).toContain('Actualizado');
    expect(t).toContain('Traslado TRA-1 · 3 productos');
    expect(t).toContain('lo pediste tú');
    expect(t).toContain('Traslado TRA-2 · 2 productos');
    expect(t).not.toContain('TRA-3');
    expect(t).not.toContain('TRA-6');
    expect(t).toContain('Gabriel lo está alistando');
    expect(t).toContain('Almacén aún no lo toma');
    expect(boton('Comprobar y retirar')).toBeTruthy();
    expect(boton('Seguir comprobando')).toBeTruthy();
    expect(t).toContain('Solo ves los traslados que van a tu sucursal.');
  });

  it('sin traslados listos muestra el estado vacío', async () => {
    mocks.rpc.mockResolvedValue({ data: { sucursal_id: 2, traslados: [traslados[5]] }, error: null });
    await montar();
    expect(container.textContent).toContain('No tienes traslados listos para retirar.');
  });

  it('«Comprobar y retirar» abre el traslado con el escáner', async () => {
    await montar();
    await act(async () => boton('Comprobar y retirar').click());
    expect(rutaActual()).toBe('/operaciones/traslados/1?escanear=1');
  });

  it('escanear un QR de traslado navega a él', async () => {
    mocks.codigo = 'https://almacen.example/operaciones/traslados/42';
    await montar();
    await act(async () => boton('Escanear QR del traslado').click());
    await act(async () => boton('LEER').click());
    expect(rutaActual()).toBe('/operaciones/traslados/42?escanear=1');
  });

  it.each(['VTD-2026-15', 'https://almacen.example/pedidos/9', '7750182000015'])('escanear %s muestra el aviso', async codigo => {
    mocks.codigo = codigo;
    await montar();
    await act(async () => boton('Escanear QR del traslado').click());
    await act(async () => boton('LEER').click());
    expect(rutaActual()).toBe('/operaciones');
    expect(container.textContent).toContain('Ese código no es un traslado. Las ventas de almacén (VTD) las alista y entrega el almacenero.');
  });
});
