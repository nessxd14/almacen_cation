import { describe, it, expect } from "vitest";
import {
  armarPayloadDespacho, lineasConFaltante, totalUnidadesSeleccion,
  formatoEquivalencia, labelUbicacionConSucursal, lineasNoSaldranCompletas,
} from "./despacho";

describe("armarPayloadDespacho", () => {
  it("arma el payload desde la selección + los picks", () => {
    const seleccion = new Set([1, 2, 3]);
    const picks = new Map([
      [1, { pendiente: 10, asignaciones: [{ ubicacion_id: 5, cantidad_base: 10 }] }],
      [2, { pendiente: 4, asignaciones: [{ ubicacion_id: 5, cantidad_base: 4 }, { ubicacion_id: 6, cantidad_base: 0 }] }],
      // línea 3 seleccionada pero sin pick calculado todavía -> se excluye
    ]);

    expect(armarPayloadDespacho(seleccion, picks)).toEqual([
      { linea_id: 1, asignaciones: [{ ubicacion_id: 5, cantidad_base: 10 }] },
      { linea_id: 2, asignaciones: [{ ubicacion_id: 5, cantidad_base: 4 }] }, // filtra cantidad 0
    ]);
  });

  it("no manda una línea sin ninguna asignación con cantidad > 0", () => {
    const seleccion = new Set([1]);
    const picks = new Map([[1, { pendiente: 5, asignaciones: [{ ubicacion_id: 5, cantidad_base: 0 }] }]]);
    expect(armarPayloadDespacho(seleccion, picks)).toEqual([]);
  });
});

describe("lineasConFaltante", () => {
  it("detecta líneas cuyo pick no cubre lo pendiente", () => {
    const seleccion = new Set([1, 2]);
    const picks = new Map([
      [1, { pendiente: 10, asignaciones: [{ ubicacion_id: 5, cantidad_base: 10 }] }], // cubre
      [2, { pendiente: 10, asignaciones: [{ ubicacion_id: 5, cantidad_base: 6 }] }],  // faltan 4
    ]);
    expect(lineasConFaltante(seleccion, picks)).toEqual([2]);
  });

  it("sin faltantes devuelve vacío", () => {
    const seleccion = new Set([1]);
    const picks = new Map([[1, { pendiente: 5, asignaciones: [{ ubicacion_id: 5, cantidad_base: 5 }] }]]);
    expect(lineasConFaltante(seleccion, picks)).toEqual([]);
  });
});

describe("totalUnidadesSeleccion", () => {
  it("suma lo pendiente de cada línea seleccionada", () => {
    const seleccion = new Set([1, 2]);
    const lineas = new Map([
      [1, { cantidad_base: 10, cantidad_despachada: 4 }],
      [2, { cantidad_base: 5, cantidad_despachada: 0 }],
    ]);
    expect(totalUnidadesSeleccion(seleccion, lineas)).toBe(11);
  });
});

describe("formatoEquivalencia", () => {
  it("con presentación y factor 24", () => {
    expect(formatoEquivalencia({
      cantidadPresentacion: 3, nombrePresentacion: "Caja", factor: 24, cantidadBase: 72, unidadBase: "unidad",
    })).toBe("3 Caja x24 · 72 u");
  });

  it("sin presentación", () => {
    expect(formatoEquivalencia({
      cantidadPresentacion: null, nombrePresentacion: null, factor: null, cantidadBase: 5, unidadBase: "unidad",
    })).toBe("5 u");
  });

  it("factor 1 no aporta nada — se omite la presentación", () => {
    expect(formatoEquivalencia({
      cantidadPresentacion: 5, nombrePresentacion: "Unidad", factor: 1, cantidadBase: 5, unidadBase: "unidad",
    })).toBe("5 u");
  });
});

describe("labelUbicacionConSucursal", () => {
  const nombreSucursal = (id) => ({ 1: "Almacén Central", 2: "Tienda" }[id]);

  it("antepone la sucursal cuando se provee el resolver", () => {
    expect(labelUbicacionConSucursal("PISO", 2, nombreSucursal)).toBe("Tienda · PISO");
  });

  it("sin sucursal_id no antepone nada", () => {
    expect(labelUbicacionConSucursal("PISO", null, nombreSucursal)).toBe("PISO");
  });

  it("sin resolver no antepone nada (nunca hardcodea un nombre)", () => {
    expect(labelUbicacionConSucursal("PISO", 2, undefined)).toBe("PISO");
  });
});

describe("lineasNoSaldranCompletas", () => {
  it("detecta líneas bloqueadas por stock (noAlcanza)", () => {
    const lineas = [
      { id: 1, cantidadIngresada: 10, cantidadPedida: 10, noAlcanza: true },
      { id: 2, cantidadIngresada: 5, cantidadPedida: 5, noAlcanza: false },
    ];
    expect(lineasNoSaldranCompletas(lineas)).toEqual([lineas[0]]);
  });

  it("detecta líneas con cantidad cargada menor a lo pedido (parcial)", () => {
    const lineas = [
      { id: 1, cantidadIngresada: 3, cantidadPedida: 10, noAlcanza: false },
      { id: 2, cantidadIngresada: 5, cantidadPedida: 5, noAlcanza: false },
    ];
    expect(lineasNoSaldranCompletas(lineas)).toEqual([lineas[0]]);
  });

  it("sin líneas afectadas devuelve vacío", () => {
    const lineas = [{ id: 1, cantidadIngresada: 10, cantidadPedida: 10, noAlcanza: false }];
    expect(lineasNoSaldranCompletas(lineas)).toEqual([]);
  });

  it("no duplica una línea que es a la vez noAlcanza y parcial", () => {
    const lineas = [{ id: 1, cantidadIngresada: 3, cantidadPedida: 10, noAlcanza: true }];
    expect(lineasNoSaldranCompletas(lineas)).toEqual([lineas[0]]);
  });
});
