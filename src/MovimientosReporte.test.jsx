// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MovimientosDia, MovimientosReporte } from './MovimientosReporte';

const qa = vi.hoisted(() => ({ cargar: vi.fn() }));
vi.mock('./lib/reportesAlmacen', () => ({ movimientosProductoDia: qa.cargar }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let node, root;
const linea = { nombre: 'Artículo QA', producto_id: 1, ubicacion_id: 2, ubicacion: 'Estante A', unidad: 'unidad', inicial: 100, sistema: 110, entradas: 15, salidas: 5, ajustes: 0 };
const items = [
  { id: 2, creado_en: '2026-10-19T16:30:00Z', cantidad: -5, tipo_movimiento: 'TRASLADO', referencia: 'Traslado #2' },
  { id: 1, creado_en: '2026-10-19T12:00:00Z', cantidad: 15, tipo_movimiento: 'ENTRADA', referencia: 'Entrada #1' },
];
beforeEach(() => { qa.cargar.mockReset();node = document.createElement('div');document.body.append(node);root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount());node.remove(); });
const seleccionar = async (index, value) => act(async () => { const el = node.querySelectorAll('select')[index];el.value = value;el.dispatchEvent(new Event('change', { bubbles: true })); });

describe('desglose de movimientos', () => {
  it('identifica ajustes negativos y traslados por su tipo, conservando el signo y un icono visible', async () => {
    const ejemplo = [...items, { id: 3, creado_en: '2026-10-19T17:00:00Z', cantidad: -3, tipo_movimiento: 'AJUSTE', referencia: 'Ajuste #3' }];
    await act(async () => root.render(<MovimientosReporte linea={{...linea,sistema:107}} items={ejemplo} hasta="2026-10-20T04:00:00Z" onCerrar={()=>{}} />));
    const ajuste = node.querySelector('[data-movimiento=AJUSTE]');
    expect(ajuste.querySelector('.rp-movement-type').textContent).toBe('Ajuste');
    expect(ajuste.querySelector('.rp-movement-type svg')).toBeTruthy();
    expect(ajuste.querySelector('.rp-movement-amount').textContent).toBe('-3 unidad');
    expect(ajuste.querySelector('.rp-difference')).toBeNull();
    expect(node.querySelector('[data-movimiento=TRASLADO] .rp-movement-type').textContent).toBe('Traslado de salida');
  });
  it('separa el respaldo posterior al turno, incluso en el límite de cierre, y marca movimientos posteriores al conteo', async () => {
    await act(async () => root.render(<MovimientosReporte linea={{...linea, contado_en:'2026-10-19T12:15:00Z'}} items={items} reporte={{ fecha:'2026-10-19', turno:'MANANA' }} onCerrar={()=>{}} />));
    expect(node.querySelectorAll('.rp-movement-list>li')).toHaveLength(1);
    expect(node.querySelector('.rp-movement-list').textContent).toContain('Entrada #1');
    await seleccionar(0, 'posterior');
    expect(node.querySelectorAll('.rp-movement-list>li')).toHaveLength(1);
    expect(node.querySelector('.rp-movement-list').textContent).toContain('Traslado de salida');
    expect(node.querySelector('.rp-movement-list').textContent).toContain('Después del conteo físico');
    expect(node.querySelector('.rp-movement-list').textContent).toContain('Posterior al turno');
    await seleccionar(1, 'ENTRADA');expect(node.querySelectorAll('.rp-movement-list>li')).toHaveLength(0);
  });
  it('advierte detalle truncado y no inventa saldos a partir de una consulta incompleta', async () => {
    await act(async () => root.render(<MovimientosReporte linea={linea} items={items.slice(1)} total={1005} incompleto hasta="2026-10-20T04:00:00Z" onCerrar={()=>{}} />));
    expect(node.textContent).toContain('primeros 1 movimientos de 1005');
    expect(node.querySelector('.rp-movement-list').textContent).not.toContain('Saldo después');
  });
  it('pide actualizar cuando el resumen cambió y evita mostrar un saldo histórico falso', async () => {
    await act(async () => root.render(<MovimientosReporte linea={{...linea,sistema:999}} items={items} hasta="2026-10-20T04:00:00Z" onCerrar={()=>{}} />));
    expect(node.textContent).toContain('El detalle no coincide');
    expect(node.querySelector('.rp-movement-list').textContent).not.toContain('Saldo después');
  });
  it('descarta consultas antiguas al cambiar de producto', async () => {
    let resolver;
    qa.cargar.mockImplementationOnce(()=>new Promise(resolve=>{resolver=resolve;})).mockResolvedValueOnce({items:[],total:0,incompleto:false});
    await act(async () => root.render(<MovimientosDia key="1" linea={linea} fecha="2026-10-19" hasta="2026-10-20T04:00:00Z" sucursalId={1} onCerrar={()=>{}} />));
    await act(async () => root.render(<MovimientosDia key="2" linea={{...linea,producto_id:2,nombre:'Otro producto'}} fecha="2026-10-19" hasta="2026-10-20T04:00:00Z" sucursalId={1} onCerrar={()=>{}} />));
    await act(async()=>resolver({items,total:2,incompleto:false}));
    expect(node.querySelector('h4').textContent).toBe('Otro producto');expect(node.querySelectorAll('.rp-movement-list>li')).toHaveLength(0);
  });
});
