import { describe, it, expect, vi, beforeAll } from "vitest";

// clasificar() es pura, pero vive en el mismo módulo que fetchTablero/
// suscribirTablero (así lo pide el brief), que importan supabaseClient — y
// ese módulo tira si faltan las env vars, que no están seteadas en este
// entorno de test. Se stubean antes del import (dinámico, para que corra
// después del stub) solo para poder cargar el módulo; nunca se llega a usar
// un cliente Supabase real en estos tests.
let clasificar;
beforeAll(async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
  ({ clasificar } = await import("./tablero"));
});

function pedido(overrides) {
  return { id: 1, numero: "P-1", categoria: "MAYOR", estado: "ABIERTO", titulo: "Cliente", creado_en: "2026-01-01T00:00:00Z", lineas_total: 3, lineas_resueltas: 0, ultimo_movimiento_en: null, ...overrides };
}

function venta(overrides) {
  return { id: 1, numero: "VTD-2026-00001", estado: "ABIERTA", creado_en: "2026-01-01T00:00:00Z", completado_en: null, ...overrides };
}

describe("clasificar — pedidos", () => {
  it("sin pedidos ni ventas -> las tres columnas vacías", () => {
    expect(clasificar([], [])).toEqual({ pendiente: [], preparacion: [], listo: [] });
    expect(clasificar(undefined, undefined)).toEqual({ pendiente: [], preparacion: [], listo: [] });
  });

  it("ABIERTO con lineas_resueltas = 0 -> pendiente, con tipo 'pedido'", () => {
    const p = pedido({ id: 1, lineas_resueltas: 0 });
    expect(clasificar([p], [])).toEqual({ pendiente: [{ ...p, tipo: "pedido" }], preparacion: [], listo: [] });
  });

  it("ABIERTO con 0 < lineas_resueltas < lineas_total -> preparacion", () => {
    const p = pedido({ id: 2, lineas_total: 3, lineas_resueltas: 1 });
    expect(clasificar([p], []).preparacion).toEqual([{ ...p, tipo: "pedido" }]);
  });

  it("estado COMPLETADO -> listo, sin importar lineas_resueltas", () => {
    const p = pedido({ id: 3, estado: "COMPLETADO", lineas_total: 3, lineas_resueltas: 3 });
    expect(clasificar([p], []).listo).toEqual([{ ...p, tipo: "pedido" }]);
  });

  it("COMPLETADO con lineas_resueltas = 0 igual va a listo, no a pendiente", () => {
    // No debería pasar en la práctica, pero el criterio de columna manda
    // sobre el conteo de líneas: estado === COMPLETADO siempre gana.
    const p = pedido({ id: 4, estado: "COMPLETADO", lineas_resueltas: 0 });
    const columnas = clasificar([p], []);
    expect(columnas.listo).toEqual([{ ...p, tipo: "pedido" }]);
    expect(columnas.pendiente).toEqual([]);
  });

  it("mezcla de pedidos se reparte correctamente entre las tres columnas", () => {
    const pendiente = pedido({ id: 1, lineas_resueltas: 0 });
    const preparacion = pedido({ id: 2, lineas_total: 4, lineas_resueltas: 2 });
    const listo = pedido({ id: 3, estado: "COMPLETADO", lineas_total: 2, lineas_resueltas: 2 });
    const columnas = clasificar([pendiente, preparacion, listo], []);
    expect(columnas).toEqual({
      pendiente: [{ ...pendiente, tipo: "pedido" }],
      preparacion: [{ ...preparacion, tipo: "pedido" }],
      listo: [{ ...listo, tipo: "pedido" }],
    });
  });
});

describe("clasificar — Venta Directa (VTD)", () => {
  it("ABIERTA -> pendiente, con tipo 'vtd', nunca preparacion", () => {
    const v = venta({ id: 1, estado: "ABIERTA" });
    const columnas = clasificar([], [v]);
    expect(columnas.pendiente).toEqual([{ ...v, tipo: "vtd" }]);
    expect(columnas.preparacion).toEqual([]);
  });

  it("COMPLETADA -> listo", () => {
    const v = venta({ id: 2, estado: "COMPLETADA", completado_en: "2026-01-01T01:00:00Z" });
    expect(clasificar([], [v]).listo).toEqual([{ ...v, tipo: "vtd" }]);
  });

  it("pedidos y ventas directas conviven en la misma columna sin mezclar el tipo", () => {
    const pedidoPendiente = pedido({ id: 10, lineas_resueltas: 0 });
    const vtdPendiente = venta({ id: 20, estado: "ABIERTA" });
    const columnas = clasificar([pedidoPendiente], [vtdPendiente]);
    expect(columnas.pendiente).toEqual([
      { ...pedidoPendiente, tipo: "pedido" },
      { ...vtdPendiente, tipo: "vtd" },
    ]);
  });
});
