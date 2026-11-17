import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { from, upload, getPublicUrl, update, eq } = vi.hoisted(() => ({
  from: vi.fn(), upload: vi.fn(), getPublicUrl: vi.fn(), update: vi.fn(), eq: vi.fn(),
}));
vi.mock("../supabaseClient", () => ({
  supabase: { from, storage: { from: vi.fn(() => ({ upload, getPublicUrl })) } },
}));
import { dimensionesMiniatura, generarMiniatura, rutaMiniatura, subirImagenProducto } from "./imagenProducto";

// Canvas falso: toBlob responde según los tipos que "soporta" el navegador.
function stubNavegador({ webp = true, ancho = 1600, alto = 800 } = {}) {
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => {} }),
    pedidos: [],
    toBlob(cb, tipo, calidad) {
      canvas.pedidos.push({ tipo, calidad });
      if (tipo === "image/webp" && !webp) return cb(new Blob(["png"], { type: "image/png" }));
      return cb(new Blob(["x".repeat(1000)], { type: tipo }));
    },
  };
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: ancho, height: alto, close() {} })));
  vi.stubGlobal("document", { createElement: () => canvas });
  return canvas;
}

beforeEach(() => {
  vi.clearAllMocks();
  getPublicUrl.mockImplementation((p) => ({ data: { publicUrl: `https://x.test/storage/v1/object/public/producto_imagenes/${p}` } }));
  upload.mockResolvedValue({ error: null });
  eq.mockResolvedValue({ error: null });
  update.mockReturnValue({ eq });
  from.mockReturnValue({ update });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("dimensionesMiniatura / rutaMiniatura", () => {
  it("lado mayor 320 sin agrandar", () => {
    expect(dimensionesMiniatura(1600, 800)).toEqual({ ancho: 320, alto: 160 });
    expect(dimensionesMiniatura(600, 1200)).toEqual({ ancho: 160, alto: 320 });
    expect(dimensionesMiniatura(200, 100)).toEqual({ ancho: 200, alto: 100 });
  });
  it("ruta miniatura/{id}-{base36}.webp", () => {
    expect(rutaMiniatura("abc", "webp", 36 * 36)).toBe("miniatura/abc-100.webp");
  });
});

describe("generarMiniatura", () => {
  it("usa WebP 0.72, sube con cache de 1 año sin upsert y actualiza la fila", async () => {
    const canvas = stubNavegador();
    const url = await generarMiniatura("p1", new Blob(["img"], { type: "image/jpeg" }));
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(160);
    expect(canvas.pedidos).toEqual([{ tipo: "image/webp", calidad: 0.72 }]);
    const [path, , opts] = upload.mock.calls[0];
    expect(path).toMatch(/^miniatura\/p1-[0-9a-z]+\.webp$/);
    expect(opts).toEqual({ contentType: "image/webp", cacheControl: "31536000", upsert: false });
    expect(from).toHaveBeenCalledWith("producto");
    expect(update).toHaveBeenCalledWith({ imagen_miniatura_url: url });
    expect(eq).toHaveBeenCalledWith("id", "p1");
    expect(url).toContain(path);
  });

  it("cae a JPEG 0.75 si el navegador no codifica WebP", async () => {
    const canvas = stubNavegador({ webp: false });
    await generarMiniatura("p1", new Blob(["img"]));
    expect(canvas.pedidos).toEqual([{ tipo: "image/webp", calidad: 0.72 }, { tipo: "image/jpeg", calidad: 0.75 }]);
    const [path, , opts] = upload.mock.calls[0];
    expect(path).toMatch(/\.jpg$/);
    expect(opts.contentType).toBe("image/jpeg");
  });

  it("baja la imagen cuando recibe una URL", async () => {
    stubNavegador();
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["i"]) }));
    vi.stubGlobal("fetch", fetchMock);
    await generarMiniatura("p1", "https://x.test/storage/v1/object/public/producto_imagenes/producto/p1.jpg?v=1");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
  });

  it("lanza si la subida falla y no toca la fila", async () => {
    stubNavegador();
    upload.mockResolvedValue({ error: new Error("rls") });
    await expect(generarMiniatura("p1", new Blob(["i"]))).rejects.toThrow("rls");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("subirImagenProducto", () => {
  const archivo = () => new Blob(["x"], { type: "image/jpeg" });

  it("sube el original con cache de 30 días y genera la miniatura", async () => {
    stubNavegador();
    await subirImagenProducto("p1", archivo());
    expect(upload.mock.calls[0][2]).toEqual({ contentType: "image/jpeg", cacheControl: "2592000", upsert: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ imagen_url: expect.stringContaining("?v=") }));
    expect(update).toHaveBeenCalledWith({ imagen_miniatura_url: expect.stringContaining("miniatura/p1-") });
  });

  it("si solo falla la miniatura, la subida de la foto igual termina bien", async () => {
    stubNavegador();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    upload.mockImplementation(async (path) => (path.startsWith("miniatura/") ? { error: new Error("boom") } : { error: null }));
    const url = await subirImagenProducto("p1", archivo());
    expect(url).toContain("producto/p1.jpg?v=");
    expect(update).toHaveBeenCalledTimes(1); // solo imagen_url
    expect(log).toHaveBeenCalled();
  });
});
