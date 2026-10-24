// @vitest-environment happy-dom
import { act, useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FichasEtiquetasApp from './FichasEtiquetasApp';

const simulado = vi.hoisted(() => ({ datos: null, cargar: vi.fn(), ubicaciones: vi.fn(), imprimir: vi.fn() }));
vi.mock('./supabaseClient', () => ({ supabase: {} }));
vi.mock('./lib/useAuth', () => ({ useAuth: () => ({ usuario: { id: 'qa', sucursalId: null } }) }));
vi.mock('./lib/useSucursal', () => ({ useSucursal: () => ({ sucursalActivaId: 1, sucursales: [{ id: 1, tipo: 'fisica', nombre: 'Almacén Central' }], puedeElegir: true, cargando: false }) }));
vi.mock('./lib/fichaProducto', async () => ({ ...await vi.importActual('./lib/fichaProducto'), cargarDatosEtiqueta: simulado.cargar }));
vi.mock('./lib/fichaUbicacion', async () => ({ ...await vi.importActual('./lib/fichaUbicacion'), listarUbicacionesEtiqueta: simulado.ubicaciones }));
vi.mock('./lib/impresionEtiquetas', async () => ({ ...await vi.importActual('./lib/impresionEtiquetas'), imprimirEtiquetas: simulado.imprimir }));
vi.mock('./TypeaheadProducto', () => ({ default: ({ onSeleccionar }) => <button onClick={() => onSeleccionar({ id: 4 })}>Añadir producto QA</button> }));
vi.mock('./EtiquetaProducto', () => ({ default: function Vista({ etiquetaId, presentacion, codigoBarras, enlace, onEstado }) {
  const nodo = useRef(null);
  useLayoutEffect(() => { onEstado(etiquetaId, { nodo: nodo.current, error: null }); }, [etiquetaId, onEstado]);
  return <div className="warehouse-label" ref={nodo} data-presentacion={presentacion?.id || ''} data-barcode={codigoBarras?.valor || ''} data-enlace={enlace}>Etiqueta QA</div>;
} }));

let contenedor, root;
const seleccion = prefijo => [...contenedor.querySelectorAll('select')].find(e => e.getAttribute('aria-label')?.startsWith(prefijo));
const boton = nombre => [...contenedor.querySelectorAll('button')].find(e => e.textContent.trim() === nombre);
const vistas = () => [...contenedor.querySelectorAll('.warehouse-label')];
async function cambiar(select, valor) {
  await act(async () => { select.value = String(valor); select.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function pulsar(nombre) { await act(async () => { boton(nombre).click(); }); }
async function montar(props = {}) { await act(async () => { root.render(<MemoryRouter><FichasEtiquetasApp productoId={4} {...props} /></MemoryRouter>); }); }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  simulado.datos = { producto: { id: 4, nombre: 'Bolígrafo', sku_interno: 'B-4', unidad_base: 'unidad' }, atributos: [], asignaciones: [{ es_principal: true, ubicacion: { id: 21, codigo_zona: 'A', nivel: '1' } }], presentaciones: [
    { id: 11, nombre: 'Unidad', factor_unidad_base: 1, es_base: true, activo: true, identificador: [{ id: 101, tipo: 'barra', valor: 'UNIDAD-4', activo: true }] },
    { id: 12, nombre: 'Caja', factor_unidad_base: 12, activo: true, identificador: [{ id: 102, tipo: 'barra', valor: 'CAJA-4', activo: true }] },
  ] };
  simulado.cargar.mockReset().mockImplementation(async () => simulado.datos);
  simulado.ubicaciones.mockReset().mockResolvedValue([{ id: 21, codigo_zona: 'A', nivel: '1', sucursal_id: 1 }]);
  simulado.imprimir.mockReset().mockResolvedValue(undefined);
  contenedor = document.createElement('div'); document.body.append(contenedor); root = createRoot(contenedor);
});
afterEach(async () => { await act(async () => root.unmount()); contenedor.remove(); });

describe('selección de presentaciones e impresión', () => {
  it('elige la presentación aunque las barras estén desactivadas y la conserva en el QR', async () => {
    await montar();
    expect(vistas()[0].dataset.presentacion).toBe('11');
    await cambiar(seleccion('Presentación de'), 12);
    expect(vistas()[0].dataset.presentacion).toBe('12');
    expect(vistas()[0].dataset.barcode).toBe('CAJA-4');
    expect(vistas()[0].dataset.enlace).toContain('presentacion=12');
    expect(contenedor.textContent).toContain('Caja · 12 unidad');
  });
  it('permite unidad y caja del mismo producto y la prueba imprime sólo una etiqueta', async () => {
    await montar(); await cambiar(seleccion('Presentación de'), 12);
    await pulsar('Añadir otra presentación');
    expect(vistas().map(v => v.dataset.presentacion)).toEqual(['12', '11']);
    expect(vistas().map(v => v.dataset.barcode)).toEqual(['CAJA-4', 'UNIDAD-4']);
    await pulsar('Imprimir 1 prueba');
    expect(simulado.imprimir.mock.calls[0][0]).toHaveLength(1);
    await pulsar('Imprimir etiquetas');
    expect(simulado.imprimir.mock.calls[1][0]).toHaveLength(2);
    expect(simulado.cargar).toHaveBeenCalledTimes(1);
  });
  it('cambiar presentación descarta el código de barras de la presentación anterior', async () => {
    await montar(); await cambiar(seleccion('Formato'), 'ficha_grande');
    await cambiar(seleccion('Código de barras de'), 101);
    await cambiar(seleccion('Presentación de'), 12);
    expect(seleccion('Código de barras de').value).toBe('102');
    expect(vistas()[0].dataset.barcode).toBe('CAJA-4');
  });
  it('bloquea una presentación retirada después de actualizar sin reemplazarla por otra', async () => {
    await montar({ presentacionId: 12 });
    simulado.datos = { ...simulado.datos, presentaciones: [simulado.datos.presentaciones[0]] };
    await pulsar('Actualizar datos');
    expect(contenedor.textContent).toContain('La presentación elegida ya no está disponible');
    expect(boton('Imprimir etiquetas').disabled).toBe(true);
    expect(vistas()).toHaveLength(0);
  });
  it('la etiqueta de ubicación tiene un QR propio y conserva las selecciones de producto', async () => {
    await montar({ presentacionId: 12 }); await cambiar(seleccion('Formato'), 'ubicacion');
    await cambiar(seleccion('Añadir ubicación'), 21);
    expect(vistas()[0].dataset.enlace).toContain('/ubicaciones/21/ficha?sucursal=1');
    expect(vistas()[0].dataset.enlace).not.toContain('presentacion');
    await cambiar(seleccion('Formato'), 'estandar');
    expect(vistas()[0].dataset.presentacion).toBe('12');
  });
  it('la tira usa ubicaciones y permite guardar e imprimir sin una dirección de QR válida', async () => {
    localStorage.setItem('wms_etiquetas_v1_qa', JSON.stringify({ baseUrl: 'dirección pendiente' }));
    await montar({ presentacionId: 12 });
    expect(boton('Imprimir etiquetas').disabled).toBe(true);
    await cambiar(seleccion('Formato'), 'ubicacion_tira');
    expect(contenedor.querySelector('input[type="url"]')).toBeNull();
    expect(seleccion('Presentación de')).toBeUndefined();
    await cambiar(seleccion('Añadir ubicación'), 21);
    expect(vistas()).toHaveLength(1);
    expect(boton('Imprimir etiquetas').disabled).toBe(false);
    await pulsar('Imprimir etiquetas');
    expect(simulado.imprimir.mock.lastCall[1]).toMatchObject({ diseno: 'ubicacion_tira', ancho: 100, alto: 25 });
    await pulsar('Guardar formato');
    expect(JSON.parse(localStorage.getItem('wms_etiquetas_v1_qa')).formato.diseno).toBe('ubicacion_tira');
    await cambiar(seleccion('Formato'), 'ubicacion');
    expect(boton('Imprimir etiquetas').disabled).toBe(true);
    await cambiar(seleccion('Formato'), 'estandar');
    expect(seleccion('Presentación de').value).toBe('12');
  });
  it('abrir etiquetas de producto descarta una tira de ubicación guardada como formato actual', async () => {
    localStorage.setItem('wms_etiquetas_v1_qa', JSON.stringify({ formato: { diseno: 'ubicacion_tira' } }));
    await montar();
    expect(seleccion('Formato').value).toBe('estandar');
    expect(vistas()[0].dataset.presentacion).toBe('11');
  });
  it.each(['caja_grande', 'lectura_distancia'])('%s conserva la presentación en el QR y bloquea la impresión si falta la equivalencia', async diseno => {
    await montar({ presentacionId: 12 });
    await cambiar(seleccion('Formato'), diseno);
    expect(vistas()[0].dataset.enlace).toContain('presentacion=12');
    expect(boton('Imprimir etiquetas').disabled).toBe(false);
    const opcionPresentacion = [...contenedor.querySelectorAll('input[type="checkbox"]')].find(e => e.parentElement.textContent === 'Presentación y equivalencia');
    expect(opcionPresentacion.disabled).toBe(true);
    expect(opcionPresentacion.checked).toBe(true);
    simulado.datos = { ...simulado.datos, presentaciones: simulado.datos.presentaciones.map(p => p.id === 12 ? { ...p, factor_unidad_base: null } : p) };
    await pulsar('Actualizar datos');
    expect(contenedor.textContent).toContain('equivalencia y unidad base registrados');
    expect(boton('Imprimir etiquetas').disabled).toBe(true);
    expect(vistas()).toHaveLength(0);
  });
});
