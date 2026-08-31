/**
 * tablero.js — capa de datos del Tablero de almacén (TV, estilo KDS).
 * Ver TableroAlmacenApp.jsx. La clasificación en columnas es pura
 * (testeable sin Supabase) — no reinventa el criterio de "resuelta": la
 * vista v_tablero_almacen_pedidos ya trae lineas_total/lineas_resueltas
 * calculados igual que recalcular_estado_pedido() en la base.
 */
import { supabase } from "../supabaseClient";

export async function fetchTablero() {
  const { data, error } = await supabase
    .from("v_tablero_almacen_pedidos")
    .select("*")
    .order("creado_en", { ascending: true });
  if (error) throw error;
  return data;
}

export function clasificar(pedidos) {
  const columnas = { pendiente: [], preparacion: [], listo: [] };
  for (const p of pedidos || []) {
    if (p.estado === "COMPLETADO") columnas.listo.push(p);
    else if (p.lineas_resueltas === 0) columnas.pendiente.push(p);
    else columnas.preparacion.push(p);
  }
  return columnas;
}

// Pantalla de bajo volumen de pedidos simultáneos — cualquier cambio en
// pedido/pedido_linea/pedido_despacho_evento simplemente vuelve a pedir el
// tablero completo, no vale la pena mergear eventos parciales a mano.
export function suscribirTablero(onChange) {
  const channel = supabase
    .channel("tablero-almacen")
    .on("postgres_changes", { event: "*", schema: "public", table: "pedido" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "pedido_linea" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "pedido_despacho_evento" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
