/**
 * tablero.js — capa de datos del Tablero de Almacén v2 (TV, estilo pantalla de
 * aeropuerto). Ver TableroAlmacenApp.jsx.
 *
 * La base (public.tablero_almacen) ya decide la etapa de cada documento
 * (POR_ALISTAR, ALISTANDO, POR_VERIFICAR, LISTO, EN_CAJA, EN_CAMINO, PARCIAL,
 * RETORNO). Acá solo se ordena, se marca la demora, se pagina y se arma el
 * texto: todo puro y testeable sin Supabase, salvo fetchTablero.
 */
import { supabase } from "../supabaseClient";

export async function fetchTablero(sucursalId = null) {
  const { data, error } = await supabase.rpc("tablero_almacen", { p_sucursal_id: sucursalId });
  if (error) throw error;
  return data || { filas: [], completados: [] };
}

// ── Etapas ────────────────────────────────────────────────────────────────
// orden: la fila más urgente arriba. Las VTD activas van antes que todo
// (hay un cliente esperando en caja), ver ordenar().
export const ETAPAS = {
  LISTO:         { label: "LISTO PARA SALIR", orden: 1, clase: "tab-e-listo" },
  POR_VERIFICAR: { label: "POR VERIFICAR",    orden: 2, clase: "tab-e-verificar" },
  ALISTANDO:     { label: "ALISTANDO",        orden: 3, clase: "tab-e-alistando" },
  POR_ALISTAR:   { label: "POR ALISTAR",      orden: 4, clase: "tab-e-por-alistar" },
  EN_CAJA:       { label: "EN CAJA",          orden: 5, clase: "tab-e-camino" },
  EN_CAMINO:     { label: "EN CAMINO",        orden: 5, clase: "tab-e-camino" },
  PARCIAL:       { label: "PARCIAL",          orden: 6, clase: "tab-e-parcial" },
  RETORNO:       { label: "RETORNO",          orden: 7, clase: "tab-e-retorno" },
};

export function etapaInfo(etapa) {
  return ETAPAS[etapa] || { label: etapa || "—", orden: 9, clase: "tab-e-por-alistar" };
}

const CATEGORIAS = {
  MAYOR: "Mayoreo",
  TIENDA: "Tienda directa",
  INSTITUCIONAL: "Institucional",
  MUNICIPAL: "Corporativo",
  CORPORATIVO: "Corporativo",
};

// ── Demoras ───────────────────────────────────────────────────────────────
// VTD y traslados cuentan solo minutos de turno (8:00–21:30, La Paz): la
// noche no los vuelve rojos. Los pedidos cuentan horas corridas sin
// movimiento.
export const DEMORA = {
  vtdMinutos: 5,
  trasladoMinutos: 120,
  pedidoHoras: 24,
};

const LA_PAZ_OFFSET_MIN = -4 * 60; // Bolivia no tiene horario de verano.
const TURNO_INICIO_MIN = 8 * 60;
const TURNO_FIN_MIN = 21 * 60 + 30;
const DIA_MS = 86400000;

/** Minutos de turno (8:00–21:30 hora de La Paz) entre dos instantes. */
export function minutosHabiles(desde, hasta) {
  if (desde == null || hasta == null) return 0;
  const a = new Date(desde).getTime();
  const b = new Date(hasta).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  const off = LA_PAZ_OFFSET_MIN * 60000;
  const wa = a + off;
  const wb = b + off;
  let total = 0;
  // Tope de 400 días: un documento más viejo ya es demorado de sobra.
  const inicio = Math.max(Math.floor(wa / DIA_MS), Math.floor(wb / DIA_MS) - 400);
  for (let dia = inicio; dia * DIA_MS <= wb; dia++) {
    const t0 = dia * DIA_MS + TURNO_INICIO_MIN * 60000;
    const t1 = dia * DIA_MS + TURNO_FIN_MIN * 60000;
    const solape = Math.min(t1, wb) - Math.max(t0, wa);
    if (solape > 0) total += solape;
  }
  return Math.floor(total / 60000);
}

/** "7 min", "3 h", "2 d" — duración corta para la TV. */
export function duracionCorta(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/**
 * ¿Está demorada la fila? Devuelve { demorado, texto }; texto es el tiempo
 * corrido desde la referencia (lo que entiende la gente), aunque la regla de
 * VTD y traslados mire minutos de turno.
 */
export function demora(fila, ahora = new Date()) {
  const ahoraMs = new Date(ahora).getTime();
  if (fila.tipo === "VTD" && (fila.etapa === "POR_ALISTAR" || fila.etapa === "ALISTANDO")) {
    const demorado = minutosHabiles(fila.entro_en, ahora) > DEMORA.vtdMinutos;
    return { demorado, texto: duracionCorta(ahoraMs - new Date(fila.entro_en).getTime()) };
  }
  if (fila.tipo === "TRA" && ["POR_ALISTAR", "ALISTANDO", "POR_VERIFICAR", "LISTO"].includes(fila.etapa)) {
    const demorado = minutosHabiles(fila.entro_en, ahora) > DEMORA.trasladoMinutos;
    return { demorado, texto: duracionCorta(ahoraMs - new Date(fila.entro_en).getTime()) };
  }
  if (fila.tipo === "PED" && ["POR_ALISTAR", "ALISTANDO", "POR_VERIFICAR", "LISTO"].includes(fila.etapa)) {
    const ref = fila.ultimo_mov_en || fila.entro_en;
    const ms = ahoraMs - new Date(ref).getTime();
    return { demorado: ms > DEMORA.pedidoHoras * 3600000, texto: duracionCorta(ms) };
  }
  return { demorado: false, texto: "" };
}

// ── Textos ────────────────────────────────────────────────────────────────
/** PED-2026-00845 -> PED-00845 (el año sobra en la TV). */
export function numeroCorto(numero) {
  if (!numero) return "—";
  const m = /^([A-Z]{2,4})-\d{4}-(\d+)$/.exec(numero);
  return m ? `${m[1]}-${m[2]}` : numero;
}

export function clave(fila) {
  return `${fila.tipo}-${fila.id}`;
}

function plural(n, uno, varios) {
  return `${n} ${n === 1 ? uno : varios}`;
}

export function detalle(fila) {
  if (fila.tipo === "VTD") {
    if (fila.etapa === "RETORNO") return "Anulada en caja · volver la mercadería a su estante";
    const partes = [plural(fila.total, "línea", "líneas"), fila.encargado || "sin encargado"];
    if (fila.cajero) partes.push(`cobra ${fila.cajero}`);
    return partes.join(" · ");
  }
  if (fila.tipo === "TRA") {
    const partes = [plural(fila.total, "línea", "líneas"), fila.encargado || "sin encargado"];
    if (fila.referencia) partes.push(fila.referencia);
    return partes.join(" · ");
  }
  const partes = [CATEGORIAS[fila.categoria] || fila.categoria || "Pedido"];
  if (fila.etapa === "PARCIAL") {
    const falta = [];
    if (fila.por_comprar) falta.push(`${fila.por_comprar} por comprar`);
    if (fila.especiales) falta.push(plural(fila.especiales, "especial", "especiales"));
    partes.push(`salió ${fila.resueltas} de ${fila.total}`);
    if (falta.length) partes.push(`falta ${falta.join(" y ")}`);
  } else {
    partes.push(fila.encargado || "sin encargado");
    if (fila.sucursal) partes.push(fila.sucursal);
    if (fila.referencia) partes.push(fila.referencia);
  }
  return partes.join(" · ");
}

export function avance(fila) {
  const total = Number(fila.total) || 0;
  if (fila.hecho == null) return { texto: total ? plural(total, "lín.", "lín.") : "—", pct: 0 };
  const hecho = Math.min(Number(fila.hecho) || 0, total);
  return { texto: `${hecho}/${total}`, pct: total ? Math.round((hecho / total) * 100) : 0 };
}

// ── Orden, resumen y páginas ──────────────────────────────────────────────
function prioridad(fila) {
  if (fila.tipo === "VTD" && (fila.etapa === "POR_ALISTAR" || fila.etapa === "ALISTANDO")) return 0;
  return etapaInfo(fila.etapa).orden;
}

/** VTD activas arriba; luego lo más cerca de salir; dentro, lo más antiguo primero. */
export function ordenar(filas) {
  return [...(filas || [])].sort((a, b) =>
    prioridad(a) - prioridad(b) ||
    new Date(a.entro_en).getTime() - new Date(b.entro_en).getTime() ||
    String(a.numero).localeCompare(String(b.numero))
  );
}

/** Junta orden, demora y textos: lo que la pantalla pinta tal cual. */
export function preparar(datos, ahora = new Date()) {
  const filas = ordenar(datos?.filas).map((f) => {
    const d = demora(f, ahora);
    return {
      ...f,
      clave: clave(f),
      corto: numeroCorto(f.numero),
      etapaLabel: etapaInfo(f.etapa).label,
      etapaClase: etapaInfo(f.etapa).clase,
      detalle: detalle(f),
      avance: avance(f),
      demorado: d.demorado,
      demoraTexto: d.texto,
      vtdActiva: f.tipo === "VTD" && (f.etapa === "POR_ALISTAR" || f.etapa === "ALISTANDO"),
    };
  });
  const completados = (datos?.completados || []).map((c) => ({
    ...c,
    corto: numeroCorto(c.numero),
    clave: `${c.tipo}-${c.numero}-${c.hora}`,
    texto: c.total ? `${c.estado} ${c.hecho}/${c.total}` : c.estado,
  }));
  return {
    filas,
    completados,
    resumen: {
      enCurso: filas.length,
      demorados: filas.filter((f) => f.demorado).length,
      hoy: completados.length,
    },
  };
}

export function paginar(items, porPagina, pagina) {
  const lista = items || [];
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const actual = ((pagina % paginas) + paginas) % paginas;
  return { items: lista.slice(actual * porPagina, actual * porPagina + porPagina), pagina: actual, paginas };
}

/** Avisos para la franja de abajo: VTD esperando, retornos y demorados. */
export function avisos(filas, max = 5) {
  const out = [];
  for (const f of filas) {
    if (f.vtdActiva) out.push({ clave: f.clave, texto: `${f.corto} · CAJA ESPERA HACE ${f.demoraTexto.toUpperCase()}`, urgente: f.demorado });
  }
  for (const f of filas) {
    if (!f.vtdActiva && f.demorado) out.push({ clave: f.clave, texto: `${f.corto} ${f.titulo.toUpperCase()} · DEMORADO ${f.demoraTexto.toUpperCase()}`, urgente: true });
  }
  for (const f of filas) {
    if (f.etapa === "RETORNO") out.push({ clave: f.clave, texto: `${f.corto} · DEVOLVER A ESTANTE`, urgente: false });
  }
  return out.slice(0, max);
}

// ── Avisos con voz ────────────────────────────────────────────────────────
/**
 * Documentos que no estaban en la carga anterior. prevClaves = null en la
 * primera carga: no se anuncia nada al abrir la pantalla.
 */
export function detectarNuevos(prevClaves, filas) {
  if (!prevClaves) return [];
  return (filas || []).filter((f) => !prevClaves.has(clave(f)) && f.etapa !== "RETORNO" && f.etapa !== "PARCIAL");
}

/** Lo que dice la voz. Números leídos sin ceros a la izquierda: "981". */
export function textoVoz(fila) {
  const n = String(fila.numero || "").replace(/^.*-0*/, "");
  if (fila.tipo === "VTD") return `Venta directa ${n}, a caja`;
  if (fila.tipo === "TRA") return `Traslado nuevo, ${fila.titulo.replace("→", "a")}`;
  return `Pedido nuevo, ${fila.titulo}`;
}

/** VTD demoradas cuya voz toca repetir (cada repetirMs). Muta ultimaVez. */
export function vtdParaRepetir(filas, ultimaVez, ahoraMs, repetirMs = 120000) {
  const out = [];
  for (const f of filas) {
    if (!(f.vtdActiva && f.demorado)) continue;
    const prev = ultimaVez.get(f.clave);
    if (prev == null || ahoraMs - prev >= repetirMs) {
      ultimaVez.set(f.clave, ahoraMs);
      out.push(f);
    }
  }
  return out;
}
