import { beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirColaConteo, presentacionesDelCodigo, requiereReconteo, sincronizarCaptura } from './conteoControlado';

const qa = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn() }));
vi.mock('../supabaseClient', () => ({ supabase: { rpc: qa.rpc, storage: { from: () => ({ upload: qa.upload }) } } }));
const catalogo = { sucursalId: 1, presentaciones: [{ id: 1, producto_id: 4 }, { id: 2, producto_id: 4 }], identificadores: [{ presentacion_id: 2, valor: '12345' }] };
const captura = { sesionId: 9, datos: { uuid: 'captura', foto_ref: 'sesion_9/captura.jpg', cantidad: 0 }, foto: { type: 'image/jpeg' } };
beforeEach(() => { qa.rpc.mockReset().mockResolvedValue({ data: { sesion: { id: 9 } }, error: null }); qa.upload.mockReset().mockResolvedValue({ error: null }); });

describe('códigos y revisión de conteo', () => {
  it('un código numérico identifica la presentación y no un pedido', () => {
    expect(presentacionesDelCodigo(catalogo, '12345')).toEqual([{ id: 2, producto_id: 4 }]);
  });
  it('el QR conserva presentación y exige la sucursal correcta', () => {
    expect(presentacionesDelCodigo(catalogo, 'https://almacen.example/productos/4/ficha?sucursal=1&presentacion=2')).toEqual([{ id: 2, producto_id: 4 }]);
    expect(() => presentacionesDelCodigo(catalogo, 'https://almacen.example/productos/4/ficha?sucursal=2')).toThrow('otra sucursal');
    expect(() => presentacionesDelCodigo(catalogo, 'https://seller.example/pedidos/4')).toThrow('etiqueta de producto');
  });
  it('un QR sin presentación exige elegir el empaque, sin asumir unidad', () => {
    expect(presentacionesDelCodigo(catalogo, '/productos/4/ficha?sucursal=1')).toHaveLength(2);
  });
  it('cero confirmado se compara con todas las rondas y el corte', () => {
    expect(requiereReconteo({ teorico: 0, conteo_1: 0, conteo_2: null }, 0)).toBe(false);
    expect(requiereReconteo({ teorico: 0, conteo_1: 0, conteo_2: 2 }, 0)).toBe(true);
  });
});

describe('confirmación de capturas', () => {
  it('no confirma una captura si la foto no subió', async () => {
    qa.upload.mockResolvedValue({ error: { message: 'Sin conexión', statusCode: '503' } });
    await expect(sincronizarCaptura(captura)).rejects.toThrow('Sin conexión');
    expect(qa.rpc).toHaveBeenCalledTimes(1);
    expect(qa.rpc.mock.calls[0][1].p_accion).toBe('estado_captura');
  });
  it('un reintento usa el mismo UUID sin reemplazar la foto', async () => {
    qa.upload.mockResolvedValue({ error: { message: 'Already exists', statusCode: '409' } });
    await sincronizarCaptura(captura);
    expect(qa.upload).toHaveBeenCalledWith(captura.datos.foto_ref, captura.foto, { contentType: 'image/jpeg', upsert: false });
    expect(qa.rpc).toHaveBeenCalledWith('operar_conteo', { p_accion: 'capturar', p_sesion_id: 9, p_datos: captura.datos });
  });
  it('un rechazo de captura se propaga y no se anuncia confirmación', async () => {
    qa.rpc.mockResolvedValue({ error: { message: 'La ronda ya está cerrada' } });
    await expect(sincronizarCaptura(captura)).rejects.toThrow('ya está cerrada');
  });
  it('recupera una confirmación perdida sin volver a subir la foto de una ronda cerrada', async () => {
    qa.rpc.mockResolvedValueOnce({ data: { confirmada: true } });
    await sincronizarCaptura(captura);
    expect(qa.upload).not.toHaveBeenCalled();
    expect(qa.rpc.mock.calls[1][1].p_accion).toBe('capturar');
  });
  it('sólo confirma persistencia local al completarse la transacción', async () => {
    let tx;
    const database = { close: vi.fn(), transaction: () => { tx = { objectStore: () => ({ put: () => ({ result: 'ok' }) }) }; return tx; } };
    const request = {};
    vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => { request.result = database; request.onsuccess(); }); return request; } });
    try {
      const queue = await abrirColaConteo(); let completed = false;
      const save = queue.guardar({ uuid: 'prueba' }).then(() => { completed = true; });
      await Promise.resolve(); expect(completed).toBe(false);
      tx.oncomplete(); await save; expect(completed).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
});
