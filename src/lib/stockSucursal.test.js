import { describe, it, expect } from "vitest";
import { sumaStockPorSucursal, desgloseStockPorSucursal, textoDesgloseSucursal, stockDespachable } from "./stockSucursal";

const SUCURSALES = [
  { id: 1, nombre: "Almacén Central", tipo: "fisica" },
  { id: 2, nombre: "Tienda", tipo: "fisica" },
  { id: 3, nombre: "Shopify", tipo: "virtual" },
];

describe("sumaStockPorSucursal", () => {
  it("producto sin filas de stock -> 0", () => {
    expect(sumaStockPorSucursal(new Map())).toBe(0);
    expect(sumaStockPorSucursal(undefined)).toBe(0);
  });

  it("suma todas las sucursales del Map, incluida la virtual", () => {
    const mapa = new Map([[1, 1170], [2, 75], [3, 0]]);
    expect(sumaStockPorSucursal(mapa)).toBe(1245);
  });
});

describe("desgloseStockPorSucursal", () => {
  it("producto sin filas de stock -> desglose vacío", () => {
    expect(desgloseStockPorSucursal(new Map(), SUCURSALES)).toEqual([]);
  });

  it("producto con stock solo en una sucursal -> desglose de un elemento", () => {
    const mapa = new Map([[2, 75]]);
    expect(desgloseStockPorSucursal(mapa, SUCURSALES)).toEqual([
      { sucursalId: 2, nombre: "Tienda", cantidad: 75 },
    ]);
  });

  it("sucursal virtual en el mapa: queda fuera del desglose", () => {
    const mapa = new Map([[1, 1170], [2, 75], [3, 40]]);
    expect(desgloseStockPorSucursal(mapa, SUCURSALES)).toEqual([
      { sucursalId: 1, nombre: "Almacén Central", cantidad: 1170 },
      { sucursalId: 2, nombre: "Tienda", cantidad: 75 },
    ]);
  });

  it("sucursal con cantidad 0 o sin fila: se omite", () => {
    const mapa = new Map([[1, 1170], [2, 0]]);
    expect(desgloseStockPorSucursal(mapa, SUCURSALES)).toEqual([
      { sucursalId: 1, nombre: "Almacén Central", cantidad: 1170 },
    ]);
  });
});

describe("textoDesgloseSucursal", () => {
  it("0 sucursales -> null", () => {
    expect(textoDesgloseSucursal([])).toBeNull();
  });

  it("1 sucursal -> null (el total ya lo dice)", () => {
    expect(textoDesgloseSucursal([{ sucursalId: 2, nombre: "Tienda", cantidad: 75 }])).toBeNull();
  });

  it("2 sucursales -> línea unida con · ", () => {
    const desglose = [
      { sucursalId: 1, nombre: "Almacén", cantidad: 1170 },
      { sucursalId: 2, nombre: "Tienda", cantidad: 75 },
    ];
    expect(textoDesgloseSucursal(desglose)).toBe("Almacén 1170 · Tienda 75");
  });

  it("3 sucursales -> las tres unidas", () => {
    const desglose = [
      { sucursalId: 1, nombre: "Almacén", cantidad: 1170 },
      { sucursalId: 2, nombre: "Tienda", cantidad: 75 },
      { sucursalId: 4, nombre: "Sucursal Norte", cantidad: 12 },
    ];
    expect(textoDesgloseSucursal(desglose)).toBe("Almacén 1170 · Tienda 75 · Sucursal Norte 12");
  });

  it("usa el formateador de cantidad inyectado", () => {
    const desglose = [
      { sucursalId: 1, nombre: "Almacén", cantidad: 51011 },
      { sucursalId: 2, nombre: "Tienda", cantidad: 566 },
    ];
    const fmt = (n) => n.toLocaleString("es-BO");
    expect(textoDesgloseSucursal(desglose, fmt)).toBe("Almacén 51.011 · Tienda 566");
  });
});

describe("stockDespachable", () => {
  it("suma cantidad_base por producto en la sucursal pedida", () => {
    const rows = [
      { producto_id: 10, cantidad_base: 100, ubicacion: { sucursal_id: 1, excluye_disponible: false } },
      { producto_id: 10, cantidad_base: 50, ubicacion: { sucursal_id: 1, excluye_disponible: false } },
    ];
    expect(stockDespachable(rows, 1)).toEqual(new Map([[10, 150]]));
  });

  it("omite filas con cantidad_base negativa o cero", () => {
    const rows = [
      { producto_id: 10, cantidad_base: 200, ubicacion: { sucursal_id: 1, excluye_disponible: false } },
      { producto_id: 10, cantidad_base: -400, ubicacion: { sucursal_id: 1, excluye_disponible: false } },
      { producto_id: 10, cantidad_base: 0, ubicacion: { sucursal_id: 1, excluye_disponible: false } },
    ];
    expect(stockDespachable(rows, 1)).toEqual(new Map([[10, 200]]));
  });

  it("omite ubicaciones con excluye_disponible = true (VENTAS DIRECTAS, SOBREGIRO ONLINE)", () => {
    const rows = [
      { producto_id: 10, cantidad_base: 200, ubicacion: { sucursal_id: 1, excluye_disponible: false } },
      { producto_id: 10, cantidad_base: 9999, ubicacion: { sucursal_id: 1, excluye_disponible: true } },
    ];
    expect(stockDespachable(rows, 1)).toEqual(new Map([[10, 200]]));
  });

  it("omite filas de otra sucursal", () => {
    const rows = [
      { producto_id: 10, cantidad_base: 200, ubicacion: { sucursal_id: 1, excluye_disponible: false } },
      { producto_id: 10, cantidad_base: 999, ubicacion: { sucursal_id: 2, excluye_disponible: false } },
    ];
    expect(stockDespachable(rows, 1)).toEqual(new Map([[10, 200]]));
    expect(stockDespachable(rows, 2)).toEqual(new Map([[10, 999]]));
  });

  it("sin filas -> mapa vacío", () => {
    expect(stockDespachable([], 1)).toEqual(new Map());
    expect(stockDespachable(undefined, 1)).toEqual(new Map());
  });
});
