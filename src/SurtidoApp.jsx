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
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import { fetchAll } from "./lib/fetchAll";
import { useSucursal } from "./lib/useSucursal";
import { sanearFiltro } from "./lib/filtroTexto";
import { controlEfectivo } from "./lib/control";
import BarraSeleccion from "./BarraSeleccion";
import ImagenProducto from "./ImagenProducto";
import {
  Tags, Search, Check, X, AlertTriangle, Lock, Unlock, ChevronLeft, ChevronRight, Loader, RefreshCw,
} from "lucide-react";

const PAGE_SIZE = 50;

function Toast({ msg, tipo = "ok", onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div role={tipo === "error" ? "alert" : "status"} className={`ui-toast fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg
      ${tipo === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
      {tipo === "ok" ? <Check size={16} /> : <AlertTriangle size={16} />}
      {msg}
    </div>
  );
}

function CampoStock({ valor, label, disabled, onGuardar }) {
  const [borrador, setBorrador] = useState(null);
  const [error, setError] = useState(false);
  return <div>
    <input type="number" min="0" step="any" inputMode="decimal" value={borrador ?? valor ?? ""}
      aria-label={label} aria-invalid={error} disabled={disabled}
      onChange={e => { setBorrador(e.target.value); setError(false); }}
      onBlur={async e => {
        const texto = e.target.value;
        const numero = texto === "" ? null : Number(texto);
        if (numero !== null && (!Number.isFinite(numero) || numero < 0)) { setError(true); return; }
        if (numero === (valor ?? null)) { setBorrador(null); return; }
        if (await onGuardar(numero)) setBorrador(null);
      }}
      onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === "Escape") { e.preventDefault(); setBorrador(null); setError(false); }
      }}
      className="w-20 rounded border border-slate-200 px-1.5 py-1 text-right text-xs focus:border-slate-500 focus:outline-none disabled:opacity-50" />
    {error && <span className="surtido-field-error" role="alert">Usa un número mayor o igual a cero.</span>}
  </div>;
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
  const [errorCarga, setErrorCarga] = useState(null);
  const [guardando, setGuardando] = useState(new Set());
  const pendientesRef = useRef(new Set());
  const sucursalRef = useRef(sucursalActivaId);
  const requestRef = useRef(0);
  const invalidarPeticiones = useCallback(() => { requestRef.current++; }, []);
  useEffect(() => { sucursalRef.current = sucursalActivaId; }, [sucursalActivaId]);

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(sanearFiltro(busquedaInput)), 300);
    return () => clearTimeout(t);
  }, [busquedaInput]);

  const cargar = useCallback(async () => {
    if (!sucursalActivaId) return;
    const request = ++requestRef.current;
    setErrorCarga(null);
    setCargando(true);
    try {
      const [prods, ps] = await Promise.all([
        fetchAll(() => supabase.from("producto").select("id, nombre, sku_interno, marca, imagen_url").eq("activo", true).order("nombre")),
        fetchAll(() => supabase.from("producto_sucursal")
          .select("producto_id, se_vende, control_stock, stock_min, punto_reorden, inventariado_en, inventariado_por")
          .eq("sucursal_id", sucursalActivaId)),
      ]);
      if (request !== requestRef.current) return;
      setProductos(prods);
      setMapaPs(new Map(ps.map((p) => [p.producto_id, p])));
    } catch (e) {
      console.error("cargar surtido falló:", e);
      if (request === requestRef.current) setErrorCarga("No se pudo cargar el surtido. Intenta nuevamente.");
    } finally {
      if (request === requestRef.current) setCargando(false);
    }
  }, [sucursalActivaId]);

  useEffect(() => {
    // Sincroniza con Supabase (sistema externo), no deriva estado de React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargar();
    return () => { invalidarPeticiones(); };
  }, [cargar, invalidarPeticiones]);
  useEffect(() => {
    // Reinicia la selección/página al cambiar de filtro — no deriva estado.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPagina(0);
    setSeleccion(new Set());
  }, [busqueda, filtro, sucursalActivaId]);

  const filas = useMemo(() => {
    const texto = busqueda.toLowerCase();
    return productos
      .filter((p) => !texto || p.nombre.toLowerCase().includes(texto) || p.sku_interno?.toLowerCase().includes(texto) || p.marca?.toLowerCase().includes(texto))
      .map((p) => ({ producto: p, ps: mapaPs.get(p.id) || null }))
      .filter(({ ps }) => {
        if (filtro === "en") return ps?.se_vende === true;
        if (filtro === "fuera") return !ps || ps.se_vende !== true;
        return true;
      });
  }, [productos, mapaPs, busqueda, filtro]);

  const totalPaginas = Math.max(1, Math.ceil(filas.length / PAGE_SIZE));
  const paginaEfectiva = Math.min(pagina, totalPaginas - 1);
  const filasPagina = filas.slice(paginaEfectiva * PAGE_SIZE, paginaEfectiva * PAGE_SIZE + PAGE_SIZE);
  const paginaCompletaSeleccionada = filasPagina.length > 0 && filasPagina.every(({ producto }) => seleccion.has(producto.id));

  const defaultControl = sucursalActiva?.control_stock_default || "ESTRICTO";
  const enSurtido = productos.filter(p => mapaPs.get(p.id)?.se_vende === true).length;

  async function guardarPs(productoId, cambios) {
    const branch = sucursalActivaId;
    const pendingKey = `${branch}:${productoId}`;
    if (pendientesRef.current.has(pendingKey) || guardandoLote) return false;
    pendientesRef.current.add(pendingKey);
    setGuardando(prev => new Set(prev).add(productoId));
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
    try {
      const { data, error } = await supabase.from("producto_sucursal")
        .upsert(payload, { onConflict: "producto_id,sucursal_id" }).select().single();
      if (sucursalRef.current !== branch) return false;
      if (error) { setToast({ msg: "No se pudo guardar el cambio. Intenta nuevamente.", tipo: "error" }); return false; }
      setMapaPs(prev => new Map(prev).set(productoId, data));
      setToast({ msg: "Cambio guardado", tipo: "ok" });
      return true;
    } catch {
      if (sucursalRef.current === branch) setToast({ msg: "No se pudo guardar el cambio. Intenta nuevamente.", tipo: "error" });
      return false;
    } finally {
      pendientesRef.current.delete(pendingKey);
      setGuardando(prev => { const next = new Set(prev); next.delete(productoId); return next; });
    }
  }

  function alternarSeVende(productoId, valorActual) {
    guardarPs(productoId, { se_vende: !valorActual });
  }

  async function forzarControl(productoId, valor) {
    const actual = mapaPs.get(productoId);
    if (actual?.inventariado_en && valor !== "ESTRICTO") {
      const ok = window.confirm(
        "Este producto ya fue contado (está en control estricto por su cuenta). " +
        "Forzarlo de vuelta a libre descarta ese trabajo — ¿confirmar?"
      );
      if (!ok) return;
    }
    if (await guardarPs(productoId, { control_stock: valor })) setForzando(null);
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
      const todas = filasPagina.every(({ producto }) => next.has(producto.id));
      for (const { producto } of filasPagina) {
        if (todas) next.delete(producto.id);
        else next.add(producto.id);
      }
      return next;
    });
  }

  async function aplicarEnLote(seVende) {
    if (seleccion.size === 0 || guardando.size || guardandoLote) return;
    const branch = sucursalActivaId;
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
    if (sucursalRef.current !== branch) return;
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
    <div className={`surtido-app mx-auto max-w-5xl ${seleccion.size ? "has-selection" : ""}`}>
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

      <div className="cation-filters mb-3 flex flex-wrap items-center gap-2">
        <div className="cation-filter-search relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            aria-label="Buscar productos en surtido"
            value={busquedaInput}
            onChange={(e) => setBusquedaInput(e.target.value)}
            placeholder="Buscar por nombre, SKU o marca…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-12 text-sm focus:border-slate-500 focus:outline-none"
          />
          {busquedaInput && <button type="button" className="ui-search-clear" aria-label="Limpiar búsqueda de surtido" onClick={() => setBusquedaInput("")}><X size={16} /></button>}
        </div>
        <div className="surtido-filter-tabs flex rounded-lg border border-slate-300 p-0.5 text-sm">
          {[
            { id: "todos", label: "Todos", cantidad: productos.length },
            { id: "en",    label: "En surtido", cantidad: enSurtido },
            { id: "fuera", label: "Fuera de surtido", cantidad: productos.length - enSurtido },
          ].map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
              className={`rounded px-3 py-1.5 font-medium
                ${filtro === f.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              {f.label} <span className="surtido-filter-count">{cargando ? "…" : f.cantidad}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500">El surtido define qué se vende aquí. En control libre se puede vender sin stock; en estricto se necesita stock disponible.</p>
      {errorCarga && <div className="ui-feedback ui-feedback-error" role="alert"><AlertTriangle size={18} /><span>{errorCarga}</span><button type="button" onClick={cargar}><RefreshCw size={14} /> Reintentar</button></div>}

      {seleccion.size > 0 && (
        <BarraSeleccion fixed texto={`${seleccion.size} seleccionados`} disabled={guardandoLote} onCerrar={() => setSeleccion(new Set())}>
          <button disabled={guardandoLote || guardando.size > 0} onClick={() => aplicarEnLote(true)}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            Marcar en surtido
          </button>
          <button disabled={guardandoLote || guardando.size > 0} onClick={() => aplicarEnLote(false)}
            className="rounded-md border border-blue-300 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
            Marcar fuera de surtido
          </button>
          {guardandoLote && <span role="status" className="inline-flex items-center gap-1"><Loader size={14} className="animate-spin" /> Guardando…</span>}
        </BarraSeleccion>
      )}

      <div className="cation-table-card">
        <div className="cation-table-toolbar"><div><strong>Productos por sucursal</strong><span>{cargando ? "Cargando…" : `${filasPagina.length} de ${filas.length} productos · los campos se guardan al salir`}</span></div>
          <label className="surtido-mobile-select"><input type="checkbox" checked={paginaCompletaSeleccionada} onChange={seleccionarPagina} disabled={!filasPagina.length || guardandoLote} /> Seleccionar esta página</label>
        </div>
        <div className="cation-table-scroll" tabIndex={0} aria-label="Productos y configuración de surtido">
          <table className="cation-data-table cation-table-surtido w-full text-sm">
            <caption className="sr-only">Productos y configuración de surtido por sucursal</caption>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th scope="col" className="cation-sticky-select px-3 py-2">
                  <input type="checkbox" checked={paginaCompletaSeleccionada} disabled={filasPagina.length === 0}
                    ref={element => { if (element) element.indeterminate = !paginaCompletaSeleccionada && filasPagina.some(({ producto }) => seleccion.has(producto.id)); }}
                    onChange={seleccionarPagina} aria-label={paginaCompletaSeleccionada ? "Deseleccionar productos de esta página" : "Seleccionar productos de esta página"} />
                </th>
                <th scope="col" className="cation-sticky-product px-3 py-2">Producto</th>
                <th scope="col" className="px-3 py-2">Surtido</th>
                <th scope="col" className="px-3 py-2">Control</th>
                <th scope="col" className="px-3 py-2 text-right">Stock mín.</th>
                <th scope="col" className="px-3 py-2 text-right">Punto reorden</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : filasPagina.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">{errorCarga ? "El surtido no está disponible." : "Sin productos para estos filtros."}
                  {!errorCarga && (busquedaInput || filtro !== "todos") && <button type="button" className="ui-reset block mx-auto mt-3" onClick={() => { setBusquedaInput(""); setFiltro("todos"); }}>Limpiar filtros</button>}
                </td></tr>
              ) : filasPagina.map(({ producto, ps }) => {
                const seVende = ps?.se_vende ?? false;
                const control = controlEfectivo(ps?.control_stock ?? null, defaultControl);
                return (
                  <tr key={`${sucursalActivaId}:${producto.id}`} className={seleccion.has(producto.id) ? "is-selected" : ""} aria-busy={guardando.has(producto.id)}>
                    <td className="cation-sticky-select px-3 py-2">
                      <input type="checkbox" checked={seleccion.has(producto.id)}
                        disabled={guardandoLote}
                        aria-label={`Seleccionar ${producto.nombre}`}
                        onChange={() => alternarSeleccion(producto.id)} />
                    </td>
                    <td className="cation-sticky-product px-3 py-2">
                      <div className="surtido-product">
                      <ImagenProducto url={producto.imagen_url} nombre={producto.nombre} className="surtido-mobile-photo" />
                      <div>
                      <p className="font-medium text-slate-800" title={producto.nombre}>{producto.nombre}</p>
                      {producto.sku_interno && <p className="text-xs text-slate-400">{producto.sku_interno}</p>}
                      </div></div>
                    </td>
                    <td className="surtido-state px-3 py-2" data-label="Surtido">
                      <button onClick={() => alternarSeVende(producto.id, seVende)} aria-pressed={seVende}
                        disabled={guardando.has(producto.id) || guardandoLote}
                        aria-label={`${producto.nombre}: ${seVende ? "en surtido" : "fuera de surtido"}. Cambiar estado`}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium
                          ${seVende ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {seVende ? "En surtido" : "Fuera"}
                      </button>
                    </td>
                    <td className="surtido-control px-3 py-2" data-label="Control de stock">
                      {forzando === producto.id ? (
                        <div className="flex flex-wrap items-center gap-1">
                          <button onClick={() => forzarControl(producto.id, "ESTRICTO")}
                            disabled={guardando.has(producto.id) || guardandoLote}
                            className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-200">Estricto</button>
                          <button onClick={() => forzarControl(producto.id, "LIBRE")}
                            disabled={guardando.has(producto.id) || guardandoLote}
                            className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-200">Libre</button>
                          {ps?.control_stock != null && (
                            <button onClick={() => forzarControl(producto.id, null)}
                              disabled={guardando.has(producto.id) || guardandoLote}
                              className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200" title="Volver a heredar el default de la sucursal">Auto</button>
                          )}
                          <button onClick={() => setForzando(null)} aria-label="Cancelar cambio de control" className="text-slate-400 hover:text-slate-600"><X size={12} /></button>
                        </div>
                      ) : (
                        <button disabled={guardando.has(producto.id) || guardandoLote} onClick={() => setForzando(producto.id)} className="flex items-center gap-1" aria-label={`Cambiar control de stock de ${producto.nombre}`}>
                          <ChipControl valor={control} />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right" data-label="Stock mínimo">
                      <CampoStock valor={ps?.stock_min} label={`Stock mínimo de ${producto.nombre}`} disabled={guardando.has(producto.id) || guardandoLote}
                        onGuardar={v => guardarPs(producto.id, { stock_min: v })} />
                    </td>
                    <td className="px-3 py-2 text-right" data-label="Punto de reorden">
                      <CampoStock valor={ps?.punto_reorden} label={`Punto de reorden de ${producto.nombre}`} disabled={guardando.has(producto.id) || guardandoLote}
                        onGuardar={v => guardarPs(producto.id, { punto_reorden: v })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="cation-table-hint">Desliza para ver las demás columnas →</p>
      </div>

      {!cargando && filas.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>{filas.length} productos</span>
          <div className="flex items-center gap-2">
            <button aria-label="Página anterior de surtido" disabled={paginaEfectiva === 0} onClick={() => setPagina(paginaEfectiva - 1)}
              className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={14} /></button>
            <span>{paginaEfectiva + 1} / {totalPaginas}</span>
            <button aria-label="Página siguiente de surtido" disabled={paginaEfectiva >= totalPaginas - 1} onClick={() => setPagina(paginaEfectiva + 1)}
              className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
