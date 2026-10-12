// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EscanerCodigo from './EscanerCodigo';
const qa = vi.hoisted(() => ({ callback: null, stop: vi.fn(), decode: vi.fn() }));
vi.mock('@zxing/browser', () => ({ BrowserMultiFormatReader: class { decodeFromVideoElement(video, callback) { return qa.decode(video, callback); } } }));
let nodo, root, detenerCamara;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('BarcodeDetector', undefined);
  detenerCamara = vi.fn(); qa.stop.mockReset();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: detenerCamara }] }) } });
  Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', { configurable: true, writable: true, value: null });
  qa.decode.mockReset().mockImplementation(async (video, callback) => { qa.callback = callback; return { stop: qa.stop }; });
  nodo = document.createElement('div'); document.body.append(nodo); root = createRoot(nodo);
});
afterEach(async () => { await act(async () => root.unmount()); nodo.remove(); delete HTMLVideoElement.prototype.srcObject; delete navigator.mediaDevices; vi.unstubAllGlobals(); });
it('entrega una sola lectura y detiene ZXing y la cámara al salir', async () => {
  const detectar = vi.fn();
  await act(async () => root.render(<EscanerCodigo onDetect={detectar} onClose={() => {}} />));
  await act(async () => { await vi.waitFor(() => expect(qa.decode).toHaveBeenCalled()); });
  await act(async () => { qa.callback({ getText: () => 'QR-4' }); qa.callback({ getText: () => 'QR-4' }); });
  expect(detectar).toHaveBeenCalledTimes(1); expect(qa.stop).toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(detenerCamara).toHaveBeenCalledTimes(1);
});
it('muestra un error controlado si ZXing no puede iniciar', async () => {
  qa.decode.mockRejectedValue(new Error('video no disponible'));
  await act(async () => root.render(<EscanerCodigo onDetect={() => {}} onClose={() => {}} />));
  await act(async () => { await vi.waitFor(() => expect(nodo.textContent).toContain('No se pudo acceder a la cámara')); });
  expect(nodo.textContent).toContain('No se pudo acceder a la cámara');
});
