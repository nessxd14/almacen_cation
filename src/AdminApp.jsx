import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { sanearFiltro } from "./lib/filtroTexto";
import EscanerCodigo from "./EscanerCodigo";
import MapaMuebles from "./MapaMuebles";
import { compararUbicaciones, etiquetaUbicacion } from "./lib/ubicacionTexto";
import {
  MapPin, Package, Plus, Check, X,
  ChevronRight, Search, Star, AlertCircle, ScanLine
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function Toast({ msg, tipo = "ok", onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg
      ${tipo === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
      {tipo === "ok" ? <Check size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState(null);
  const show = (msg, tipo = "ok") => setToast({ msg, tipo });
  const node = toast ? <Toast msg={toast.msg} tipo={toast.tipo} onClose={() => setToast(null)} /> : null;
  return { show, node };
}

// ─── TAB 2: Asignación Producto ↔ Ubicación ─────────────────────────────────

function TabAsignaciones() {
  const { show, node: toastNode } = useToast();
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [seleccionado, setSeleccionado] = useState(null);
  const [asignaciones, setAsignaciones] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [nuevaUbicId, setNuevaUbicId] = useState("");
  const [agregando, setAgregando] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const handleScan = useCallback(async (codigo) => {
    setShowScanner(false);
    const code = (codigo || "").trim();
    if (!code) return;
    const { data } = await supabase.rpc("resolver_identificador", { p_codigo: code });
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    if (rows.length === 0) { show("Código no reconocido", "err"); return; }
    const { data: pres } = await supabase
      .from("presentacion")
      .select("producto:producto_id(id, nombre, sku_interno)")
      .eq("id", rows[0].presentacion_id)
      .single();
    if (pres?.producto) seleccionarProducto(pres.producto);
  }, []);

  useEffect(() => {
    supabase
      .from("ubicacion")
      .select("*")
      .order("codigo_zona")
      .order("estante")
      .order("nivel")
      .order("compartimiento")
      .then(({ data }) => setUbicaciones((data || []).slice().sort(compararUbicaciones)));
  }, []);

  async function buscarProductos(q) {
    const texto = sanearFiltro(q);
    if (!texto) { setProductos([]); return; }
    setBuscando(true);
    const { data, error } = await supabase
      .from("producto")
      .select("id, nombre, sku_interno")
      .or(`nombre.ilike.%${texto}%,sku_interno.ilike.%${texto}%`)
      .eq("activo", true)
      .order("nombre")
      .limit(20);
    if (error) console.error("buscarProductos falló:", error);
    setProductos(data || []);
    setBuscando(false);
  }

  useEffect(() => {
    const t = setTimeout(() => buscarProductos(busqueda), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  async function seleccionarProducto(p) {
    setSeleccionado(p);
    setProductos([]);
    setBusqueda("");
    cargarAsignaciones(p.id);
  }

  async function cargarAsignaciones(productoId) {
    const { data } = await supabase
      .from("producto_ubicacion")
      .select("id, es_principal, ubicacion:ubicacion_id(id, codigo_zona, estante, nivel, compartimiento)")
      .eq("producto_id", productoId)
      .order("es_principal", { ascending: false });
    setAsignaciones(data || []);
  }

  async function agregarUbicacion() {
    if (!nuevaUbicId) { show("Elegí una ubicación", "err"); return; }
    setAgregando(true);
    const yaTiene = asignaciones.some(a => String(a.ubicacion.id) === String(nuevaUbicId));
    if (yaTiene) { show("Este producto ya tiene esa ubicación", "err"); setAgregando(false); return; }

    const esPrimera = asignaciones.length === 0;
    const { error } = await supabase.from("producto_ubicacion").insert({
      producto_id: seleccionado.id,
      ubicacion_id: Number(nuevaUbicId),
      es_principal: esPrimera,
    });
    if (error) { show("Error al asignar", "err"); setAgregando(false); return; }
    show("Ubicación asignada");
    setNuevaUbicId("");
    cargarAsignaciones(seleccionado.id);
    setAgregando(false);
  }

  async function marcarPrincipal(asignacionId) {
    await supabase
      .from("producto_ubicacion")
      .update({ es_principal: false })
      .eq("producto_id", seleccionado.id);
    const { error } = await supabase
      .from("producto_ubicacion")
      .update({ es_principal: true })
      .eq("id", asignacionId);
    if (error) { show("Error al actualizar", "err"); return; }
    show("Ubicación principal actualizada");
    cargarAsignaciones(seleccionado.id);
  }

  async function quitarAsignacion(asignacionId) {
    const { error } = await supabase.from("producto_ubicacion").delete().eq("id", asignacionId);
    if (error) { show("Error al quitar", "err"); return; }
    show("Asignación eliminada");
    cargarAsignaciones(seleccionado.id);
  }

  const asignadasIds = new Set(asignaciones.map(a => a.ubicacion.id));
  const disponibles = ubicaciones.filter(u => !asignadasIds.has(u.id));

  return (
    <div>
      {toastNode}

      {showScanner && <EscanerCodigo onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      {/* Buscador */}
      <div className="mb-6">
        <label className="mb-1 block text-sm font-medium text-slate-700">Buscar producto</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={busqueda}
              onChange={e => { setBusqueda(e.target.value); setSeleccionado(null); }}
              placeholder="Nombre, SKU o código de barras…"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          <button onClick={() => setShowScanner(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <ScanLine size={15} /> Escanear
          </button>
        </div>

        {(productos.length > 0 || buscando) && (
          <div className="mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {buscando && <p className="px-4 py-3 text-sm text-slate-400">Buscando…</p>}
            {productos.map(p => (
              <button
                key={p.id}
                onClick={() => seleccionarProducto(p)}
                className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-3 text-left text-sm last:border-0 hover:bg-slate-50">
                <Package size={14} className="shrink-0 text-slate-400" />
                <span className="flex-1 font-medium text-slate-800">{p.nombre}</span>
                {p.sku_interno && <span className="text-xs text-slate-400">{p.sku_interno}</span>}
                <ChevronRight size={14} className="shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Panel producto seleccionado */}
      {seleccionado && (
        <div>
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-slate-900 px-5 py-4">
            <Package size={18} className="text-slate-400" />
            <div>
              <p className="font-semibold text-white">{seleccionado.nombre}</p>
              {seleccionado.sku_interno && (
                <p className="text-xs text-slate-400">SKU: {seleccionado.sku_interno}</p>
              )}
            </div>
            <button
              onClick={() => { setSeleccionado(null); setAsignaciones([]); }}
              className="ml-auto text-slate-400 hover:text-white">
              <X size={18} />
            </button>
          </div>

          {/* Ubicaciones actuales */}
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Ubicaciones asignadas
            </h3>
            {asignaciones.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                Sin ubicaciones asignadas todavía.
              </p>
            ) : (
              <div className="space-y-2">
                {asignaciones.map(a => (
                  <div key={a.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <MapPin size={15} className={a.es_principal ? "text-slate-900" : "text-slate-300"} />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-800">{etiquetaUbicacion(a.ubicacion)}</p>
                      <p className="text-xs text-slate-400">
                        <span className={`rounded-full px-1.5 py-0.5
                          ${a.ubicacion.estante === "Pallet"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-blue-100 text-blue-700"}`}>
                          {a.ubicacion.estante}
                        </span>
                        {" "}{a.ubicacion.nivel}
                        {a.ubicacion.compartimiento ? ` · ${a.ubicacion.compartimiento}` : ""}
                      </p>
                    </div>
                    {a.es_principal && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        Principal
                      </span>
                    )}
                    <div className="flex gap-2">
                      {!a.es_principal && (
                        <button
                          onClick={() => marcarPrincipal(a.id)}
                          className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          title="Marcar como principal">
                          <Star size={12} /> Principal
                        </button>
                      )}
                      <button
                        onClick={() => quitarAsignacion(a.id)}
                        className="flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                        <X size={12} /> Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Agregar ubicación */}
          {disponibles.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Agregar ubicación
              </h3>
              <div className="flex gap-2">
                <select
                  value={nuevaUbicId}
                  onChange={e => setNuevaUbicId(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none">
                  <option value="">Elegir ubicación…</option>
                  {disponibles.map(u => (
                    <option key={u.id} value={u.id}>{etiquetaUbicacion(u)}</option>
                  ))}
                </select>
                <button
                  onClick={agregarUbicacion}
                  disabled={agregando}
                  className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                  <Plus size={15} /> Asignar
                </button>
              </div>
            </div>
          )}

          {disponibles.length === 0 && asignaciones.length > 0 && (
            <p className="text-xs text-slate-400">
              Este producto ya tiene todas las ubicaciones disponibles asignadas.
            </p>
          )}
        </div>
      )}

      {!seleccionado && !busqueda && (
        <div className="rounded-xl border border-dashed border-slate-200 px-6 py-12 text-center">
          <Package size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">Buscá un producto para ver y editar sus ubicaciones.</p>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal Admin ──────────────────────────────────────────────

const SUBTABS = [
  { id: "ubicaciones",  label: "Mapa de muebles",  icon: MapPin,   Comp: MapaMuebles },
  { id: "asignaciones", label: "Asignaciones", icon: Package,  Comp: TabAsignaciones },
];

export default function AdminApp() {
  const [subtab, setSubtab] = useState("ubicaciones");
  const Active = SUBTABS.find(t => t.id === subtab).Comp;

  return (
    <div className={`mx-auto ${subtab === "ubicaciones" ? "max-w-6xl" : "max-w-3xl"}`}>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-800">Administración</h1>
        <p className="text-sm text-slate-500">
          Gestión de ubicaciones del almacén y asignación a productos.
        </p>
      </div>

      <div className="mb-6 flex gap-1 rounded-xl bg-slate-100 p-1">
        {SUBTABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSubtab(id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors
              ${subtab === id
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <Active />
    </div>
  );
}
