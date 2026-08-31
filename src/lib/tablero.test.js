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

describe("clasificar", () => {
  it("sin pedidos -> las tres columnas vacías", () => {
    expect(clasificar([])).toEqual({ pendiente: [], preparacion: [], listo: [] });
    expect(clasificar(undefined)).toEqual({ pendiente: [], preparacion: [], listo: [] });
  });

  it("ABIERTO con lineas_resueltas = 0 -> pendiente", () => {
    const p = pedido({ id: 1, lineas_resueltas: 0 });
    expect(clasificar([p]).pendiente).toEqual([p]);
  });

  it("ABIERTO con 0 < lineas_resueltas < lineas_total -> preparacion", () => {
    const p = pedido({ id: 2, lineas_total: 3, lineas_resueltas: 1 });
    expect(clasificar([p]).preparacion).toEqual([p]);
  });

  it("estado COMPLETADO -> listo, sin importar lineas_resueltas", () => {
    const p = pedido({ id: 3, estado: "COMPLETADO", lineas_total: 3, lineas_resueltas: 3 });
    expect(clasificar([p]).listo).toEqual([p]);
  });

  it("COMPLETADO con lineas_resueltas = 0 igual va a listo, no a pendiente", () => {
    // No debería pasar en la práctica, pero el criterio de columna manda
    // sobre el conteo de líneas: estado === COMPLETADO siempre gana.
    const p = pedido({ id: 4, estado: "COMPLETADO", lineas_resueltas: 0 });
    const columnas = clasificar([p]);
    expect(columnas.listo).toEqual([p]);
    expect(columnas.pendiente).toEqual([]);
  });

  it("mezcla de pedidos se reparte correctamente entre las tres columnas", () => {
    const pendiente = pedido({ id: 1, lineas_resueltas: 0 });
    const preparacion = pedido({ id: 2, lineas_total: 4, lineas_resueltas: 2 });
    const listo = pedido({ id: 3, estado: "COMPLETADO", lineas_total: 2, lineas_resueltas: 2 });
    const columnas = clasificar([pendiente, preparacion, listo]);
    expect(columnas).toEqual({ pendiente: [pendiente], preparacion: [preparacion], listo: [listo] });
  });
});
