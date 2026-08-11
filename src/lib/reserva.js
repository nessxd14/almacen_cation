// lib/reserva.js — lógica pura de la compuerta de reserva (brief W8),
// separada para poder testearla sin Supabase ni React — mismo patrón que
// src/lib/control.js y src/lib/despacho.js.
//
// `cubierto` sale de v_pedido_linea_reserva (turno FIFO ya calculado en la
// base: reserva de clientes primero, reposición después) — acá no se
// reimplementa ese cálculo, solo se decide qué mostrar/pedir con él.

// Cuánto pick automático ofrecer: todo lo pendiente si hay turno para eso,
// o solo lo cubierto si no — salvo que el usuario ya haya elegido "Despachar
// igual" (forzado), en cuyo caso se ofrece lo pendiente completo aunque no
// tenga turno.
export function objetivoPick({ pendiente, cubierto, forzado }) {
  const p = Number(pendiente) || 0;
  if (forzado || cubierto == null) return p;
  return Math.min(p, Math.max(Number(cubierto), 0));
}

// ¿Esta línea tiene menos turno que lo pendiente? — dispara el aviso y el
// botón "Despachar igual".
export function haySobreTurno({ pendiente, cubierto }) {
  if (cubierto == null) return false;
  return Number(cubierto) < Number(pendiente) - 0.0001;
}

export const MOTIVOS_DESPACHO_FORZADO = [
  "El cliente reprogramó",
  "Llega mercadería",
  "Autorizado por gerencia",
];
export const MOTIVO_OTRO = "OTRO";

// Brief W8: "se puede pisar, nunca en silencio" — motivo obligatorio, de la
// lista corta o texto libre.
export function motivoValido(seleccionado, libre) {
  if (seleccionado && seleccionado !== MOTIVO_OTRO) return true;
  return Boolean((libre || "").trim());
}

export function motivoFinal(seleccionado, libre) {
  if (seleccionado && seleccionado !== MOTIVO_OTRO) return seleccionado;
  return (libre || "").trim();
}
