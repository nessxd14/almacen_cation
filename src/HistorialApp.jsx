import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import { metaProducto } from "./lib/producto";
import { useSucursal } from "./lib/useSucursal";
import {
  ArrowDownToLine, ArrowUpFromLine, Sliders, ArrowLeftRight, PackagePlus,
  Search, Calendar, User, FileText, MapPin, Filter, History as HistoryIcon, ScanLine
} from "lucide-react";

// ─── Configuración de tipos de movimiento ────────────────────────────────────

const TIPOS = {
  INV_INICIAL: { label: "Inv. inicial", icon: PackagePlus,     color: "violet",  signo: "+" },
  ENTRADA:     { label: "Entrada",      icon: ArrowDownToLine,  color: "emerald", signo: "+" },
  SALIDA:      { label: "Salida",       icon: ArrowUpFromLine,  color: "red",     signo: "-" },
  AJUSTE:      { label: "Ajuste",       icon: Sliders,          color: "amber",   signo: "±" },
  TRASLADO:    { label: "Traslado",     icon: ArrowLeftRight,   color: "blue",    signo: "→" },
};

const COLORES = {
  violet:  "bg-violet-100 text-violet-700",
  emerald: "bg-emerald-100 text-emerald-700",
  red:     "bg-red-100 text-red-700",
  amber:   "bg-amber-100 text-amber-700",
  blue:    "bg-blue-100 text-blue-700",
  slate:   "bg-slate-100 text-slate-500",
};

function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
function fechaFmt(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("es-BO", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
// nombreSucursal (opcional): antepone la sucursal (brief W5 #5) — solo
// tiene sentido cuando la tabla puede mezclar sucursales (panel de
// historial por producto); el tab global ya está filtrado a una sola.
function etiquetaUbicacion(u, nombreSucursal) {
  if (!u) return "—";
  const partes = [u.codigo_zona];
  if (u.estante && u.nivel) partes.push(`${u.estante} ${u.nivel}`);
  else if (u.estante) partes.push(u.estante);
  if (u.compartimiento) partes.push(u.compartimiento);
  const base = partes.join(" › ");
  if (typeof nombreSucursal !== "function" || u.sucursal_id == null) return base;
  const nombre = nombreSucursal(u.sucursal_id);
  return nombre ? `${nombre} · ${base}` : base;
}

// ─── Una fila de movimiento ──────────────────────────────────────────────────

// Card apilada — reemplaza la fila de tabla de 8 columnas (desbordaba en
// anchos normales, forzando scroll horizontal). Fecha+Tipo arriba,
// Producto/Ubicación/Referencia en el cuerpo con wrap libre, Cant./Saldo
// destacados a la derecha (abajo en columna en pantallas chicas).
function FilaMovimiento({ mov, mostrarProducto, nombreSucursal }) {
  const cfg = TIPOS[mov.tipo_movimiento] || { label: mov.tipo_movimiento, icon: FileText, color: "slate", signo: "" };
  const Icono = cfg.icon;
  const cantidad = Number(mov.cantidad);
  const signoColor = cantidad < 0 ? "text-red-600" : cantidad > 0 ? "text-emerald-600" : "text-slate-600";

  return (
    <div className="flex flex-col gap-3 px-3 py-3 hover:bg-slate-50 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${COLORES[cfg.color]}`}>
            <Icono size={11} /> {cfg.label}
          </span>
          {mov.esVentaDirecta && (
            <span className="inline-flex items-center rounded-full bg-pink-100 px-2 py-0.5 text-xs font-semibold text-pink-700">
              VTD
            </span>
          )}
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Calendar size={11} className="text-slate-400" />
            {fechaFmt(mov.creado_en)}
          </span>
        </div>

        {mostrarProducto && (
          <div>
            <p className="text-sm font-medium text-slate-800">{mov.producto?.nombre || `#${mov.producto_id}`}</p>
            {metaProducto(mov.producto) && (
              <p className="text-xs text-slate-500">{metaProducto(mov.producto)}</p>
            )}
          </div>
        )}

        <p className="flex items-center gap-1 text-sm text-slate-600">
          <MapPin size={12} className="shrink-0 text-slate-400" />
          {etiquetaUbicacion(mov.ubicacion, nombreSucursal)}
        </p>

        {(mov.referencia || mov.motivo) && (
          <div className="text-sm text-slate-600">
            {mov.referencia && <p>{mov.referencia}</p>}
            {mov.motivo && <p className="text-xs text-slate-400">{mov.motivo}</p>}
          </div>
        )}

        <p className="flex items-center gap-1 text-xs text-slate-500">
          <User size={11} className="text-slate-400" />
          {mov.creado_por || "—"}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-5 sm:flex-col sm:items-end sm:gap-1.5">
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cant.</p>
          <p className={`text-base font-bold leading-tight ${signoColor}`}>
            {cantidad > 0 ? "+" : ""}{cantidadFmt(cantidad)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Saldo</p>
          <p className={`text-sm font-medium leading-tight ${
            mov.saldo_base == null ? "text-slate-400" : Number(mov.saldo_base) < 0 ? "text-red-600" : "text-slate-700"
          }`}>
            {mov.saldo_base == null ? "—" : cantidadFmt(mov.saldo_base)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Componente reutilizable de historial ────────────────────────────────────
// Si recibe productoId -> historial de ese producto (modo panel).
// Si no -> historial global con buscador (modo tab).

export function HistorialMovimientos({ productoId = null, compacto = false }) {
  const { sucursalActivaId, nombreSucursal } = useSucursal();
  const [movs, setMovs] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [showScanner, setShowScanner] = useState(false);

  const handleScan = useCallback(async (codigo) => {
    setShowScanner(false);
    // eslint-disable-next-line no-control-regex
    const code = (codigo || "").trim().replace(/[\x00-\x1F\x7F]/g, "");
    if (!code) return;
    const { data, error } = await supabase.rpc("resolver_identificador", { p_codigo: code });
    if (error) { console.error("resolver_identificador:", error); return; }
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    if (rows.length === 0) return;
    const { data: pres } = await supabase
      .from("presentacion")
      .select("producto:producto_id(nombre)")
      .eq("id", rows[0].presentacion_id)
      .single();
    if (pres?.producto?.nombre) setBusqueda(pres.producto.nombre);
  }, []);

  const cargar = useCallback(async () => {
    // El panel por producto (dentro de Catálogo) muestra su historial
    // completo a propósito, incluso entre sucursales — el tab global sí
    // se filtra por sucursal activa, es la pantalla que hoy es ciega a ella.
    if (!productoId && !sucursalActivaId) return;
    setCargando(true);
    let query = supabase
      .from("kardex_transacciones")
      .select(`
        id, producto_id, cantidad, tipo_movimiento, referencia, motivo,
        fecha_efectiva, creado_por, creado_en, traslado_grupo_id,
        producto:producto_id(nombre, sku_interno, marca),
        ubicacion:ubicacion_id!inner(codigo_zona, estante, nivel, compartimiento, sucursal_id)
      `)
      .order("creado_en", { ascending: false })
      .limit(500);

    if (productoId) query = query.eq("producto_id", productoId);
    if (filtroTipo) query = query.eq("tipo_movimiento", filtroTipo);
    if (!productoId) query = query.eq("ubicacion.sucursal_id", sucursalActivaId);

    const { data } = await query;
    let lista = data || [];

    // Búsqueda por nombre de producto (modo global)
    if (!productoId && busqueda.trim()) {
      const q = busqueda.trim().toLowerCase();
      lista = lista.filter(m =>
        m.producto?.nombre?.toLowerCase().includes(q) ||
        m.producto?.sku_interno?.toLowerCase().includes(q) ||
        m.producto?.marca?.toLowerCase().includes(q) ||
        m.referencia?.toLowerCase().includes(q)
      );
    }

    // Saldo acumulado por producto+ubicación: ya calculado en v_kardex_movimientos,
    // se pinta tal cual (sin recalcular en el front).
    if (lista.length > 0) {
      const ids = lista.map(m => m.id);
      const { data: saldos } = await supabase
        .from("v_kardex_movimientos")
        .select("id, saldo_base")
        .in("id", ids);
      const mapaSaldo = new Map((saldos || []).map(s => [s.id, s.saldo_base]));
      for (const m of lista) m.saldo_base = mapaSaldo.get(m.id) ?? null;
    }

    // Venta Directa vs. venta normal de Seller: ambas llegan al Kardex como
    // SALIDA / "Venta #<id>" indistinguibles — solo venta.numero (prefijo
    // VTD-, asignado por abrir_venta) las distingue. Una sola consulta
    // batch acá, puramente para el chip visual — no toca el resto del pipeline.
    const idsVenta = lista
      .map(m => m.referencia?.match(/^Venta #(\d+)$/)?.[1])
      .filter(Boolean)
      .map(Number);
    if (idsVenta.length > 0) {
      const { data: ventas } = await supabase
        .from("venta")
        .select("id, numero")
        .in("id", [...new Set(idsVenta)]);
      const vtdIds = new Set((ventas || []).filter(v => v.numero?.startsWith("VTD-")).map(v => v.id));
      for (const m of lista) {
        const id = Number(m.referencia?.match(/^Venta #(\d+)$/)?.[1]);
        m.esVentaDirecta = vtdIds.has(id);
      }
    }

    setMovs(lista);
    setCargando(false);
  }, [productoId, filtroTipo, busqueda, sucursalActivaId]);

  useEffect(() => {
    const t = setTimeout(cargar, busqueda ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, busqueda]);

  return (
    <div>
      {showScanner && <EscanerCodigo onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      {/* Controles (solo en modo global) */}
      {!productoId && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleScan(e.target.value); } }}
              placeholder="Buscar por producto, SKU, referencia o código de barras…"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <button onClick={() => setShowScanner(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <ScanLine size={15} /> Escanear
          </button>
          <div className="relative">
            <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={filtroTipo}
              onChange={e => setFiltroTipo(e.target.value)}
              className="rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-slate-500 focus:outline-none">
              <option value="">Todos los tipos</option>
              {Object.entries(TIPOS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Filtro de tipo en modo panel (compacto) */}
      {productoId && (
        <div className="mb-3 flex flex-wrap gap-1">
          <button onClick={() => setFiltroTipo("")}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${filtroTipo === "" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
            Todos
          </button>
          {Object.entries(TIPOS).map(([k, v]) => (
            <button key={k} onClick={() => setFiltroTipo(k)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${filtroTipo === k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
              {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Movimientos — cards apiladas, sin scroll horizontal a ningún ancho */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {cargando ? (
          <p className="px-3 py-10 text-center text-slate-400">Cargando…</p>
        ) : movs.length === 0 ? (
          <div className="px-3 py-10 text-center text-slate-400">
            <HistoryIcon size={28} className="mx-auto mb-2 text-slate-300" />
            Sin movimientos registrados todavía.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {movs.map(m => (
              <FilaMovimiento key={m.id} mov={m} mostrarProducto={!productoId} nombreSucursal={productoId ? nombreSucursal : undefined} />
            ))}
          </div>
        )}
      </div>

      {!cargando && movs.length > 0 && (
        <p className="mt-3 text-right text-xs text-slate-400">
          {movs.length} movimientos{movs.length === 500 ? " (máximo mostrado)" : ""}
        </p>
      )}
    </div>
  );
}

// ─── Wrapper para usar como tab independiente ────────────────────────────────

export default function HistorialApp() {
  const { sucursalActivaId, nombreSucursal } = useSucursal();
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-slate-800">Historial de movimientos</h1>
        <p className="text-sm text-slate-500">
          Registro del Kardex en {nombreSucursal(sucursalActivaId) || "…"} — entradas, salidas, ajustes y traslados
        </p>
      </div>
      <HistorialMovimientos />
    </div>
  );
}
