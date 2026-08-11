// lib/faltantes.js — lógica pura sobre v_faltante_producto (brief W6),
// separada para poder testearla sin Supabase ni React — mismo patrón que
// src/lib/control.js y src/lib/despacho.js.
//
// v_faltante_producto ya reparte el stock físico en FIFO con las líneas de
// reserva primero (ver v_pedido_linea_reserva): eso garantiza que, del
// faltante total de un producto, la porción que le corresponde a clientes es
// siempre la que excede el stock físico, y la de reposición es el resto.
// No hay que tocar la base para partir el número — se deriva acá.

// -> { faltanteClientes, faltanteReposicion }
export function partirFaltante(fila) {
  const stock = Number(fila.stock_fisico) || 0;
  const clientes = Number(fila.comprometido_clientes) || 0;
  const reposicion = Number(fila.comprometido_reposicion) || 0;
  const faltanteClientes = Math.max(clientes - stock, 0);
  const restanteParaReposicion = Math.max(stock - clientes, 0);
  const faltanteReposicion = Math.max(reposicion - restanteParaReposicion, 0);
  return { faltanteClientes, faltanteReposicion };
}

// Ordena por faltante de clientes descendente — es la lista de compras real
// (brief W6). Empate: faltante total descendente, luego nombre.
export function ordenarFaltantes(filas) {
  return [...(filas || [])]
    .map((f) => ({ ...f, ...partirFaltante(f) }))
    .sort((a, b) => {
      if (b.faltanteClientes !== a.faltanteClientes) return b.faltanteClientes - a.faltanteClientes;
      if (Number(b.faltante) !== Number(a.faltante)) return Number(b.faltante) - Number(a.faltante);
      return (a.producto_nombre || "").localeCompare(b.producto_nombre || "");
    });
}
