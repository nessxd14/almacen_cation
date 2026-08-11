import { describe, it, expect } from "vitest";
import { diasDesde } from "./fechas";

describe("diasDesde", () => {
  it("calcula días transcurridos redondeando hacia abajo", () => {
    const hace3dias = new Date(Date.now() - 3 * 86400000 - 1000).toISOString();
    expect(diasDesde(hace3dias)).toBe(3);
  });

  it("hoy es 0", () => {
    expect(diasDesde(new Date().toISOString())).toBe(0);
  });

  it("null/inválido -> null", () => {
    expect(diasDesde(null)).toBeNull();
    expect(diasDesde("no-es-fecha")).toBeNull();
  });
});
