// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapaMuebles from './MapaMuebles';

const db = vi.hoisted(() => ({ tablas: {}, inserts: [], updates: [], rpcs: [], rpcRespuesta: null, rol: 'admin' }));

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
  const rpc = (nombre, args) => { db.rpcs.push({ nombre, args }); return Promise.resolve(db.rpcRespuesta ?? { data: null, error: null }); };
  return { supabase: { from: consulta, rpc } };
});
vi.mock('./lib/useAuth', () => ({ useUsuarioActual: () => ({ id: 'u1', rol: db.rol }) }));
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
  db.inserts = []; db.updates = []; db.rpcs = []; db.rpcRespuesta = null; db.rol = 'admin';
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

  const clic = async (el) => { await act(async () => { el.click(); }); await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
  const botonPapelera = (n) => contenedor.querySelector(`article[aria-label="Estante A"]:not([id*="HUECO"]) button[aria-label="Eliminar compartimiento ${n}"]`);
  const botonDialogo = (texto) => [...contenedor.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === texto);

  it('oculta los controles de eliminar a quien no es admin ni gerente', async () => {
    db.rol = 'operario';
    await montar();
    expect(botonPapelera(1)).toBeNull();
    expect(contenedor.textContent).not.toContain('Eliminar vacíos');
  });

  it('elimina un compartimiento vía RPC tras confirmar', async () => {
    db.rpcRespuesta = { data: { resultado: 'eliminado' }, error: null };
    await montar();
    await clic(botonPapelera(2));
    expect(contenedor.querySelector('[role="dialog"]').textContent).toContain('¿Eliminar compartimiento 2?');
    await clic(botonDialogo('Eliminar'));
    expect(db.rpcs).toEqual([{ nombre: 'eliminar_compartimiento', args: { p_ubicacion_id: 13, p_eliminar_estante: false } }]);
    expect(document.body.textContent).toContain('Compartimiento 2 eliminado');
  });

  it('muestra el aviso de productos cuando el compartimiento no se puede eliminar', async () => {
    db.rpcRespuesta = { data: { resultado: 'tiene_productos', productos: [
      { producto_id: 1, nombre: 'Tornillo', cantidad: 5, asignado: true },
      { producto_id: 2, nombre: 'Tuerca', cantidad: 0, asignado: true },
    ] }, error: null };
    await montar();
    await clic(botonPapelera(1));
    await clic(botonDialogo('Eliminar'));
    const d = contenedor.querySelector('[role="dialog"]');
    expect(d.textContent).toContain('El compartimiento 1 tiene productos');
    expect(d.textContent).toContain('asignado, sin stock');
    expect(botonDialogo('Entendido')).toBeTruthy();
  });

  it('pide confirmar y repite con p_eliminar_estante cuando es el último compartimiento', async () => {
    db.rpcRespuesta = { data: { resultado: 'ultimo_compartimiento' }, error: null };
    await montar();
    await clic(botonPapelera(1));
    await clic(botonDialogo('Eliminar'));
    expect(contenedor.querySelector('[role="dialog"]').textContent).toContain('elimina el Estante A completo');
    db.rpcRespuesta = { data: { resultado: 'eliminado' }, error: null };
    await clic(botonDialogo('Continuar'));
    expect(db.rpcs[1].args).toEqual({ p_ubicacion_id: 12, p_eliminar_estante: true });
  });

  it('traduce el error 42501 a un aviso legible', async () => {
    db.rpcRespuesta = { data: null, error: { code: '42501' } };
    await montar();
    await clic(botonPapelera(1));
    await clic(botonDialogo('Eliminar'));
    expect(document.body.textContent).toContain('No tenés permiso');
  });

  it('elimina los vacíos del mueble y resume el resultado', async () => {
    db.rpcRespuesta = { data: { eliminados: ['4', '5', '6'], archivados: [], con_productos: [{ ubicacion_id: 12, compartimiento: '1', total_productos: 2, productos: [] }] }, error: null };
    await montar();
    const estante = contenedor.querySelector('article[aria-label="Estante A"]:not([id*="HUECO"])');
    await clic([...estante.querySelectorAll('button')].find(b => b.textContent === 'Eliminar vacíos'));
    await clic(botonDialogo('Eliminar vacíos'));
    expect(db.rpcs[0]).toEqual({ nombre: 'eliminar_compartimientos_vacios', args: { p_codigo_zona: 'PLANTA BAJA', p_estante: 'Estante', p_nivel: 'A' } });
    const d = contenedor.querySelector('[role="dialog"]').textContent;
    expect(d).toContain('Eliminados: 4–6');
    expect(d).toContain('1 (2)');
  });
});
