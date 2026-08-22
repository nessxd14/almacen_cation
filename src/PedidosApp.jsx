/**
 * PedidosApp.jsx — Fase C: Despacho de pedidos con backorder.
 *
 * Modelo (ver db/migrations/2026-07-05_pedidos.sql y src/lib/operaciones.js):
 *   pedido (categoria MAYOR|TIENDA, estado ABIERTO|COMPLETADO|CANCELADO)
 *   pedido_linea (estado POR_DESPACHAR|DESPACHADA|PENDIENTE|COMPRADO_DIRECTO)
 *   pedido_despacho_evento / pedido_despacho_movimiento (puente con Kardex,
 *     reversible_hasta solo para categoria TIENDA)
 *
 * "Vender ahora" (Catálogo) crea pedidos de 1 línea sobre el mismo modelo —
 * este tab es donde se resuelven backorders, compras directas y reversiones.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import TypeaheadProducto from "./TypeaheadProducto";
import {
  ubicacionesParaOperacion, calcularPick, desglosePresentaciones, armarDesglose,
  crearPedido, despacharLinea, despacharLineaForzado, turnoLinea, despacharLineas, revertirEvento, comprarDirecto,
  entregarPersonalizado, estadoSaldoLinea, saldoDisponiblePedido, saldoVendible,
  codigosGrisPorProducto, stockPorSucursalProducto,
  rechazarPedidoLinea, rechazarPedido, cambiarPedidoLinea, restarPedidoLinea,
  devolverAlistadoAAlmacen, inyectarAlistadoATienda,
} from "./lib/operaciones";
import {
  armarPayloadDespacho, lineasConFaltante, totalUnidadesSeleccion, formatoEquivalencia,
} from "./lib/despacho";
import { avisoDisponibilidad, lineasSinCobertura } from "./lib/disponibilidad";
import { objetivoPick, haySobreTurno, MOTIVOS_DESPACHO_FORZADO, MOTIVO_OTRO, motivoValido, motivoFinal } from "./lib/reserva";
import CodigosLinea from "./CodigosLinea";
import BarraSeleccion from "./BarraSeleccion";
import { obtenerBorrador, limpiarBorrador } from "./lib/pedidoBorrador";
import { resolverAutores, nombreAutor } from "./lib/autoria";
import { useUsuarioActual } from "./lib/useAuth";
import { useSucursal } from "./lib/useSucursal";
import {
  ClipboardList, Plus, ChevronDown, ChevronUp, MapPin, Undo2,
  AlertTriangle, Loader, ArrowLeft, X, ScanLine, RefreshCw,
  ShoppingBag, Clock, Boxes, Printer, CheckSquare,
  Ban, Repeat, Trash2, Warehouse, Store,
} from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────────────── */
function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
// Texto de cantidad de una línea de pedido: si tiene presentación (elegida
// en el WMS o en el POS), muestra "3 Caja (24 und) · 72 unidad" — el mismo
// idioma que usó quien armó el pedido. Si no, cae al "72 unidad" de siempre.
function textoCantidadLinea(l) {
  const unidad = l.producto?.unidad_base || "";
  if (l.presentacion_id && l.presentacion) {
    return `${cantidadFmt(l.cantidad_presentacion)} ${l.presentacion.nombre} · ${cantidadFmt(l.cantidad_base)} ${unidad}`;
  }
  return `${cantidadFmt(l.cantidad_base)} ${unidad}`;
}
function fechaFmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
// Fecha completa para el reporte de impresión — el papel no tiene el
// límite de espacio de una card en pantalla, no hace falta abreviar.
function fechaFmtLarga(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-BO", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function mmss(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const CATEGORIAS = [
  { id: "MAYOR",  label: "Mayor" },
  { id: "TIENDA", label: "Tienda directa" },
];

// Las 4 categorías comerciales (el POS creaba MAYOR/TIENDA/INSTITUCIONAL/
// MUNICIPAL; ArmadorPedido, que solo crea pedidos de stock sin datos
// comerciales, sigue ofreciendo nada más MAYOR/TIENDA arriba). MUNICIPAL
// se retiró como valor nuevo — la clave queda solo para mostrar pedidos
// históricos que ya la tienen guardada, con la etiqueta actual "Corporativo".
const CATEGORIA_LABELS = {
  MAYOR:         "Mayoreo",
  TIENDA:        "Tienda directa",
  INSTITUCIONAL: "Institucional",
  MUNICIPAL:     "Corporativo",
};
function labelCategoria(categoria) {
  return CATEGORIA_LABELS[categoria] || categoria;
}

function fmtDinero(v) {
  if (v == null) return "—";
  return Number(v).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function BadgePedido({ estado }) {
  const estilos = {
    ABIERTO:    "bg-blue-100 text-blue-700",
    COMPLETADO: "bg-emerald-100 text-emerald-700",
    CANCELADO:  "bg-slate-100 text-slate-500",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${estilos[estado] || "bg-slate-100 text-slate-500"}`}>{estado}</span>;
}

// Compartido con el reporte de impresión (DetallePedido) — misma etiqueta,
// ahí sin el color de fondo (el papel no necesita el badge, solo el texto).
const ESTADOS_LINEA = {
  POR_DESPACHAR:    { label: "Por despachar", cls: "bg-slate-100 text-slate-600" },
  DESPACHADA:       { label: "Despachada",    cls: "bg-emerald-100 text-emerald-700" },
  PENDIENTE:        { label: "Pendiente",     cls: "bg-amber-100 text-amber-700" },
  COMPRADO_DIRECTO: { label: "Comprado directo", cls: "bg-violet-100 text-violet-700" },
  ESPECIAL:         { label: "Pendiente de entrega", cls: "bg-amber-100 text-amber-700" },
  RECHAZADO:        { label: "Rechazada",     cls: "bg-red-100 text-red-600" },
  CAMBIADA:         { label: "Cambiada",      cls: "bg-slate-200 text-slate-500" },
  RETIRADA:         { label: "Retirada",      cls: "bg-slate-200 text-slate-500" },
};
function BadgeLinea({ estado }) {
  const cfg = ESTADOS_LINEA[estado] || { label: estado, cls: "bg-slate-100 text-slate-500" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>;
}

// Indicador informativo de saldo disponible vs. lo pendiente de la línea —
// no bloquea "Despachar" ni cambia el pick automático, solo avisa si otras
// líneas (de cualquier pedido) ya comprometieron el stock libre.
const ESTILOS_SALDO = {
  verde: { cls: "bg-emerald-100 text-emerald-700", icon: "✓" },
  ambar: { cls: "bg-amber-100 text-amber-700",     icon: "!" },
  rojo:  { cls: "bg-red-100 text-red-600",         icon: "✕" },
};

function BadgeSaldoLinea({ saldoLibre, pendienteLinea }) {
  if (saldoLibre == null) return null; // aún no llegó el primer polling
  const estado = estadoSaldoLinea(saldoLibre, pendienteLinea);
  const s = ESTILOS_SALDO[estado];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.icon} Saldo {cantidadFmt(Math.max(0, saldoLibre))}
    </span>
  );
}

// Texto explicativo para ámbar/rojo — solo se muestra colapsado (expandido,
// el pick automático ya trae el detalle vía "Total asignado: X / Y pendiente").
function textoSaldoLinea(saldoLibre, pendienteLinea) {
  if (saldoLibre == null) return null;
  const estado = estadoSaldoLinea(saldoLibre, pendienteLinea);
  if (estado === "verde") return null;
  if (estado === "ambar") {
    return `Alcanza para ${cantidadFmt(saldoLibre)} de ${cantidadFmt(pendienteLinea)}.`;
  }
  // saldo_libre <= 0 == comprometido - stock_total (el RPC solo devuelve el
  // neto, no el desglose) — el valor absoluto es cuánto más allá del stock
  // físico ya está comprometido por otras líneas.
  const comprometidas = Math.abs(Number(saldoLibre) || 0);
  return `Sin stock libre (${cantidadFmt(comprometidas)} ya comprometidas en otras líneas).`;
}

/* ── Lista de pedidos ──────────────────────────────────────────────────── */
function ListaPedidos({ onNuevo }) {
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  // El filtro vive en la URL (?categoria=MAYOR), no en estado local: así el
  // botón "volver" desde /pedidos/:id (brief S3) lo recupera solo, al volver
  // a esta misma entrada del historial — no hace falta cargarlo a mano.
  const [searchParams, setSearchParams] = useSearchParams();
  const filtroCategoria = searchParams.get("categoria") || "TODAS";
  const setFiltroCategoria = (id) => {
    setSearchParams(id === "TODAS" ? {} : { categoria: id }, { replace: true });
  };

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data } = await supabase
      .from("pedido")
      .select("id, categoria, referencia, estado, creado_en, cliente:cliente_id ( nombre )")
      .order("creado_en", { ascending: false })
      .limit(200);
    setPedidos(data || []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const pedidosFiltrados = filtroCategoria === "TODAS"
    ? pedidos
    : pedidos.filter((p) => p.categoria === filtroCategoria);

  return (
    <div className="max-w-3xl mx-auto pt-4 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <ClipboardList size={20} /> Pedidos
        </h1>
        <button onClick={onNuevo}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
          <Plus size={15} /> Nuevo pedido
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setFiltroCategoria("TODAS")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${filtroCategoria === "TODAS" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          Todas
        </button>
        {Object.entries(CATEGORIA_LABELS).map(([id, label]) => (
          <button key={id} onClick={() => setFiltroCategoria(id)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filtroCategoria === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {label}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="py-16 text-center text-slate-400">Cargando pedidos…</div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <ShoppingBag size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">Sin pedidos todavía.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {pedidosFiltrados.map((p) => (
            // <a> real (vía Link) — no onClick: rueda del mouse y Ctrl+clic
            // tienen que abrir pestaña nueva (brief S3 parte A).
            <Link key={p.id} to={`/pedidos/${p.id}`}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50">
              <span className="font-mono text-xs text-slate-400">#{p.id}</span>
              <span className="text-sm font-medium text-slate-800">{labelCategoria(p.categoria)}</span>
              <span className="flex-1 truncate text-sm text-slate-500">{p.cliente?.nombre || p.referencia || "—"}</span>
              <span className="text-xs text-slate-400">{fechaFmt(p.creado_en)}</span>
              <BadgePedido estado={p.estado} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Canal de precio sugerido para cada categoría de pedido del WMS (stock,
// sin cliente) — mismas columnas que usa el POS.
const CANAL_PRECIO_POR_CATEGORIA = { MAYOR: "precio_mayoreo", TIENDA: "precio_base" };

/* ── Armador de pedido ─────────────────────────────────────────────────── */
function ArmadorPedido({ lineasIniciales, onCreado, onCancelar }) {
  const usuarioActual = useUsuarioActual();
  const { nombreSucursal, sucursales, sucursalActivaId } = useSucursal();
  const [categoria, setCategoria] = useState("");
  const [referencia, setReferencia] = useState("");
  const [lineas, setLineas] = useState(
    (lineasIniciales || []).map((l) => ({
      producto_id: l.producto_id, nombre: l.nombre, sku_interno: l.sku_interno, unidad_base: l.unidad_base,
      cantidad: String(l.cantidad_base ?? 1),
      presentaciones: [], presentacionId: null, precios: null, precioUnitario: "", precioTocado: false,
      stockPorSucursal: null, disponibilidad: null,
    }))
  );
  const [query, setQuery] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [flash, setFlash] = useState(null);
  const [creando, setCreando] = useState(false);

  // Líneas precargadas (borrador desde Catálogo) no pasan por agregarProducto
  // — se resuelven acá, una sola vez.
  useEffect(() => {
    const ids = (lineasIniciales || []).map((l) => l.producto_id);
    if (ids.length === 0) return;
    (async () => {
      const [{ data: pres }, { data: prods }] = await Promise.all([
        supabase.from("presentacion")
          .select("id, producto_id, nombre, factor_unidad_base, es_base")
          .in("producto_id", ids).eq("activo", true)
          .order("es_base", { ascending: false }),
        supabase.from("producto").select("id, precio_base, precio_mayoreo").in("id", ids),
      ]);
      const presPorProducto = new Map();
      for (const p of pres || []) {
        if (!presPorProducto.has(p.producto_id)) presPorProducto.set(p.producto_id, []);
        presPorProducto.get(p.producto_id).push(p);
      }
      const preciosPorProducto = new Map((prods || []).map((p) => [p.id, p]));
      setLineas((prev) => prev.map((l) => {
        const lista = presPorProducto.get(l.producto_id) || [];
        const base = lista.find((x) => x.es_base) || lista[0];
        return { ...l, presentaciones: lista, presentacionId: base?.id ?? null, precios: preciosPorProducto.get(l.producto_id) || null };
      }));
      // Stock por sucursal: una consulta por producto (no bulk), en paralelo.
      for (const id of ids) {
        stockPorSucursalProducto(id).then((mapa) => {
          setLineas((prev) => prev.map((l) => l.producto_id === id ? { ...l, stockPorSucursal: mapa } : l));
        });
      }
      // Disponibilidad "en el momento" (brief W7): una sola llamada batch,
      // no una por producto — a diferencia del stock por sucursal de
      // arriba, saldo_vendible sí acepta un array.
      if (sucursalActivaId) {
        saldoVendible(ids, sucursalActivaId).then((mapa) => {
          setLineas((prev) => prev.map((l) => mapa.has(l.producto_id) ? { ...l, disponibilidad: mapa.get(l.producto_id) } : l));
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showFlash = (msg, type = "error") => { setFlash({ msg, type }); setTimeout(() => setFlash(null), 3000); };

  const agregarProducto = useCallback(async (p) => {
    setLineas((prev) => {
      const existente = prev.find((l) => l.producto_id === p.id);
      if (existente) {
        return prev.map((l) => l.producto_id === p.id ? { ...l, cantidad: String(Number(l.cantidad) + 1) } : l);
      }
      return [...prev, {
        producto_id: p.id, nombre: p.nombre, sku_interno: p.sku_interno, unidad_base: p.unidad_base,
        cantidad: "1", presentaciones: [], presentacionId: null, precios: null, precioUnitario: "", precioTocado: false,
        stockPorSucursal: null, disponibilidad: null,
      }];
    });

    const [{ data: pres }, { data: prod }, stockMapa, disponibilidadMapa] = await Promise.all([
      supabase.from("presentacion")
        .select("id, nombre, factor_unidad_base, es_base")
        .eq("producto_id", p.id).eq("activo", true)
        .order("es_base", { ascending: false }),
      supabase.from("producto").select("precio_base, precio_mayoreo").eq("id", p.id).single(),
      stockPorSucursalProducto(p.id),
      sucursalActivaId ? saldoVendible([p.id], sucursalActivaId) : Promise.resolve(new Map()),
    ]);
    const lista = pres || [];
    const base = lista.find((x) => x.es_base) || lista[0];
    setLineas((prev) => prev.map((l) => l.producto_id === p.id
      ? { ...l, presentaciones: lista, presentacionId: l.presentacionId ?? (base?.id ?? null), precios: prod || null, stockPorSucursal: stockMapa, disponibilidad: disponibilidadMapa.get(p.id) || l.disponibilidad }
      : l));
  }, [sucursalActivaId]);

  const handleScan = useCallback(async (codigo) => {
    setShowScanner(false);
    const code = (codigo || "").trim();
    if (!code) return;
    const { data } = await supabase.rpc("resolver_identificador", { p_codigo: code });
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    if (rows.length === 0) { showFlash(`Código no reconocido: ${code}`); return; }
    const { data: prod } = await supabase
      .from("producto").select("id, nombre, sku_interno, unidad_base")
      .eq("id", rows[0].producto_id).single();
    if (prod) agregarProducto(prod);
  }, [agregarProducto]);

  function actualizarCantidad(productoId, valor) {
    setLineas((prev) => prev.map((l) => l.producto_id === productoId ? { ...l, cantidad: valor } : l));
  }
  function actualizarPresentacion(productoId, presentacionId) {
    setLineas((prev) => prev.map((l) => l.producto_id === productoId ? { ...l, presentacionId } : l));
  }
  function actualizarPrecio(productoId, valor) {
    setLineas((prev) => prev.map((l) => l.producto_id === productoId ? { ...l, precioUnitario: valor, precioTocado: true } : l));
  }
  function quitarLinea(productoId) {
    setLineas((prev) => prev.filter((l) => l.producto_id !== productoId));
  }

  // Precio sugerido = precio del canal × factor de la presentación elegida
  // (misma fórmula que el POS) — se recalcula cuando cambia la presentación
  // o la categoría, salvo que el usuario ya haya tocado el campo a mano.
  useEffect(() => {
    const canal = CANAL_PRECIO_POR_CATEGORIA[categoria];
    if (!canal) return;
    setLineas((prev) => prev.map((l) => {
      if (l.precioTocado || !l.precios) return l;
      const pres = l.presentaciones.find((p) => p.id === l.presentacionId);
      const factor = pres ? Number(pres.factor_unidad_base) : 1;
      const base = l.precios[canal];
      if (base == null) return l;
      return { ...l, precioUnitario: String(Math.round(Number(base) * factor * 100) / 100) };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria, lineas.map((l) => `${l.producto_id}:${l.presentacionId}`).join(",")]);

  async function crear() {
    if (!categoria) { showFlash("Selecciona la categoría del pedido"); return; }
    if (lineas.length === 0) { showFlash("Agrega al menos un producto"); return; }
    for (const l of lineas) {
      if (!l.cantidad || Number(l.cantidad) <= 0) {
        showFlash(`Cantidad inválida para ${l.nombre}`); return;
      }
      if (l.precioUnitario !== "" && l.precioUnitario != null) {
        const precio = Number(l.precioUnitario);
        if (Number.isNaN(precio) || precio < 0) {
          showFlash(`Precio inválido para ${l.nombre}`); return;
        }
      }
    }

    const lineasSinPrecio = lineas.filter((l) => {
      const precio = l.precioUnitario !== "" && l.precioUnitario != null ? Number(l.precioUnitario) : 0;
      return !precio;
    });
    if (lineasSinPrecio.length > 0) {
      const nombres = lineasSinPrecio.map((l) => l.nombre).join(", ");
      const continuar = window.confirm(
        `Estas líneas quedarían a Bs 0: ${nombres}. ¿Crear el pedido igual?`
      );
      if (!continuar) return;
    }

    // Aviso final antes de crear (brief W7 "extra"): el punto donde alguien
    // puede reconsiderar antes de que el pedido exista.
    const sinCobertura = lineasSinCobertura(lineas.map((l) => {
      const pres = l.presentaciones.find((p) => p.id === l.presentacionId);
      const factor = pres ? Number(pres.factor_unidad_base) : 1;
      return { ...l, cantidadBaseIngresada: Number(l.cantidad || 0) * factor };
    }));
    if (sinCobertura.length > 0) {
      const continuar = window.confirm(
        `${sinCobertura.length} de ${lineas.length} línea${lineas.length === 1 ? "" : "s"} no ${sinCobertura.length === 1 ? "tiene" : "tienen"} stock suficiente. ¿Crear igual?`
      );
      if (!continuar) return;
    }

    setCreando(true);
    const { id, error } = await crearPedido({
      categoria,
      referencia: referencia.trim() || null,
      lineas: lineas.map((l) => {
        const pres = l.presentaciones.find((p) => p.id === l.presentacionId);
        const linea = {
          producto_id: l.producto_id,
          ...(pres && !pres.es_base
            ? { presentacion_id: pres.id, cantidad_presentacion: Number(l.cantidad) }
            : { cantidad_base: Number(l.cantidad) }),
        };
        if (l.precioUnitario !== "" && l.precioUnitario != null) linea.precio_unitario = Number(l.precioUnitario);
        return linea;
      }),
      usuario: usuarioActual.nombre,
    });
    setCreando(false);
    if (error) { showFlash("Error: " + error.message); return; }
    onCreado(id);
  }

  return (
    <div className="max-w-2xl mx-auto pt-4 px-4 space-y-4">
      {showScanner && <EscanerCodigo onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      <div className="flex items-center gap-2">
        <button onClick={onCancelar} className="text-slate-500 hover:text-slate-700"><ArrowLeft size={18} /></button>
        <h1 className="text-lg font-semibold text-slate-800">Nuevo pedido</h1>
      </div>

      {flash && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={14} /> {flash.msg}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Categoría</label>
          <div className="flex gap-2">
            {CATEGORIAS.map((c) => (
              <button key={c.id} onClick={() => setCategoria(c.id)}
                className={`flex-1 rounded-lg border py-2 text-sm font-medium
                  ${categoria === c.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                {c.label}
              </button>
            ))}
          </div>
          {categoria === "TIENDA" && (
            <p className="mt-2 text-xs text-slate-500">
              Los pedidos de tienda no reservan stock: el mostrador puede vender estas unidades.
              Tampoco se pueden despachar unidades ya comprometidas con un cliente.
            </p>
          )}
        </div>

        <input value={referencia} onChange={(e) => setReferencia(e.target.value)}
          placeholder="Referencia (cliente, factura, etc. — opcional)"
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />

        <div className="flex gap-2">
          <TypeaheadProducto
            value={query}
            onChange={setQuery}
            onSeleccionar={agregarProducto}
            placeholder="Buscar producto por nombre, SKU o código…"
            className="flex-1"
          />
          <button onClick={() => setShowScanner(true)} className="rounded-lg bg-slate-800 px-3 py-2 text-white">
            <ScanLine size={16} />
          </button>
        </div>

        {lineas.length > 0 && (
          <div className="space-y-2">
            {lineas.map((l) => {
              const presElegida = l.presentaciones.find((p) => p.id === l.presentacionId);
              const esBulto = presElegida && !presElegida.es_base;
              const mostrarSelector = l.presentaciones.length > 1;
              const factorElegido = presElegida ? Number(presElegida.factor_unidad_base) : 1;
              const cantidadBaseEquivalente = esBulto ? Number(l.cantidad || 0) * factorElegido : null;
              const disponibleTotal = l.stockPorSucursal
                ? [...l.stockPorSucursal.values()].reduce((s, v) => s + v, 0)
                : null;
              const cantidadBaseIngresada = Number(l.cantidad || 0) * factorElegido;
              const superaDisponible = disponibleTotal != null && cantidadBaseIngresada > disponibleTotal;
              return (
                <div key={l.producto_id} className="space-y-1.5 rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p title={l.nombre} className="line-clamp-2 text-sm font-medium text-slate-800">{l.nombre}</p>
                      {l.sku_interno && <p className="text-xs text-slate-400">{l.sku_interno}</p>}
                    </div>
                    <input type="number" min="0.001" step="any" value={l.cantidad}
                      onChange={(e) => actualizarCantidad(l.producto_id, e.target.value)}
                      className="w-20 rounded-lg border px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    {mostrarSelector ? (
                      <select value={l.presentacionId ?? ""} onChange={(e) => actualizarPresentacion(l.producto_id, Number(e.target.value))}
                        className="rounded-lg border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300">
                        {l.presentaciones.map((p) => (
                          <option key={p.id} value={p.id}>{p.nombre}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-400">{l.unidad_base}</span>
                    )}
                    <button onClick={() => quitarLinea(l.producto_id)} className="text-slate-300 hover:text-red-500">
                      <X size={16} />
                    </button>
                  </div>
                  {esBulto && (
                    <p className="text-xs text-slate-400">
                      {cantidadFmt(l.cantidad)} {presElegida.nombre} = {cantidadFmt(cantidadBaseEquivalente)} {l.unidad_base}
                    </p>
                  )}
                  {l.stockPorSucursal && (
                    <p className="text-xs text-slate-400">
                      {sucursales.map((s) => `${nombreSucursal(s.id)} ${cantidadFmt(l.stockPorSucursal.get(s.id) || 0)}`).join(" · ")}
                      {" → "}{cantidadFmt(disponibleTotal)} {l.unidad_base} disponibles
                      {esBulto && ` · ${cantidadFmt(disponibleTotal / factorElegido)} ${presElegida.nombre}`}
                    </p>
                  )}
                  {superaDisponible && (
                    <p className="flex items-center gap-1 text-xs text-amber-600">
                      <AlertTriangle size={11} />
                      Pedís {cantidadFmt(cantidadBaseIngresada)} {l.unidad_base} y hay {cantidadFmt(disponibleTotal)} {l.unidad_base}
                      {" — quedarán "}{cantidadFmt(cantidadBaseIngresada - disponibleTotal)} {l.unidad_base} pendientes.
                    </p>
                  )}
                  {(() => {
                    const aviso = avisoDisponibilidad({
                      cantidadPedida: cantidadBaseIngresada,
                      vendible: l.disponibilidad?.vendible,
                      reservado: l.disponibilidad?.reservado,
                      motivo: l.disponibilidad?.motivo,
                    });
                    if (!aviso) return null;
                    return (
                      <div className="text-xs text-slate-500">
                        <p>
                          Pedís {cantidadFmt(cantidadBaseIngresada)} {l.unidad_base} · hay {cantidadFmt(aviso.vendible)} {l.unidad_base}
                          {aviso.reservado > 0 && (
                            <> · {cantidadFmt(aviso.reservado)} {l.unidad_base} reservadas para {aviso.motivo || "otros pedidos"}</>
                          )}
                        </p>
                        {aviso.noAlcanza > 0 && (
                          <p className="flex items-center gap-1 font-medium text-red-600">
                            <AlertTriangle size={11} /> {cantidadFmt(aviso.noAlcanza)} {l.unidad_base} no se van a poder despachar
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  {categoria && l.precios != null && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Precio unitario</span>
                      <input type="number" min="0" step="0.01" value={l.precioUnitario}
                        onChange={(e) => actualizarPrecio(l.producto_id, e.target.value)}
                        placeholder="Opcional"
                        className="w-24 rounded-lg border px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button onClick={crear} disabled={creando}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
          {creando && <Loader size={14} className="animate-spin" />}
          {creando ? "Creando…" : "Crear pedido"}
        </button>
      </div>
    </div>
  );
}

/* ── Modal de Cambiar línea (brief W-B, pieza 3) — reusa TypeaheadProducto
   del catálogo (mismo buscador que Armador de pedido) en vez de uno nuevo.
   La línea vieja se resuelve en el server (queda CAMBIADA) y se crea una
   línea nueva POR_DESPACHAR — recarga completa del pedido al confirmar,
   no hay forma de patchear localmente sin conocer los datos de la nueva. */
function ModalCambiarLinea({ linea, onClose, onCambiado }) {
  const usuarioActual = useUsuarioActual();
  const [query, setQuery] = useState("");
  const [producto, setProducto] = useState(null);
  const [cantidad, setCantidad] = useState(String(linea.cantidad_base ?? 1));
  const [precio, setPrecio] = useState(linea.precio_unitario != null ? String(linea.precio_unitario) : "");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [flash, setFlash] = useState(null);

  async function confirmar() {
    if (!producto) { setFlash("Elegí un producto de reemplazo"); return; }
    if (!cantidad || Number(cantidad) <= 0) { setFlash("Cantidad inválida"); return; }
    setGuardando(true);
    const { error } = await cambiarPedidoLinea({
      lineaId: linea.id, productoId: producto.id, cantidadBase: Number(cantidad),
      precioUnitario: precio !== "" ? precio : null, motivo: motivo.trim() || null,
      usuario: usuarioActual.nombre,
    });
    setGuardando(false);
    if (error) { setFlash("Error: " + error.message); return; }
    onCambiado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Cambiar línea</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-500">
          Reemplazando: <span className="font-medium text-slate-700">{linea.producto?.nombre}</span> · {textoCantidadLinea(linea)}
        </p>

        {flash && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle size={12} /> {flash}
          </div>
        )}

        {!producto ? (
          <TypeaheadProducto value={query} onChange={setQuery}
            onSeleccionar={(p) => { setProducto(p); setQuery(""); }}
            placeholder="Buscar producto de reemplazo…" />
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{producto.nombre}</p>
              {producto.sku_interno && <p className="text-xs text-slate-400">{producto.sku_interno}</p>}
            </div>
            <button onClick={() => setProducto(null)} className="shrink-0 text-slate-300 hover:text-red-500"><X size={16} /></button>
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Cantidad ({linea.producto?.unidad_base})</label>
            <input type="number" min="0.001" step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Precio unitario</label>
            <input type="number" min="0" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </div>
        </div>

        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)"
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />

        <div className="flex gap-2">
          <button onClick={confirmar} disabled={guardando}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
            {guardando && <Loader size={14} className="animate-spin" />}
            {guardando ? "Cambiando…" : "Confirmar cambio"}
          </button>
          <button onClick={onClose} className="rounded-lg border px-3 py-2 text-sm text-slate-500">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

/* ── Acciones sobre un evento de despacho ya alistado, para pedidos que no
   son Tienda (brief W-B, pieza 4b) — Tienda sigue con su countdown propio
   (revertir_evento), este es un mecanismo distinto sin ventana de tiempo.
   Motivo obligatorio: se valida acá solo que no venga vacío, el resto lo
   exige el backend. */
function EventoAlistadoAcciones({ evento, linea, onLineaPatch, onEventoRevertido }) {
  const usuarioActual = useUsuarioActual();
  const [accion, setAccion] = useState(null); // null | 'devolver' | 'inyectar'
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function confirmar() {
    if (!motivo.trim()) { setError("El motivo es obligatorio"); return; }
    setGuardando(true);
    setError(null);
    const fn = accion === "devolver" ? devolverAlistadoAAlmacen : inyectarAlistadoATienda;
    const { resultado, error: err } = await fn({ eventoId: evento.id, motivo: motivo.trim(), usuario: usuarioActual.nombre });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    onLineaPatch(linea.id, { estado: resultado.nuevo_estado_linea, cantidad_despachada: resultado.cantidad_despachada });
    if (resultado.evento_revertido_total) onEventoRevertido(linea.id, evento.id);
    setAccion(null);
    setMotivo("");
  }

  if (evento.revertido) {
    return <span className="text-slate-400">Devuelto</span>;
  }

  if (!accion) {
    return (
      <div className="flex shrink-0 gap-1">
        <button onClick={() => setAccion("devolver")}
          className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600 hover:bg-slate-200">
          <Warehouse size={11} /> Devolver a almacén
        </button>
        <button onClick={() => setAccion("inyectar")}
          className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 font-medium text-blue-600 hover:bg-blue-100">
          <Store size={11} /> Inyectar a tienda
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-wrap items-center justify-end gap-1">
      {error && <span className="text-red-600">{error}</span>}
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo *" autoFocus
        className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300" />
      <button onClick={confirmar} disabled={guardando}
        className="shrink-0 rounded-lg bg-slate-900 px-2 py-1 font-medium text-white disabled:opacity-50">
        {guardando ? "…" : "Confirmar"}
      </button>
      <button onClick={() => { setAccion(null); setMotivo(""); setError(null); }} className="shrink-0 text-slate-400 hover:text-slate-600">
        <X size={13} />
      </button>
    </div>
  );
}

/* ── Fila de línea (expandible: pick auto editable + acciones) ──────────── */
function FilaLinea({
  linea, eventos, habilitado, categoria, saldoLibre, codigos,
  seleccionada, onToggleSeleccion, onPickChange, onLineaPatch, onEventoNuevo, onEventoRevertido, onCambiado,
}) {
  const usuarioActual = useUsuarioActual();
  const { nombreSucursal } = useSucursal();
  const [abierto, setAbierto] = useState(false);
  const [asignaciones, setAsignaciones] = useState([]);
  const [ubicacionesDisponibles, setUbicacionesDisponibles] = useState([]);
  const [desglose, setDesglose] = useState(null);
  const [cargandoPick, setCargandoPick] = useState(false);
  const [despachando, setDespachando] = useState(false);
  const [mostrarComprado, setMostrarComprado] = useState(false);
  const [nota, setNota] = useState("");
  const [costo, setCosto] = useState("");
  const [guardandoCompra, setGuardandoCompra] = useState(false);
  const [flash, setFlash] = useState(null);
  const [, forzarTick] = useState(0);
  // Brief W8 — compuerta de reserva: turno FIFO de esta línea (cubierto <
  // pendiente => hay turno de otro pedido por delante). forzado abre el
  // camino de "Despachar igual" con motivo obligatorio.
  const [turno, setTurno] = useState(null);
  const [forzado, setForzado] = useState(false);
  const [motivoSel, setMotivoSel] = useState("");
  const [motivoLibre, setMotivoLibre] = useState("");
  const [despachandoForzado, setDespachandoForzado] = useState(false);
  // Brief W-B — Restar/Rechazar/Cambiar: acciones sobre una línea todavía
  // no despachada (mismas condiciones que puedeDespachar, más abajo).
  const [restando, setRestando] = useState(false);
  const [rechazandoLinea, setRechazandoLinea] = useState(false);
  const [mostrarCambiar, setMostrarCambiar] = useState(false);

  const pendiente = Math.max(Number(linea.cantidad_base) - Number(linea.cantidad_despachada), 0);
  const puedeDespachar = linea.estado === "POR_DESPACHAR" || (linea.estado === "PENDIENTE" && habilitado);
  // Restar/Rechazar/Cambiar (brief W-B): a diferencia de "puedeDespachar",
  // no exigen `habilitado` — el backend las permite en PENDIENTE aunque
  // todavía no haya llegado stock nuevo (habilitado solo gatea el pick).
  const puedeModificar = linea.estado === "POR_DESPACHAR" || linea.estado === "PENDIENTE";
  const cubierto = turno?.cubierto ?? null;
  const sobreTurno = haySobreTurno({ pendiente, cubierto });

  const showFlash = (msg, type = "error") => { setFlash({ msg, type }); setTimeout(() => setFlash(null), 3000); };

  // Recalcular pick auto al expandir O al seleccionar la casilla (brief W5
  // #1: seleccionar precarga el pick, sin necesidad de abrir el acordeón).
  // Brief W8: el objetivo del pick se limita a `cubierto` cuando hay turno
  // de otro pedido por delante, salvo que ya se haya elegido "Despachar
  // igual" (forzado) — ahí sí se calcula sobre lo pendiente completo.
  useEffect(() => {
    if ((!abierto && !seleccionada) || !puedeDespachar) return;
    let activo = true;
    setCargandoPick(true);
    turnoLinea(linea.id).then((t) => {
      if (!activo) return;
      setTurno(t);
      const objetivo = objetivoPick({ pendiente, cubierto: t?.cubierto ?? null, forzado });
      return Promise.all([
        calcularPick({ productoId: linea.producto_id, cantidadBase: objetivo, sucursalPreferidaId: linea.sucursal_origen_id }),
        desglosePresentaciones({ productoId: linea.producto_id, cantidadBase: objetivo }),
        ubicacionesParaOperacion({ productoId: linea.producto_id, modo: "SALIDA", sucursalPreferidaId: linea.sucursal_origen_id, nombreSucursal }),
      ]);
    }).then((res) => {
      if (!activo || !res) return;
      const [pick, desg, ubs] = res;
      setAsignaciones(pick.asignaciones);
      setDesglose(desg);
      setUbicacionesDisponibles(ubs.ubicaciones);
      setCargandoPick(false);
    });
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, seleccionada, linea.id, forzado]);

  // Espeja el pick (auto o editado) hacia DetallePedido mientras la línea
  // está seleccionada — es lo que arma el payload de despachar_lineas.
  useEffect(() => {
    if (!seleccionada) return;
    onPickChange(linea.id, { asignaciones, pendiente });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionada, asignaciones, pendiente]);

  // countdown para revertir (Tienda, dentro de ventana)
  const eventoRevertible = (eventos || []).find((e) => !e.revertido && e.reversible_hasta && new Date(e.reversible_hasta) > new Date());
  useEffect(() => {
    if (!eventoRevertible) return;
    const t = setInterval(() => forzarTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [eventoRevertible]);

  function actualizarAsignacion(idx, campo, valor) {
    setAsignaciones((prev) => prev.map((a, i) => i === idx ? { ...a, [campo]: valor } : a));
  }
  function quitarAsignacion(idx) {
    setAsignaciones((prev) => prev.filter((_, i) => i !== idx));
  }
  function agregarAsignacion() {
    const usados = new Set(asignaciones.map((a) => a.ubicacion_id));
    const libre = ubicacionesDisponibles.find((u) => !usados.has(u.id));
    if (!libre) { showFlash("No hay más ubicaciones con stock para agregar"); return; }
    setAsignaciones((prev) => [...prev, { ubicacion_id: libre.id, cantidad_base: 0 }]);
  }

  const totalAsignado = asignaciones.reduce((s, a) => s + Number(a.cantidad_base || 0), 0);

  // Despacho de ESTA línea sola: patchea el estado local en vez de
  // recargar el pedido entero (brief W5 #3) — despachar_linea ya devuelve
  // todo lo necesario (estado, cantidad_despachada, pendiente).
  async function confirmarDespacho() {
    const filtradas = asignaciones.filter((a) => Number(a.cantidad_base) > 0);
    if (filtradas.length === 0) { showFlash("Asigná una cantidad mayor a cero en al menos una ubicación"); return; }
    if (totalAsignado > pendiente + 0.0001) { showFlash(`El total asignado (${totalAsignado}) excede lo pendiente (${pendiente})`); return; }

    setDespachando(true);
    const { resultado, error } = await despacharLinea({ lineaId: linea.id, asignaciones: filtradas, usuario: usuarioActual.nombre });
    setDespachando(false);
    if (error) { showFlash("Error: " + error.message); return; }
    setAbierto(false);
    onLineaPatch(linea.id, { estado: resultado.estado, cantidad_despachada: resultado.cantidad_despachada });
    onEventoNuevo(linea.id, {
      id: resultado.evento_id, pedido_linea_id: linea.id, cantidad_base: totalAsignado,
      creado_en: new Date().toISOString(), reversible_hasta: resultado.reversible_hasta, revertido: false,
    });
    // Despachada por su cuenta: si estaba en la selección del lote, ya no
    // pertenece ahí (puedeDespachar pasa a false y la casilla desaparece).
    if (seleccionada) onToggleSeleccion(linea.id);
  }

  // Brief W8: pisar el turno exige motivo, usuario y hora — nunca en
  // silencio. despachar_linea_forzado escribe la bitácora en la misma
  // transacción que el despacho (no best-effort).
  async function confirmarDespachoForzado() {
    const filtradas = asignaciones.filter((a) => Number(a.cantidad_base) > 0);
    if (filtradas.length === 0) { showFlash("Asigná una cantidad mayor a cero en al menos una ubicación"); return; }
    if (totalAsignado > pendiente + 0.0001) { showFlash(`El total asignado (${totalAsignado}) excede lo pendiente (${pendiente})`); return; }
    if (!motivoValido(motivoSel, motivoLibre)) { showFlash("El motivo es obligatorio para despachar por encima del turno"); return; }

    setDespachandoForzado(true);
    const { resultado, error } = await despacharLineaForzado({
      lineaId: linea.id, asignaciones: filtradas, motivo: motivoFinal(motivoSel, motivoLibre), usuario: usuarioActual.nombre,
    });
    setDespachandoForzado(false);
    if (error) { showFlash("Error: " + error.message); return; }
    setAbierto(false);
    setForzado(false);
    setMotivoSel("");
    setMotivoLibre("");
    onLineaPatch(linea.id, { estado: resultado.estado, cantidad_despachada: resultado.cantidad_despachada });
    onEventoNuevo(linea.id, {
      id: resultado.evento_id, pedido_linea_id: linea.id, cantidad_base: totalAsignado,
      creado_en: new Date().toISOString(), reversible_hasta: resultado.reversible_hasta, revertido: false,
    });
    if (seleccionada) onToggleSeleccion(linea.id);
  }

  async function confirmarCompraDirecta() {
    if (!nota.trim()) { showFlash("La nota es obligatoria"); return; }
    setGuardandoCompra(true);
    const { error } = await comprarDirecto({ lineaId: linea.id, nota: nota.trim(), costo: costo ? Number(costo) : null, usuario: usuarioActual.nombre });
    setGuardandoCompra(false);
    if (error) { showFlash("Error: " + error.message); return; }
    setMostrarComprado(false);
    onLineaPatch(linea.id, { estado: "COMPRADO_DIRECTO", compra_directa_nota: nota.trim(), compra_directa_costo: costo ? Number(costo) : null });
    if (seleccionada) onToggleSeleccion(linea.id);
  }

  // Motivo opcional (brief W-B): el prompt hace de "confirm simple" — un
  // Cancel aborta la acción, un motivo vacío (Aceptar sin escribir nada)
  // sigue adelante igual.
  async function restarLinea() {
    const motivo = window.prompt("Motivo (opcional) para quitar esta línea del pedido:");
    if (motivo === null) return;
    setRestando(true);
    const { error } = await restarPedidoLinea({ lineaId: linea.id, motivo: motivo.trim() || null, usuario: usuarioActual.nombre });
    setRestando(false);
    if (error) { showFlash("Error: " + error.message); return; }
    onLineaPatch(linea.id, { estado: "RETIRADA" });
    if (seleccionada) onToggleSeleccion(linea.id);
  }

  async function rechazarLinea() {
    const motivo = window.prompt("Motivo (opcional) para rechazar esta línea:");
    if (motivo === null) return;
    setRechazandoLinea(true);
    const { error } = await rechazarPedidoLinea({ lineaId: linea.id, motivo: motivo.trim() || null, usuario: usuarioActual.nombre });
    setRechazandoLinea(false);
    if (error) { showFlash("Error: " + error.message); return; }
    onLineaPatch(linea.id, { estado: "RECHAZADO" });
    if (seleccionada) onToggleSeleccion(linea.id);
  }

  async function revertir(eventoId, montoParcial) {
    const { resultado, error } = await revertirEvento({ eventoId, cantidadBase: montoParcial ?? null, usuario: usuarioActual.nombre });
    if (error) { showFlash("Error al revertir: " + error.message); return; }
    onLineaPatch(linea.id, { estado: resultado.nuevo_estado_linea, cantidad_despachada: resultado.cantidad_despachada });
    if (resultado.evento_revertido_total) onEventoRevertido(linea.id, eventoId);
  }

  return (
    <div className={`rounded-xl border bg-white ${seleccionada ? "border-blue-300 ring-1 ring-blue-200" : "border-slate-200"}`}>
      <button onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {puedeDespachar && (
          <input type="checkbox" checked={seleccionada} onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSeleccion(linea.id)}
            className="shrink-0" />
        )}
        {abierto ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p title={linea.producto?.nombre} className="line-clamp-2 text-sm font-medium text-slate-800">{linea.producto?.nombre}</p>
          {linea.producto?.sku_interno && <p className="text-xs text-slate-400">{linea.producto.sku_interno}</p>}
          <CodigosLinea codigos={codigos} marca={linea.producto?.marca} />
          {linea.sucursal_origen_id != null && (
            <p className="text-xs text-slate-400">Origen: {nombreSucursal(linea.sucursal_origen_id)}</p>
          )}
        </div>
        <span className="text-sm font-mono text-slate-600">{textoCantidadLinea(linea)}</span>
        <BadgeLinea estado={linea.estado} />
        {puedeDespachar && (
          <BadgeSaldoLinea saldoLibre={saldoLibre} pendienteLinea={pendiente} />
        )}
        {linea.estado === "PENDIENTE" && (
          <span className="text-xs text-amber-600">pend. {cantidadFmt(pendiente)}</span>
        )}
      </button>

      {!abierto && puedeDespachar && textoSaldoLinea(saldoLibre, pendiente) && (
        <p className="px-4 pb-3 text-xs text-slate-400">{textoSaldoLinea(saldoLibre, pendiente)}</p>
      )}

      {abierto && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          {flash && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={12} /> {flash.msg}
            </div>
          )}

          {linea.precio_unitario != null && (
            <p className="text-xs text-slate-500">
              Precio unitario: {fmtDinero(linea.precio_unitario)}
              {linea.descuento_pct ? ` · Descuento: ${linea.descuento_pct}%` : ""}
              {linea.subtotal != null ? ` · Subtotal: ${fmtDinero(linea.subtotal)}` : ""}
            </p>
          )}

          {linea.estado === "COMPRADO_DIRECTO" && (
            <div className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-700">
              <p className="font-medium">Comprado directo</p>
              <p>{linea.compra_directa_nota}</p>
              {linea.compra_directa_costo != null && <p className="text-xs">Costo: {linea.compra_directa_costo}</p>}
            </div>
          )}

          {puedeDespachar && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pick automático (editable)</p>
              {cargandoPick ? (
                <p className="flex items-center gap-1 text-xs text-slate-400"><Loader size={12} className="animate-spin" /> Calculando…</p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {asignaciones.map((a, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <MapPin size={13} className="text-slate-400 shrink-0" />
                        <select value={a.ubicacion_id} onChange={(e) => actualizarAsignacion(i, "ubicacion_id", Number(e.target.value))}
                          className="flex-1 rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                          {ubicacionesDisponibles.map((u) => (
                            <option key={u.id} value={u.id}>{u.label} (stock: {u.cantidad_base})</option>
                          ))}
                        </select>
                        <input type="number" min="0" step="any" value={a.cantidad_base}
                          onChange={(e) => actualizarAsignacion(i, "cantidad_base", e.target.value)}
                          className="w-24 rounded-lg border px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        <button onClick={() => quitarAsignacion(i)} className="text-slate-300 hover:text-red-500">
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                    <button onClick={agregarAsignacion} className="text-xs text-blue-600 underline">
                      + Agregar ubicación
                    </button>
                  </div>

                  <p className={`text-xs ${totalAsignado < pendiente ? "text-amber-600" : "text-slate-500"}`}>
                    Total asignado: {cantidadFmt(totalAsignado)} / {cantidadFmt(pendiente)} pendiente
                    {totalAsignado < pendiente && !sobreTurno && " — el resto quedará pendiente"}
                  </p>

                  {/* Brief W8 — compuerta de reserva: cuando el turno FIFO no alcanza
                      para todo lo pendiente, el pick automático se limita a lo cubierto
                      y se ofrece "Despachar igual" con motivo obligatorio para pisarlo. */}
                  {sobreTurno && !forzado && (
                    <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      <p>
                        Podés despachar {cantidadFmt(cubierto)} de {cantidadFmt(pendiente)}.
                        {" "}Las otras {cantidadFmt(pendiente - cubierto)} tienen turno para otro pedido.
                      </p>
                      <button onClick={() => setForzado(true)} className="mt-1 font-semibold underline">
                        Despachar igual
                      </button>
                    </div>
                  )}

                  {sobreTurno && forzado && (
                    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs text-amber-700">
                        Vas a despachar por encima del turno FIFO. Elegí un motivo — queda registrado con tu usuario y la hora.
                      </p>
                      <select value={motivoSel} onChange={(e) => setMotivoSel(e.target.value)}
                        className="w-full rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300">
                        <option value="">Elegí un motivo…</option>
                        {MOTIVOS_DESPACHO_FORZADO.map((m) => <option key={m} value={m}>{m}</option>)}
                        <option value={MOTIVO_OTRO}>Otro (especificar)</option>
                      </select>
                      {motivoSel === MOTIVO_OTRO && (
                        <input value={motivoLibre} onChange={(e) => setMotivoLibre(e.target.value)}
                          placeholder="Motivo *"
                          className="w-full rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
                      )}
                      <div className="flex gap-2">
                        <button onClick={confirmarDespachoForzado} disabled={despachandoForzado}
                          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-600 py-1.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
                          {despachandoForzado && <Loader size={13} className="animate-spin" />}
                          {despachandoForzado ? "Despachando…" : "Confirmar despacho igual"}
                        </button>
                        <button onClick={() => { setForzado(false); setMotivoSel(""); setMotivoLibre(""); }}
                          className="rounded-lg border px-3 py-1.5 text-sm text-slate-500">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {desglose?.desglose?.length > 0 && (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <p className="mb-1 font-medium text-slate-500">Desglose de presentaciones (informativo):</p>
                      <p>
                        {desglose.desglose.map((d) => `${d.cantidad} ${d.nombre}`).join(" + ")}
                        {desglose.restante > 0 && ` + ${cantidadFmt(desglose.restante)} sueltas`}
                      </p>
                    </div>
                  )}

                  {!forzado && (
                    <button onClick={confirmarDespacho} disabled={despachando}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                      {despachando && <Loader size={14} className="animate-spin" />}
                      {despachando ? "Despachando…" : linea.estado === "PENDIENTE" ? "Despachar pendiente" : "Despachar"}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {linea.estado === "PENDIENTE" && !habilitado && (
            <p className="flex items-center gap-1 text-xs text-slate-400">
              <Boxes size={12} /> Sin stock nuevo todavía — se habilita cuando llegue una ENTRADA de este producto.
            </p>
          )}

          {puedeModificar && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={restarLinea} disabled={restando}
                className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <Trash2 size={12} /> Quitar del pedido
              </button>
              <button onClick={rechazarLinea} disabled={rechazandoLinea}
                className="flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                <Ban size={12} /> Rechazar
              </button>
              <button onClick={() => setMostrarCambiar(true)}
                className="flex items-center gap-1 rounded-lg border border-blue-200 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50">
                <Repeat size={12} /> Cambiar
              </button>
            </div>
          )}

          {mostrarCambiar && (
            <ModalCambiarLinea linea={linea} onClose={() => setMostrarCambiar(false)}
              onCambiado={() => { setMostrarCambiar(false); onCambiado(); }} />
          )}

          {linea.estado !== "COMPRADO_DIRECTO" && (
            <div>
              {!mostrarComprado ? (
                <button onClick={() => setMostrarComprado(true)} className="text-xs text-amber-600 underline">
                  Comprado directo (sin tocar Kardex)
                </button>
              ) : (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <input value={nota} onChange={(e) => setNota(e.target.value)}
                    placeholder="Nota (proveedor / variante / fabricante) *"
                    className="w-full rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
                  <input type="number" min="0" step="any" value={costo} onChange={(e) => setCosto(e.target.value)}
                    placeholder="Costo (opcional)"
                    className="w-full rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
                  <div className="flex gap-2">
                    <button onClick={confirmarCompraDirecta} disabled={guardandoCompra}
                      className="flex-1 rounded-lg bg-amber-600 py-1.5 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50">
                      {guardandoCompra ? "Guardando…" : "Confirmar"}
                    </button>
                    <button onClick={() => setMostrarComprado(false)} className="rounded-lg border px-3 py-1.5 text-sm text-slate-500">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {linea.estado === "DESPACHADA" && categoria === "TIENDA" && (eventos || []).map((e) => {
            const vigente = !e.revertido && e.reversible_hasta && new Date(e.reversible_hasta) > new Date();
            return (
              <div key={e.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs">
                <span className="text-slate-500">
                  Evento #{e.id} · {cantidadFmt(e.cantidad_base)} {linea.producto?.unidad_base} · {fechaFmt(e.creado_en)}
                </span>
                {e.revertido ? (
                  <span className="text-slate-400">Revertido</span>
                ) : vigente ? (
                  <button onClick={() => revertir(e.id)}
                    className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 font-medium text-red-600 hover:bg-red-100">
                    <Undo2 size={11} /> Revertir <Clock size={11} /> {mmss(new Date(e.reversible_hasta) - new Date())}
                  </button>
                ) : (
                  <span className="text-slate-400">Sellado</span>
                )}
              </div>
            );
          })}

          {categoria !== "TIENDA" && (eventos || []).length > 0 && (
            <div className="space-y-1.5">
              {(eventos || []).map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs">
                  <span className="shrink-0 text-slate-500">
                    Evento #{e.id} · {cantidadFmt(e.cantidad_base)} {linea.producto?.unidad_base} · {fechaFmt(e.creado_en)}
                  </span>
                  <EventoAlistadoAcciones evento={e} linea={linea} onLineaPatch={onLineaPatch} onEventoRevertido={onEventoRevertido} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Fila de ítem especial/personalizado — no pasa por FilaLinea (no hay
   pick ni Kardex): solo "marcar entregado" cierra la línea. También
   despachable en lote (brief W5 #1: catálogo y personalizados por igual),
   aunque en lote no pasa por despachar_lineas — no tiene pick, se
   entrega vía entregar_personalizado como cualquier entrega individual. */
function FilaEspecial({ linea, seleccionada, onToggleSeleccion, onLineaPatch }) {
  const usuarioActual = useUsuarioActual();
  const [entregando, setEntregando] = useState(false);
  const [flash, setFlash] = useState(null);
  const despachable = linea.estado === "ESPECIAL";

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 3000); };

  async function marcarEntregado() {
    if (!window.confirm("¿Confirmar entrega de este ítem especial? Esta acción cierra la línea.")) return;
    setEntregando(true);
    const { error } = await entregarPersonalizado({ lineaId: linea.id, usuario: usuarioActual.nombre });
    setEntregando(false);
    if (error) { showFlash("Error: " + error.message); return; }
    onLineaPatch(linea.id, { estado: "COMPRADO_DIRECTO" });
    if (seleccionada) onToggleSeleccion(linea.id);
  }

  return (
    <div className={`rounded-xl border bg-white px-4 py-3 space-y-2 ${seleccionada ? "border-blue-300 ring-1 ring-blue-200" : "border-slate-200"}`}>
      {flash && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={12} /> {flash}
        </div>
      )}
      <div className="flex items-start gap-3">
        {despachable && (
          <input type="checkbox" checked={seleccionada} onChange={() => onToggleSeleccion(linea.id)} className="mt-1 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">{linea.descripcion || linea.producto?.nombre || "Ítem especial"}</p>
          <CodigosLinea esPersonalizado />
          {linea.nota && <p className="text-xs text-slate-500">{linea.nota}</p>}
        </div>
        <span className="text-sm font-mono text-slate-600">{textoCantidadLinea(linea)}</span>
        <BadgeLinea estado={linea.estado} />
      </div>
      {linea.precio_unitario != null && (
        <p className="text-xs text-slate-500">Precio unitario: {fmtDinero(linea.precio_unitario)}</p>
      )}
      {linea.estado === "ESPECIAL" && (
        <button onClick={marcarEntregado} disabled={entregando}
          className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
          {entregando && <Loader size={14} className="animate-spin" />}
          {entregando ? "Guardando…" : "Marcar entregado"}
        </button>
      )}
    </div>
  );
}

/* ── Reporte de impresión (solo visible en @media print, ver print:hidden
   más abajo) — tabla propia en vez de aplicar print: sobre FilaLinea, que
   es un editor interactivo de pick (selects, inputs) mal adaptado a hoja
   impresa. Texto de producto sin truncar ni clamp: en papel no hay el
   límite de espacio de una card en pantalla. */
function ReporteImpresionPedido({ pedido, lineasCatalogo, lineasEspeciales, codigosPorProducto, desglosePorLinea }) {
  const { nombreSucursal } = useSucursal();
  return (
    <div className="hidden print:block">
      <h1 className="text-2xl font-bold text-slate-900">Pedido #{pedido.id}</h1>
      <div className="mt-1 space-y-0.5 text-sm text-slate-700">
        <p><span className="font-medium">Categoría:</span> {labelCategoria(pedido.categoria)}</p>
        {pedido.cliente?.nombre && <p><span className="font-medium">Cliente:</span> {pedido.cliente.nombre}</p>}
        {pedido.referencia && <p><span className="font-medium">Referencia:</span> {pedido.referencia}</p>}
        <p><span className="font-medium">Estado:</span> {pedido.estado}</p>
        <p><span className="font-medium">Fecha de creación:</span> {fechaFmtLarga(pedido.creado_en)}</p>
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left">
            <th className="py-2 pr-3 font-semibold text-slate-800">Producto</th>
            <th className="py-2 pr-3 font-semibold text-slate-800">Cantidad</th>
            <th className="py-2 pr-3 font-semibold text-slate-800">Origen</th>
            <th className="py-2 pr-3 font-semibold text-slate-800">Precio unit.</th>
            <th className="py-2 pr-3 font-semibold text-slate-800">Desc.</th>
            <th className="py-2 pr-3 font-semibold text-slate-800">Subtotal</th>
            <th className="py-2 pr-3 font-semibold text-slate-800">Estado</th>
            <th className="py-2 font-semibold text-slate-800">Detalle</th>
          </tr>
        </thead>
        <tbody>
          {lineasCatalogo.map((l) => {
            const pendiente = Math.max(Number(l.cantidad_base) - Number(l.cantidad_despachada), 0);
            const desg = desglosePorLinea?.get(l.id);
            return (
              <tr key={l.id} className="break-inside-avoid border-b border-slate-300 align-top">
                <td className="py-2 pr-3">
                  <p className="font-medium text-slate-900">{l.producto?.nombre}</p>
                  {l.producto?.sku_interno && <p className="text-xs text-slate-500">{l.producto.sku_interno}</p>}
                  <CodigosLinea codigos={codigosPorProducto?.get(l.producto_id)} marca={l.producto?.marca} />
                </td>
                <td className="whitespace-nowrap py-2 pr-3">
                  {formatoEquivalencia({
                    cantidadPresentacion: l.cantidad_presentacion,
                    nombrePresentacion: l.presentacion?.nombre,
                    factor: l.presentacion?.factor_unidad_base,
                    cantidadBase: cantidadFmt(l.cantidad_base),
                    unidadBase: l.producto?.unidad_base,
                  })}
                  {l.estado === "PENDIENTE" && (
                    <p className="text-xs text-slate-500">
                      {cantidadFmt(l.cantidad_despachada)} despachado, {cantidadFmt(pendiente)} pendiente
                      {desg?.desglose?.length > 0 && (
                        <> — {desg.desglose.map((d) => `${d.cantidad} ${d.nombre}`).join(" + ")}
                          {desg.restante > 0 && ` + ${cantidadFmt(desg.restante)} sueltas`}</>
                      )}
                    </p>
                  )}
                </td>
                <td className="py-2 pr-3">{nombreSucursal(l.sucursal_origen_id) || "—"}</td>
                <td className="py-2 pr-3">{l.precio_unitario != null ? fmtDinero(l.precio_unitario) : "—"}</td>
                <td className="py-2 pr-3">{l.descuento_pct ? `${l.descuento_pct}%` : "—"}</td>
                <td className="py-2 pr-3">{l.subtotal != null ? fmtDinero(l.subtotal) : "—"}</td>
                <td className="py-2 pr-3">{(ESTADOS_LINEA[l.estado] || {}).label || l.estado}</td>
                <td className="py-2">
                  {l.estado === "COMPRADO_DIRECTO" && (
                    <>
                      {l.compra_directa_nota}
                      {l.compra_directa_costo != null && (
                        <span className="block text-xs text-slate-500">Costo: {l.compra_directa_costo}</span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {lineasEspeciales.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-slate-900">Ítems especiales / a pedido</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-800 text-left">
                <th className="py-2 pr-3 font-semibold text-slate-800">Descripción</th>
                <th className="py-2 pr-3 font-semibold text-slate-800">Cantidad</th>
                <th className="py-2 pr-3 font-semibold text-slate-800">Precio unit.</th>
                <th className="py-2 pr-3 font-semibold text-slate-800">Estado</th>
                <th className="py-2 font-semibold text-slate-800">Nota</th>
              </tr>
            </thead>
            <tbody>
              {lineasEspeciales.map((l) => (
                <tr key={l.id} className="break-inside-avoid border-b border-slate-300 align-top">
                  <td className="py-2 pr-3">
                    <p className="font-medium text-slate-900">{l.descripcion || l.producto?.nombre}</p>
                    <CodigosLinea esPersonalizado />
                  </td>
                  <td className="py-2 pr-3">{textoCantidadLinea(l)}</td>
                  <td className="py-2 pr-3">{l.precio_unitario != null ? fmtDinero(l.precio_unitario) : "—"}</td>
                  <td className="py-2 pr-3">{(ESTADOS_LINEA[l.estado] || {}).label || l.estado}</td>
                  <td className="py-2">{l.nota}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pedido.total != null && (
        <div className="mt-4 ml-auto w-64 space-y-0.5 text-sm text-slate-700">
          <p className="flex justify-between"><span>Subtotal</span> <span>{fmtDinero(pedido.subtotal)}</span></p>
          <p className="flex justify-between"><span>Descuento general</span> <span>{fmtDinero(pedido.descuento_general)}</span></p>
          <p className="flex justify-between border-t border-slate-800 pt-1 font-semibold text-slate-900"><span>Total</span> <span>{fmtDinero(pedido.total)}</span></p>
        </div>
      )}
    </div>
  );
}

/* ── Detalle de pedido (formulario grande de despacho) ───────────────────── */
// Exportado con nombre: PedidoDetallePage.jsx lo monta en la ruta
// /pedidos/:id (brief S3 parte A) fuera del shell de pestañas.
export function DetallePedido({ pedidoId, onBack }) {
  const usuarioActual = useUsuarioActual();
  const [pedido, setPedido] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [eventosPorLinea, setEventosPorLinea] = useState({});
  const [habilitadas, setHabilitadas] = useState(new Set());
  const [cargando, setCargando] = useState(true);
  const [saldoPorProducto, setSaldoPorProducto] = useState(new Map());
  const [codigosPorProducto, setCodigosPorProducto] = useState(new Map());
  const [desglosePorLinea, setDesglosePorLinea] = useState(new Map());
  const [autores, setAutores] = useState(new Map());

  // Despacho por lote (brief W5): una casilla por línea despachable +
  // barra de acción, en vez de despachar de a una y recargar el pedido
  // entero 30 veces. seleccion mezcla líneas de catálogo (van por
  // despachar_lineas) y especiales (van por entregar_personalizado, no
  // tienen pick) — se separan recién al confirmar.
  const [seleccion, setSeleccion] = useState(new Set());
  const [picksPorLinea, setPicksPorLinea] = useState(new Map());
  const [despachandoLote, setDespachandoLote] = useState(false);
  const [flashLote, setFlashLote] = useState(null);
  // Brief W-B — Rechazar pedido completo (pieza 2, nivel pedido).
  const [rechazandoPedido, setRechazandoPedido] = useState(false);
  const [flashRechazo, setFlashRechazo] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [{ data: p }, { data: ls }] = await Promise.all([
      supabase.from("pedido")
        .select("*, cliente:cliente_id ( nombre, tipo_precio )")
        .eq("id", pedidoId).single(),
      supabase.from("pedido_linea")
        .select("*, producto:producto_id(id, nombre, sku_interno, unidad_base, marca), presentacion:presentacion_id(nombre, factor_unidad_base)")
        .eq("pedido_id", pedidoId)
        .order("id"),
    ]);
    const lineaIds = (ls || []).map((l) => l.id);
    const productoIdsCatalogo = (ls || []).filter((l) => !l.es_personalizado).map((l) => l.producto_id);
    const [{ data: eventos }, { data: hab }, codigos, { data: pres }] = await Promise.all([
      lineaIds.length
        ? supabase.from("pedido_despacho_evento").select("*").in("pedido_linea_id", lineaIds).order("id", { ascending: false })
        : Promise.resolve({ data: [] }),
      lineaIds.length
        ? supabase.from("v_pedido_linea_despachable").select("id").in("id", lineaIds)
        : Promise.resolve({ data: [] }),
      codigosGrisPorProducto(productoIdsCatalogo),
      // Presentaciones de TODOS los productos del pedido en una sola
      // consulta — arma el desglose informativo de la hoja impresa
      // (brief W5 #4) sin una consulta por línea.
      productoIdsCatalogo.length
        ? supabase.from("presentacion").select("id, nombre, factor_unidad_base, producto_id")
            .in("producto_id", productoIdsCatalogo).eq("activo", true).order("factor_unidad_base", { ascending: false })
        : Promise.resolve({ data: [] }),
    ]);
    const grupo = {};
    for (const e of eventos || []) (grupo[e.pedido_linea_id] ||= []).push(e);

    const presPorProducto = new Map();
    for (const row of pres || []) {
      if (!presPorProducto.has(row.producto_id)) presPorProducto.set(row.producto_id, []);
      presPorProducto.get(row.producto_id).push(row);
    }
    const desglose = new Map();
    for (const l of ls || []) {
      if (l.es_personalizado) continue;
      const pendiente = Math.max(Number(l.cantidad_base) - Number(l.cantidad_despachada), 0);
      desglose.set(l.id, armarDesglose(presPorProducto.get(l.producto_id) || [], pendiente));
    }

    setPedido(p);
    setLineas(ls || []);
    setEventosPorLinea(grupo);
    setHabilitadas(new Set((hab || []).map((h) => h.id)));
    setCodigosPorProducto(codigos);
    setDesglosePorLinea(desglose);
    setCargando(false);
    // creado_por es un solo email acá (no hace falta el batch de la lista),
    // pero se reusa resolverAutores para no duplicar la consulta a perfil.
    if (p?.creado_por) resolverAutores([p.creado_por]).then(setAutores);
  }, [pedidoId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Patch local de una línea sin recargar el pedido entero (brief W5 #3):
  // revertir y comprar directo ya devuelven todo lo necesario en su propia
  // respuesta — desproporcionado volver a pedir cabecera + líneas + saldos
  // + picks por una acción sobre una sola línea.
  const patchLinea = useCallback((lineaId, patch) => {
    setLineas((prev) => prev.map((l) => l.id === lineaId ? { ...l, ...patch } : l));
  }, []);
  const agregarEvento = useCallback((lineaId, evento) => {
    setEventosPorLinea((prev) => ({ ...prev, [lineaId]: [evento, ...(prev[lineaId] || [])] }));
  }, []);
  const marcarEventoRevertido = useCallback((lineaId, eventoId) => {
    setEventosPorLinea((prev) => ({
      ...prev,
      [lineaId]: (prev[lineaId] || []).map((e) => e.id === eventoId ? { ...e, revertido: true } : e),
    }));
  }, []);

  function toggleSeleccion(lineaId) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(lineaId)) next.delete(lineaId); else next.add(lineaId);
      return next;
    });
  }
  function onPickChange(lineaId, pick) {
    setPicksPorLinea((prev) => new Map(prev).set(lineaId, pick));
  }

  // Saldo disponible (informativo, no bloquea "Despachar" ni el pick
  // automático): una sola llamada batch acá, no un polling por línea —
  // recalcula cada 18s para que dos operarios despachando pedidos
  // distintos en simultáneo no vean ambos verde sobre el mismo stock.
  const productoIdsActivos = useMemo(() => {
    return lineas
      .filter((l) => l.estado === "POR_DESPACHAR" || l.estado === "PENDIENTE")
      .map((l) => l.producto_id);
  }, [lineas]);

  useEffect(() => {
    if (productoIdsActivos.length === 0) return;
    let activo = true;

    async function refrescar() {
      const mapa = await saldoDisponiblePedido(productoIdsActivos);
      if (activo) setSaldoPorProducto(mapa);
    }

    refrescar(); // fetch inmediato, no esperar el primer intervalo

    let intervalId = setInterval(refrescar, 18000);

    function onVisibility() {
      if (document.hidden) {
        clearInterval(intervalId);
      } else {
        refrescar();
        intervalId = setInterval(refrescar, 18000);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      activo = false;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoIdsActivos.join(",")]);

  if (cargando || !pedido) return (
    <div className="max-w-2xl mx-auto pt-8 text-center text-slate-400">
      <Loader size={16} className="mx-auto animate-spin" />
    </div>
  );

  const lineasCatalogo = lineas.filter((l) => !l.es_personalizado);
  const lineasEspeciales = lineas.filter((l) => l.es_personalizado);

  const puedeDespacharLinea = (l) => l.estado === "POR_DESPACHAR" || (l.estado === "PENDIENTE" && habilitadas.has(l.id));
  const idsDespachables = new Set([
    ...lineasCatalogo.filter(puedeDespacharLinea).map((l) => l.id),
    ...lineasEspeciales.filter((l) => l.estado === "ESPECIAL").map((l) => l.id),
  ]);
  const todasSeleccionadas = idsDespachables.size > 0 && [...idsDespachables].every((id) => seleccion.has(id));

  function toggleSeleccionarTodas() {
    setSeleccion(todasSeleccionadas ? new Set() : new Set(idsDespachables));
  }

  const lineasPorId = new Map(lineas.map((l) => [l.id, l]));
  const totalUnidades = totalUnidadesSeleccion(seleccion, lineasPorId);

  // Mismo criterio que usa rechazar_pedido en el server para decidir qué
  // líneas afecta — visible solo si hay algo que de verdad se rechazaría.
  const TERMINALES_RECHAZO_PEDIDO = new Set(["DESPACHADA", "COMPRADO_DIRECTO", "RECHAZADO"]);
  const hayLineaPendiente = lineas.some((l) => !TERMINALES_RECHAZO_PEDIDO.has(l.estado));

  async function rechazarPedidoCompleto() {
    const motivo = window.prompt("Motivo (opcional) para rechazar TODAS las líneas pendientes de este pedido:");
    if (motivo === null) return;
    setRechazandoPedido(true);
    setFlashRechazo(null);
    const { resultado, error } = await rechazarPedido({ pedidoId: pedido.id, motivo: motivo.trim() || null, usuario: usuarioActual.nombre });
    setRechazandoPedido(false);
    if (error) { setFlashRechazo({ type: "error", msg: "Error: " + error.message }); return; }
    setFlashRechazo({ type: "ok", msg: `${resultado.lineas_rechazadas} línea(s) rechazada(s).` });
    await cargar();
  }

  async function confirmarDespachoLote() {
    const seleccionCatalogo = new Set([...seleccion].filter((id) => !lineasPorId.get(id)?.es_personalizado));
    const seleccionEspeciales = [...seleccion].filter((id) => lineasPorId.get(id)?.es_personalizado);

    const faltantes = lineasConFaltante(seleccionCatalogo, picksPorLinea);
    if (faltantes.length > 0) {
      const ok = window.confirm(
        `${faltantes.length} línea${faltantes.length === 1 ? "" : "s"} quedará${faltantes.length === 1 ? "" : "n"} parcialmente pendiente${faltantes.length === 1 ? "" : "s"} (el pick no cubre lo pendiente). ¿Despachar igual?`
      );
      if (!ok) return;
    }

    const payload = armarPayloadDespacho(seleccionCatalogo, picksPorLinea);
    if (payload.length === 0 && seleccionEspeciales.length === 0) {
      setFlashLote({ type: "error", msg: "Nada para despachar todavía — abrí o dejá calcular el pick de al menos una línea." });
      return;
    }

    setDespachandoLote(true);
    setFlashLote(null);
    try {
      // Una sola llamada para todo el catálogo seleccionado: esto es lo
      // que colapsa las N recargas de un despacho de a una en una sola
      // (brief W5). Atómica en el server: si una línea falla, ninguna
      // queda despachada — el mensaje de error dice cuál.
      if (payload.length > 0) {
        const { error } = await despacharLineas({ lineas: payload, usuario: usuarioActual.nombre });
        if (error) { setFlashLote({ type: "error", msg: "Despacho por lote falló, ninguna línea quedó despachada: " + error.message }); return; }
      }
      // Los especiales no tienen pick — se entregan como cualquier entrega
      // individual, en paralelo (son pocos frente al volumen de catálogo,
      // que es lo que generaba la ráfaga de peticiones).
      if (seleccionEspeciales.length > 0) {
        const resultados = await Promise.all(
          seleccionEspeciales.map((id) => entregarPersonalizado({ lineaId: id, usuario: usuarioActual.nombre }))
        );
        const conError = resultados.find((r) => r.error);
        if (conError) setFlashLote({ type: "error", msg: "El despacho por lote se hizo, pero algunos ítems especiales no se pudieron entregar: " + conError.error.message });
      }
      setSeleccion(new Set());
      setPicksPorLinea(new Map());
      await cargar(); // única recarga completa, al final del lote
    } finally {
      setDespachandoLote(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto pt-4 px-4 pb-8">
      <div className="print:hidden space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-slate-500 hover:text-slate-700"><ArrowLeft size={18} /></button>
          <h1 className="text-lg font-semibold text-slate-800">Pedido #{pedido.id}</h1>
          <BadgePedido estado={pedido.estado} />
          <button onClick={cargar} title="Actualizar (recarga completa)"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Printer size={15} /> Imprimir
          </button>
          {hayLineaPendiente && (
            <button onClick={rechazarPedidoCompleto} disabled={rechazandoPedido}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
              {rechazandoPedido ? <Loader size={14} className="animate-spin" /> : <Ban size={15} />}
              Rechazar pedido
            </button>
          )}
        </div>
        {flashRechazo && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${flashRechazo.type === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {flashRechazo.type === "error" && <AlertTriangle size={14} />} {flashRechazo.msg}
          </div>
        )}
        <p className="text-sm text-slate-500">
          {labelCategoria(pedido.categoria)}
          {pedido.cliente?.nombre && ` · ${pedido.cliente.nombre}`}
          {pedido.referencia && ` · ${pedido.referencia}`} · {fechaFmt(pedido.creado_en)}
        </p>
        {pedido.creado_por && (
          <p className="text-xs text-slate-400">
            {pedido.cotizacion_origen_id
              ? <>Convertido por {nombreAutor(pedido.creado_por, autores)} · desde cotización #{pedido.cotizacion_origen_id}</>
              : <>Creado por {nombreAutor(pedido.creado_por, autores)}</>}
          </p>
        )}

        {pedido.total != null && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 space-y-0.5">
            <p className="flex justify-between"><span>Subtotal</span> <span>{fmtDinero(pedido.subtotal)}</span></p>
            <p className="flex justify-between"><span>Descuento general</span> <span>{fmtDinero(pedido.descuento_general)}</span></p>
            <p className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900"><span>Total</span> <span>{fmtDinero(pedido.total)}</span></p>
          </div>
        )}

        {idsDespachables.size > 0 && (
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={todasSeleccionadas} onChange={toggleSeleccionarTodas} />
            Seleccionar todas las despachables ({idsDespachables.size})
          </label>
        )}

        <div className="space-y-2">
          {lineasCatalogo.map((l) => (
            <FilaLinea
              key={l.id}
              linea={l}
              eventos={eventosPorLinea[l.id]}
              habilitado={habilitadas.has(l.id)}
              categoria={pedido.categoria}
              saldoLibre={saldoPorProducto.get(l.producto_id)}
              codigos={codigosPorProducto.get(l.producto_id)}
              seleccionada={seleccion.has(l.id)}
              onToggleSeleccion={toggleSeleccion}
              onPickChange={onPickChange}
              onLineaPatch={patchLinea}
              onEventoNuevo={agregarEvento}
              onEventoRevertido={marcarEventoRevertido}
              onCambiado={cargar}
            />
          ))}
        </div>

        {lineasEspeciales.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-600">Ítems especiales / a pedido</h2>
            {lineasEspeciales.map((l) => (
              <FilaEspecial
                key={l.id}
                linea={l}
                seleccionada={seleccion.has(l.id)}
                onToggleSeleccion={toggleSeleccion}
                onLineaPatch={patchLinea}
              />
            ))}
          </div>
        )}
      </div>

      {seleccion.size > 0 && (
        <BarraSeleccion
          fixed
          texto={`${seleccion.size} línea${seleccion.size === 1 ? "" : "s"} seleccionada${seleccion.size === 1 ? "" : "s"} · ${cantidadFmt(totalUnidades)} unidades`}
          onCerrar={() => setSeleccion(new Set())}
        >
          {flashLote && (
            <span className={`text-xs ${flashLote.type === "error" ? "text-red-600" : "text-blue-700"}`}>{flashLote.msg}</span>
          )}
          <button onClick={confirmarDespachoLote} disabled={despachandoLote}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
            {despachandoLote && <Loader size={12} className="animate-spin" />}
            <CheckSquare size={13} />
            {despachandoLote ? "Despachando…" : "Despachar seleccionadas"}
          </button>
        </BarraSeleccion>
      )}

      <ReporteImpresionPedido pedido={pedido} lineasCatalogo={lineasCatalogo} lineasEspeciales={lineasEspeciales} codigosPorProducto={codigosPorProducto} desglosePorLinea={desglosePorLinea} />
    </div>
  );
}

/* ── Componente principal ─────────────────────────────────────────────────── */
export default function PedidosApp() {
  const [pantalla, setPantalla] = useState({ tipo: "lista" }); // {tipo:"lista"} | {tipo:"nuevo"}
  const [lineasBorrador, setLineasBorrador] = useState(null);
  const navigate = useNavigate();

  if (pantalla.tipo === "nuevo") {
    return (
      <ArmadorPedido
        lineasIniciales={lineasBorrador}
        onCreado={(id) => { setLineasBorrador(null); setPantalla({ tipo: "lista" }); navigate(`/pedidos/${id}`); }}
        onCancelar={() => setPantalla({ tipo: "lista" })}
      />
    );
  }

  return (
    <ListaPedidos
      onNuevo={() => {
        setLineasBorrador(obtenerBorrador());
        limpiarBorrador();
        setPantalla({ tipo: "nuevo" });
      }}
    />
  );
}
