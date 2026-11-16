import { describe, it, expect } from "vitest";
import {
  calcularResumen, conConcurrencia, construirUpdateLote, esCandidato, formatearResumen, partirEnLotes, rutaMiniatura,
} from "../../miniaturas_productos.mjs";

const BUCKET = "https://x.supabase.co/storage/v1/object/public/producto_imagenes/producto/1.jpg?v=1";

describe("backfill de miniaturas — selección", () => {
  it("solo activos con foto del bucket y sin miniatura", () => {
    expect(esCandidato({ activo: true, imagen_url: BUCKET, imagen_miniatura_url: null })).toBe(true);
    expect(esCandidato({ activo: false, imagen_url: BUCKET })).toBe(false);
    expect(esCandidato({ activo: true, imagen_url: BUCKET, imagen_miniatura_url: "https://m" })).toBe(false);
    expect(esCandidato({ activo: true, imagen_url: "https://cdn.shopify.com/a.jpg?width=320" })).toBe(false);
    expect(esCandidato({ activo: true, imagen_url: null })).toBe(false);
  });
  it("ruta con id y timestamp en base36", () => {
    expect(rutaMiniatura("abc", 36 * 36)).toBe("miniatura/abc-100.webp");
  });
});

describe("backfill de miniaturas — lotes", () => {
  it("parte en lotes de 200", () => {
    const lotes = partirEnLotes(Array.from({ length: 450 }, (_, i) => i));
    expect(lotes.map((l) => l.length)).toEqual([200, 200, 50]);
  });
  it("arma un único UPDATE parametrizado por lote, sin pisar miniaturas existentes", () => {
    const { text, values } = construirUpdateLote([{ id: 1, url: "u1" }, { id: 2, url: "u2" }]);
    expect(values).toEqual(["1", "u1", "2", "u2"]);
    expect(text).toContain("VALUES ($1::text, $2::text), ($3::text, $4::text)");
    expect(text).toContain("p.imagen_miniatura_url IS NULL");
    expect(text.match(/UPDATE/g)).toHaveLength(1);
  });
  it("rechaza lote vacío", () => {
    expect(() => construirUpdateLote([])).toThrow();
  });
});

describe("backfill de miniaturas — resumen", () => {
  const resultados = [
    { id: 1, ok: true, bytesAntes: 140 * 1024, bytesDespues: 10 * 1024 },
    { id: 2, ok: true, bytesAntes: 100 * 1024, bytesDespues: 20 * 1024 },
    { id: 3, ok: false, motivo: "HTTP 404" },
  ];
  it("totales, omitidos y promedio", () => {
    expect(calcularResumen(resultados)).toEqual({
      procesados: 3, subidos: 2, omitidos: [{ id: 3, motivo: "HTTP 404" }],
      kbAntes: 240, kbDespues: 30, promedioKb: 15,
    });
  });
  it("lista los ids omitidos y marca el dry-run", () => {
    const txt = formatearResumen(calcularResumen(resultados), { dryRun: true });
    expect(txt).toContain("DRY-RUN");
    expect(txt).toContain("- 3: HTTP 404");
  });
  it("sin éxitos el promedio es 0", () => {
    expect(calcularResumen([{ id: 1, ok: false, motivo: "x" }]).promedioKb).toBe(0);
  });
});

describe("backfill de miniaturas — concurrencia", () => {
  it("respeta el máximo en vuelo y conserva el orden", async () => {
    let enVuelo = 0;
    let maximo = 0;
    const out = await conConcurrencia([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      await new Promise((r) => setTimeout(r, 5));
      enVuelo--;
      return n * 2;
    });
    expect(maximo).toBe(4);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });
});
