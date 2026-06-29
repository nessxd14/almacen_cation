import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import {
  ArrowDownToLine, ArrowUpFromLine, Sliders, ArrowLeftRight, PackagePlus,
  Search, Calendar, User, FileText, MapPin, Filter, History as HistoryIcon
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
function etiquetaUbicacion(u) {
  if (!u) return "—";
  const partes = [u.codigo_zona];
  if (u.estante && u.nivel) partes.push(`${u.estante} ${u.nivel}`);
  else if (u.estante) partes.push(u.estante);
  if (u.compartimiento) partes.push(u.compartimiento);
  return partes.join(" › ");
}

// ─── Una fila de movimiento ──────────────────────────────────────────────────

function FilaMovimiento({ mov, mostrarProducto }) {
  const cfg = TIPOS[mov.tipo_movimiento] || { label: mov.tipo_movimiento, icon: FileText, color: "slate", signo: "" };
  const Icono = cfg.icon;
  const cantidad = Number(mov.cantidad);
  const signoColor = cantidad < 0 ? "text-red-600" : cantidad > 0 ? "text-emerald-600" : "text-slate-600";

  return (
    <tr className="hover:bg-slate-50">
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <Calendar size={11} className="text-slate-400" />
          {fechaFmt(mov.creado_en)}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${COLORES[cfg.color]}`}>
          <Icono size={11} /> {cfg.label}
        </span>
      </td>
      {mostrarProducto && (
        <td className="px-3 py-2.5">
          <p className="truncate text-sm font-medium text-slate-800">{mov.producto?.nombre || `#${mov.producto_id}`}</p>
          {mov.producto?.sku_interno && <p className="text-xs text-slate-400">{mov.producto.sku_interno}</p>}
        </td>
      )}
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-1 text-sm text-slate-600">
          <MapPin size={12} className="text-slate-400" />
          {etiquetaUbicacion(mov.ubicacion)}
        </span>
      </td>
      <td className={`px-3 py-2.5 text-right text-sm font-bold ${signoColor}`}>
        {cantidad > 0 ? "+" : ""}{cantidadFmt(cantidad)}
      </td>
      <td className="px-3 py-2.5 text-sm text-slate-600">
        <div className="max-w-xs">
          <p className="truncate">{mov.referencia}</p>
          {mov.motivo && <p className="truncate text-xs text-slate-400">{mov.motivo}</p>}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <User size={11} className="text-slate-400" />
          {mov.creado_por || "—"}
        </span>
      </td>
    </tr>
  );
}

// ─── Componente reutilizable de historial ────────────────────────────────────
// Si recibe productoId -> historial de ese producto (modo panel).
// Si no -> historial global con buscador (modo tab).

export function HistorialMovimientos({ productoId = null, compacto = false }) {
  const [movs, setMovs] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    let query = supabase
      .from("kardex_transacciones")
      .select(`
        id, producto_id, cantidad, tipo_movimiento, referencia, motivo,
        fecha_efectiva, creado_por, creado_en, traslado_grupo_id,
        producto:producto_id(nombre, sku_interno),
        ubicacion:ubicacion_id(codigo_zona, estante, nivel, compartimiento)
      `)
      .order("creado_en", { ascending: false })
      .limit(500);

    if (productoId) query = query.eq("producto_id", productoId);
    if (filtroTipo) query = query.eq("tipo_movimiento", filtroTipo);

    const { data } = await query;
    let lista = data || [];

    // Búsqueda por nombre de producto (modo global)
    if (!productoId && busqueda.trim()) {
      const q = busqueda.trim().toLowerCase();
      lista = lista.filter(m =>
        m.producto?.nombre?.toLowerCase().includes(q) ||
        m.producto?.sku_interno?.toLowerCase().includes(q) ||
        m.referencia?.toLowerCase().includes(q)
      );
    }

    setMovs(lista);
    setCargando(false);
  }, [productoId, filtroTipo, busqueda]);

  useEffect(() => {
    const t = setTimeout(cargar, busqueda ? 300 : 0);
    return () => clearTimeout(t);
  }, [cargar, busqueda]);

  return (
    <div>
      {/* Controles (solo en modo global) */}
      {!productoId && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por producto, SKU o referencia…"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
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

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Tipo</th>
                {!productoId && <th className="px-3 py-2">Producto</th>}
                <th className="px-3 py-2">Ubicación</th>
                <th className="px-3 py-2 text-right">Cant.</th>
                <th className="px-3 py-2">Referencia</th>
                <th className="px-3 py-2">Usuario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={productoId ? 6 : 7} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : movs.length === 0 ? (
                <tr><td colSpan={productoId ? 6 : 7} className="px-3 py-10 text-center text-slate-400">
                  <HistoryIcon size={28} className="mx-auto mb-2 text-slate-300" />
                  Sin movimientos registrados todavía.
                </td></tr>
              ) : (
                movs.map(m => (
                  <FilaMovimiento key={m.id} mov={m} mostrarProducto={!productoId} />
                ))
              )}
            </tbody>
          </table>
        </div>
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
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-slate-800">Historial de movimientos</h1>
        <p className="text-sm text-slate-500">Registro completo del Kardex — entradas, salidas, ajustes y traslados</p>
      </div>
      <HistorialMovimientos />
    </div>
  );
}
