import { describe, it, expect } from "vitest";
import { objetivoPick, haySobreTurno, motivoValido, motivoFinal, MOTIVO_OTRO } from "./reserva";

describe("objetivoPick", () => {
  it("sin dato de turno todavía: ofrece lo pendiente (no bloquea a ciegas)", () => {
    expect(objetivoPick({ pendiente: 60, cubierto: null, forzado: false })).toBe(60);
  });
  it("con turno insuficiente: ofrece solo lo cubierto", () => {
    expect(objetivoPick({ pendiente: 60, cubierto: 20, forzado: false })).toBe(20);
  });
  it("turno alcanza para todo: ofrece lo pendiente", () => {
    expect(objetivoPick({ pendiente: 60, cubierto: 100, forzado: false })).toBe(60);
  });
  it("forzado: ofrece lo pendiente aunque el turno no alcance", () => {
    expect(objetivoPick({ pendiente: 60, cubierto: 20, forzado: true })).toBe(60);
  });
});

describe("haySobreTurno", () => {
  it("cubierto < pendiente -> true", () => {
    expect(haySobreTurno({ pendiente: 60, cubierto: 20 })).toBe(true);
  });
  it("cubierto >= pendiente -> false", () => {
    expect(haySobreTurno({ pendiente: 60, cubierto: 60 })).toBe(false);
    expect(haySobreTurno({ pendiente: 60, cubierto: 100 })).toBe(false);
  });
  it("sin dato -> false (no avisa hasta tener el número)", () => {
    expect(haySobreTurno({ pendiente: 60, cubierto: null })).toBe(false);
  });
});

describe("motivoValido / motivoFinal", () => {
  it("lista corta: válido sin texto libre", () => {
    expect(motivoValido("El cliente reprogramó", "")).toBe(true);
    expect(motivoFinal("El cliente reprogramó", "")).toBe("El cliente reprogramó");
  });
  it("OTRO sin texto libre: inválido", () => {
    expect(motivoValido(MOTIVO_OTRO, "")).toBe(false);
    expect(motivoValido(MOTIVO_OTRO, "   ")).toBe(false);
  });
  it("OTRO con texto libre: válido, usa el texto libre", () => {
    expect(motivoValido(MOTIVO_OTRO, "Autorizado por Ness por teléfono")).toBe(true);
    expect(motivoFinal(MOTIVO_OTRO, "Autorizado por Ness por teléfono")).toBe("Autorizado por Ness por teléfono");
  });
  it("nada seleccionado: inválido", () => {
    expect(motivoValido("", "")).toBe(false);
  });
});
