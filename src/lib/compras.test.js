import { describe, it, expect } from "vitest";
import {
  etiquetaEstadoCompra, etiquetaOrigenCompra, ordenarCompras, filtrarCompras, cantidadSugeridaCompra,
} from "./compras";

describe("etiquetaEstadoCompra", () => {
  it("traduce los cuatro estados", () => {
    expect(etiquetaEstadoCompra("SOLICITADA")).toBe("Solicitada");
    expect(etiquetaEstadoCompra("COMPRADA")).toBe("Comprada");
    expect(etiquetaEstadoCompra("RECIBIDA")).toBe("Recibida");
    expect(etiquetaEstadoCompra("CANCELADA")).toBe("Cancelada");
  });
  it("un estado desconocido o vacío no rompe", () => {
    expect(etiquetaEstadoCompra("OTRO")).toBe("OTRO");
    expect(etiquetaEstadoCompra(null)).toBe("");
  });
});

describe("etiquetaOrigenCompra", () => {
  it("traduce los tres orígenes", () => {
    expect(etiquetaOrigenCompra("VENDEDOR")).toBe("Vendedor");
    expect(etiquetaOrigenCompra("ALMACEN")).toBe("Almacén");
    expect(etiquetaOrigenCompra("PERSONALIZADO")).toBe("Personalizado");
  });
  it("un origen desconocido o vacío no rompe", () => {
    expect(etiquetaOrigenCompra("X")).toBe("X");
    expect(etiquetaOrigenCompra(undefined)).toBe("");
  });
});

describe("ordenarCompras", () => {
  const filas = [
    { solicitud_id: 2, solicitado_en: "2026-10-07T10:00:00Z" },
    { solicitud_id: 1, solicitado_en: "2026-10-05T10:00:00Z" },
    { solicitud_id: 3, solicitado_en: "2026-10-06T10:00:00Z" },
  ];
  it("deja primero la más antigua", () => {
    expect(ordenarCompras(filas).map((f) => f.solicitud_id)).toEqual([1, 3, 2]);
  });
  it("no muta la entrada", () => {
    const copia = filas.map((f) => ({ ...f }));
    const r = ordenarCompras(filas);
    expect(filas).toEqual(copia);
    expect(r).not.toBe(filas);
  });
  it("sin fecha va al final y null/undefined dan lista vacía", () => {
    expect(ordenarCompras([{ solicitud_id: 9 }, ...filas]).map((f) => f.solicitud_id)).toEqual([1, 3, 2, 9]);
    expect(ordenarCompras(null)).toEqual([]);
  });
});

describe("filtrarCompras", () => {
  const filas = [
    { solicitud_id: 1, estado: "SOLICITADA", producto_nombre: "Resma Carta", sku_interno: "RC-01", pedido_numero: "PED-2026-00010", pedido_titulo: "Escuela Sucre" },
    { solicitud_id: 2, estado: "COMPRADA", producto_nombre: "Marcador negro", sku_interno: "MK-02", pedido_numero: "PED-2026-00011", pedido_titulo: null },
    { solicitud_id: 3, estado: "SOLICITADA", producto_nombre: null, sku_interno: null, pedido_numero: "PED-2026-00012", pedido_titulo: "Colegio Don Bosco" },
  ];
  it("TODAS no filtra por estado", () => {
    expect(filtrarCompras(filas, { estado: "TODAS", texto: "" })).toHaveLength(3);
  });
  it("filtra por estado", () => {
    expect(filtrarCompras(filas, { estado: "COMPRADA" }).map((f) => f.solicitud_id)).toEqual([2]);
    expect(filtrarCompras(filas, { estado: "SOLICITADA" }).map((f) => f.solicitud_id)).toEqual([1, 3]);
  });
  it("el texto busca en producto, SKU, número y título del pedido, sin distinguir mayúsculas", () => {
    expect(filtrarCompras(filas, { estado: "TODAS", texto: "resma" }).map((f) => f.solicitud_id)).toEqual([1]);
    expect(filtrarCompras(filas, { estado: "TODAS", texto: "mk-02" }).map((f) => f.solicitud_id)).toEqual([2]);
    expect(filtrarCompras(filas, { estado: "TODAS", texto: "00012" }).map((f) => f.solicitud_id)).toEqual([3]);
    expect(filtrarCompras(filas, { estado: "TODAS", texto: "DON BOSCO" }).map((f) => f.solicitud_id)).toEqual([3]);
  });
  it("combina estado y texto, y recorta espacios", () => {
    expect(filtrarCompras(filas, { estado: "COMPRADA", texto: "resma" })).toEqual([]);
    expect(filtrarCompras(filas, { estado: "SOLICITADA", texto: "  escuela " }).map((f) => f.solicitud_id)).toEqual([1]);
  });
  it("sin opciones ni filas no rompe", () => {
    expect(filtrarCompras(filas)).toHaveLength(3);
    expect(filtrarCompras(null, {})).toEqual([]);
  });
});

describe("cantidadSugeridaCompra", () => {
  it("cubierto menor que pendiente: la diferencia", () => {
    expect(cantidadSugeridaCompra({ pendiente: 10, cubierto: 4 })).toBe(6);
    expect(cantidadSugeridaCompra({ pendiente: 10, cubierto: 0 })).toBe(10);
  });
  it("cubierto desconocido o que alcanza: todo lo pendiente", () => {
    expect(cantidadSugeridaCompra({ pendiente: 10 })).toBe(10);
    expect(cantidadSugeridaCompra({ pendiente: 10, cubierto: null })).toBe(10);
    expect(cantidadSugeridaCompra({ pendiente: 10, cubierto: 10 })).toBe(10);
    expect(cantidadSugeridaCompra({ pendiente: 10, cubierto: 25 })).toBe(10);
  });
  it("nunca baja de 0", () => {
    expect(cantidadSugeridaCompra({ pendiente: -3, cubierto: 1 })).toBe(0);
    expect(cantidadSugeridaCompra({ pendiente: 5, cubierto: -2 })).toBe(5);
    expect(cantidadSugeridaCompra({})).toBe(0);
  });
});
