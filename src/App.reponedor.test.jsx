// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ rol: 'reponedor' }));
vi.mock('./supabaseClient', () => ({ supabase: {} }));
vi.mock('./lib/useAuth', () => ({
  useAuth: () => ({ cargando: false, usuario: { id: 'u1', nombre: 'Josias QA', rol: mocks.rol, activo: true, sucursalId: 2 }, signOut: vi.fn() }),
}));
vi.mock('./lib/useSucursal', () => ({
  useSucursal: () => ({ sucursales: [], sucursalActivaId: 2, setSucursalActiva: vi.fn(), puedeElegir: false, nombreSucursal: 'Tienda' }),
}));
// Las pantallas reales no importan: sólo qué ruta queda activa.
vi.mock('./OperacionesMovilApp', () => ({ default: ({ tipoDocumento = 'pedido' }) => <p>INICIO-{tipoDocumento}</p> }));
vi.mock('./TrasladoQrApp', () => ({ default: () => <p>TRASLADO</p> }));
vi.mock('./TableroAlmacenApp', () => ({ default: () => <p>TABLERO</p> }));
vi.mock('./PedidoDetallePage', () => ({ default: () => <p>PEDIDO</p> }));
vi.mock('./FichaProductoPage', () => ({ default: () => <p>FICHA-PRODUCTO</p> }));
vi.mock('./FichaUbicacionPage', () => ({ default: () => <p>FICHA-UBICACION</p> }));
import App from './App';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
const ruta = vi.fn();
function Ruta() { const { pathname } = useLocation(); useEffect(() => { ruta(pathname); }, [pathname]); return null; }
const rutaActual = () => ruta.mock.calls.at(-1)[0];
async function ir(entrada) {
  await act(async () => root.render(<MemoryRouter initialEntries={[entrada]}><App /><Ruta /></MemoryRouter>));
}
beforeEach(() => { ruta.mockClear(); mocks.rol = 'reponedor'; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('rutas del reponedor', () => {
  it.each(['/', '/tablero', '/pedidos/1', '/productos/4/ficha', '/ubicaciones/3/ficha', '/operaciones/vtd/1', '/operaciones/carrito', '/operaciones/carrito/9', '/operaciones/pedidos/7', '/operaciones/traslados-virtuales/2', '/operaciones/otra-cosa'])(
    '%s vuelve a /operaciones', async entrada => {
      await ir(entrada);
      expect(rutaActual()).toBe('/operaciones');
      expect(container.textContent).toBe('INICIO-pedido');
    });

  it('/operaciones/traslados/5 se queda', async () => {
    await ir('/operaciones/traslados/5');
    expect(rutaActual()).toBe('/operaciones/traslados/5');
    expect(container.textContent).toBe('TRASLADO');
  });

  it('un vendedor sigue entrando a su carrito (no cambió)', async () => {
    mocks.rol = 'vendedor';
    await ir('/operaciones/carrito');
    expect(rutaActual()).toBe('/operaciones/carrito');
    expect(container.textContent).toBe('INICIO-carrito');
  });
});
