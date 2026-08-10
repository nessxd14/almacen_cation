/**
 * SurtidoApp.jsx — Brief W3 #4: "¿qué se maneja en esta sucursal?"
 *
 * Dos preguntas separadas por producto×sucursal (producto_sucursal):
 *   se_vende      -> surtido (¿se maneja acá?)
 *   control_stock -> confiabilidad del stock (null = hereda el default de
 *                    la sucursal, ver sucursal.control_stock_default)
 *
 * Tienda se sembró con TODO el catálogo activo a propósito (para que el
 * POS no rechace ventas en el mostrador) — la poda es un trabajo masivo
 * posterior, no una edición fila por fila. Por eso hay selección múltiple
 * y acciones en lote, no solo un toggle por fila.
 *
 * Catálogo activo (~1.500 productos) se trae completo con fetchAll, mismo
 * criterio que W2 fijó para InventarioApp a esta escala — filtro, búsqueda
 * y paginado quedan del lado del cliente.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient";
import { fetchAll } from "./lib/fetchAll";
import { useSucursal } from "./lib/useSucursal";
import { sanearFiltro } from "./lib/filtroTexto";
import { controlEfectivo } from "./lib/control";
import {
  Tags, Search, Check, X, AlertTriangle, Lock, Unlock, ChevronLeft, ChevronRight,
} from "lucide-react";

const PAGE_SIZE = 50;

function Toast({ msg, tipo = "ok", onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg
      ${tipo === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
      {tipo === "ok" ? <Check size={16} /> : <AlertTriangle size={16} />}
      {msg}
    </div>
  );
}

function ChipControl({ valor }) {
  if (valor === "ESTRICTO") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <Lock size={10} /> estricto
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
      <Unlock size={10} /> libre
    </span>
  );
}

export default function SurtidoApp() {
  const { sucursalActivaId, sucursalActiva, nombreSucursal } = useSucursal();
  const [productos, setProductos] = useState([]);
  const [mapaPs, setMapaPs] = useState(new Map()); // producto_id -> fila de producto_sucursal (o undefined si nunca se creó)
  const [cargando, setCargando] = useState(true);
  const [busquedaInput, setBusquedaInput] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState("todos"); // todos | en | fuera
  const [pagina, setPagina] = useState(0);
  const [seleccion, setSeleccion] = useState(new Set());
  const [guardandoLote, setGuardandoLote] = useState(false);
  const [toast, setToast] = useState(null);
  const [forzando, setForzando] = useState(null); // producto_id en edición de control

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(sanearFiltro(busquedaInput)), 300);
    return () => clearTimeout(t);
  }, [busquedaInput]);

  const cargar = useCallback(async () => {
    if (!sucursalActivaId) return;
    setCargando(true);
    try {
      const [prods, ps] = await Promise.all([
        fetchAll(() => supabase.from("producto").select("id, nombre, sku_interno, marca").eq("activo", true).order("nombre")),
        fetchAll(() => supabase.from("producto_sucursal")
          .select("producto_id, se_vende, control_stock, stock_min, punto_reorden, inventariado_en, inventariado_por")
          .eq("sucursal_id", sucursalActivaId)),
      ]);
      setProductos(prods);
      setMapaPs(new Map(ps.map((p) => [p.producto_id, p])));
    } catch (e) {
      console.error("cargar surtido falló:", e);
      setToast({ msg: "No se pudo cargar el surtido", tipo: "error" });
    } finally {
      setCargando(false);
    }
  }, [sucursalActivaId]);

  useEffect(() => {
    // Sincroniza con Supabase (sistema externo), no deriva estado de React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
  }, [cargar]);
  useEffect(() => {
    // Reinicia la selección/página al cambiar de filtro — no deriva estado.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPagina(0);
    setSeleccion(new Set());
  }, [busqueda, filtro, sucursalActivaId]);

  const filas = useMemo(() => {
    const texto = busqueda.toLowerCase();
    return productos
      .filter((p) => !texto || p.nombre.toLowerCase().includes(texto) || p.sku_interno?.toLowerCase().includes(texto))
      .map((p) => ({ producto: p, ps: mapaPs.get(p.id) || null }))
      .filter(({ ps }) => {
        if (filtro === "en") return ps?.se_vende === true;
        if (filtro === "fuera") return !ps || ps.se_vende !== true;
        return true;
      });
  }, [productos, mapaPs, busqueda, filtro]);

  const totalPaginas = Math.max(1, Math.ceil(filas.length / PAGE_SIZE));
  const filasPagina = filas.slice(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE);

  const defaultControl = sucursalActiva?.control_stock_default || "ESTRICTO";

  async function guardarPs(productoId, cambios) {
    const actual = mapaPs.get(productoId);
    const payload = {
      producto_id: productoId,
      sucursal_id: sucursalActivaId,
      se_vende: actual?.se_vende ?? true,
      control_stock: actual?.control_stock ?? null,
      stock_min: actual?.stock_min ?? null,
      punto_reorden: actual?.punto_reorden ?? null,
      ...cambios,
    };
    const { data, error } = await supabase
      .from("producto_sucursal")
      .upsert(payload, { onConflict: "producto_id,sucursal_id" })
      .select()
      .single();
    if (error) { setToast({ msg: "No se pudo guardar: " + error.message, tipo: "error" }); return; }
    setMapaPs((prev) => new Map(prev).set(productoId, data));
  }

  function alternarSeVende(productoId, valorActual) {
    guardarPs(productoId, { se_vende: !valorActual });
  }

  function forzarControl(productoId, valor) {
    const actual = mapaPs.get(productoId);
    if (actual?.inventariado_en && valor !== "ESTRICTO") {
      const ok = window.confirm(
        "Este producto ya fue contado (está en control estricto por su cuenta). " +
        "Forzarlo de vuelta a libre descarta ese trabajo — ¿confirmar?"
      );
      if (!ok) return;
    }
    guardarPs(productoId, { control_stock: valor });
    setForzando(null);
  }

  function alternarSeleccion(productoId) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(productoId)) next.delete(productoId); else next.add(productoId);
      return next;
    });
  }

  function seleccionarPagina() {
    setSeleccion((prev) => {
      const next = new Set(prev);
      for (const { producto } of filasPagina) next.add(producto.id);
      return next;
    });
  }

  async function aplicarEnLote(seVende) {
    if (seleccion.size === 0) return;
    setGuardandoLote(true);
    const ids = [...seleccion];
    const payload = ids.map((id) => {
      const actual = mapaPs.get(id);
      return {
        producto_id: id,
        sucursal_id: sucursalActivaId,
        se_vende: seVende,
        control_stock: actual?.control_stock ?? null,
        stock_min: actual?.stock_min ?? null,
        punto_reorden: actual?.punto_reorden ?? null,
      };
    });
    const { data, error } = await supabase
      .from("producto_sucursal")
      .upsert(payload, { onConflict: "producto_id,sucursal_id" })
      .select();
    setGuardandoLote(false);
    if (error) { setToast({ msg: "No se pudo aplicar en lote: " + error.message, tipo: "error" }); return; }
    setMapaPs((prev) => {
      const next = new Map(prev);
      for (const row of data || []) next.set(row.producto_id, row);
      return next;
    });
    setSeleccion(new Set());
    setToast({ msg: `${ids.length} producto${ids.length === 1 ? "" : "s"} actualizados`, tipo: "ok" });
  }

  return (
    <div className="mx-auto max-w-5xl">
      {toast && <Toast msg={toast.msg} tipo={toast.tipo} onClose={() => setToast(null)} />}

      <div className="mb-5 flex items-center gap-2">
        <Tags className="text-slate-700" />
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Surtido</h1>
          <p className="text-sm text-slate-500">
            Qué se maneja en {nombreSucursal(sucursalActivaId) || "…"} — control por defecto: {defaultControl === "LIBRE" ? "libre" : "estricto"}
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busquedaInput}
            onChange={(e) => setBusquedaInput(e.target.value)}
            placeholder="Buscar por nombre o SKU…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <div className="flex rounded-lg border border-slate-300 p-0.5 text-sm">
          {[
            { id: "todos", label: "Todos" },
            { id: "en",    label: "En surtido" },
            { id: "fuera", label: "Fuera de surtido" },
          ].map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)}
              className={`rounded px-3 py-1.5 font-medium
                ${filtro === f.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {seleccion.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          <span>{seleccion.size} seleccionados</span>
          <button disabled={guardandoLote} onClick={() => aplicarEnLote(true)}
            className="ml-auto rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            Marcar en surtido
          </button>
          <button disabled={guardandoLote} onClick={() => aplicarEnLote(false)}
            className="rounded-md border border-blue-300 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
            Marcar fuera de surtido
          </button>
          <button onClick={() => setSeleccion(new Set())} className="text-blue-400 hover:text-blue-600">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">
                  <button onClick={seleccionarPagina} className="underline decoration-dotted">sel.</button>
                </th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Surtido</th>
                <th className="px-3 py-2">Control</th>
                <th className="px-3 py-2 text-right">Stock mín.</th>
                <th className="px-3 py-2 text-right">Punto reorden</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : filasPagina.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">Sin resultados.</td></tr>
              ) : filasPagina.map(({ producto, ps }) => {
                const seVende = ps?.se_vende ?? false;
                const control = controlEfectivo(ps?.control_stock ?? null, defaultControl);
                return (
                  <tr key={producto.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={seleccion.has(producto.id)}
                        onChange={() => alternarSeleccion(producto.id)} />
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{producto.nombre}</p>
                      {producto.sku_interno && <p className="text-xs text-slate-400">{producto.sku_interno}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => alternarSeVende(producto.id, seVende)}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium
                          ${seVende ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {seVende ? "En surtido" : "Fuera"}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      {forzando === producto.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => forzarControl(producto.id, "ESTRICTO")}
                            className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-200">Estricto</button>
                          <button onClick={() => forzarControl(producto.id, "LIBRE")}
                            className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-200">Libre</button>
                          {ps?.control_stock != null && (
                            <button onClick={() => forzarControl(producto.id, null)}
                              className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200" title="Volver a heredar el default de la sucursal">Auto</button>
                          )}
                          <button onClick={() => setForzando(null)} className="text-slate-400 hover:text-slate-600"><X size={12} /></button>
                        </div>
                      ) : (
                        <button onClick={() => setForzando(producto.id)} className="flex items-center gap-1">
                          <ChipControl valor={control} />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" min="0" step="any" defaultValue={ps?.stock_min ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          if (v !== (ps?.stock_min ?? null)) guardarPs(producto.id, { stock_min: v });
                        }}
                        className="w-20 rounded border border-slate-200 px-1.5 py-1 text-right text-xs focus:border-slate-500 focus:outline-none" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" min="0" step="any" defaultValue={ps?.punto_reorden ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          if (v !== (ps?.punto_reorden ?? null)) guardarPs(producto.id, { punto_reorden: v });
                        }}
                        className="w-20 rounded border border-slate-200 px-1.5 py-1 text-right text-xs focus:border-slate-500 focus:outline-none" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!cargando && filas.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>{filas.length} productos</span>
          <div className="flex items-center gap-2">
            <button disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}
              className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={14} /></button>
            <span>{pagina + 1} / {totalPaginas}</span>
            <button disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)}
              className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
