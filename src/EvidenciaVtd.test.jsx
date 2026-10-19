// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import EvidenciaVtd from './EvidenciaVtd';

const qa = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabaseClient', () => ({ supabase: { rpc: qa.rpc } }));
let node, root;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; qa.rpc.mockReset(); node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });
async function mount(props = {}) {
  const config = vi.fn(), fotos = vi.fn();
  await act(async () => root.render(<EvidenciaVtd ventaId="7" estadoEntrega="SOLICITADO" fotos={[]} busy={false} onFotos={fotos} onConfiguracion={config} {...props} />));
  return { config, fotos };
}
it('permite cámara y galería e informa que la foto es obligatoria', async () => {
  qa.rpc.mockResolvedValue({ data: { activo: true, envios: [] }, error: null });
  const { config, fotos } = await mount();
  expect(config).toHaveBeenCalledWith(true); expect(node.textContent).toContain('Adjunta al menos una foto');
  expect(node.querySelector('input[capture="environment"]')).not.toBeNull();
  const galeria = node.querySelector('input[multiple]');
  Object.defineProperty(galeria, 'files', { configurable: true, value: [new File(['qa'], 'salida.jpg', { type: 'image/jpeg' })] });
  await act(async () => galeria.dispatchEvent(new Event('change', { bubbles: true })));
  expect(fotos.mock.calls[0][0]).toHaveLength(1);
  if (env.CATION_QA_OUTPUT) writeFileSync(`${env.CATION_QA_OUTPUT}/evidencia-vtd.html`, `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif;background:#f7fafc}${readFileSync('src/operaciones-movil.css', 'utf8')}</style><body><main class="om-app">${node.innerHTML}</main></body></html>`);
});
it('muestra el enlace confirmado y no permite adjuntar fotos a una salida ya registrada', async () => {
  qa.rpc.mockResolvedValue({ data: { activo: true, envios: [{ id: 'qa', estado: 'ENVIADO', cantidad: 2, enlace: 'https://t.me/c/3058173908/17051/24529', eliminado_en: '2026-10-21' }] }, error: null });
  await mount({ estadoEntrega: 'EN_CAJA' });
  expect(node.querySelector('a').href).toBe('https://t.me/c/3058173908/17051/24529');
  expect(node.textContent).toContain('La copia temporal ya se eliminó'); expect(node.querySelector('input')).toBeNull();
});
it('si falla la consulta bloquea la configuración y muestra el error', async () => {
  qa.rpc.mockResolvedValue({ data: null, error: { message: 'sin acceso' } });
  const { config } = await mount(); expect(config).toHaveBeenCalledWith(null); expect(node.querySelector('[role=alert]')).not.toBeNull();
});
