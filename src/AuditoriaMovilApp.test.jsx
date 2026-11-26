// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AuditoriaMovilApp from './AuditoriaMovilApp';

const qa = vi.hoisted(() => ({ rpc: vi.fn(), rol: 'operario' }));
vi.mock('./lib/useAuth', () => ({ useAuth: () => ({ usuario: { nombre: 'Ana QA', rol: qa.rol } }) }));
vi.mock('./lib/useSucursal', () => ({ useSucursal: () => ({
  sucursalActiva: { id: 1, nombre: 'Almacén QA' }, sucursales: [], puedeElegir: false, cargando: false,
}) }));
vi.mock('./supabaseClient', () => ({ supabase: { rpc: qa.rpc } }));

const item = {
  id: 10, producto_id: 21, ubicacion_id: 2, nombre: 'Tajador QA', ubicacion: 'PB / A-01',
  origen: 2, estado: 'PENDIENTE', captura_id: null, version_movimiento: '0',
  cantidad: null, esperado: null, factor: 1, unidad_base: 'unidad',
};
const resumen = {
  total: 1, arrastrados: 0, movimientos: 1, ciclicos: 0, verificados: 0, reconteos: 0, diferencias: 0,
};
const respuesta = (linea, extra = {}) => ({ error: null, data: { fecha: '2026-11-26', items: [linea], resumen, ...extra } });

let nodo;
let root;
const boton = texto => [...nodo.querySelectorAll('button')].find(b => b.textContent.trim() === texto);
const pulsar = async texto => { await act(async () => boton(texto).click()); };
const enviar = async () => {
  await act(async () => nodo.querySelector('.auditoria-captura').dispatchEvent(new Event('submit', {
    bubbles: true, cancelable: true,
  })));
};
const montar = async (ruta = '/operaciones/auditoria') => {
  await act(async () => root.render(<MemoryRouter initialEntries={[ruta]}><AuditoriaMovilApp /></MemoryRouter>));
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  qa.rol = 'operario';
  qa.rpc.mockReset().mockResolvedValue(respuesta(item));
  nodo = document.createElement('div');
  document.body.append(nodo);
  root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); });

it('abre la jornada, exige una cantidad explícita y recién entonces muestra el esperado', async () => {
  await montar();
  await pulsar('Ir al conteo');
  await pulsar('Tajador QAPB / A-01Pendiente');
  expect(nodo.textContent).not.toContain('Esperado');
  await enviar();
  expect(nodo.textContent).toContain('Ingresa una cantidad válida');
  expect(qa.rpc.mock.calls.map(([, args]) => args.p_accion)).not.toContain('contar');

  await act(async () => nodo.querySelector('button[aria-label="Quitar 1 unidad"]').click());
  qa.rpc.mockResolvedValueOnce(respuesta({
    ...item, estado: 'VERIFICADO', captura_id: 'id-qa', contado_en: '2026-11-26T15:41:00-04:00',
    cantidad: 0, esperado: 0,
  }, { resumen: { ...resumen, verificados: 1 } }));
  await enviar();
  expect(qa.rpc).toHaveBeenLastCalledWith('operar_auditoria_almacen', {
    p_accion: 'contar', p_sucursal_id: 1, p_datos: {
      item_id: 10, captura_id: null, cantidad: '0', version_movimiento: '0', solicitud: expect.any(String),
    },
  });
  expect(nodo.textContent).toContain('Esperado');
  expect(nodo.textContent).toContain('Verificado correctamente');
});

it('abre un reconteo sin precargar cantidades y muestra cómo recuperar un conflicto', async () => {
  const reconteo = {
    ...item, estado: 'RECONTEO', captura_id: 'captura-anterior', cantidad: 100, esperado: 100,
    version_movimiento: '1', contado_en: '2026-11-26T15:00:00-04:00',
  };
  qa.rpc.mockResolvedValue(respuesta(reconteo));
  await montar('/operaciones/auditoria?vista=lista&item=10');
  expect(nodo.textContent).toContain('Reconteo pendiente');
  expect(nodo.querySelector('input[aria-label="Cantidad contada"]').value).toBe('');
  await act(async () => nodo.querySelector('button[aria-label="Sumar 1 unidad"]').click());
  qa.rpc.mockResolvedValueOnce({ data: null, error: { message: 'El ítem cambió mientras contabas.', code: '40001' } });
  await enviar();
  expect(boton('Guardar y comparar').disabled).toBe(true);
  await pulsar('Actualizar conteo');
  expect(boton('Guardar y comparar').disabled).toBe(false);
});

it('mantiene fuera del flujo a los roles sin acceso a Almacén', async () => {
  qa.rol = 'cajero';
  await montar();
  expect(nodo.textContent).toContain('Tu perfil no tiene acceso');
  expect(qa.rpc).not.toHaveBeenCalled();
});
