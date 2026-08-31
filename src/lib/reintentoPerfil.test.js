import { describe, it, expect } from "vitest";
import { decidirReintento } from "./reintentoPerfil";

describe("decidirReintento", () => {
  it("data OK, sin error -> no reintentar", () => {
    expect(decidirReintento({ error: null, data: { id: 1 }, intento: 1 }))
      .toEqual({ reintentar: false, esperaMs: null });
  });

  it("data: null, error: null (fila ausente) -> no reintentar, es una respuesta definitiva", () => {
    expect(decidirReintento({ error: null, data: null, intento: 1 }))
      .toEqual({ reintentar: false, esperaMs: null });
  });

  it("error en el primer intento -> reintentar, espera ~400ms", () => {
    expect(decidirReintento({ error: { message: "429" }, data: null, intento: 1 }))
      .toEqual({ reintentar: true, esperaMs: 400 });
  });

  it("error en el segundo intento -> reintentar, espera ~1200ms", () => {
    expect(decidirReintento({ error: { message: "429" }, data: null, intento: 2 }))
      .toEqual({ reintentar: true, esperaMs: 1200 });
  });

  it("error en el tercer intento -> se agotaron los reintentos, esperaMs null", () => {
    expect(decidirReintento({ error: { message: "429" }, data: null, intento: 3 }))
      .toEqual({ reintentar: false, esperaMs: null });
  });

  it("jitter inyectable se suma a la espera base", () => {
    expect(decidirReintento({ error: { message: "429" }, data: null, intento: 1, jitterMs: 75 }))
      .toEqual({ reintentar: true, esperaMs: 475 });
  });

  it("error presente CON data presente -> reintentar igual (la decisión no mira data)", () => {
    expect(decidirReintento({ error: { message: "429" }, data: { id: 1 }, intento: 1 }))
      .toEqual({ reintentar: true, esperaMs: 400 });
  });

  it("sin error y sin fila -> NO reintentar: 'no existe' es una respuesta, no un fallo", () => {
    expect(decidirReintento({ error: null, data: null, intento: 1 }).reintentar).toBe(false);
    // si esto se rompe, un usuario sin fila en `perfil` reintentaría hasta agotar
    // los intentos y terminaría bloqueado en vez de entrar como operario.
  });
});
