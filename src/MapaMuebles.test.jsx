// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapaMuebles from './MapaMuebles';

const db = vi.hoisted(() => ({ tablas: {}, inserts: [], updates: [] }));

// Constructor de consultas mínimo: cada cadena termina en una promesa con los datos de la tabla.
vi.mock('./supabaseClient', () => {
  const consulta = (tabla) => {
    const q = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, or: () => q, order: () => q, limit: () => q, range: () => q,
      insert: (filas) => { db.inserts.push({ tabla, filas }); return Promise.resolve({ error: null }); },
      update: (valores) => { db.updates.push({ tabla, valores }); return q; },
      delete: () => q,
      then: (ok, mal) => Promise.resolve({ data: db.tablas[tabla] ?? [], error: null }).then(ok, mal),
    };
    return q;
  };
  return { supabase: { from: consulta } };
});
vi.mock('./lib/useSucursal', () => ({ useSucursal: () => ({ sucursalActivaId: 1, nombreSucursal: () => 'Almacén Central' }) }));

const fila = (id, estante, nivel, compartimiento, zona = 'PLANTA BAJA') =>
  ({ id, codigo_zona: zona, estante, nivel, compartimiento, sucursal_id: 1, es_recepcion: false });

let contenedor, root;
async function montar() {
  await act(async () => { root.render(<MemoryRouter><MapaMuebles /></MemoryRouter>); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  db.inserts = []; db.updates = [];
  db.tablas = {
    ubicacion: [
      fila(12, 'Estante', 'A', '1'), fila(13, 'Estante', 'A', '2'), fila(14, 'Estante', 'A', '10'),
      fila(23, 'Pallet', 'A', null),
      fila(4, 'Estante', 'A', '1', 'HUECO'),
      { id: 31, codigo_zona: 'VENTAS DIRECTAS', estante: null, nivel: null, compartimiento: null, sucursal_id: 1 },
    ],
    producto_ubicacion: [{ ubicacion_id: 12 }, { ubicacion_id: 12 }, { ubicacion_id: 23 }],
  };
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  root = createRoot(contenedor);
});

afterEach(() => { act(() => root.unmount()); contenedor.remove(); });

describe('MapaMuebles', () => {
  it('muestra cada mueble con su letra y los compartimientos en orden numérico', async () => {
    await montar();
    const zonas = [...contenedor.querySelectorAll('section[aria-label^="Zona"] h2')].map(h => h.textContent);
    expect(zonas).toEqual(['HUECO', 'PLANTA BAJA']);
    const estante = contenedor.querySelector('article[aria-label="Estante A"]:not([id*="HUECO"])');
    const casillas = [...estante.querySelectorAll('ol a')].map(a => a.firstChild.textContent);
    expect(casillas).toEqual(['1', '2', '10']);
    expect(estante.textContent).toContain('3 compartimientos · 2 productos');
    expect(contenedor.querySelector('article[aria-label="Pallet A"]').textContent).toContain('Sin divisiones');
  });

  it('deja las áreas especiales fuera de los muebles', async () => {
    await montar();
    const especiales = contenedor.querySelector('section[aria-label="Áreas especiales"]');
    expect(especiales.textContent).toContain('VENTAS DIRECTAS');
  });

  it('crea un mueble nuevo con la siguiente letra, compartimientos numerados y la sucursal', async () => {
    await montar();
    const zonaPB = [...contenedor.querySelectorAll('section[aria-label^="Zona"]')].find(s => s.getAttribute('aria-label') === 'Zona PLANTA BAJA');
    await act(async () => { [...zonaPB.querySelectorAll('button')].find(b => b.textContent === 'Mueble').click(); });
    const form = zonaPB.querySelector('form');
    expect(form.querySelectorAll('select')[1].value).toBe('B');
    await act(async () => { form.querySelector('button[type="submit"]').click(); });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].filas.map(f => `${f.estante} ${f.nivel} › ${f.compartimiento}`)).toEqual(
      ['Estante B › 1', 'Estante B › 2', 'Estante B › 3', 'Estante B › 4']);
    expect(db.inserts[0].filas.every(f => f.sucursal_id === 1 && f.codigo_zona === 'PLANTA BAJA')).toBe(true);
  });

  it('no deja eliminar un mueble con productos', async () => {
    await montar();
    const pallet = contenedor.querySelector('article[aria-label="Pallet A"]');
    const eliminar = [...pallet.querySelectorAll('button')].find(b => b.textContent === 'Eliminar');
    expect(eliminar.disabled).toBe(true);
  });
});
