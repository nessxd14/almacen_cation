/**
 * lib/operaciones.js — Motor compartido de operaciones de Kardex.
 *
 * Extraído de OperacionesApp para que Fase B (catálogo como surface de venta)
 * y Fase C (despacho de pedidos) lo reusen sin recablear el Kardex.
 *
 * Firmas RPC confirmadas:
 *   registrar_entrada(p_presentacion_id, p_ubicacion_id, p_cantidad_pres,
 *                     p_referencia, p_usuario?, p_fecha?, p_costo_unitario?, p_idempotencia?)
 *   registrar_salida(p_presentacion_id, p_ubicacion_id, p_cantidad_pres,
 *                    p_referencia, p_usuario?, p_fecha?, p_idempotencia?, p_permitir_sobregiro?)
 *   registrar_ajuste(p_producto_id, p_ubicacion_id, p_cantidad_base_objetivo,
 *                    p_motivo, p_referencia?, p_usuario?, p_fecha?)
 *   registrar_traslado(p_presentacion_id, p_ubicacion_origen, p_ubicacion_destino,
 *                      p_cantidad_pres, p_referencia?, p_usuario?, p_fecha?)
 */

import { supabase } from "../supabaseClient";

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);

const hoy = () => new Date().toISOString().slice(0, 10);

export const labelUbicacion = (u) =>
  u ? [u.codigo_zona, u.estante, u.nivel, u.compartimiento].filter(Boolean).join("-") : "—";

/* ── búsqueda typeahead de producto (nombre / sku) ────────────────────── */
export async function buscarProductos(q) {
  const texto = (q || "").trim();
  if (!texto) return [];
  const { data } = await supabase
    .from("producto")
    .select("id, nombre, sku_interno, unidad_base")
    .or(`nombre.ilike.%${texto}%,sku_interno.ilike.%${texto}%`)
    .eq("activo", true)
    .order("nombre")
    .limit(20);
  return data || [];
}

/* ── ubicaciones según el modo de operación ───────────────────────────
 * modo: "ENTRADA" | "SALIDA" | "AJUSTE" | "TRASLADO_ORIGEN" | "TRASLADO_DESTINO"
 * -> { ubicaciones: [{id, label, cantidad_base?, es_principal?}], sinAsignacion }
 */
export async function ubicacionesParaOperacion({ productoId, modo }) {
  if (!productoId) return { ubicaciones: [], sinAsignacion: false };
  const pid = Number(productoId);

  if (modo === "SALIDA" || modo === "TRASLADO_ORIGEN") {
    const { data } = await supabase
      .from("stock_actual")
      .select("cantidad_base, ubicacion:ubicacion_id(id, codigo_zona, estante, nivel, compartimiento)")
      .eq("producto_id", pid)
      .gt("cantidad_base", 0)
      .order("cantidad_base", { ascending: false });
    const ubicaciones = (data || [])
      .filter((r) => r.ubicacion)
      .map((r) => ({ id: r.ubicacion.id, label: labelUbicacion(r.ubicacion), cantidad_base: r.cantidad_base }));
    return { ubicaciones, sinAsignacion: false };
  }

  if (modo === "ENTRADA" || modo === "TRASLADO_DESTINO") {
    const { data } = await supabase
      .from("producto_ubicacion")
      .select("es_principal, ubicacion:ubicacion_id(id, codigo_zona, estante, nivel, compartimiento)")
      .eq("producto_id", pid)
      .order("es_principal", { ascending: false });
    const asignadas = (data || []).filter((r) => r.ubicacion);

    if (asignadas.length === 0) {
      const { data: todas } = await supabase
        .from("ubicacion")
        .select("id, codigo_zona, estante, nivel, compartimiento")
        .order("codigo_zona").order("estante").order("nivel").order("compartimiento");
      return {
        ubicaciones: (todas || []).map((u) => ({ id: u.id, label: labelUbicacion(u) })),
        sinAsignacion: true,
      };
    }
    return {
      ubicaciones: asignadas.map((r) => ({ id: r.ubicacion.id, label: labelUbicacion(r.ubicacion), es_principal: r.es_principal })),
      sinAsignacion: false,
    };
  }

  if (modo === "AJUSTE") {
    const [{ data: asigData }, { data: stockData }] = await Promise.all([
      supabase.from("producto_ubicacion")
        .select("es_principal, ubicacion:ubicacion_id(id, codigo_zona, estante, nivel, compartimiento)")
        .eq("producto_id", pid)
        .order("es_principal", { ascending: false }),
      supabase.from("stock_actual")
        .select("cantidad_base, ubicacion:ubicacion_id(id, codigo_zona, estante, nivel, compartimiento)")
        .eq("producto_id", pid)
        .gt("cantidad_base", 0)
        .order("cantidad_base", { ascending: false }),
    ]);

    const mapa = new Map();
    for (const r of asigData || []) {
      if (!r.ubicacion) continue;
      mapa.set(r.ubicacion.id, { id: r.ubicacion.id, label: labelUbicacion(r.ubicacion), es_principal: r.es_principal });
    }
    for (const r of stockData || []) {
      if (!r.ubicacion) continue;
      const existente = mapa.get(r.ubicacion.id);
      if (existente) existente.cantidad_base = r.cantidad_base;
      else mapa.set(r.ubicacion.id, { id: r.ubicacion.id, label: labelUbicacion(r.ubicacion), cantidad_base: r.cantidad_base });
    }
    const ubicaciones = [...mapa.values()].sort((a, b) => (b.es_principal ? 1 : 0) - (a.es_principal ? 1 : 0));
    return { ubicaciones, sinAsignacion: false };
  }

  return { ubicaciones: [], sinAsignacion: false };
}

/* ── stock actual de un producto en una ubicación (unidades base) ────── */
export async function stockEn({ productoId, ubicacionId }) {
  if (!productoId || !ubicacionId) return null;
  const { data } = await supabase
    .from("stock_actual")
    .select("cantidad_base")
    .eq("producto_id", Number(productoId))
    .eq("ubicacion_id", Number(ubicacionId))
    .maybeSingle();
  return data?.cantidad_base ?? 0;
}

/* ── ejecutar la operación: switch único hacia el RPC correcto ────────
 * -> { id, error }
 */
export async function ejecutarOperacion({
  modo, productoId, presentacionId, ubicacionId, ubicacionDestinoId,
  cantidad, cantidadObjetivo, motivo, referencia, usuario = "operario", permitirSobregiro,
}) {
  const fecha = hoy();
  let resultado;

  if (modo === "ENTRADA") {
    resultado = await supabase.rpc("registrar_entrada", {
      p_presentacion_id: Number(presentacionId),
      p_ubicacion_id: Number(ubicacionId),
      p_cantidad_pres: Number(cantidad),
      p_referencia: referencia || "Sin referencia",
      p_usuario: usuario,
      p_fecha: fecha,
      p_idempotencia: uuid(),
    });
  } else if (modo === "SALIDA") {
    resultado = await supabase.rpc("registrar_salida", {
      p_presentacion_id: Number(presentacionId),
      p_ubicacion_id: Number(ubicacionId),
      p_cantidad_pres: Number(cantidad),
      p_referencia: referencia || "Sin referencia",
      p_usuario: usuario,
      p_fecha: fecha,
      p_idempotencia: uuid(),
      p_permitir_sobregiro: !!permitirSobregiro,
    });
  } else if (modo === "TRASLADO") {
    resultado = await supabase.rpc("registrar_traslado", {
      p_presentacion_id: Number(presentacionId),
      p_ubicacion_origen: Number(ubicacionId),
      p_ubicacion_destino: Number(ubicacionDestinoId),
      p_cantidad_pres: Number(cantidad),
      p_referencia: referencia || "Sin referencia",
      p_usuario: usuario,
      p_fecha: fecha,
    });
  } else if (modo === "AJUSTE") {
    resultado = await supabase.rpc("registrar_ajuste", {
      p_producto_id: Number(productoId),
      p_ubicacion_id: Number(ubicacionId),
      p_cantidad_base_objetivo: Number(cantidadObjetivo),
      p_motivo: motivo || "Ajuste manual",
      p_referencia: referencia || null,
      p_usuario: usuario,
      p_fecha: fecha,
    });
  } else {
    return { id: null, error: new Error(`Modo desconocido: ${modo}`) };
  }

  return { id: resultado.data, error: resultado.error };
}

/* ── asegura la asignación producto-ubicación (idempotente) ───────────
 * es_principal = true si es la primera ubicación asignada al producto.
 */
export async function asegurarAsignacion(productoId, ubicacionId) {
  const pid = Number(productoId);
  const uid = Number(ubicacionId);

  const { data: existente } = await supabase
    .from("producto_ubicacion")
    .select("id")
    .eq("producto_id", pid)
    .eq("ubicacion_id", uid)
    .maybeSingle();
  if (existente) return;

  const { count } = await supabase
    .from("producto_ubicacion")
    .select("id", { count: "exact", head: true })
    .eq("producto_id", pid);

  await supabase.from("producto_ubicacion").insert({
    producto_id: pid,
    ubicacion_id: uid,
    es_principal: (count || 0) === 0,
  });
}
