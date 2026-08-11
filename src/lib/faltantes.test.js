import { describe, it, expect } from "vitest";
import { partirFaltante, ordenarFaltantes } from "./faltantes";

describe("partirFaltante", () => {
  it("reparte el faltante entre clientes y reposición según FIFO (clientes primero)", () => {
    expect(partirFaltante({ stock_fisico: 100, comprometido_clientes: 150, comprometido_reposicion: 50 }))
      .toEqual({ faltanteClientes: 50, faltanteReposicion: 50 });
  });

  it("stock alcanza para clientes: todo el faltante es de reposición", () => {
    expect(partirFaltante({ stock_fisico: 200, comprometido_clientes: 150, comprometido_reposicion: 100 }))
      .toEqual({ faltanteClientes: 0, faltanteReposicion: 50 });
  });

  it("stock alcanza para todo: sin faltante", () => {
    expect(partirFaltante({ stock_fisico: 500, comprometido_clientes: 150, comprometido_reposicion: 100 }))
      .toEqual({ faltanteClientes: 0, faltanteReposicion: 0 });
  });

  it("sin reposición: el faltante entero es de clientes", () => {
    expect(partirFaltante({ stock_fisico: 20, comprometido_clientes: 60, comprometido_reposicion: 0 }))
      .toEqual({ faltanteClientes: 40, faltanteReposicion: 0 });
  });
});

describe("ordenarFaltantes", () => {
  it("ordena por faltante de clientes descendente", () => {
    const filas = [
      { producto_nombre: "A", stock_fisico: 100, comprometido_clientes: 110, comprometido_reposicion: 0, faltante: 10 },
      { producto_nombre: "B", stock_fisico: 0, comprometido_clientes: 500, comprometido_reposicion: 0, faltante: 500 },
      { producto_nombre: "C", stock_fisico: 50, comprometido_clientes: 0, comprometido_reposicion: 200, faltante: 150 },
    ];
    const resultado = ordenarFaltantes(filas);
    expect(resultado.map((f) => f.producto_nombre)).toEqual(["B", "A", "C"]);
  });

  it("no muta el array original", () => {
    const filas = [{ producto_nombre: "A", stock_fisico: 0, comprometido_clientes: 10, comprometido_reposicion: 0, faltante: 10 }];
    const copia = [...filas];
    ordenarFaltantes(filas);
    expect(filas).toEqual(copia);
  });
});
