import { describe, it, expect } from "vitest";
import { resumenATarjetas, filtrarPorSucursal, nivelAlerta, umbralEfectivo } from "./inventario";

describe("resumenATarjetas", () => {
  it("mapea una fila de v_inventario_resumen a las tarjetas", () => {
    // Fila real de Almacén Central tras aplicar la vista (brief W2).
    const fila = {
      sucursal_id: 1,
      sucursal_nombre: "Almacén Central",
      productos_con_stock: 1187,
      productos_en_cero: 28,
      unidades: 1527552,
      valor: 7902400,
      filas_detalle: 1228,
    };

    const tarjetas = resumenATarjetas(fila);

    expect(tarjetas).toEqual({
      totalProductos: 1187,
      totalUnidades: 1527552,
      valorTotal: 7902400,
      enCero: 28,
      filasDetalle: 1228,
    });
  });

  it("null cuando no hay fila (sucursal sin resumen todavía)", () => {
    expect(resumenATarjetas(null)).toBeNull();
  });
});

describe("filtrarPorSucursal", () => {
  const filas = [
    { producto_id: 1, sucursal_id: 1, cantidad_base: 10 },
    { producto_id: 1, sucursal_id: 2, cantidad_base: 3 },
    { producto_id: 2, sucursal_id: 1, cantidad_base: 0 },
    { producto_id: 3, sucursal_id: 2, cantidad_base: 5 },
  ];

  it("deja solo las filas de la sucursal pedida", () => {
    expect(filtrarPorSucursal(filas, 1)).toEqual([
      { producto_id: 1, sucursal_id: 1, cantidad_base: 10 },
      { producto_id: 2, sucursal_id: 1, cantidad_base: 0 },
    ]);
    expect(filtrarPorSucursal(filas, 2)).toEqual([
      { producto_id: 1, sucursal_id: 2, cantidad_base: 3 },
      { producto_id: 3, sucursal_id: 2, cantidad_base: 5 },
    ]);
  });

  it("sin sucursalId no filtra nada", () => {
    expect(filtrarPorSucursal(filas, null)).toBe(filas);
  });
});

describe("stock_min vs umbral global", () => {
  it("producto con mínimo definido usa el suyo", () => {
    expect(umbralEfectivo(20, 5)).toBe(20);
    expect(nivelAlerta(15, 20, 5)).toBe("bajo"); // 15 <= 20 (su propio mínimo)
    expect(nivelAlerta(15, 10, 5)).toBe("ok");   // 15 > 10 (su propio mínimo)
  });

  it("producto con stock_min NULL cae al umbral global", () => {
    expect(umbralEfectivo(null, 5)).toBe(5);
    expect(nivelAlerta(4, null, 5)).toBe("bajo"); // 4 <= 5 (umbral global)
    expect(nivelAlerta(6, null, 5)).toBe("ok");   // 6 > 5 (umbral global)
  });

  it("cantidad 0 siempre es cero, sin importar el umbral", () => {
    expect(nivelAlerta(0, 100, 100)).toBe("cero");
  });
});
