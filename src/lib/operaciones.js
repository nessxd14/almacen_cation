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
 *
 * Fase C — despacho de pedidos (RPC definidas en
 * db/migrations/2026-07-05_pedidos.sql, validadas contra la base viva):
 *   crear_pedido(p_categoria, p_referencia, p_lineas jsonb, p_usuario?) -> bigint
 *   despachar_linea(p_linea_id, p_asignaciones jsonb, p_usuario?) -> jsonb
 *   revertir_evento(p_evento_id, p_cantidad_base?, p_usuario?) -> jsonb
 *   comprar_directo(p_linea_id, p_nota, p_costo?, p_usuario?) -> jsonb
 */

import { supabase } from "../supabaseClient";
import { sanearFiltro } from "./filtroTexto";
import { stockDespachable } from "./stockSucursal";
import { etiquetaUbicacion } from "./ubicacionTexto";

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);

const hoy = () => new Date().toISOString().slice(0, 10);

// nombreSucursal (opcional): resolver de SucursalContext — antepone
// "Tienda · " / "Almacén Central · " cuando el contexto no deja clara la
// sucursal (brief W5 #5). Sin él, comportamiento idéntico a siempre.
export const labelUbicacion = (u, { nombreSucursal } = {}) => {
  if (!u) return "—";
  const base = etiquetaUbicacion(u);
  if (typeof nombreSucursal !== "function" || u.sucursal_id == null) return base;
  const nombre = nombreSucursal(u.sucursal_id);
  return nombre ? `${nombre} · ${base}` : base;
};

/* ── búsqueda typeahead de producto (nombre / sku) ────────────────────── */
export async function buscarProductos(q) {
  const texto = sanearFiltro(q);
  if (!texto) return [];
  const { data, error } = await supabase
    .from("producto")
    .select("id, nombre, sku_interno, unidad_base")
    .or(`nombre.ilike.%${texto}%,sku_interno.ilike.%${texto}%`)
    .eq("activo", true)
    .order("nombre")
    .limit(20);
  if (error) { console.error("buscarProductos falló:", error); return []; }
  return data || [];
}

/* ── búsqueda agrupada por familia (typeahead de familias/variantes) ──
 * Motor compartido para Catálogo/Inventario/Operaciones (briefs siguientes).
 * No reemplaza a buscarProductos: esa sigue intacta para los flujos que
 * ya la usan (typeahead de producto suelto en Operaciones, etc.).
 *
 * -> [{ familia_id, familia_nombre, familia_imagen_url,
 *       variantes: [{ producto_id, nombre, sku_interno, atributos: [{atributo, valor}] }] }]
 *    familia_id es null para productos sin familia (o familias de 1 variante
 *    que no matchean por nombre de familia): esos grupos traen variantes.length === 1.
 *
 * Buscar por SKU/nombre de una variante trae el grupo completo de su familia
 * (todas las variantes activas), no solo la variante que matcheó — el
 * consumidor decide si resalta o filtra.
 */
export async function buscarAgrupado(q) {
  const texto = sanearFiltro(q);
  if (!texto) return [];

  // 1. Productos que matchean directo por nombre/SKU/marca (para saber a
  //    qué familias pertenecen y qué productos sueltos entran).
  const { data: directos, error: errDirectos } = await supabase
    .from("producto")
    .select("id, familia_id")
    .eq("activo", true)
    .or(`nombre.ilike.%${texto}%,sku_interno.ilike.%${texto}%,marca.ilike.%${texto}%`)
    .limit(200);
  if (errDirectos) console.error("buscarAgrupado (directos) falló:", errDirectos);

  // 2. Familias que matchean por su propio nombre.
  const { data: familiasMatch, error: errFamilias } = await supabase
    .from("familia")
    .select("id")
    .ilike("nombre", `%${texto}%`)
    .limit(200);
  if (errFamilias) console.error("buscarAgrupado (familias) falló:", errFamilias);

  const familiaIds = new Set();
  for (const p of directos || []) if (p.familia_id != null) familiaIds.add(p.familia_id);
  for (const f of familiasMatch || []) familiaIds.add(f.id);

  const productoIdsSueltos = (directos || [])
    .filter(p => p.familia_id == null)
    .map(p => p.id);

  if (familiaIds.size === 0 && productoIdsSueltos.length === 0) return [];

  // 3. Traer TODAS las variantes activas de las familias implicadas, más
  //    los productos sueltos (sin familia) que matchearon directo.
  const orParts = [];
  if (familiaIds.size > 0) orParts.push(`familia_id.in.(${[...familiaIds].join(",")})`);
  if (productoIdsSueltos.length > 0) orParts.push(`id.in.(${productoIdsSueltos.join(",")})`);

  const { data: variantes, error: errVariantes } = await supabase
    .from("producto")
    .select(`
      id, nombre, sku_interno, familia_id, imagen_url,
      familia:familia_id(id, nombre),
      producto_atributo(atributo_valor:atributo_valor_id(valor, atributo:atributo_id(nombre)))
    `)
    .eq("activo", true)
    .or(orParts.join(","))
    .limit(200);
  if (errVariantes) console.error("buscarAgrupado (variantes) falló:", errVariantes);

  // Agrupar en JS por familia_id (o por producto_id si no tiene familia).
  const grupos = new Map();
  for (const p of variantes || []) {
    const atributos = (p.producto_atributo || [])
      .filter(pa => pa.atributo_valor)
      .map(pa => ({ atributo: pa.atributo_valor.atributo?.nombre, valor: pa.atributo_valor.valor }));

    const key = p.familia_id ?? `p:${p.id}`;
    if (!grupos.has(key)) {
      grupos.set(key, {
        familia_id: p.familia_id ?? null,
        familia_nombre: p.familia?.nombre ?? p.nombre,
        familia_imagen_url: null,
        variantes: [],
      });
    }
    const grupo = grupos.get(key);
    if (!grupo.familia_imagen_url && p.imagen_url) grupo.familia_imagen_url = p.imagen_url;
    grupo.variantes.push({
      producto_id: p.id,
      nombre: p.nombre,
      sku_interno: p.sku_interno,
      atributos,
    });
  }

  const lista = [...grupos.values()];
  lista.sort((a, b) => a.familia_nombre.localeCompare(b.familia_nombre));
  for (const g of lista) g.variantes.sort((a, b) => a.nombre.localeCompare(b.nombre));
  return lista;
}

/* ── ubicaciones según el modo de operación ───────────────────────────
 * modo: "ENTRADA" | "SALIDA" | "AJUSTE" | "TRASLADO_ORIGEN" | "TRASLADO_DESTINO"
 * nombreSucursal (opcional, de SucursalContext): antepone la sucursal al
 * label cuando corresponde — sobre todo TRASLADO_*, que por definición
 * cruza sucursales y es donde "PISO" a secas generó confusión real
 * (brief W5 #5).
 * -> { ubicaciones: [{id, label, cantidad_base?, es_principal?}], sinAsignacion }
 */
export async function ubicacionesParaOperacion({ productoId, modo, sucursalPreferidaId, nombreSucursal }) {
  if (!productoId) return { ubicaciones: [], sinAsignacion: false };
  const pid = Number(productoId);

  if (modo === "SALIDA" || modo === "TRASLADO_ORIGEN") {
    const { data } = await supabase
      .from("stock_actual")
      .select("cantidad_base, ubicacion:ubicacion_id(id, codigo_zona, estante, nivel, compartimiento, sucursal_id)")
      .eq("producto_id", pid)
      .gt("cantidad_base", 0)
      .order("cantidad_base", { ascending: false });
    let ubicaciones = (data || [])
      .filter((r) => r.ubicacion)
      .map((r) => ({ id: r.ubicacion.id, label: labelUbicacion(r.ubicacion, { nombreSucursal }), cantidad_base: r.cantidad_base, sucursal_id: r.ubicacion.sucursal_id }));
    if (sucursalPreferidaId != null) {
      const pref = Number(sucursalPreferidaId);
      ubicaciones = [...ubicaciones].sort((a, b) => (b.sucursal_id === pref) - (a.sucursal_id === pref));
    }
    return { ubicaciones, sinAsignacion: false };
  }

  if (modo === "ENTRADA" || modo === "TRASLADO_DESTINO") {
    const { data } = await supabase
      .from("producto_ubicacion")
      .select("es_principal, ubicacion:ubicacion_id(id, codigo_zona, estante, nivel, compartimiento, sucursal_id)")
      .eq("producto_id", pid)
      .order("es_principal", { ascending: false });
    const asignadas = (data || []).filter((r) => r.ubicacion);

    if (asignadas.length === 0) {
      const { data: todas } = await supabase
        .from("ubicacion")
        .select("id, codigo_zona, estante, nivel, compartimiento, sucursal_id")
        .order("codigo_zona").order("estante").order("nivel").order("compartimiento");
      return {
        ubicaciones: (todas || []).map((u) => ({ id: u.id, label: labelUbicacion(u, { nombreSucursal }) })),
        sinAsignacion: true,
      };
    }
    return {
      ubicaciones: asignadas.map((r) => ({ id: r.ubicacion.id, label: labelUbicacion(r.ubicacion, { nombreSucursal }), es_principal: r.es_principal })),
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
  cantidad, cantidadObjetivo, motivo, referencia, usuario, permitirSobregiro, idempotencia,
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
      p_idempotencia: idempotencia || uuid(),
    });
  } else if (modo === "SALIDA") {
    resultado = await supabase.rpc("registrar_salida", {
      p_presentacion_id: Number(presentacionId),
      p_ubicacion_id: Number(ubicacionId),
      p_cantidad_pres: Number(cantidad),
      p_referencia: referencia || "Sin referencia",
      p_usuario: usuario,
      p_fecha: fecha,
      p_idempotencia: idempotencia || uuid(),
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
export async function asegurarAsignacion(productoId, ubicacionId, { estricto = false } = {}) {
  const pid = Number(productoId);
  const uid = Number(ubicacionId);

  const { data: existente, error: errorExistente } = await supabase
    .from("producto_ubicacion")
    .select("id")
    .eq("producto_id", pid)
    .eq("ubicacion_id", uid)
    .maybeSingle();
  if (estricto && errorExistente) throw errorExistente;
  if (existente) return;

  const { count, error: errorConteo } = await supabase
    .from("producto_ubicacion")
    .select("id", { count: "exact", head: true })
    .eq("producto_id", pid);
  if (estricto && errorConteo) throw errorConteo;

  const { error: errorAsignacion } = await supabase.from("producto_ubicacion").insert({
    producto_id: pid,
    ubicacion_id: uid,
    es_principal: (count || 0) === 0,
  });
  if (estricto && errorAsignacion) throw errorAsignacion;
}

/* ══════════════════════════════════════════════════════════════════════
 * Fase C — Despacho de pedidos
 * ══════════════════════════════════════════════════════════════════════ */

/* ── pick automático: mayor stock primero, greedy hasta cubrir cantidadBase
 * -> { asignaciones: [{ubicacion_id, cantidad_base}], faltante }
 * faltante > 0 => la línea quedará parcialmente pendiente.
 */
export async function calcularPick({ productoId, cantidadBase, sucursalPreferidaId }) {
  const { ubicaciones } = await ubicacionesParaOperacion({ productoId, modo: "SALIDA", sucursalPreferidaId });
  let restante = Number(cantidadBase);
  const asignaciones = [];

  for (const u of ubicaciones) {
    if (restante <= 0) break;
    const disponible = Number(u.cantidad_base) || 0;
    const tomar = Math.min(restante, disponible);
    if (tomar <= 0) continue;
    asignaciones.push({ ubicacion_id: u.id, cantidad_base: tomar });
    restante -= tomar;
  }

  return { asignaciones, faltante: Math.max(restante, 0) };
}

/* ── desglose de presentaciones (display-only, para el picking) ───────
 * Arma "1 caja ×12 + 3 sueltas": llena greedy desde el factor más grande
 * (cajas, packs) hasta el más chico (unidad base). No ejecuta nada, es
 * solo informativo — la SALIDA real siempre se registra en la
 * presentación base (ver despacharLinea).
 *
 * armarDesglose es la parte pura, extraída para poder precalcular varias
 * líneas de pedido de una sola consulta batch de `presentacion` (ver
 * ReporteImpresionPedido en PedidosApp.jsx, brief W5 #4) en vez de una
 * consulta por línea.
 */
export function armarDesglose(presentaciones, cantidadBase) {
  let restante = Number(cantidadBase);
  const desglose = [];

  for (const p of presentaciones) {
    const factor = Number(p.factor_unidad_base);
    if (factor <= 0) continue;
    const cantidad = Math.floor(restante / factor);
    if (cantidad > 0) {
      desglose.push({ presentacion_id: p.id, nombre: p.nombre, cantidad, factor_unidad_base: factor });
      restante -= cantidad * factor;
    }
  }

  return { desglose, restante };
}

// ubicacionId se acepta por paridad con el brief pero no afecta el
// cálculo hoy (las presentaciones no varían por ubicación).
export async function desglosePresentaciones({ productoId, ubicacionId, cantidadBase }) {
  void ubicacionId;
  const { data } = await supabase
    .from("presentacion")
    .select("id, nombre, factor_unidad_base, es_base")
    .eq("producto_id", Number(productoId))
    .eq("activo", true)
    .order("factor_unidad_base", { ascending: false });
  return armarDesglose(data || [], cantidadBase);
}

/* ── crear un pedido con sus líneas (en unidad base) ─────────────────── */
export async function crearPedido({ categoria, referencia, lineas, usuario }) {
  const { data, error } = await supabase.rpc("crear_pedido", {
    p_categoria: categoria,
    p_referencia: referencia || null,
    p_lineas: lineas,
    p_usuario: usuario,
  });
  return { id: data, error };
}

/* ── despachar una línea: ejecuta el pick (auto o editado) ───────────
 * asignaciones: [{ubicacion_id, cantidad_base}]
 * -> { resultado: {linea_id, evento_id, estado, cantidad_despachada,
 *                  pendiente, kardex_ids, reversible_hasta}, error }
 */
export async function despacharLinea({ lineaId, asignaciones, usuario }) {
  const { data, error } = await supabase.rpc("despachar_linea", {
    p_linea_id: Number(lineaId),
    p_asignaciones: asignaciones,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── despachar por encima del turno (brief W8): motivo obligatorio, deja
 * rastro en despacho_sobre_reserva por la porción que excede el turno FIFO.
 */
export async function despacharLineaForzado({ lineaId, asignaciones, motivo, usuario }) {
  const { data, error } = await supabase.rpc("despachar_linea_forzado", {
    p_linea_id: Number(lineaId),
    p_asignaciones: asignaciones,
    p_motivo: motivo,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── info de turno FIFO de una línea (brief W8) -> {cubierto, pendiente, turno} | null */
export async function turnoLinea(lineaId) {
  const { data, error } = await supabase
    .from("v_pedido_linea_reserva")
    .select("cubierto, pendiente, turno")
    .eq("linea_id", Number(lineaId))
    .maybeSingle();
  if (error || !data) return null;
  return { cubierto: Number(data.cubierto), pendiente: Number(data.pendiente), turno: data.turno };
}

/* ── despachar varias líneas en una sola llamada (brief W5) — colapsa las
 * N recargas de pedido que generaba despachar de a una en pedidos grandes
 * (cientos de peticiones, y si el token vence en medio de la ráfaga, la
 * renovación choca con el rate limit de Supabase y expulsa a la persona).
 * Reusa despachar_linea internamente del lado de la base y es atómica: si
 * una línea falla, ninguna queda despachada.
 * lineas: [{linea_id, asignaciones:[{ubicacion_id, cantidad_base}]}]
 * -> { resultado: {despachadas, resultados: [...]}, error }
 */
export async function despacharLineas({ lineas, usuario }) {
  const { data, error } = await supabase.rpc("despachar_lineas", {
    p_lineas: lineas,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── revertir un evento de despacho (total o parcial, solo Tienda) ───── */
export async function revertirEvento({ eventoId, cantidadBase = null, usuario }) {
  const { data, error } = await supabase.rpc("revertir_evento", {
    p_evento_id: Number(eventoId),
    p_cantidad_base: cantidadBase != null ? Number(cantidadBase) : null,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── comprar directo: cierra la línea sin tocar Kardex ────────────────── */
export async function comprarDirecto({ lineaId, nota, costo = null, usuario }) {
  const { data, error } = await supabase.rpc("comprar_directo", {
    p_linea_id: Number(lineaId),
    p_nota: nota,
    p_costo: costo != null ? Number(costo) : null,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── clasifica saldo_libre vs lo pendiente de una línea -> 'verde'|'ambar'|'rojo' */
export function estadoSaldoLinea(saldoLibre, pendienteLinea) {
  const saldo = Number(saldoLibre) || 0;
  const pendiente = Number(pendienteLinea) || 0;
  if (saldo >= pendiente) return 'verde';
  if (saldo > 0) return 'ambar';
  return 'rojo';
}

/* ══════════════════════════════════════════════════════════════════════
 * Brief W-B — Rechazar, Cambiar, Restar (piezas 2/3/4a/4b)
 * Todas exigen rol distinto de cajero — el backend responde con "Un cajero
 * no puede…" si no corresponde; el frontend no replica esa regla, solo
 * muestra el mensaje si el backend lo rechaza.
 * ══════════════════════════════════════════════════════════════════════ */

/* ── rechazar una línea puntual (POR_DESPACHAR/PENDIENTE -> RECHAZADO) ── */
export async function rechazarPedidoLinea({ lineaId, motivo }) {
  const { data, error } = await supabase.rpc("rechazar_linea_pedido_auditada", {
    p_pedido_linea_id: Number(lineaId),
    p_motivo: motivo || null,
  });
  return { resultado: data, error: error?.code === "PGRST202"
    ? { ...error, message: "El rechazo con historial aún no está habilitado. Solicita la actualización del sistema." } : error };
}

/* ── rechazar TODAS las líneas pendientes de un pedido de una sola vez ── */
export async function rechazarPedido({ pedidoId, motivo }) {
  const { data, error } = await supabase.rpc("rechazar_pedido_auditado", {
    p_pedido_id: Number(pedidoId),
    p_motivo: motivo || null,
  });
  return { resultado: data, error: error?.code === "PGRST202"
    ? { ...error, message: "El rechazo con historial aún no está habilitado. Solicita la actualización del sistema." } : error };
}

/* ── cerrar la tanda actual: deja en el pedido solo lo que se despachó de
 * verdad y manda el faltante (líneas PENDIENTE/POR_DESPACHAR) a un pedido
 * nuevo — la próxima tanda, que entra a la bandeja de Almacén como
 * cualquier otro pedido -> { pedido_original_id, pedido_nuevo_id,
 * numero_tanda, lineas_movidas, total_movido }
 */
export async function cerrarTandaPedido({ pedidoId, motivo, usuario }) {
  const { data, error } = await supabase.rpc("cerrar_tanda_pedido", {
    p_pedido_id: Number(pedidoId),
    p_motivo: motivo || null,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

// Registra el escaneo de un ticket en modo despacho rápido (VentaDirectaApp)
// vía la RPC despacho_rapido_venta_directa: si la venta sigue ABIERTA (Almacén
// llega primero), la completa ella misma en la misma transacción — sin
// carrera posible con un "Completar" simultáneo de Caja — y descuenta
// Kardex; si ya estaba COMPLETADA (Caja llegó primero), solo registra el
// escaneo. Escanear dos veces el mismo ticket no es un error del usuario —
// es informativo — así que ese caso puntual del server ("ya fue
// descargada") se traduce a { yaDescargado: true } en vez de propagar el error.
export async function registrarDespachoRapido({ ventaId, usuario }) {
  const { data, error } = await supabase.rpc("despacho_rapido_venta_directa", {
    p_venta_id: Number(ventaId),
    p_usuario: usuario,
  });
  if (error) {
    const yaDescargado = error.message?.includes("ya fue descargada");
    return { yaDescargado, error: yaDescargado ? null : error };
  }
  return { yaDescargado: false, disparoCompletado: data?.disparo_completado, error: null };
}

// Venta Directa vive fija en la ubicación "VENTAS DIRECTAS" de Almacén
// Central — filtrar acá por sucursal_id de esa ubicación no representa la
// sucursal donde se vendió (eso vive en sesion_caja, no en venta) y este
// panel de todos modos solo se usa desde Almacén, así que no aporta nada:
// sin filtro de sucursal.
export async function historialDespachoRapido({ desde, hasta, creadoPor }) {
  let query = supabase
    .from("venta_despacho_rapido")
    .select(`
      id, venta_id, escaneado_por, escaneado_en,
      venta:venta_id!inner ( numero, creado_por, cliente:cliente_id ( nombre ) )
    `)
    .order("escaneado_en", { ascending: false })
    .limit(200);
  if (desde) query = query.gte("escaneado_en", desde);
  if (hasta) query = query.lte("escaneado_en", hasta);
  if (creadoPor) query = query.eq("venta.creado_por", creadoPor);

  const { data, error } = await query;
  return { data: data || [], error };
}

/* ── completar una venta directa (VTD): descuenta Kardex, NO toca caja/pagos
 * (confirmado leyendo completar_venta en la base — el cobro ya quedó resuelto
 * al abrir la venta en Seller). No soporta entrega parcial: descuenta cada
 * línea completa tal cual está — el llamador debe garantizar que todo lo que
 * hay en la venta se entregó de verdad antes de invocar esto.
 * -> { resultado, error }
 */
export async function completarVentaDirecta({ ventaId, usuario }) {
  const { data, error } = await supabase.rpc("completar_venta", {
    p_venta_id: Number(ventaId),
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── ajustar/rechazar líneas de una venta directa ABIERTA desde Almacén.
 * Reusa la misma RPC que Caja (ajustar_venta_abierta) — solo permite
 * reducir cantidad_presentacion, nunca subirla; cantidad 0 borra la línea
 * (queda registrada como LINEA_RECHAZADA en venta_evento), una reducción
 * parcial queda LINEA_CAMBIADA. Motivo obligatorio (lo exige el server).
 * p_sesion_caja_id siempre null: Venta Directa es postcobrada en la
 * práctica, así que nunca hay devolución que requiera abrir caja desde acá;
 * si alguna vez la hay, el server la rechaza pidiendo la sesión y ese
 * caso se resuelve desde Caja, no desde Almacén.
 * ajustes: [{ lineaId, cantidadPresentacion }] -> { resultado, error }
 */
export async function ajustarVentaDirecta({ ventaId, ajustes, motivo, usuario }) {
  const { data, error } = await supabase.rpc("ajustar_venta_abierta", {
    p_venta_id: Number(ventaId),
    p_ajustes: ajustes.map((a) => ({
      linea_id: Number(a.lineaId),
      cantidad_presentacion: Number(a.cantidadPresentacion),
    })),
    p_sesion_caja_id: null,
    p_usuario: usuario,
    p_motivo: motivo,
  });
  return { resultado: data, error };
}

/* ── cambiar una línea por otro producto (o por un ítem personalizado
 * nuevo, si productoId es null y descripcion trae texto): la vieja queda
 * CAMBIADA, se crea una línea nueva POR_DESPACHAR (catálogo) o ESPECIAL
 * (personalizado) -> { pedido_id, linea_vieja_id, linea_nueva_id }
 */
export async function cambiarPedidoLinea({ lineaId, productoId, cantidadBase, precioUnitario, motivo, usuario, descripcion }) {
  const { data, error } = await supabase.rpc("cambiar_pedido_linea", {
    p_pedido_linea_id: Number(lineaId),
    p_producto_id: productoId != null ? Number(productoId) : null,
    p_cantidad_base: Number(cantidadBase),
    p_precio_unitario: precioUnitario != null && precioUnitario !== "" ? Number(precioUnitario) : null,
    p_motivo: motivo || null,
    p_usuario: usuario,
    p_descripcion: descripcion || null,
  });
  return { resultado: data, error };
}

/* ── quitar una línea del pedido sin reemplazo (POR_DESPACHAR/PENDIENTE -> RETIRADA) ── */
export async function restarPedidoLinea({ lineaId, motivo, usuario }) {
  const { data, error } = await supabase.rpc("restar_pedido_linea", {
    p_pedido_linea_id: Number(lineaId),
    p_motivo: motivo || null,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── compras (brief W-PC): una línea de catálogo pasa a POR_COMPRAR y queda
 * una compra_solicitud (SOLICITADA -> COMPRADA -> RECIBIDA, o CANCELADA).
 * cantidadBase null = todo lo pendiente. Si es una parte, el backend crea una
 * línea nueva y achica la original: recargar el pedido entero después.
 * -> { pedido_id, linea_id, linea_compra_id, solicitud_id, cantidad_base } */
export async function enviarLineaACompra({ lineaId, cantidadBase, motivo, usuario }) {
  const { data, error } = await supabase.rpc("enviar_linea_a_compra", {
    p_pedido_linea_id: Number(lineaId),
    p_cantidad_base: cantidadBase != null && cantidadBase !== "" ? Number(cantidadBase) : null,
    p_motivo: motivo || null,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* -> { solicitud_id, estado: "COMPRADA" } */
export async function marcarCompraComprada({ solicitudId, costoTotal, nota, usuario }) {
  const { data, error } = await supabase.rpc("marcar_compra_comprada", {
    p_solicitud_id: Number(solicitudId),
    p_costo_total: costoTotal != null && costoTotal !== "" ? Number(costoTotal) : null,
    p_nota: nota || null,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ubicacionId es obligatorio para líneas de catálogo y null para ítems a pedido
 * (si se omite para una línea de catálogo, el backend usa la ubicación de
 * recepción de la sucursal de la línea); cantidadBase null = todo lo que
 * falta recibir (se admiten recepciones parciales); costoTotal es el costo
 * de la compra entera, opcional y solo tiene efecto si la solicitud todavía
 * no tiene costo cargado (mismo manejo de número opcional que marcarCompraComprada).
 * -> { solicitud_id, estado, cantidad_recibida, linea_id, linea_estado,
 *      kardex_id, ubicacion_id } */
export async function recibirCompra({ solicitudId, ubicacionId, cantidadBase, costoTotal, usuario }) {
  const { data, error } = await supabase.rpc("recibir_compra", {
    p_solicitud_id: Number(solicitudId),
    p_ubicacion_id: ubicacionId != null && ubicacionId !== "" ? Number(ubicacionId) : null,
    p_cantidad_base: cantidadBase != null && cantidadBase !== "" ? Number(cantidadBase) : null,
    p_costo_total: costoTotal != null && costoTotal !== "" ? Number(costoTotal) : null,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* devuelve la línea de catálogo a POR_DESPACHAR; rechaza ítems a pedido.
 * -> { solicitud_id, estado: "CANCELADA", linea_id } */
export async function cancelarCompra({ solicitudId, motivo, usuario }) {
  const { data, error } = await supabase.rpc("cancelar_compra", {
    p_solicitud_id: Number(solicitudId),
    p_motivo: motivo || null,
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── devolver mercadería ya alistada al almacén (pedidos no-Tienda) —
 * motivo obligatorio (el backend lo exige, acá no se valida más que eso).
 * Mismo shape de respuesta que revertirEvento: {evento_id, linea_id,
 * monto_revertido, nuevo_estado_linea, cantidad_despachada, evento_revertido_total}
 */
export async function devolverAlistadoAAlmacen({ eventoId, motivo, usuario, cantidadBase = null }) {
  const { data, error } = await supabase.rpc("devolver_alistado_a_almacen", {
    p_evento_id: Number(eventoId),
    p_motivo: motivo,
    p_usuario: usuario,
    p_cantidad_base: cantidadBase != null ? Number(cantidadBase) : null,
  });
  return { resultado: data, error };
}

/* ── inyectar mercadería ya alistada directo a Tienda para venta de
 * mostrador (pedidos no-Tienda) — motivo obligatorio, mismo shape que arriba.
 */
export async function inyectarAlistadoATienda({ eventoId, motivo, usuario, cantidadBase = null }) {
  const { data, error } = await supabase.rpc("inyectar_alistado_a_tienda", {
    p_evento_id: Number(eventoId),
    p_motivo: motivo,
    p_usuario: usuario,
    p_cantidad_base: cantidadBase != null ? Number(cantidadBase) : null,
  });
  return { resultado: data, error };
}

/* ── inyectar el resultado conciliado de una sesión de conteo al stock
 * (registrar_ajuste por cada línea CONCILIADA) y cerrar la sesión. Admin-only
 * en el server; bloquea si quedan líneas PENDIENTE sin resolver — ese error
 * ya trae la cantidad pendiente en el mensaje, no hace falta traducirlo.
 */
export async function inyectarConciliacionSesion({ sesionId, usuario }) {
  const { data, error } = await supabase.rpc("inyectar_conciliacion_sesion", {
    p_sesion_id: Number(sesionId),
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── entregar un ítem personalizado (ESPECIAL -> DESPACHADA, desde retiro QR) ───── */
export async function entregarPersonalizado({ lineaId, usuario }) {
  const { data, error } = await supabase.rpc("entregar_personalizado", {
    p_linea_id: Number(lineaId),
    p_usuario: usuario,
  });
  return { resultado: data, error };
}

/* ── saldo disponible batch para un array de producto_id -> Map<producto_id, saldo_libre> */
export async function saldoDisponiblePedido(productoIds) {
  const ids = [...new Set((productoIds || []).filter(Boolean))].map(Number);
  if (ids.length === 0) return { mapa: new Map(), error: null };
  const { data, error } = await supabase.rpc('saldo_disponible_pedido', { p_producto_ids: ids });
  if (error) {
    console.error('saldo_disponible_pedido falló:', error);
    return { mapa: new Map(), error };
  }
  return { mapa: new Map((data || []).map((r) => [r.producto_id, Number(r.saldo_libre)])), error: null };
}

/* ── saldo vendible por sucursal (brief W7) — vendible ya neto de lo
 * reservado por otros pedidos, con el motivo (nombres de esos pedidos)
 * -> Map<producto_id, {vendible, reservado, motivo}>
 */
export async function saldoVendible(productoIds, sucursalId) {
  const ids = [...new Set((productoIds || []).filter(Boolean))].map(Number);
  if (ids.length === 0 || !sucursalId) return { mapa: new Map(), error: null };
  const { data, error } = await supabase.rpc('saldo_vendible', {
    p_producto_ids: ids, p_sucursal_id: Number(sucursalId),
  });
  if (error) {
    console.error('saldo_vendible falló:', error);
    return { mapa: new Map(), error };
  }
  return {
    mapa: new Map((data || []).map((r) => [r.producto_id, {
      vendible: Number(r.vendible), reservado: Number(r.reservado), motivo: r.motivo || null,
    }])),
    error: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * Brief F — Traslados entre sucursales
 * ══════════════════════════════════════════════════════════════════════ */

/* ── despachar (total o parcial) una solicitud de traslado ────────────
 * lineas: [{linea_id, cantidad_base}] opcional, para parcial.
 * -> { resultado: {estado, cantidad_despachada}, error }
 */
export async function despacharTraslado({ solicitudId, lineas, usuario }) {
  const { data, error } = await supabase.rpc("despachar_traslado", {
    p_solicitud_id: Number(solicitudId),
    p_usuario: usuario,
    p_lineas: lineas || null,
  });
  return { resultado: data, error };
}

/* ── confirmar recepción de un traslado EN_TRANSITO: acredita destino ya
 * pasó al despachar, esto ajusta si lo recibido es menor a lo despachado
 * (registra el faltante) y marca RECIBIDO. p_lineas es opcional — si se
 * omite, recibe todo lo despachado tal cual (v_recibida := v_despachada).
 * -> { resultado: { solicitud_id, estado, ubicacion_destino_id,
 *      lineas_con_faltante, faltantes: [{linea_id, producto_id,
 *      despachado, recibido, faltante, ubicacion_id}] }, error }
 */
export async function recibirTraslado({ solicitudId, lineas, usuario }) {
  const { data, error } = await supabase.rpc("recibir_traslado", {
    p_solicitud_id: Number(solicitudId),
    p_usuario: usuario,
    p_lineas: lineas || null,
  });
  return { resultado: data, error };
}

/* ── cerrar una solicitud de traslado (RECHAZADO/CANCELADO, sin mover stock) ── */
export async function cerrarSolicitudTraslado({ solicitudId, estado, usuario, nota }) {
  const { data, error } = await supabase.rpc("cerrar_solicitud_traslado", {
    p_solicitud_id: Number(solicitudId),
    p_estado: estado,
    p_usuario: usuario,
    p_nota: nota || null,
  });
  return { resultado: data, error };
}

/* ── desglose de stock por sucursal de UN producto (consulta acotada al
 * seleccionarlo, no bulk-preload) -> Map<sucursal_id, cantidad_base>
 */
export async function stockPorSucursalProducto(productoId) {
  if (!productoId) return new Map();
  const { data } = await supabase
    .from("stock_actual")
    .select("cantidad_base, ubicacion:ubicacion_id(sucursal_id)")
    .eq("producto_id", Number(productoId));
  const mapa = new Map();
  for (const row of data || []) {
    if (!row.ubicacion) continue;
    const sid = row.ubicacion.sucursal_id;
    mapa.set(sid, (mapa.get(sid) || 0) + Number(row.cantidad_base || 0));
  }
  return mapa;
}

/* ── stock DESPACHABLE por sucursal para un array de producto_id — mismo
 * criterio que usa despachar_traslado para chequear disponibilidad (solo
 * bins positivos en ubicaciones con excluye_disponible = false). Antes esto
 * sumaba todo, incluidas VENTAS DIRECTAS y SOBREGIRO ONLINE (grandes
 * negativos): la tarjeta mostraba "Stock: −400 — no alcanza" cuando el RPC
 * en verdad veía +200 disponibles.
 * -> Map<producto_id, cantidad_base>
 */
export async function stockDisponibleSucursal(productoIds, sucursalId) {
  const ids = [...new Set((productoIds || []).filter(Boolean))].map(Number);
  if (ids.length === 0 || !sucursalId) return new Map();
  const rows = [];
  for (let start = 0; start < ids.length; start += 100) {
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase.from('stock_actual')
        .select('producto_id, cantidad_base, ubicacion:ubicacion_id!inner(sucursal_id, excluye_disponible)')
        .in('producto_id', ids.slice(start, start + 100)).eq('ubicacion.sucursal_id', sucursalId)
        .gt('cantidad_base', 0).order('producto_id').order('ubicacion_id').range(offset, offset + 499);
      if (error) throw error;
      if (!data?.length) break;
      rows.push(...data); offset += data.length;
    }
  }
  return stockDespachable(rows, sucursalId);
}

/* ── stock por sucursal para un lote de producto_id (una página de tabla,
 * no bulk-preload del catálogo entero) -> Map<producto_id, Map<sucursal_id, cantidad_base>>
 */
export async function stockPorSucursalBatch(productoIds) {
  const ids = [...new Set((productoIds || []).filter(Boolean))].map(Number);
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("stock_actual")
    .select("producto_id, cantidad_base, ubicacion:ubicacion_id(sucursal_id, excluye_disponible)")
    .in("producto_id", ids);
  const mapa = new Map();
  for (const row of data || []) {
    if (!row.ubicacion) continue;
    if (row.ubicacion.excluye_disponible === true) continue;
    if (!mapa.has(row.producto_id)) mapa.set(row.producto_id, new Map());
    const porSucursal = mapa.get(row.producto_id);
    const sid = row.ubicacion.sucursal_id;
    porSucursal.set(sid, (porSucursal.get(sid) || 0) + Number(row.cantidad_base || 0));
  }
  return mapa;
}

/* ══════════════════════════════════════════════════════════════════════
 * Códigos de producto en gris (barra · fábrica), compartido Pedidos/Traslados
 * ══════════════════════════════════════════════════════════════════════ */

/* ── códigos activos (barra, fabrica) de la presentación base de cada
 * producto -> Map<producto_id, {barra?, fabrica?}>. La marca vive en
 * producto.marca, no acá — el consumidor la combina para el render.
 */
export async function codigosGrisPorProducto(productoIds) {
  const ids = [...new Set((productoIds || []).filter(Boolean))].map(Number);
  if (ids.length === 0) return new Map();

  const { data: pres } = await supabase
    .from("presentacion")
    .select("id, producto_id")
    .in("producto_id", ids)
    .eq("es_base", true);
  const presPorProducto = new Map((pres || []).map((p) => [p.producto_id, p.id]));
  const presIds = [...presPorProducto.values()];
  if (presIds.length === 0) return new Map();

  const { data: ident } = await supabase
    .from("identificador")
    .select("presentacion_id, tipo, valor, activo")
    .in("presentacion_id", presIds);
  const codigosPorPres = new Map();
  for (const row of ident || []) {
    if (row.activo === false) continue;
    const entry = codigosPorPres.get(row.presentacion_id) || {};
    if (row.tipo === "barra" && entry.barra == null) entry.barra = row.valor;
    if (row.tipo === "fabrica" && entry.fabrica == null) entry.fabrica = row.valor;
    codigosPorPres.set(row.presentacion_id, entry);
  }

  const mapa = new Map();
  for (const [productoId, presId] of presPorProducto) {
    mapa.set(productoId, codigosPorPres.get(presId) || {});
  }
  return mapa;
}
