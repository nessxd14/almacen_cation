// lib/compras.js — lógica pura sobre compra_solicitud / v_compras_pendientes
// (brief W-PC), separada para testearla sin Supabase ni React — mismo patrón
// que src/lib/faltantes.js.

const ETIQUETAS_ESTADO = {
  SOLICITADA: "Solicitada",
  COMPRADA: "Comprada",
  RECIBIDA: "Recibida",
  CANCELADA: "Cancelada",
};

const ETIQUETAS_ORIGEN = {
  VENDEDOR: "Vendedor",
  ALMACEN: "Almacén",
  PERSONALIZADO: "Personalizado",
};

export function etiquetaEstadoCompra(estado) {
  return ETIQUETAS_ESTADO[estado] ?? estado ?? "";
}

export function etiquetaOrigenCompra(origen) {
  return ETIQUETAS_ORIGEN[origen] ?? origen ?? "";
}

// Más antigua primero (la que más espera). No muta la entrada; las filas sin
// fecha o con fecha inválida van al final.
export function ordenarCompras(filas) {
  const t = (f) => {
    const ms = new Date(f.solicitado_en).getTime();
    return Number.isNaN(ms) ? Infinity : ms;
  };
  return [...(filas || [])].sort((a, b) => t(a) - t(b));
}

// estado: "TODAS" | "SOLICITADA" | "COMPRADA". texto: producto, SKU, número o título del pedido.
export function filtrarCompras(filas, { estado = "TODAS", texto = "" } = {}) {
  const q = String(texto || "").trim().toLowerCase();
  return (filas || []).filter((f) => {
    if (estado && estado !== "TODAS" && f.estado !== estado) return false;
    if (!q) return true;
    return [f.producto_nombre, f.sku_interno, f.pedido_numero, f.pedido_titulo]
      .some((v) => v != null && String(v).toLowerCase().includes(q));
  });
}

// Cantidad a proponer al mandar una línea a compra: lo pendiente menos lo que
// ya hay cubierto (stock disponible). Si no se sabe lo cubierto, o cubre todo
// o más, se propone lo pendiente entero. Nunca menos que 0.
export function cantidadSugeridaCompra({ pendiente, cubierto }) {
  const p = Math.max(Number(pendiente) || 0, 0);
  if (typeof cubierto === "number" && Number.isFinite(cubierto) && cubierto < p) {
    return Math.max(p - Math.max(cubierto, 0), 0);
  }
  return p;
}
