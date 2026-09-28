import { describe, it, expect, vi, beforeEach } from "vitest";

const { from, select, inFilter } = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), inFilter: vi.fn() }));
vi.mock("../supabaseClient", () => ({ supabase: { from } }));
import { resolverAutores, solicitantePedido } from "./autoria";

describe("Solicitante de pedidos", () => {
  const autores = new Map([["seller@example.test", "Rony"], ["warehouse@example.test", "Gabriel"]]);
  it("muestra al solicitante explícito aunque el creador sea otra persona", () => {
    expect(solicitantePedido({ solicitado_por: "warehouse@example.test", creado_por: "seller@example.test" }, autores)).toBe("Gabriel");
  });
  it("conserva el nombre libre del solicitante", () => {
    expect(solicitantePedido({ solicitado_por: " María ", creado_por: "seller@example.test" }, autores)).toBe("María");
  });
  it("usa al autor cuando el pedido antiguo no tiene solicitante", () => {
    expect(solicitantePedido({ solicitado_por: "  ", creado_por: "seller@example.test" }, autores)).toBe("Rony");
  });
  it("conserva el identificador cuando el perfil no está disponible", () => {
    expect(solicitantePedido({ creado_por: "externo@example.test" }, autores)).toBe("externo@example.test");
    expect(solicitantePedido({}, autores)).toBe("—");
  });
});

describe("Resolución de autores en listas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    from.mockReturnValue({ select });
    select.mockReturnValue({ in: inFilter });
    inFilter.mockResolvedValue({ data: [{ email: "seller@example.test", nombre: "Rony" }] });
  });
  it("resuelve solicitantes y autores con una sola consulta sin duplicados ni blancos", async () => {
    const mapa = await resolverAutores([" seller@example.test ", null, "", "seller@example.test", "warehouse@example.test"]);
    expect(inFilter).toHaveBeenCalledExactlyOnceWith("email", ["seller@example.test", "warehouse@example.test"]);
    expect(mapa.get("seller@example.test")).toBe("Rony");
  });
  it("no consulta perfiles cuando no hay identificadores", async () => {
    expect((await resolverAutores([null, " "])).size).toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});
