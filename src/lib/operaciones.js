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
  const texto = (q || "").trim();
  if (!texto) return [];

  // 1. Productos que matchean directo por nombre/SKU/marca (para saber a
  //    qué familias pertenecen y qué productos sueltos entran).
  const { data: directos } = await supabase
    .from("producto")
    .select("id, familia_id")
    .eq("activo", true)
    .or(`nombre.ilike.%${texto}%,sku_interno.ilike.%${texto}%,marca.ilike.%${texto}%`)
    .limit(200);

  // 2. Familias que matchean por su propio nombre.
  const { data: familiasMatch } = await supabase
    .from("familia")
    .select("id")
    .ilike("nombre", `%${texto}%`)
    .limit(200);

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

  const { data: variantes } = await supabase
    .from("producto")
    .select(`
      id, nombre, sku_interno, familia_id, imagen_url,
      familia:familia_id(id, nombre),
      producto_atributo(atributo_valor:atributo_valor_id(valor, atributo:atributo_id(nombre)))
    `)
    .eq("activo", true)
    .or(orParts.join(","))
    .limit(200);

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
 * -> { ubicaciones: [{id, label, cantidad_base?, es_principal?}], sinAsignacion }
 */
export async function ubicacionesParaOperacion({ productoId, modo, sucursalPreferidaId }) {
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
      .map((r) => ({ id: r.ubicacion.id, label: labelUbicacion(r.ubicacion), cantidad_base: r.cantidad_base, sucursal_id: r.ubicacion.sucursal_id }));
    if (sucursalPreferidaId != null) {
      const pref = Number(sucursalPreferidaId);
      ubicaciones = [...ubicaciones].sort((a, b) => (b.sucursal_id === pref) - (a.sucursal_id === pref));
    }
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
  cantidad, cantidadObjetivo, motivo, referencia, usuario, permitirSobregiro,
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
 * ubicacionId se acepta por paridad con el brief pero no afecta el
 * cálculo hoy (las presentaciones no varían por ubicación).
 */
export async function desglosePresentaciones({ productoId, ubicacionId, cantidadBase }) {
  void ubicacionId;
  const { data } = await supabase
    .from("presentacion")
    .select("id, nombre, factor_unidad_base, es_base")
    .eq("producto_id", Number(productoId))
    .order("factor_unidad_base", { ascending: false });

  const presentaciones = data || [];
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

/* ── entregar un ítem personalizado (ESPECIAL -> COMPRADO_DIRECTO) ───── */
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
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc('saldo_disponible_pedido', { p_producto_ids: ids });
  if (error || !data) return new Map();
  return new Map(data.map((r) => [r.producto_id, Number(r.saldo_libre)]));
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

/* ── stock actual por sucursal para un array de producto_id ───────────
 * -> Map<producto_id, cantidad_base total en la sucursal>
 */
export async function stockDisponibleSucursal(productoIds, sucursalId) {
  const ids = [...new Set((productoIds || []).filter(Boolean))].map(Number);
  if (ids.length === 0 || !sucursalId) return new Map();
  const { data } = await supabase
    .from("stock_actual")
    .select("producto_id, cantidad_base, ubicacion:ubicacion_id(sucursal_id)")
    .in("producto_id", ids);
  const mapa = new Map();
  for (const row of data || []) {
    if (!row.ubicacion || row.ubicacion.sucursal_id !== Number(sucursalId)) continue;
    mapa.set(row.producto_id, (mapa.get(row.producto_id) || 0) + Number(row.cantidad_base || 0));
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
