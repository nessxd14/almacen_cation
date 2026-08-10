// inventario.js
// Lógica pura de InventarioApp, separada para poder testearla sin Supabase
// ni React: mapeo de v_inventario_resumen a las tarjetas, filtro por
// sucursal, y la regla de stock_min vs. umbral global.

// v_inventario_resumen trae una fila por sucursal — esto la convierte en
// lo que pintan las tarjetas de resumen.
export function resumenATarjetas(resumenRow) {
  if (!resumenRow) return null;
  return {
    totalProductos: Number(resumenRow.productos_con_stock || 0),
    totalUnidades: Number(resumenRow.unidades || 0),
    valorTotal: Number(resumenRow.valor || 0),
    enCero: Number(resumenRow.productos_en_cero || 0),
    filasDetalle: Number(resumenRow.filas_detalle || 0),
  };
}

// Filas de v_inventario_detalle (que puede traer varias sucursales
// mezcladas si el caller no filtró en la query) restringidas a una sola.
export function filtrarPorSucursal(filas, sucursalId) {
  if (sucursalId == null) return filas;
  return filas.filter((f) => f.sucursal_id === sucursalId);
}

// stock_min del producto manda; si es NULL (no cargado todavía) cae al
// umbral global configurado en la pantalla.
export function umbralEfectivo(stockMin, umbralGlobal) {
  return stockMin != null ? Number(stockMin) : Number(umbralGlobal);
}

export function nivelAlerta(cantidad, stockMin, umbralGlobal) {
  const n = Number(cantidad);
  if (n === 0) return "cero";
  if (n <= umbralEfectivo(stockMin, umbralGlobal)) return "bajo";
  return "ok";
}
