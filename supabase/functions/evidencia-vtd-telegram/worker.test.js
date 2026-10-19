// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { comprobarBot, enviarLote, limpiarFotos, manejarWorker } from './worker.js';

const config = { activo: true, chat_id: '-1003058173908', tema_id: 17051 };
const lote = { id: 'lote-qa', lease: 'lease-qa', caption: 'VTD-QA · Salida a Caja', rutas: ['qa/1.jpg', 'qa/2.jpg'] };
let admin, call, download, remove, fetchImpl;
const ok = result => Response.json({ ok: true, result });
const recibos = [1, 2].map(n => ({ message_id: n, chat: { id: Number(config.chat_id) }, message_thread_id: config.tema_id, photo: [{ file_id: `file-${n}`, file_unique_id: `unique-${n}` }] }));
beforeEach(() => {
  call = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
  download = vi.fn().mockResolvedValue({ data: new Blob([new Uint8Array([255, 216, 255, 0])], { type: 'image/jpeg' }), error: null });
  remove = vi.fn().mockResolvedValue({ error: null });
  admin = { rpc: call, storage: { from: () => ({ download, remove }) } };
  fetchImpl = vi.fn().mockResolvedValue(ok(recibos));
});
const enviar = (override = {}) => enviarLote({ admin, fetchImpl, token: 'TOKEN_PRIVADO_QA', config, lote, ...override });

it('publica un álbum en el tema exacto y persiste todos los identificadores', async () => {
  expect(await enviar()).toBe('enviado');
  const [url, request] = fetchImpl.mock.calls[0];
  expect(url.endsWith('/sendMediaGroup')).toBe(true);
  expect(request.body.get('chat_id')).toBe(config.chat_id);
  expect(request.body.get('message_thread_id')).toBe('17051');
  expect(JSON.parse(request.body.get('media'))[0].caption).toContain('VTD-QA');
  expect(call.mock.calls[0][1]).toMatchObject({ p_accion: 'confirmar', p_datos: { id: lote.id, lease: lote.lease, telegram: [{ message_id: 1 }, { message_id: 2 }] } });
});
it('una sola imagen usa sendPhoto', async () => {
  fetchImpl.mockResolvedValue(ok(recibos[0]));
  expect(await enviar({ lote: { ...lote, rutas: ['qa/1.jpg'] } })).toBe('enviado');
  expect(fetchImpl.mock.calls[0][0].endsWith('/sendPhoto')).toBe(true);
});
it('no publica ni confirma un archivo que no se pudo descargar', async () => {
  download.mockResolvedValue({ data: null, error: new Error('sin archivo') });
  expect(await enviar()).toBe('error'); expect(fetchImpl).not.toHaveBeenCalled();
  expect(call.mock.calls[0][1].p_accion).toBe('error');
});
it('respeta el rechazo 429 y conserva las fotos', async () => {
  fetchImpl.mockResolvedValue(Response.json({ ok: false, parameters: { retry_after: 120 } }, { status: 429 }));
  expect(await enviar()).toBe('error');
  expect(call.mock.calls[0][1]).toMatchObject({ p_accion: 'error', p_datos: { retry_after: 120 } });
  expect(remove).not.toHaveBeenCalled();
});
it('un timeout o un recibo parcial exige revisión y nunca repite automáticamente', async () => {
  fetchImpl.mockRejectedValueOnce(new Error('timeout'));
  expect(await enviar()).toBe('incierto'); expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(call.mock.calls[0][1].p_accion).toBe('incierto');
  fetchImpl.mockResolvedValueOnce(ok([recibos[0]]));
  expect(await enviar()).toBe('incierto'); expect(remove).not.toHaveBeenCalled();
});
it('si falla guardar el recibo, reintenta sólo la base de datos', async () => {
  call.mockResolvedValueOnce({ error: { message: 'conexión' } });
  expect(await enviar()).toBe('enviado'); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(call).toHaveBeenCalledTimes(2);
});
it('no marca una eliminación si Storage falló', async () => {
  call.mockResolvedValueOnce({ data: [{ id: lote.id, rutas: lote.rutas }], error: null });
  remove.mockResolvedValue({ error: { message: 'falló' } });
  expect(await limpiarFotos(admin)).toBe(0); expect(call).toHaveBeenCalledTimes(1);
});
it('una llamada sin autorización no envía mensajes ni borra objetos', async () => {
  call.mockResolvedValue({ data: { autorizado: false }, error: null });
  const result = await manejarWorker(new Request('https://qa.invalid', { method: 'POST', body: '{}' }), { admin, token: 'TOKEN_PRIVADO_QA', fetchImpl });
  expect(result.status).toBe(401); expect(fetchImpl).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});
it('el diagnóstico verifica la identidad y no cambia webhook ni recibe updates', async () => {
  fetchImpl.mockResolvedValueOnce(ok({ id: 9, username: 'cation_bbb_bot' })).mockResolvedValueOnce(ok({ id: Number(config.chat_id), is_forum: true })).mockResolvedValueOnce(ok({ status: 'administrator' }));
  expect(await comprobarBot(fetchImpl, 'TOKEN_PRIVADO_QA', config)).toMatchObject({ bot: '@cation_bbb_bot', tema: 17051 });
  expect(fetchImpl.mock.calls.map(([url]) => url.split('/').at(-1))).toEqual(['getMe', 'getChat', 'getChatMember']);
});
it('un fallo de red no expone el token en la respuesta', async () => {
  call.mockImplementation(async (_name, { p_accion }) => ({ data: p_accion === 'autorizar' ? { autorizado: true } : p_accion === 'configuracion' ? config : [], error: null }));
  fetchImpl.mockRejectedValue(new Error('https://api.telegram.org/botTOKEN_PRIVADO_QA/getMe'));
  const result = await manejarWorker(new Request('https://qa.invalid', { method: 'POST', body: '{"token":"worker-qa"}' }), { admin, token: 'TOKEN_PRIVADO_QA', fetchImpl });
  expect(result.status).toBe(503); expect(await result.text()).not.toContain('TOKEN_PRIVADO_QA');
});
