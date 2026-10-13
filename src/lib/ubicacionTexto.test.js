import { describe, expect, it } from "vitest";
import {
  abreviaturaZona, codigoUbicacion, compararUbicaciones, esMueble, etiquetaUbicacion,
  nombreMueble, rangoNumeros, siguienteLetra,
} from "./ubicacionTexto";

const estanteA3 = { codigo_zona: "PLANTA BAJA", estante: "Estante", nivel: "A", compartimiento: "3" };
const palletB = { codigo_zona: "SECTOR ARTE", estante: "Pallet", nivel: "B", compartimiento: null };
const faltantes = { codigo_zona: "SOBREGIRO ONLINE", estante: "Faltantes", nivel: "1", compartimiento: null };
const salon = { codigo_zona: "SALÓN", estante: null, nivel: null, compartimiento: null };

describe("etiquetaUbicacion", () => {
  it("arma zona › mueble › compartimiento", () => {
    expect(etiquetaUbicacion(estanteA3)).toBe("PLANTA BAJA › Estante A › 3");
    expect(etiquetaUbicacion(estanteA3, { largo: true })).toBe("PLANTA BAJA › Estante A › Compartimiento 3");
    expect(etiquetaUbicacion(palletB)).toBe("SECTOR ARTE › Pallet B");
  });
  it("no inventa letra en áreas especiales", () => {
    expect(etiquetaUbicacion(faltantes)).toBe("SOBREGIRO ONLINE › Faltantes");
    expect(etiquetaUbicacion(salon)).toBe("SALÓN");
    expect(etiquetaUbicacion(null)).toBe("—");
  });
  it("acepta otro separador", () => {
    expect(etiquetaUbicacion(estanteA3, { separador: " · " })).toBe("PLANTA BAJA · Estante A · 3");
  });
});

describe("códigos cortos", () => {
  it("abrevia zonas", () => {
    expect(abreviaturaZona("PLANTA BAJA")).toBe("PB");
    expect(abreviaturaZona("HUECO")).toBe("HUE");
    expect(abreviaturaZona("SALÓN")).toBe("SAL");
  });
  it("arma el código del mueble", () => {
    expect(codigoUbicacion(estanteA3)).toBe("PB-EA-3");
    expect(codigoUbicacion(palletB)).toBe("SA-PB");
    expect(codigoUbicacion(salon)).toBe("SAL");
  });
  it("distingue muebles de áreas especiales", () => {
    expect(esMueble(estanteA3)).toBe(true);
    expect(esMueble(faltantes)).toBe(false);
    expect(nombreMueble(palletB)).toBe("Pallet B");
  });
});

describe("orden y altas", () => {
  it("ordena compartimientos como números", () => {
    const filas = ["10", "2", "1"].map(c => ({ ...estanteA3, compartimiento: c }));
    expect(filas.sort(compararUbicaciones).map(f => f.compartimiento)).toEqual(["1", "2", "10"]);
  });
  it("pone estantes antes que pallets dentro de la zona", () => {
    const p = { ...palletB, codigo_zona: "PLANTA BAJA", nivel: "A" };
    expect([p, estanteA3].sort(compararUbicaciones)[0]).toBe(estanteA3);
  });
  it("propone la primera letra libre", () => {
    const filas = [estanteA3, { ...estanteA3, nivel: "B" }, { ...estanteA3, nivel: "D" }];
    expect(siguienteLetra(filas, "PLANTA BAJA", "Estante")).toBe("C");
    expect(siguienteLetra(filas, "PLANTA BAJA", "Pallet")).toBe("A");
  });
  it("genera rangos de compartimientos", () => {
    expect(rangoNumeros(1, 4)).toEqual(["1", "2", "3", "4"]);
    expect(rangoNumeros(5, 2)).toEqual([]);
    expect(rangoNumeros(1, 120)).toEqual([]);
  });
});
