// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EtiquetaProducto from './EtiquetaProducto';
import { FORMATO_INICIAL, FORMATOS_ETIQUETA } from './lib/formatosEtiqueta';

let contenedor, root;
const atributo = (nombre, valor) => ({ atributo_valor: { atributo: { nombre }, valor } });
const onEstado = vi.fn();
async function montar({ diseno = 'lectura_distancia', atributos = [], presentacion = { id: 12, nombre: 'Caja', factor_unidad_base: 50 }, unidadBase = 'UND', ubicacion, enlace = 'https://almacen.example/productos/4/ficha?sucursal=1&presentacion=12' } = {}) {
  await act(async () => root.render(<EtiquetaProducto
    datos={{ producto: { id: 4, nombre: 'Producto de prueba', sku_interno: 'SKU-004', unidad_base: unidadBase }, atributos }}
    formato={{ ...FORMATO_INICIAL, ...FORMATOS_ETIQUETA.find(f => f.id === diseno) }}
    enlace={enlace} ubicacion={ubicacion} sucursalNombre="Almacén"
    presentacion={presentacion} onEstado={onEstado}
  />));
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(566);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(566);
  onEstado.mockClear();
  contenedor = document.createElement('div'); document.body.append(contenedor); root = createRoot(contenedor);
});

describe('ubicaciones en tira', () => {
  it('imprime el código por partes sin QR, cabecera ni datos del producto, incluso sin enlace', async () => {
    await montar({ diseno: 'ubicacion_tira', enlace: null, ubicacion: { codigo_zona: 'PLANTA BAJA', estante: 'Estante', nivel: 'A', compartimiento: '3' } });
    expect(contenedor.querySelector('.label-location-strip').getAttribute('aria-label')).toBe('PB-EA-3');
    expect([...contenedor.querySelectorAll('.label-strip-value')].map(n => n.textContent)).toEqual(['PB', 'EA', '3']);
    expect([...contenedor.querySelectorAll('.label-strip-title')].map(n => n.textContent)).toEqual(['Zona', 'Mueble', 'Compartimiento']);
    expect(contenedor.querySelectorAll('.label-strip-dash')).toHaveLength(2);
    expect(contenedor.querySelector('svg, .label-header, .label-name, .label-presentation')).toBeNull();
    expect(onEstado.mock.lastCall[1].error).toBeNull();
  });
  it('omite compartimientos ausentes y conserva los códigos de pallets y zonas especiales', async () => {
    await montar({ diseno: 'ubicacion_tira', ubicacion: { codigo_zona: 'PLANTA BAJA', estante: 'Pallet', nivel: 'B' } });
    expect(contenedor.querySelector('.label-location-strip').getAttribute('aria-label')).toBe('PB-PB');
    expect(contenedor.querySelectorAll('.label-strip-value')).toHaveLength(2);
    expect(contenedor.textContent).not.toContain('Compartimiento');
    await montar({ diseno: 'ubicacion_tira', ubicacion: { codigo_zona: 'RECEPCIÓN', estante: 'Recepción' } });
    expect(contenedor.querySelector('.label-location-strip').getAttribute('aria-label')).toBe('REC');
    expect(contenedor.querySelectorAll('.label-strip-value')).toHaveLength(1);
    expect(contenedor.querySelectorAll('.label-strip-dash')).toHaveLength(0);
  });
});
afterEach(async () => { await act(async () => root.unmount()); contenedor.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('etiquetas de empaque con características del catálogo', () => {
  it.each([
    ['bolígrafos', [atributo('Color', 'Azul'), atributo('Punta', '1,0 mm')]],
    ['pinturas', [atributo('Capacidad', '250 ml'), atributo('Acabado', 'Mate')]],
    ['cintas', [atributo('Ancho', '48 mm'), atributo('Largo', '100 m')]],
    ['silicona', [atributo('Diámetro', '7 mm'), atributo('Largo', '20 cm')]],
  ])('usa las características registradas para %s sin imponer campos de papel', async (_, atributos) => {
    await montar({ atributos });
    const campos = [...contenedor.querySelectorAll('.label-pack-specs .label-meta')];
    expect(campos).toHaveLength(2);
    atributos.forEach((a, i) => {
      expect(campos[i].textContent).toContain(a.atributo_valor.atributo.nombre);
      expect(campos[i].textContent).toContain(a.atributo_valor.valor);
    });
    expect(contenedor.textContent).not.toContain('Gramaje');
    expect(contenedor.querySelector('svg[aria-label="QR de Producto de prueba"]')).not.toBeNull();
    expect(onEstado.mock.lastCall[1].error).toBeNull();
  });
  it('omite campos vacíos, conserva todos los atributos válidos y no imprime stock', async () => {
    const atributos = [atributo('Color', ''), atributo('', 'Azul'), {}, ...Array.from({ length: 8 }, (_, i) => atributo(`Campo ${i}`, `Valor ${i}`))];
    await montar({ atributos });
    expect(contenedor.querySelectorAll('.label-pack-specs .label-meta')).toHaveLength(8);
    expect(contenedor.querySelector('.label-pack-content').textContent).toContain('50 UND');
    expect(contenedor.querySelector('.label-pack-footer').textContent).toBe('Existencias actuales en la ficha digital');
    await montar();
    expect(contenedor.querySelector('.label-pack-specs')).toBeNull();
  });
  it('al cambiar la presentación muestra el contenido exacto sin convertir kilos en unidades', async () => {
    await montar({ presentacion: { id: 12, nombre: 'Bolsa', factor_unidad_base: 1 }, unidadBase: 'kg' });
    expect(contenedor.querySelector('.label-pack-content strong').textContent).toBe('1 kg');
    expect(contenedor.querySelector('.label-pack-presentation').textContent).toBe('Presentación: Bolsa');
    await montar({ presentacion: { id: 13, nombre: 'Media bolsa', factor_unidad_base: 0.5 }, unidadBase: 'kg' });
    expect(contenedor.querySelector('.label-pack-content strong').textContent).toMatch(/^0[,.]5 kg$/);
  });
  it('impide imprimir un empaque sin equivalencia conocida', async () => {
    await montar({ presentacion: { id: 12, nombre: 'Caja', factor_unidad_base: null } });
    expect(onEstado.mock.lastCall[1].error).toContain('equivalencia y unidad base registrados');
    expect(contenedor.querySelector('.label-pack-content strong').textContent).toBe('Equivalencia sin registrar');
  });
  it('caja grande destaca primero el código y lectura a distancia destaca primero el nombre', async () => {
    await montar({ diseno: 'caja_grande' });
    expect(contenedor.querySelector('.warehouse-label').children[1].className).toBe('label-pack-code');
    await montar();
    expect(contenedor.querySelector('.warehouse-label').children[1].className).toBe('label-name');
  });
});
