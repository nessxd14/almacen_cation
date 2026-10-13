// Única fuente de verdad para nombrar ubicaciones en toda la app.
//
// Columnas de `ubicacion` (ver db/migrations/2026-10-12_ubicacion_mueble_letra_compartimiento_numero.sql):
//   codigo_zona     zona                        "PLANTA BAJA"
//   estante         tipo de mueble              "Estante" | "Pallet" (u otro rótulo en áreas especiales)
//   nivel           LETRA del mueble            "A"–"Z"
//   compartimiento  NÚMERO del compartimiento   "1", "2"… (null = mueble sin divisiones)
//
// Ejemplo: PLANTA BAJA › Estante A › 3   ·   código corto PB-EA-3

export const TIPOS_MUEBLE = ["Estante", "Pallet"];
export const LETRAS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

/** true si la ubicación es un mueble (estante o pallet) y no un área especial. */
export function esMueble(u) {
  return !!u && TIPOS_MUEBLE.includes(u.estante);
}

/** "Estante A", "Pallet B"; para áreas especiales, su rótulo ("Faltantes") o "". */
export function nombreMueble(u) {
  if (!u) return "";
  if (esMueble(u)) return u.nivel ? `${u.estante} ${u.nivel}` : u.estante;
  return u.estante || "";
}

/**
 * Etiqueta legible: "PLANTA BAJA › Estante A › 3".
 * Con `largo: true` el compartimiento se escribe completo: "… › Compartimiento 3".
 */
export function etiquetaUbicacion(u, { separador = " › ", largo = false } = {}) {
  if (!u) return "—";
  const partes = [u.codigo_zona];
  const mueble = nombreMueble(u);
  if (mueble) partes.push(mueble);
  if (u.compartimiento) partes.push(largo ? `Compartimiento ${u.compartimiento}` : String(u.compartimiento));
  return partes.filter(Boolean).join(separador);
}

/** Abreviatura de zona: "PLANTA BAJA" → "PB", "HUECO" → "HUE", "SALÓN" → "SAL". */
export function abreviaturaZona(zona) {
  const palabras = String(zona || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (palabras.length === 0) return "";
  if (palabras.length === 1) return palabras[0].slice(0, 3);
  return palabras.map(p => p[0]).join("");
}

/** Código corto para etiquetas y búsquedas rápidas: "PB-EA-3", "SA-PA". */
export function codigoUbicacion(u) {
  if (!u) return "";
  const zona = abreviaturaZona(u.codigo_zona);
  if (!esMueble(u)) return zona;
  const mueble = `${u.estante[0]}${u.nivel || ""}`;
  return [zona, mueble, u.compartimiento].filter(Boolean).join("-");
}

function numero(v) {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
}

/** Orden de recorrido: zona → tipo (estantes antes que pallets) → letra → compartimiento numérico. */
export function compararUbicaciones(a, b) {
  return String(a?.codigo_zona ?? "").localeCompare(String(b?.codigo_zona ?? ""), "es")
    || TIPOS_MUEBLE.indexOf(a?.estante) - TIPOS_MUEBLE.indexOf(b?.estante)
    || String(a?.nivel ?? "").localeCompare(String(b?.nivel ?? ""), "es")
    || numero(a?.compartimiento) - numero(b?.compartimiento);
}

/** Primera letra libre de la zona para ese tipo de mueble (A si no hay ninguno). */
export function siguienteLetra(ubicaciones, zona, tipo) {
  const usadas = new Set(
    (ubicaciones || [])
      .filter(u => u.codigo_zona === zona && u.estante === tipo)
      .map(u => String(u.nivel || "").toUpperCase())
  );
  return LETRAS.find(l => !usadas.has(l)) ?? null;
}

/** Rango inclusivo de compartimientos: rangoNumeros(1, 4) → ["1","2","3","4"]. Máximo 99. */
export function rangoNumeros(desde, hasta) {
  const a = Number.parseInt(desde, 10);
  const b = Number.parseInt(hasta, 10);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > 99 || a > b) return [];
  return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
}
