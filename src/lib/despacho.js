// despacho.js
// Lógica pura del despacho por lote de pedidos (brief W5), separada para
// poder testearla sin Supabase ni React — mismo patrón que
// src/lib/inventario.js y src/lib/control.js.
//
// El motivo de fondo: despachar línea por línea dispara una recarga
// completa del pedido por línea (docenas de consultas cada vez). En un
// pedido de 30 líneas eso son cientos de peticiones en pocos minutos, y
// si el access token vence en medio de la ráfaga, la renovación choca
// contra el rate limit de Supabase y expulsa a la persona (brief W4,
// segunda fuente). Agrupar el despacho en una sola llamada a
// despachar_lineas colapsa esas 30 recargas en una.

// Arma el payload de despachar_lineas a partir de la selección y los picks
// ya calculados (uno por línea, con asignaciones editables). Las líneas
// seleccionadas sin pick calculado todavía, o sin ninguna asignación con
// cantidad > 0, se excluyen — no tiene sentido mandarlas vacías.
export function armarPayloadDespacho(seleccion, picksPorLinea) {
  const payload = [];
  for (const lineaId of seleccion) {
    const pick = picksPorLinea.get(lineaId);
    if (!pick) continue;
    const asignaciones = (pick.asignaciones || []).filter((a) => Number(a.cantidad_base) > 0);
    if (asignaciones.length === 0) continue;
    payload.push({ linea_id: lineaId, asignaciones });
  }
  return payload;
}

// Líneas seleccionadas cuyo pick no cubre lo pendiente — para advertir
// "N líneas quedarán parcialmente pendientes" antes de despachar, no
// después. Devuelve los linea_id, no solo el conteo, para poder señalarlas.
export function lineasConFaltante(seleccion, picksPorLinea) {
  const faltantes = [];
  for (const lineaId of seleccion) {
    const pick = picksPorLinea.get(lineaId);
    if (!pick) continue;
    const asignado = (pick.asignaciones || []).reduce((s, a) => s + Number(a.cantidad_base || 0), 0);
    if (asignado + 0.0001 < Number(pick.pendiente || 0)) faltantes.push(lineaId);
  }
  return faltantes;
}

// Total de unidades en la selección — para "12 líneas seleccionadas · 340
// unidades" en la barra de acción. Suma lo pendiente de cada línea
// seleccionada (lo que efectivamente se intentará despachar), no el pick:
// una línea sin pick todavía calculado igual cuenta para el total.
export function totalUnidadesSeleccion(seleccion, lineasPorId) {
  let total = 0;
  for (const lineaId of seleccion) {
    const linea = lineasPorId.get(lineaId);
    if (!linea) continue;
    total += Math.max(Number(linea.cantidad_base) - Number(linea.cantidad_despachada || 0), 0);
  }
  return total;
}

const UNIDAD_ABREVIADA = { unidad: "u" };
function abreviarUnidad(unidad) {
  if (!unidad) return "";
  return UNIDAD_ABREVIADA[unidad.toLowerCase()] || unidad;
}

// "3 Caja x24 · 72 u" — para la hoja impresa (brief W5 #4), mismo patrón
// que la columna "Equiv." de DocumentoExportable en el POS: cantidad en la
// presentación pedida + el factor + la equivalencia en unidad base. Con
// factor 1 (o sin presentación) la presentación no aporta nada que la
// cantidad base ya no diga, así que se omite.
export function formatoEquivalencia({ cantidadPresentacion, nombrePresentacion, factor, cantidadBase, unidadBase }) {
  const unidad = abreviarUnidad(unidadBase);
  const f = Number(factor);
  if (!nombrePresentacion || !f || f <= 1) {
    return `${cantidadBase} ${unidad}`.trim();
  }
  return `${cantidadPresentacion} ${nombrePresentacion} x${f} · ${cantidadBase} ${unidad}`.trim();
}

// "Tienda · PISO" — antepone la sucursal cuando el contexto no la deja
// clara (brief W5 #5): Tienda hoy tiene una sola ubicación (PISO) y sin el
// prefijo un traslado ahí se lee como "se movió a otro lado" en vez de "se
// movió a Tienda". `nombreSucursal` es la función de SucursalContext — acá
// nunca se hardcodea un nombre de sucursal.
export function labelUbicacionConSucursal(ubicacionLabel, sucursalId, nombreSucursal) {
  if (!ubicacionLabel) return ubicacionLabel;
  if (sucursalId == null || typeof nombreSucursal !== "function") return ubicacionLabel;
  const nombre = nombreSucursal(sucursalId);
  return nombre ? `${nombre} · ${ubicacionLabel}` : ubicacionLabel;
}
