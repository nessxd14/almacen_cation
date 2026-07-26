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
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import TypeaheadProducto from "./TypeaheadProducto";
import {
  ubicacionesParaOperacion, calcularPick, desglosePresentaciones,
  crearPedido, despacharLinea, revertirEvento, comprarDirecto,
  entregarPersonalizado, estadoSaldoLinea, saldoDisponiblePedido,
} from "./lib/operaciones";
import { obtenerBorrador, limpiarBorrador } from "./lib/pedidoBorrador";
import { useUsuarioActual } from "./lib/useAuth";
import {
  ClipboardList, Plus, ChevronDown, ChevronUp, MapPin, Undo2,
  AlertTriangle, Loader, ArrowLeft, X, ScanLine,
  ShoppingBag, Clock, Boxes, Printer,
} from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────────────── */
function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
// Texto informativo "≈ N paquetes de M" a partir de una cantidad en unidad
// base y la presentación de bulto del producto (si tiene una) — no editable,
// no afecta lo que se envía al backend (que siempre viaja en unidad base).
function textoAproxBulto(cantidadBaseStr, presentacionBulto) {
  if (!presentacionBulto || !cantidadBaseStr) return null;
  const n = Number(cantidadBaseStr);
  const factor = Number(presentacionBulto.factor_unidad_base);
  if (!n || n <= 0 || !factor) return null;
  const contenedor = (presentacionBulto.nombre.split(" ")[0] || "paquete").toLowerCase();
  const paquetes = n / factor;
  return `≈ ${cantidadFmt(paquetes)} ${contenedor}${paquetes === 1 ? "" : "s"} de ${cantidadFmt(factor)}`;
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

// Las 4 categorías comerciales (el POS crea MAYOR/TIENDA/INSTITUCIONAL/
// MUNICIPAL; ArmadorPedido, que solo crea pedidos de stock sin datos
// comerciales, sigue ofreciendo nada más MAYOR/TIENDA arriba).
const CATEGORIA_LABELS = {
  MAYOR:         "Mayoreo",
  TIENDA:        "Tienda directa",
  INSTITUCIONAL: "Institucional",
  MUNICIPAL:     "Municipal",
};
function labelCategoria(categoria) {
  return CATEGORIA_LABELS[categoria] || categoria;
}

const SUCURSAL_LABELS = { 1: "Almacén", 2: "Tienda" };
function labelSucursal(id) {
  return id != null ? (SUCURSAL_LABELS[id] || `Sucursal ${id}`) : null;
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
function ListaPedidos({ onSeleccionar, onNuevo }) {
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroCategoria, setFiltroCategoria] = useState("TODAS");

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
            <button key={p.id} onClick={() => onSeleccionar(p.id)}
              className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50">
              <span className="font-mono text-xs text-slate-400">#{p.id}</span>
              <span className="text-sm font-medium text-slate-800">{labelCategoria(p.categoria)}</span>
              <span className="flex-1 truncate text-sm text-slate-500">{p.cliente?.nombre || p.referencia || "—"}</span>
              <span className="text-xs text-slate-400">{fechaFmt(p.creado_en)}</span>
              <BadgePedido estado={p.estado} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Armador de pedido ─────────────────────────────────────────────────── */
function ArmadorPedido({ lineasIniciales, onCreado, onCancelar }) {
  const usuarioActual = useUsuarioActual();
  const [categoria, setCategoria] = useState("");
  const [referencia, setReferencia] = useState("");
  const [lineas, setLineas] = useState(lineasIniciales || []);
  const [query, setQuery] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [flash, setFlash] = useState(null);
  const [creando, setCreando] = useState(false);
  // producto_id -> {nombre, factor_unidad_base} | null — presentación de
  // bulto de cada línea, solo para el texto informativo (Parte B).
  const [bultoPorProducto, setBultoPorProducto] = useState({});

  // Líneas que ya vienen precargadas (borrador desde Catálogo) no pasan por
  // agregarProducto — se resuelve su presentación de bulto acá, una vez.
  useEffect(() => {
    const ids = (lineasIniciales || []).map((l) => l.producto_id);
    if (ids.length === 0) return;
    supabase.from("presentacion")
      .select("producto_id, nombre, factor_unidad_base")
      .in("producto_id", ids)
      .eq("es_base", false)
      .then(({ data }) => {
        setBultoPorProducto((prev) => {
          const next = { ...prev };
          for (const id of ids) if (!(id in next)) next[id] = null;
          for (const row of data || []) next[row.producto_id] = row;
          return next;
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showFlash = (msg, type = "error") => { setFlash({ msg, type }); setTimeout(() => setFlash(null), 3000); };

  const agregarProducto = useCallback(async (p) => {
    setLineas((prev) => {
      const existente = prev.find((l) => l.producto_id === p.id);
      if (existente) {
        return prev.map((l) => l.producto_id === p.id ? { ...l, cantidad_base: Number(l.cantidad_base) + 1 } : l);
      }
      return [...prev, { producto_id: p.id, nombre: p.nombre, sku_interno: p.sku_interno, unidad_base: p.unidad_base, cantidad_base: 1 }];
    });
    if (!(p.id in bultoPorProducto)) {
      const { data } = await supabase
        .from("presentacion")
        .select("nombre, factor_unidad_base")
        .eq("producto_id", p.id)
        .eq("es_base", false)
        .limit(1)
        .maybeSingle();
      setBultoPorProducto((prev) => ({ ...prev, [p.id]: data || null }));
    }
  }, [bultoPorProducto]);

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
    setLineas((prev) => prev.map((l) => l.producto_id === productoId ? { ...l, cantidad_base: valor } : l));
  }
  function quitarLinea(productoId) {
    setLineas((prev) => prev.filter((l) => l.producto_id !== productoId));
  }

  async function crear() {
    if (!categoria) { showFlash("Selecciona la categoría del pedido"); return; }
    if (lineas.length === 0) { showFlash("Agrega al menos un producto"); return; }
    for (const l of lineas) {
      if (!l.cantidad_base || Number(l.cantidad_base) <= 0) {
        showFlash(`Cantidad inválida para ${l.nombre}`); return;
      }
    }

    setCreando(true);
    const { id, error } = await crearPedido({
      categoria,
      referencia: referencia.trim() || null,
      lineas: lineas.map((l) => ({ producto_id: l.producto_id, cantidad_base: Number(l.cantidad_base) })),
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
            {lineas.map((l) => (
              <div key={l.producto_id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p title={l.nombre} className="line-clamp-2 text-sm font-medium text-slate-800">{l.nombre}</p>
                  {l.sku_interno && <p className="text-xs text-slate-400">{l.sku_interno}</p>}
                  {textoAproxBulto(l.cantidad_base, bultoPorProducto[l.producto_id]) && (
                    <p className="text-xs text-slate-400">{textoAproxBulto(l.cantidad_base, bultoPorProducto[l.producto_id])}</p>
                  )}
                </div>
                <input type="number" min="0.001" step="any" value={l.cantidad_base}
                  onChange={(e) => actualizarCantidad(l.producto_id, e.target.value)}
                  className="w-20 rounded-lg border px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <span className="text-xs text-slate-400">{l.unidad_base}</span>
                <button onClick={() => quitarLinea(l.producto_id)} className="text-slate-300 hover:text-red-500">
                  <X size={16} />
                </button>
              </div>
            ))}
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

/* ── Fila de línea (expandible: pick auto editable + acciones) ──────────── */
function FilaLinea({ linea, eventos, habilitado, categoria, onRefrescar, saldoLibre }) {
  const usuarioActual = useUsuarioActual();
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

  const pendiente = Math.max(Number(linea.cantidad_base) - Number(linea.cantidad_despachada), 0);
  const puedeDespachar = linea.estado === "POR_DESPACHAR" || (linea.estado === "PENDIENTE" && habilitado);

  const showFlash = (msg, type = "error") => { setFlash({ msg, type }); setTimeout(() => setFlash(null), 3000); };

  // recalcular pick auto al expandir
  useEffect(() => {
    if (!abierto || !puedeDespachar) return;
    let activo = true;
    setCargandoPick(true);
    Promise.all([
      calcularPick({ productoId: linea.producto_id, cantidadBase: pendiente, sucursalPreferidaId: linea.sucursal_origen_id }),
      desglosePresentaciones({ productoId: linea.producto_id, cantidadBase: pendiente }),
      ubicacionesParaOperacion({ productoId: linea.producto_id, modo: "SALIDA", sucursalPreferidaId: linea.sucursal_origen_id }),
    ]).then(([pick, desg, ubs]) => {
      if (!activo) return;
      setAsignaciones(pick.asignaciones);
      setDesglose(desg);
      setUbicacionesDisponibles(ubs.ubicaciones);
      setCargandoPick(false);
    });
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, linea.id]);

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

  async function confirmarDespacho() {
    const filtradas = asignaciones.filter((a) => Number(a.cantidad_base) > 0);
    if (filtradas.length === 0) { showFlash("Asigná una cantidad mayor a cero en al menos una ubicación"); return; }
    if (totalAsignado > pendiente + 0.0001) { showFlash(`El total asignado (${totalAsignado}) excede lo pendiente (${pendiente})`); return; }

    setDespachando(true);
    const { error } = await despacharLinea({ lineaId: linea.id, asignaciones: filtradas, usuario: usuarioActual.nombre });
    setDespachando(false);
    if (error) { showFlash("Error: " + error.message); return; }
    setAbierto(false);
    onRefrescar();
  }

  async function confirmarCompraDirecta() {
    if (!nota.trim()) { showFlash("La nota es obligatoria"); return; }
    setGuardandoCompra(true);
    const { error } = await comprarDirecto({ lineaId: linea.id, nota: nota.trim(), costo: costo ? Number(costo) : null, usuario: usuarioActual.nombre });
    setGuardandoCompra(false);
    if (error) { showFlash("Error: " + error.message); return; }
    setMostrarComprado(false);
    onRefrescar();
  }

  async function revertir(eventoId, montoParcial) {
    const { error } = await revertirEvento({ eventoId, cantidadBase: montoParcial ?? null, usuario: usuarioActual.nombre });
    if (error) { showFlash("Error al revertir: " + error.message); return; }
    onRefrescar();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {abierto ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p title={linea.producto?.nombre} className="line-clamp-2 text-sm font-medium text-slate-800">{linea.producto?.nombre}</p>
          {linea.producto?.sku_interno && <p className="text-xs text-slate-400">{linea.producto.sku_interno}</p>}
          {linea.sucursal_origen_id != null && (
            <p className="text-xs text-slate-400">Origen: {labelSucursal(linea.sucursal_origen_id)}</p>
          )}
        </div>
        <span className="text-sm font-mono text-slate-600">{cantidadFmt(linea.cantidad_base)} {linea.producto?.unidad_base}</span>
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
                    {totalAsignado < pendiente && " — el resto quedará pendiente"}
                  </p>

                  {desglose?.desglose?.length > 0 && (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <p className="mb-1 font-medium text-slate-500">Desglose de presentaciones (informativo):</p>
                      <p>
                        {desglose.desglose.map((d) => `${d.cantidad} ${d.nombre}`).join(" + ")}
                        {desglose.restante > 0 && ` + ${cantidadFmt(desglose.restante)} sueltas`}
                      </p>
                    </div>
                  )}

                  <button onClick={confirmarDespacho} disabled={despachando}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                    {despachando && <Loader size={14} className="animate-spin" />}
                    {despachando ? "Despachando…" : linea.estado === "PENDIENTE" ? "Despachar pendiente" : "Despachar"}
                  </button>
                </>
              )}
            </div>
          )}

          {linea.estado === "PENDIENTE" && !habilitado && (
            <p className="flex items-center gap-1 text-xs text-slate-400">
              <Boxes size={12} /> Sin stock nuevo todavía — se habilita cuando llegue una ENTRADA de este producto.
            </p>
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
        </div>
      )}
    </div>
  );
}

/* ── Fila de ítem especial/personalizado — no pasa por FilaLinea (no hay
   pick ni Kardex): solo "marcar entregado" cierra la línea. */
function FilaEspecial({ linea, onRefrescar }) {
  const usuarioActual = useUsuarioActual();
  const [entregando, setEntregando] = useState(false);
  const [flash, setFlash] = useState(null);

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 3000); };

  async function marcarEntregado() {
    if (!window.confirm("¿Confirmar entrega de este ítem especial? Esta acción cierra la línea.")) return;
    setEntregando(true);
    const { error } = await entregarPersonalizado({ lineaId: linea.id, usuario: usuarioActual.nombre });
    setEntregando(false);
    if (error) { showFlash("Error: " + error.message); return; }
    onRefrescar();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2">
      {flash && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={12} /> {flash}
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">{linea.descripcion || linea.producto?.nombre || "Ítem especial"}</p>
          {linea.nota && <p className="text-xs text-slate-500">{linea.nota}</p>}
        </div>
        <span className="text-sm font-mono text-slate-600">{cantidadFmt(linea.cantidad_base)} {linea.producto?.unidad_base || ""}</span>
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
function ReporteImpresionPedido({ pedido, lineasCatalogo, lineasEspeciales }) {
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
            return (
              <tr key={l.id} className="break-inside-avoid border-b border-slate-300 align-top">
                <td className="py-2 pr-3">
                  <p className="font-medium text-slate-900">{l.producto?.nombre}</p>
                  {l.producto?.sku_interno && <p className="text-xs text-slate-500">{l.producto.sku_interno}</p>}
                </td>
                <td className="whitespace-nowrap py-2 pr-3">
                  {cantidadFmt(l.cantidad_base)} {l.producto?.unidad_base}
                  {l.estado === "PENDIENTE" && (
                    <p className="text-xs text-slate-500">
                      {cantidadFmt(l.cantidad_despachada)} despachado, {cantidadFmt(pendiente)} pendiente
                    </p>
                  )}
                </td>
                <td className="py-2 pr-3">{labelSucursal(l.sucursal_origen_id) || "—"}</td>
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
                  <td className="py-2 pr-3 font-medium text-slate-900">{l.descripcion || l.producto?.nombre}</td>
                  <td className="py-2 pr-3">{cantidadFmt(l.cantidad_base)} {l.producto?.unidad_base || ""}</td>
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
function DetallePedido({ pedidoId, onBack }) {
  const [pedido, setPedido] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [eventosPorLinea, setEventosPorLinea] = useState({});
  const [habilitadas, setHabilitadas] = useState(new Set());
  const [cargando, setCargando] = useState(true);
  const [saldoPorProducto, setSaldoPorProducto] = useState(new Map());

  const cargar = useCallback(async () => {
    setCargando(true);
    const [{ data: p }, { data: ls }] = await Promise.all([
      supabase.from("pedido")
        .select("*, cliente:cliente_id ( nombre, tipo_precio )")
        .eq("id", pedidoId).single(),
      supabase.from("pedido_linea")
        .select("*, producto:producto_id(id, nombre, sku_interno, unidad_base)")
        .eq("pedido_id", pedidoId)
        .order("id"),
    ]);
    const lineaIds = (ls || []).map((l) => l.id);
    const [{ data: eventos }, { data: hab }] = await Promise.all([
      lineaIds.length
        ? supabase.from("pedido_despacho_evento").select("*").in("pedido_linea_id", lineaIds).order("id", { ascending: false })
        : Promise.resolve({ data: [] }),
      lineaIds.length
        ? supabase.from("v_pedido_linea_despachable").select("id").in("id", lineaIds)
        : Promise.resolve({ data: [] }),
    ]);
    const grupo = {};
    for (const e of eventos || []) (grupo[e.pedido_linea_id] ||= []).push(e);

    setPedido(p);
    setLineas(ls || []);
    setEventosPorLinea(grupo);
    setHabilitadas(new Set((hab || []).map((h) => h.id)));
    setCargando(false);
  }, [pedidoId]);

  useEffect(() => { cargar(); }, [cargar]);

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

  return (
    <div className="max-w-2xl mx-auto pt-4 px-4 pb-8">
      <div className="print:hidden space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-slate-500 hover:text-slate-700"><ArrowLeft size={18} /></button>
          <h1 className="text-lg font-semibold text-slate-800">Pedido #{pedido.id}</h1>
          <BadgePedido estado={pedido.estado} />
          <button onClick={() => window.print()}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Printer size={15} /> Imprimir
          </button>
        </div>
        <p className="text-sm text-slate-500">
          {labelCategoria(pedido.categoria)}
          {pedido.cliente?.nombre && ` · ${pedido.cliente.nombre}`}
          {pedido.referencia && ` · ${pedido.referencia}`} · {fechaFmt(pedido.creado_en)}
        </p>

        {pedido.total != null && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 space-y-0.5">
            <p className="flex justify-between"><span>Subtotal</span> <span>{fmtDinero(pedido.subtotal)}</span></p>
            <p className="flex justify-between"><span>Descuento general</span> <span>{fmtDinero(pedido.descuento_general)}</span></p>
            <p className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900"><span>Total</span> <span>{fmtDinero(pedido.total)}</span></p>
          </div>
        )}

        <div className="space-y-2">
          {lineasCatalogo.map((l) => (
            <FilaLinea
              key={l.id}
              linea={l}
              eventos={eventosPorLinea[l.id]}
              habilitado={habilitadas.has(l.id)}
              categoria={pedido.categoria}
              onRefrescar={cargar}
              saldoLibre={saldoPorProducto.get(l.producto_id)}
            />
          ))}
        </div>

        {lineasEspeciales.length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-600">Ítems especiales / a pedido</h2>
            {lineasEspeciales.map((l) => (
              <FilaEspecial key={l.id} linea={l} onRefrescar={cargar} />
            ))}
          </div>
        )}
      </div>

      <ReporteImpresionPedido pedido={pedido} lineasCatalogo={lineasCatalogo} lineasEspeciales={lineasEspeciales} />
    </div>
  );
}

/* ── Componente principal ─────────────────────────────────────────────────── */
export default function PedidosApp() {
  const [pantalla, setPantalla] = useState({ tipo: "lista" }); // {tipo:"lista"} | {tipo:"nuevo"} | {tipo:"detalle", id}
  const [lineasBorrador, setLineasBorrador] = useState(null);

  if (pantalla.tipo === "nuevo") {
    return (
      <ArmadorPedido
        lineasIniciales={lineasBorrador}
        onCreado={(id) => { setLineasBorrador(null); setPantalla({ tipo: "detalle", id }); }}
        onCancelar={() => setPantalla({ tipo: "lista" })}
      />
    );
  }

  if (pantalla.tipo === "detalle") {
    return <DetallePedido pedidoId={pantalla.id} onBack={() => setPantalla({ tipo: "lista" })} />;
  }

  return (
    <ListaPedidos
      onSeleccionar={(id) => setPantalla({ tipo: "detalle", id })}
      onNuevo={() => {
        setLineasBorrador(obtenerBorrador());
        limpiarBorrador();
        setPantalla({ tipo: "nuevo" });
      }}
    />
  );
}
