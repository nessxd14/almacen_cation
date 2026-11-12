import { describe, it, expect, vi, beforeAll } from "vitest";

// Las funciones son puras, pero el módulo importa supabaseClient (que tira si
// faltan las env vars). Se stubean antes del import dinámico.
let T;
beforeAll(async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
  T = await import("./tablero");
});

// 12/11/2026 19:00 en La Paz = 23:00 UTC.
const AHORA = new Date("2026-11-12T23:00:00Z");
const laPaz = (fechaHora) => new Date(`${fechaHora}-04:00`).toISOString();

function fila(over) {
  return {
    tipo: "PED", id: 1, numero: "PED-2026-00001", titulo: "Cliente", referencia: null,
    categoria: "MAYOR", etapa: "POR_ALISTAR", puerta: "DESPACHO", sucursal: null,
    encargado: null, revisor: null, hecho: 0, total: 3, resueltas: 0, por_comprar: 0,
    especiales: 0, entro_en: laPaz("2026-11-12T18:00:00"), ultimo_mov_en: laPaz("2026-11-12T18:00:00"),
    cajero: null, productos: null, ...over,
  };
}

describe("minutosHabiles — turno 8:00 a 21:30 de La Paz", () => {
  it("dentro del turno cuenta minutos corridos", () => {
    expect(T.minutosHabiles(laPaz("2026-11-12T10:00:00"), laPaz("2026-11-12T10:07:00"))).toBe(7);
  });
  it("la noche no suma", () => {
    // 21:00 a 08:10 del día siguiente = 30 min + 10 min.
    expect(T.minutosHabiles(laPaz("2026-11-11T21:00:00"), laPaz("2026-11-12T08:10:00"))).toBe(40);
  });
  it("fuera de turno completo da 0", () => {
    expect(T.minutosHabiles(laPaz("2026-11-12T22:00:00"), laPaz("2026-11-13T07:59:00"))).toBe(0);
  });
  it("un día entero suma 13 h 30", () => {
    expect(T.minutosHabiles(laPaz("2026-11-11T00:00:00"), laPaz("2026-11-12T00:00:00"))).toBe(810);
  });
  it("fechas inválidas o invertidas dan 0", () => {
    expect(T.minutosHabiles(null, AHORA)).toBe(0);
    expect(T.minutosHabiles(AHORA, laPaz("2026-11-12T10:00:00"))).toBe(0);
  });
});

describe("demora", () => {
  it("VTD por alistar más de 5 min de turno -> demorada", () => {
    const d = T.demora(fila({ tipo: "VTD", etapa: "POR_ALISTAR", entro_en: laPaz("2026-11-12T18:54:00") }), AHORA);
    expect(d).toEqual({ demorado: true, texto: "6 min" });
  });
  it("VTD con 4 min -> no demorada", () => {
    expect(T.demora(fila({ tipo: "VTD", etapa: "ALISTANDO", entro_en: laPaz("2026-11-12T18:56:00") }), AHORA).demorado).toBe(false);
  });
  it("VTD ya en caja o en retorno nunca se marca", () => {
    expect(T.demora(fila({ tipo: "VTD", etapa: "EN_CAJA", entro_en: laPaz("2026-11-10T10:00:00") }), AHORA).demorado).toBe(false);
    expect(T.demora(fila({ tipo: "VTD", etapa: "RETORNO", entro_en: laPaz("2026-10-10T10:00:00") }), AHORA).demorado).toBe(false);
  });
  it("traslado pedido a las 21:00 no está demorado a las 9:00 del día siguiente", () => {
    const f = fila({ tipo: "TRA", etapa: "POR_ALISTAR", entro_en: laPaz("2026-11-11T21:00:00") });
    expect(T.demora(f, new Date(laPaz("2026-11-12T09:00:00")))).toEqual({ demorado: false, texto: "12 h" });
  });
  it("traslado con más de 2 h de turno -> demorado", () => {
    const f = fila({ tipo: "TRA", etapa: "POR_ALISTAR", entro_en: laPaz("2026-11-12T16:00:00") });
    expect(T.demora(f, AHORA).demorado).toBe(true);
  });
  it("pedido sin movimiento más de 24 h -> demorado; mira el último movimiento, no la entrada", () => {
    const viejoQuieto = fila({ entro_en: laPaz("2026-11-01T10:00:00"), ultimo_mov_en: laPaz("2026-11-10T19:00:00") });
    expect(T.demora(viejoQuieto, AHORA)).toEqual({ demorado: true, texto: "2 d" });
    const viejoActivo = fila({ entro_en: laPaz("2026-11-01T10:00:00"), ultimo_mov_en: laPaz("2026-11-12T12:00:00") });
    expect(T.demora(viejoActivo, AHORA).demorado).toBe(false);
  });
  it("pedido PARCIAL (espera compra) no se marca", () => {
    expect(T.demora(fila({ etapa: "PARCIAL", ultimo_mov_en: laPaz("2026-08-01T10:00:00") }), AHORA).demorado).toBe(false);
  });
});

describe("ordenar", () => {
  it("VTD activas arriba, luego listo > verificar > alistando > por alistar > en camino > parcial > retorno; antiguo primero", () => {
    const filas = [
      fila({ id: 1, numero: "PED-1", etapa: "POR_ALISTAR", entro_en: laPaz("2026-11-12T10:00:00") }),
      fila({ id: 2, numero: "PED-2", etapa: "PARCIAL" }),
      fila({ id: 3, numero: "VTD-3", tipo: "VTD", etapa: "RETORNO" }),
      fila({ id: 4, numero: "PED-4", etapa: "POR_VERIFICAR" }),
      fila({ id: 5, numero: "VTD-5", tipo: "VTD", etapa: "ALISTANDO", entro_en: laPaz("2026-11-12T18:58:00") }),
      fila({ id: 6, numero: "PED-6", etapa: "LISTO" }),
      fila({ id: 7, numero: "PED-7", etapa: "POR_ALISTAR", entro_en: laPaz("2026-11-01T10:00:00") }),
      fila({ id: 8, numero: "TRA-8", tipo: "TRA", etapa: "EN_CAMINO" }),
      fila({ id: 9, numero: "PED-9", etapa: "ALISTANDO" }),
    ];
    expect(T.ordenar(filas).map((f) => f.id)).toEqual([5, 6, 4, 9, 7, 1, 8, 2, 3]);
  });
  it("no muta la lista original", () => {
    const filas = [fila({ id: 2, etapa: "PARCIAL" }), fila({ id: 1, etapa: "LISTO" })];
    T.ordenar(filas);
    expect(filas.map((f) => f.id)).toEqual([2, 1]);
  });
});

describe("textos", () => {
  it("numeroCorto quita el año", () => {
    expect(T.numeroCorto("PED-2026-00845")).toBe("PED-00845");
    expect(T.numeroCorto("VTD-2026-00981")).toBe("VTD-00981");
    expect(T.numeroCorto("raro")).toBe("raro");
    expect(T.numeroCorto(null)).toBe("—");
  });
  it("detalle de pedido: canal, encargado, sucursal", () => {
    expect(T.detalle(fila({ categoria: "CORPORATIVO", encargado: "Rovin Rojas", sucursal: "Almacén Central" })))
      .toBe("Corporativo · Rovin Rojas · Almacén Central");
    expect(T.detalle(fila({ categoria: "MAYOR" }))).toBe("Mayoreo · sin encargado");
  });
  it("detalle de pedido PARCIAL dice qué falta", () => {
    expect(T.detalle(fila({ etapa: "PARCIAL", resueltas: 43, total: 44, especiales: 1 })))
      .toBe("Mayoreo · salió 43 de 44 · falta 1 especial");
    expect(T.detalle(fila({ etapa: "PARCIAL", resueltas: 18, total: 20, por_comprar: 2 })))
      .toBe("Mayoreo · salió 18 de 20 · falta 2 por comprar");
  });
  it("detalle de VTD y retorno", () => {
    expect(T.detalle(fila({ tipo: "VTD", etapa: "ALISTANDO", total: 2, encargado: "Ivar", cajero: "juan" })))
      .toBe("2 líneas · Ivar · cobra juan");
    expect(T.detalle(fila({ tipo: "VTD", etapa: "RETORNO" }))).toMatch(/estante/);
  });
  it("avance: hecho/total con tope; sin dato muestra líneas", () => {
    expect(T.avance(fila({ hecho: 25, total: 29 }))).toEqual({ texto: "25/29", pct: 86 });
    expect(T.avance(fila({ hecho: 9, total: 7 }))).toEqual({ texto: "7/7", pct: 100 });
    expect(T.avance(fila({ hecho: null, total: 2 }))).toEqual({ texto: "2 lín.", pct: 0 });
  });
  it("textoVoz lee el número sin ceros", () => {
    expect(T.textoVoz(fila({ tipo: "VTD", numero: "VTD-2026-00981" }))).toBe("Venta directa 981, a caja");
    expect(T.textoVoz(fila({ numero: "PED-2026-00845", titulo: "DROGUERIA INTI S.A." }))).toBe("Pedido nuevo, DROGUERIA INTI S.A.");
    expect(T.textoVoz(fila({ tipo: "TRA", titulo: "Reposición → Tienda" }))).toBe("Traslado nuevo, Reposición a Tienda");
  });
});

describe("preparar, páginas y avisos", () => {
  const datos = {
    filas: [
      fila({ id: 1, numero: "PED-2026-00845", etapa: "POR_ALISTAR", ultimo_mov_en: laPaz("2026-11-10T10:00:00") }),
      fila({ id: 2, tipo: "VTD", numero: "VTD-2026-00981", etapa: "ALISTANDO", entro_en: laPaz("2026-11-12T18:50:00") }),
      fila({ id: 3, tipo: "VTD", numero: "VTD-2026-00979", etapa: "RETORNO" }),
    ],
    completados: [{ tipo: "PED", numero: "PED-2026-00844", titulo: "DANIEL", hora: laPaz("2026-11-12T17:55:00"), estado: "DESPACHADO", hecho: 1, total: 1 }],
  };
  it("preparar ordena, marca demoras y resume", () => {
    const p = T.preparar(datos, AHORA);
    expect(p.filas.map((f) => f.corto)).toEqual(["VTD-00981", "PED-00845", "VTD-00979"]);
    expect(p.filas[0]).toMatchObject({ vtdActiva: true, demorado: true, demoraTexto: "10 min", etapaLabel: "ALISTANDO" });
    expect(p.resumen).toEqual({ enCurso: 3, demorados: 2, hoy: 1 });
    expect(p.completados[0].texto).toBe("DESPACHADO 1/1");
  });
  it("preparar sin datos no rompe", () => {
    expect(T.preparar(null, AHORA)).toEqual({ filas: [], completados: [], resumen: { enCurso: 0, demorados: 0, hoy: 0 } });
  });
  it("paginar da la vuelta", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(T.paginar(xs, 2, 0)).toEqual({ items: [1, 2], pagina: 0, paginas: 3 });
    expect(T.paginar(xs, 2, 4)).toEqual({ items: [3, 4], pagina: 1, paginas: 3 });
    expect(T.paginar([], 2, 7)).toEqual({ items: [], pagina: 0, paginas: 1 });
  });
  it("avisos: VTD esperando, luego demorados, luego retornos", () => {
    const p = T.preparar(datos, AHORA);
    expect(T.avisos(p.filas).map((a) => a.texto)).toEqual([
      "VTD-00981 · CAJA ESPERA HACE 10 MIN",
      "PED-00845 CLIENTE · DEMORADO 2 D",
      "VTD-00979 · DEVOLVER A ESTANTE",
    ]);
  });
});

describe("avisos con voz", () => {
  it("la primera carga no anuncia; después solo lo nuevo, sin retornos ni parciales", () => {
    const a = fila({ id: 1 });
    expect(T.detectarNuevos(null, [a])).toEqual([]);
    const prev = new Set([T.clave(a)]);
    const b = fila({ id: 2, tipo: "VTD" });
    const c = fila({ id: 3, tipo: "VTD", etapa: "RETORNO" });
    const d = fila({ id: 4, etapa: "PARCIAL" });
    expect(T.detectarNuevos(prev, [a, b, c, d])).toEqual([b]);
  });
  it("pedido y VTD con el mismo id no se confunden", () => {
    const prev = new Set(["PED-5"]);
    expect(T.detectarNuevos(prev, [fila({ id: 5, tipo: "VTD" })])).toHaveLength(1);
  });
  it("VTD demorada se repite cada 2 min", () => {
    const f = { clave: "VTD-1", vtdActiva: true, demorado: true };
    const ultima = new Map();
    expect(T.vtdParaRepetir([f], ultima, 0)).toHaveLength(1);
    expect(T.vtdParaRepetir([f], ultima, 60000)).toHaveLength(0);
    expect(T.vtdParaRepetir([f], ultima, 120000)).toHaveLength(1);
    expect(T.vtdParaRepetir([{ ...f, demorado: false, clave: "VTD-2" }], ultima, 999999)).toHaveLength(0);
  });
});
