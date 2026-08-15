// stockSucursal.js
// Lógica pura del desglose de stock por sucursal en el Catálogo (brief W9),
// separada para poder testearla sin Supabase ni React — mismo patrón que
// src/lib/inventario.js.
//
// mapaSucursalCantidad es el Map interno que devuelve stockPorSucursalBatch
// para UN producto: Map<sucursal_id, cantidad_base>. Incluye sucursales
// virtuales (Shopify) si stock_actual tiene filas ahí — el total las suma
// (no cambia el comportamiento actual), el desglose las omite.

// Suma de todo el Map — es el mismo total que mostraba v_producto_stock,
// ahora derivado en el cliente en vez de leído de la vista.
export function sumaStockPorSucursal(mapaSucursalCantidad) {
  let total = 0;
  for (const cantidad of (mapaSucursalCantidad || new Map()).values()) {
    total += Number(cantidad) || 0;
  }
  return total;
}

// -> [{ sucursalId, nombre, cantidad }], solo sucursales físicas con
// cantidad distinta de cero. `sucursales` viene de SucursalContext — nunca
// se hardcodea un id ni un nombre acá.
export function desgloseStockPorSucursal(mapaSucursalCantidad, sucursales) {
  const mapa = mapaSucursalCantidad || new Map();
  const desglose = [];
  for (const s of sucursales || []) {
    if (s.tipo === "virtual") continue;
    const cantidad = Number(mapa.get(s.id)) || 0;
    if (cantidad === 0) continue;
    desglose.push({ sucursalId: s.id, nombre: s.nombre, cantidad });
  }
  return desglose;
}

// Línea "Almacén 1.170 · Tienda 75" — null con 0 o 1 sucursal (el total ya
// lo dice, no hay nada que desglosar). formatearCantidad es inyectable para
// no atar esta función pura al formato de número de la pantalla.
export function textoDesgloseSucursal(desglose, formatearCantidad = String) {
  if (!desglose || desglose.length < 2) return null;
  return desglose.map((d) => `${d.nombre} ${formatearCantidad(d.cantidad)}`).join(" · ");
}
