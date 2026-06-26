import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import {
  Boxes, Package, DollarSign, AlertTriangle, PackageX, Search,
  ArrowUpDown, MapPin, SlidersHorizontal, ImageOff
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function precioFmt(v) {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" }).format(v);
}
function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
function etiquetaUbicacion(zona, estante, nivel) {
  const partes = [zona];
  if (estante && nivel) partes.push(`${estante} ${nivel}`);
  else if (estante) partes.push(estante);
  return partes.join(" › ");
}

function TarjetaResumen({ icono: Icono, etiqueta, valor, sub, acento = "slate" }) {
  const acentos = {
    slate: "text-slate-400",
    emerald: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <Icono size={15} className={acentos[acento]} />
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{etiqueta}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900">{valor}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// ─── ThOrden: columna ordenable — definido fuera para evitar recreación en cada render
function ThOrden({ campo, children, className = "", orden, alternarOrden }) {
  return (
    <th className={`px-3 py-2 text-left ${className}`}>
      <button onClick={() => alternarOrden(campo)}
        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800">
        {children}
        <ArrowUpDown size={11} className={orden.campo === campo ? "text-slate-800" : "text-slate-300"} />
      </button>
    </th>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function InventarioApp() {
  const [resumen, setResumen] = useState(null);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [umbral, setUmbral] = useState(5);
  const [orden, setOrden] = useState({ campo: "producto_nombre", asc: true });
  const [filtroAlerta, setFiltroAlerta] = useState("todos"); // todos | bajo | cero

  // Resumen global (sobre TODO el catálogo, no solo lo filtrado)
  const cargarResumen = useCallback(async () => {
    // Total de productos activos
    const { count: totalProductos } = await supabase
      .from("producto").select("id", { count: "exact", head: true }).eq("activo", true);

    // Stock total por producto (incluye ceros vía la vista)
    const { data: stockPorProducto } = await supabase
      .from("v_producto_stock").select("producto_id, stock_total");

    // Valor total: traemos detalle (solo lo que tiene stock)
    const { data: detalle } = await supabase
      .from("v_inventario_detalle").select("cantidad_base, valor_linea");

    const totalUnidades = (detalle || []).reduce((s, r) => s + Number(r.cantidad_base || 0), 0);
    const valorTotal = (detalle || []).reduce((s, r) => s + Number(r.valor_linea || 0), 0);

    const enCero = (stockPorProducto || []).filter(s => Number(s.stock_total) === 0).length;
    const bajo = (stockPorProducto || []).filter(s => {
      const n = Number(s.stock_total);
      return n > 0 && n <= umbral;
    }).length;

    setResumen({
      totalProductos: totalProductos || 0,
      totalUnidades,
      valorTotal,
      enCero,
      bajo,
    });
  }, [umbral]);

  // Tabla detallada (producto × ubicación con stock)
  const cargarFilas = useCallback(async () => {
    setCargando(true);
    let query = supabase.from("v_inventario_detalle").select("*");
    if (busqueda.trim()) query = query.ilike("producto_nombre", `%${busqueda.trim()}%`);
    query = query.order(orden.campo, { ascending: orden.asc });
    const { data } = await query.limit(1000);
    setFilas(data || []);
    setCargando(false);
  }, [busqueda, orden]);

  useEffect(() => { cargarResumen(); }, [cargarResumen]);
  useEffect(() => {
    const t = setTimeout(cargarFilas, 300);
    return () => clearTimeout(t);
  }, [cargarFilas]);

  function alternarOrden(campo) {
    setOrden(o => o.campo === campo ? { campo, asc: !o.asc } : { campo, asc: true });
  }

  // Aplicar filtro de alerta sobre las filas cargadas
  const filasFiltradas = filas.filter(f => {
    const n = Number(f.cantidad_base);
    if (filtroAlerta === "cero") return n === 0;
    if (filtroAlerta === "bajo") return n > 0 && n <= umbral;
    return true;
  });

  function nivelAlerta(cantidad) {
    const n = Number(cantidad);
    if (n === 0) return "cero";
    if (n <= umbral) return "bajo";
    return "ok";
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Estado de inventario</h1>
          <p className="text-sm text-slate-500">Vista global del stock en el almacén</p>
        </div>
        {/* Ajuste de umbral */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
          <SlidersHorizontal size={14} className="text-slate-400" />
          <label className="text-xs text-slate-500">Stock bajo si ≤</label>
          <input
            type="number" min={0} value={umbral}
            onChange={e => setUmbral(Math.max(0, Number(e.target.value)))}
            className="w-14 rounded border border-slate-300 px-2 py-0.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Resumen */}
      {resumen && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <TarjetaResumen icono={Package} etiqueta="Productos activos"
            valor={resumen.totalProductos} acento="slate" />
          <TarjetaResumen icono={Boxes} etiqueta="Unidades en stock"
            valor={cantidadFmt(resumen.totalUnidades)} acento="emerald" />
          <TarjetaResumen icono={DollarSign} etiqueta="Valor del inventario"
            valor={precioFmt(resumen.valorTotal)} acento="emerald" />
          <TarjetaResumen icono={AlertTriangle} etiqueta="Necesitan atención"
            valor={resumen.enCero + resumen.bajo}
            sub={`${resumen.enCero} en cero · ${resumen.bajo} bajo`}
            acento={resumen.enCero + resumen.bajo > 0 ? "amber" : "slate"} />
        </div>
      )}

      {/* Controles tabla */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar producto…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        {/* Filtros de alerta */}
        <div className="flex rounded-lg border border-slate-300 p-0.5 text-sm">
          {[
            { id: "todos", label: "Todos" },
            { id: "bajo",  label: "Stock bajo" },
            { id: "cero",  label: "En cero" },
          ].map(f => (
            <button key={f.id} onClick={() => setFiltroAlerta(f.id)}
              className={`rounded px-3 py-1.5 font-medium
                ${filtroAlerta === f.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <ThOrden campo="producto_nombre" orden={orden} alternarOrden={alternarOrden}>Producto</ThOrden>
                <ThOrden campo="codigo_zona" orden={orden} alternarOrden={alternarOrden}>Ubicación</ThOrden>
                <ThOrden campo="cantidad_base" className="text-right" orden={orden} alternarOrden={alternarOrden}>Cantidad</ThOrden>
                <ThOrden campo="valor_linea" className="text-right" orden={orden} alternarOrden={alternarOrden}>Valor</ThOrden>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={4} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : filasFiltradas.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-10 text-center text-slate-400">
                  {filas.length === 0
                    ? "Sin stock registrado todavía. Aparecerá al hacer los primeros conteos."
                    : "No hay filas que coincidan con el filtro."}
                </td></tr>
              ) : (
                filasFiltradas.map((f) => {
                  const alerta = nivelAlerta(f.cantidad_base);
                  return (
                    <tr key={`${f.producto_id}-${f.ubicacion_id}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {f.imagen_url
                            ? <img src={f.imagen_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
                            : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100"><ImageOff size={13} className="text-slate-300" /></div>}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800">{f.producto_nombre}</p>
                            {f.sku_interno && <p className="truncate text-xs text-slate-400">{f.sku_interno}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1 text-slate-600">
                          <MapPin size={12} className="text-slate-400" />
                          {etiquetaUbicacion(f.codigo_zona, f.estante, f.nivel)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold
                          ${alerta === "cero" ? "bg-slate-100 text-slate-400"
                            : alerta === "bajo" ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"}`}>
                          {alerta === "cero" && <PackageX size={11} />}
                          {alerta === "bajo" && <AlertTriangle size={11} />}
                          {cantidadFmt(f.cantidad_base)} {f.unidad_base}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-slate-700">
                        {precioFmt(f.valor_linea)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!cargando && filasFiltradas.length > 0 && (
        <p className="mt-3 text-right text-xs text-slate-400">
          {filasFiltradas.length} líneas mostradas
        </p>
      )}
    </div>
  );
}
