// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditarProducto from './EditarProducto';

const sim = vi.hoisted(() => ({ rol: 'admin', tablas: {}, escrituras: [], errorEscritura: null, consultas: [] }));

// Cliente falso encadenable: cada from() resuelve con sim.tablas[tabla] y
// registra insert/update en sim.escrituras.
vi.mock('./supabaseClient', () => {
  const from = (tabla) => {
    let escritura = null;
    const q = {
      select: () => { sim.consultas.push(tabla); return q; },
      eq: () => q, in: () => q, order: () => q,
      insert: (datos) => { escritura = { tabla, tipo: 'insert', datos }; return q; },
      update: (datos) => { escritura = { tabla, tipo: 'update', datos }; return q; },
      delete: () => q,
      single: () => q,
      then: (ok, mal) => {
        if (escritura) {
          sim.escrituras.push(escritura);
          return Promise.resolve({ data: null, error: sim.errorEscritura }).then(ok, mal);
        }
        const data = sim.tablas[tabla] ?? [];
        return Promise.resolve({ data, error: null, count: 0 }).then(ok, mal);
      },
    };
    return q;
  };
  return { supabase: { from } };
});
vi.mock('./lib/useAuth', () => ({ useUsuarioActual: () => ({ id: 'qa', nombre: 'QA', rol: sim.rol }) }));
vi.mock('./CatalogDialog', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('./EscanerCodigo', () => ({ default: () => null }));
vi.mock('./ImagenProducto', () => ({ default: () => null }));

const base = { id: 1, nombre: 'Hoja', es_base: true, activo: true, factor_unidad_base: 1, identificador: [] };
const paquete = { id: 2, nombre: 'PAQUETE', es_base: false, activo: true, factor_unidad_base: 500, precio: 30, identificador: [] };
const master = { id: 3, nombre: 'CAJA MASTER', es_base: false, activo: true, factor_unidad_base: 12000, contiene_presentacion_id: 2, contiene_cantidad: 24, identificador: [] };
const vista = [
  { presentacion_id: 1, producto_id: 9, es_base: true, factor_unidad_base: 1, precio_retail: 36, precio_mayoreo: 30, precio_institucion: 36, precio_corporativo: 36, precio_municipal: 36, tiene_precio_propio: false },
  { presentacion_id: 2, producto_id: 9, es_base: false, factor_unidad_base: 500, precio_retail: 30, precio_mayoreo: 15000, precio_institucion: 18000, precio_corporativo: 18000, precio_municipal: 18000, tiene_precio_propio: true },
  { presentacion_id: 3, producto_id: 9, es_base: false, factor_unidad_base: 12000, precio_retail: 432000, tiene_precio_propio: false },
];

let contenedor, root;
const botones = () => [...contenedor.querySelectorAll('button')];
const boton = (texto) => botones().find(b => b.textContent.trim().startsWith(texto));
const campo = (label) => contenedor.querySelector(`[aria-label="${label}"]`);
async function click(el) { await act(async () => { el.click(); }); }
async function escribir(el, valor) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(valor));
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
}
async function montar(presentaciones = [base, paquete, master]) {
  sim.tablas = { presentacion: presentaciones, producto: { ficha_md: null }, v_presentacion_precio: vista, pedido_linea: [], solicitud_traslado_linea: [] };
  await act(async () => { root.render(<EditarProducto producto={{ id: 9, nombre: 'HOJA DE CARPETA TUKI', unidad_base: 'Hoja' }} onClose={() => {}} />); });
  await click(boton('Presentaciones'));
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  sim.rol = 'admin'; sim.escrituras = []; sim.errorEscritura = null; sim.consultas = [];
  contenedor = document.createElement('div'); document.body.append(contenedor); root = createRoot(contenedor);
});
afterEach(async () => { await act(async () => root.unmount()); contenedor.remove(); });

describe('presentaciones en el editor de producto', () => {
  it('muestra la equivalencia de cada fila, la cadena y el aviso de precio bajo', async () => {
    await montar();
    expect(contenedor.textContent).toContain('= 500 Hoja');
    expect(contenedor.textContent).toContain('= 12.000 Hoja (24 × PAQUETE)');
    expect(contenedor.textContent).toContain('PAQUETE sale a Bs 0,06 por Hoja');
  });

  it('precios: placeholder calculado y vacío guarda null', async () => {
    await montar();
    await click(botones().filter(b => b.textContent.includes('Precios'))[0]);
    const mayoreo = campo('Precio Mayoreo de PAQUETE');
    expect(mayoreo.placeholder).toContain('15.000,00 (calculado)');
    const publico = campo('Precio Público de PAQUETE');
    expect(publico.value).toBe('30');
    await escribir(publico, '');
    await click(boton('Guardar precios'));
    const w = sim.escrituras.at(-1);
    expect(w).toMatchObject({ tabla: 'presentacion', tipo: 'update' });
    expect(w.datos).toEqual({ precio: null, precio_mayoreo: null, precio_institucion: null, precio_corporativo: null, precio_municipal: null });
  });

  it('sin rol de precios no consulta la vista ni muestra precios', async () => {
    sim.rol = 'almacenero';
    await montar();
    expect(sim.consultas).not.toContain('v_presentacion_precio');
    expect(campo('Precio Público de PAQUETE')).toBeNull();
    expect(contenedor.textContent).not.toContain('sale a Bs');
  });

  it('alta encadenada: muestra la equivalencia y no manda factor', async () => {
    await montar([base, paquete]);
    await click(boton('Agregar presentación'));
    await escribir(campo('Nombre de la nueva presentación'), 'CAJA MASTER');
    await click(boton('N × otra presentación'));
    await escribir(campo('Presentación que trae adentro'), 2);
    await escribir(campo('Cantidad que trae'), 24);
    expect(contenedor.textContent).toContain('1 CAJA MASTER = 24 PAQUETE = 12.000 Hoja');
    await click(boton('Guardar presentación'));
    const w = sim.escrituras.at(-1);
    expect(w.datos).toEqual({ producto_id: 9, nombre: 'CAJA MASTER', contiene_presentacion_id: 2, contiene_cantidad: 24, es_base: false });
  });

  it('renombra la base y muestra el error de la base tal cual', async () => {
    await montar();
    await click(contenedor.querySelector('[title="¿Qué es 1 unidad?"]'));
    expect(contenedor.textContent).toContain('Lo más chico que se cuenta y se vende suelto');
    await click(boton('Pieza'));
    sim.errorEscritura = { message: 'No se puede cambiar el factor: usada por PED-12, COT-7' };
    await click(boton('Guardar'));
    expect(sim.escrituras.at(-1).datos).toEqual({ nombre: 'Pieza' });
    expect(contenedor.textContent).toContain('No se puede cambiar el factor: usada por PED-12, COT-7');
  });
});
