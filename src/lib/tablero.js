/**
 * tablero.js — capa de datos del Tablero de almacén (TV, estilo KDS).
 * Ver TableroAlmacenApp.jsx. La clasificación en columnas es pura
 * (testeable sin Supabase) — no reinventa el criterio de "resuelta": la
 * vista v_tablero_almacen_pedidos ya trae lineas_total/lineas_resueltas
 * calculados igual que recalcular_estado_pedido() en la base.
 *
 * Venta Directa (VTD) se suma acá también, vía v_tablero_almacen_ventas_directas
 * — esa vista ya filtra a la ubicación VENTAS DIRECTAS, no hay líneas con
 * progreso individual como en pedido_linea, así que una VTD solo puede
 * clasificar en Pendiente (ABIERTA) o Listo (COMPLETADA), nunca en
 * "En preparación".
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

export async function fetchVentasDirectas() {
  const { data, error } = await supabase
    .from("v_tablero_almacen_ventas_directas")
    .select("*")
    .order("creado_en", { ascending: true });
  if (error) throw error;
  return data;
}

export function clasificar(pedidos, ventasDirectas) {
  const columnas = { pendiente: [], preparacion: [], listo: [] };
  for (const p of pedidos || []) {
    const item = { ...p, tipo: "pedido" };
    if (p.estado === "COMPLETADO") columnas.listo.push(item);
    else if (p.lineas_resueltas === 0) columnas.pendiente.push(item);
    else columnas.preparacion.push(item);
  }
  for (const v of ventasDirectas || []) {
    const item = { ...v, tipo: "vtd" };
    if (v.estado === "COMPLETADA") columnas.listo.push(item);
    else columnas.pendiente.push(item);
  }
  return columnas;
}

// Pantalla de bajo volumen de pedidos simultáneos — cualquier cambio en
// pedido/pedido_linea/pedido_despacho_evento/venta simplemente vuelve a
// pedir el tablero completo, no vale la pena mergear eventos parciales a mano.
export function suscribirTablero(onChange) {
  const channel = supabase
    .channel("tablero-almacen")
    .on("postgres_changes", { event: "*", schema: "public", table: "pedido" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "pedido_linea" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "pedido_despacho_evento" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "venta" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
