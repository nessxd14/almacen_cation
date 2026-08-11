import { describe, it, expect } from "vitest";
import { avisoDisponibilidad, lineasSinCobertura } from "./disponibilidad";

describe("avisoDisponibilidad", () => {
  it("null mientras no llegó el dato", () => {
    expect(avisoDisponibilidad({ cantidadPedida: 10, vendible: null })).toBeNull();
  });

  it("4000 pedidas, 720 vendibles, 200 reservadas -> 3280 no alcanzan", () => {
    expect(avisoDisponibilidad({ cantidadPedida: 4000, vendible: 720, reservado: 200, motivo: "Cotización #22" }))
      .toEqual({ vendible: 720, reservado: 200, motivo: "Cotización #22", noAlcanza: 3280 });
  });

  it("alcanza de sobra -> noAlcanza 0", () => {
    expect(avisoDisponibilidad({ cantidadPedida: 5, vendible: 100, reservado: 0, motivo: null }))
      .toEqual({ vendible: 100, reservado: 0, motivo: null, noAlcanza: 0 });
  });
});

describe("lineasSinCobertura", () => {
  it("filtra solo las líneas donde no alcanza", () => {
    const lineas = [
      { nombre: "A", cantidadBaseIngresada: 10, disponibilidad: { vendible: 5, reservado: 0 } },
      { nombre: "B", cantidadBaseIngresada: 3, disponibilidad: { vendible: 20, reservado: 0 } },
      { nombre: "C", cantidadBaseIngresada: 8, disponibilidad: null },
    ];
    expect(lineasSinCobertura(lineas).map((l) => l.nombre)).toEqual(["A"]);
  });
});
