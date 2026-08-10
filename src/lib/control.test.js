import { describe, it, expect } from "vitest";
import { controlEfectivo, clasificarFila, progresoSurtido, sucursalActivaSegunPerfil } from "./control";

describe("controlEfectivo", () => {
  it("control_stock del producto pisa el default de la sucursal", () => {
    expect(controlEfectivo("LIBRE", "ESTRICTO")).toBe("LIBRE");
    expect(controlEfectivo("ESTRICTO", "LIBRE")).toBe("ESTRICTO");
  });

  it("null hereda el default de la sucursal", () => {
    expect(controlEfectivo(null, "ESTRICTO")).toBe("ESTRICTO");
    expect(controlEfectivo(null, "LIBRE")).toBe("LIBRE");
  });
});

describe("clasificarFila", () => {
  it("ESTRICTO con stock", () => {
    expect(clasificarFila(124, "ESTRICTO")).toBe("estricto_stock");
  });
  it("ESTRICTO en cero", () => {
    expect(clasificarFila(0, "ESTRICTO")).toBe("estricto_cero");
  });
  it("LIBRE con stock (sin inventariar)", () => {
    expect(clasificarFila(18, "LIBRE")).toBe("libre_sin_inventariar");
  });
  it("LIBRE en 0 sigue siendo sin inventariar, no un error", () => {
    expect(clasificarFila(0, "LIBRE")).toBe("libre_sin_inventariar");
  });
  it("LIBRE en negativo es información, no error", () => {
    expect(clasificarFila(-37, "LIBRE")).toBe("libre_negativo");
  });
});

describe("progresoSurtido", () => {
  it("calcula inventariados/total y el porcentaje", () => {
    expect(progresoSurtido(48, 1502)).toEqual({ inventariados: 48, total: 1502, pct: 3 });
  });
  it("total 0 no divide por cero", () => {
    expect(progresoSurtido(0, 0)).toEqual({ inventariados: 0, total: 0, pct: 0 });
  });
});

describe("sucursalActivaSegunPerfil", () => {
  it("perfil.sucursal_id con valor fuerza esa sucursal y oculta el selector", () => {
    expect(sucursalActivaSegunPerfil(1, 2)).toEqual({ sucursalActivaId: 1, puedeElegir: false });
  });
  it("perfil.sucursal_id null deja elegir la sucursal guardada", () => {
    expect(sucursalActivaSegunPerfil(null, 2)).toEqual({ sucursalActivaId: 2, puedeElegir: true });
  });
});
