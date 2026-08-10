// control.js
// Lógica pura de surtido/control de stock (brief W3), separada para poder
// testearla sin Supabase ni React — mismo patrón que src/lib/inventario.js.
//
// Dos preguntas independientes por producto×sucursal:
//   se_vende      -> ¿esto se maneja acá?          (surtido)
//   control_stock -> ¿la cantidad de acá es confiable?  (control de stock)
// Hasta W3 ambas se contestaban con "stock > 0", por eso "no se vende acá",
// "nunca lo contamos" y "se agotó" se veían igual en pantalla.

// producto_sucursal.control_stock (ESTRICTO|LIBRE|null) pisa el default de
// la sucursal; null hereda ese default.
export function controlEfectivo(controlStockProducto, controlStockDefaultSucursal) {
  return controlStockProducto ?? controlStockDefaultSucursal;
}

// Clasifica una fila de inventario en los cuatro estados visuales del brief:
//   estricto_stock       -> ESTRICTO, cantidad > 0
//   estricto_cero        -> ESTRICTO, cantidad = 0 (agotado de verdad)
//   libre_sin_inventariar-> LIBRE, cantidad >= 0 (todavía no se contó)
//   libre_negativo        -> LIBRE, cantidad < 0 (vendido sin contar — info, no error)
export function clasificarFila(cantidad, controlEfectivoValor) {
  const n = Number(cantidad);
  if (controlEfectivoValor === "LIBRE") {
    return n < 0 ? "libre_negativo" : "libre_sin_inventariar";
  }
  return n === 0 ? "estricto_cero" : "estricto_stock";
}

// count(*) / count(*) filter (where control_stock='ESTRICTO') sobre
// producto_sucursal en surtido (se_vende=true) de la sucursal activa.
export function progresoSurtido(inventariados, totalEnSurtido) {
  const total = Number(totalEnSurtido || 0);
  const hechos = Number(inventariados || 0);
  return {
    inventariados: hechos,
    total,
    pct: total > 0 ? Math.round((hechos / total) * 100) : 0,
  };
}

// perfil.sucursal_id fija la sucursal de un encargado (Gabriel, Cristian);
// null deja elegir (Ness, Rony). Devuelve la sucursal activa a usar y si el
// selector debe mostrarse.
export function sucursalActivaSegunPerfil(perfilSucursalId, sucursalElegidaId) {
  if (perfilSucursalId != null) {
    return { sucursalActivaId: perfilSucursalId, puedeElegir: false };
  }
  return { sucursalActivaId: sucursalElegidaId, puedeElegir: true };
}
