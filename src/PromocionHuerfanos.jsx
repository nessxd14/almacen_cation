/**
 * PromocionHuerfanos.jsx  —  Fase 3: Promoción de artículos huérfanos
 * Cableado a Supabase real.
 *
 * Funciones RPC confirmadas:
 *   promover_huerfano(p_payload jsonb) → bigint
 *     payload.modo = 'NUEVO' | 'EXISTENTE'
 *     payload.conteo_ids = [bigint]
 *     payload.producto = { nombre, unidad_base }         (modo NUEVO)
 *     payload.presentacion = { nombre, factor_unidad_base } (modo NUEVO)
 *     payload.presentacion_id_existente = bigint         (modo EXISTENTE)
 *     payload.identificador = { valor, tipo, origen }    (opcional ambos)
 *
 *   descartar_huerfano(p_conteo_ids bigint[]) → integer
 *
 *   identificador.tipo: 'barra' | 'fabrica'
 *   identificador.origen: 'fabricante' | 'interno'
 */

import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import {
  ArrowUpFromLine, Link, PlusCircle, Trash2,
  CheckCircle, AlertCircle, Loader, RefreshCw,
} from "lucide-react";

export default function PromocionHuerfanos() {
  const [huerfanos, setHuerfanos] = useState([]);
  const [presentaciones, setPresentaciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(null);
  const [selected, setSelected] = useState(null); // conteo huérfano activo
  const [modo, setModo] = useState(null);          // 'vincular' | 'nuevo'
  const [guardando, setGuardando] = useState(false);

  // form vincular
  const [presentacionId, setPresentacionId] = useState("");
  const [codigoBarras, setCodigoBarras] = useState("");
  const [tipoId, setTipoId] = useState("barra");

  // form nuevo
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoUnidad, setNuevoUnidad] = useState("pza");
  const [nuevaPresentNombre, setNuevaPresentNombre] = useState("");
  const [nuevoFactor, setNuevoFactor] = useState("1");

  /* ── cargar huérfanos y presentaciones ───────────────────────────── */
  const cargar = async () => {
    setLoading(true);
    const [{ data: huerfanosData }, { data: presData }] = await Promise.all([
      supabase
        .from("conteo_fisico_inicial")
        .select("id, descripcion_libre, ubicacion_id, cantidad, capturado_en, ubicacion(codigo_zona, estante, nivel)")
        .eq("es_no_catalogado", true)
        .eq("estado", "CAPTURADO")
        .order("capturado_en", { ascending: false }),
      supabase
        .from("presentacion")
        .select("id, nombre, producto(id, nombre, sku_interno)")
        .order("nombre"),
    ]);
    setHuerfanos(huerfanosData || []);
    setPresentaciones(presData || []);
    setLoading(false);
  };

  useEffect(() => { cargar(); }, []);

  const showFlash = (msg, type = "ok") => {
    setFlash({ msg, type });
    setTimeout(() => setFlash(null), 3500);
  };

  const resetForm = () => {
    setSelected(null); setModo(null);
    setPresentacionId(""); setCodigoBarras(""); setTipoId("barra");
    setNuevoNombre(""); setNuevoUnidad("pza");
    setNuevaPresentNombre(""); setNuevoFactor("1");
  };

  const labelUbicacion = (h) => {
    const u = h.ubicacion;
    return u ? `${u.codigo_zona}-${u.estante}-${u.nivel}` : "—";
  };

  /* ── promover: vincular a presentación existente ─────────────────── */
  const promoverExistente = async () => {
    if (!presentacionId) { showFlash("Selecciona una presentación", "error"); return; }
    setGuardando(true);
    const payload = {
      modo: "EXISTENTE",
      conteo_ids: [selected.id],
      presentacion_id_existente: Number(presentacionId),
      identificador: codigoBarras
        ? { valor: codigoBarras, tipo: tipoId, origen: "fabricante" }
        : null,
    };
    const { error } = await supabase.rpc("promover_huerfano", { p_payload: payload });
    if (error) { showFlash("Error: " + error.message, "error"); }
    else {
      showFlash(`Vinculado a presentación correctamente`);
      resetForm();
      cargar();
    }
    setGuardando(false);
  };

  /* ── promover: crear producto nuevo ──────────────────────────────── */
  const promoverNuevo = async () => {
    if (!nuevoNombre.trim()) { showFlash("El nombre del producto es obligatorio", "error"); return; }
    if (!nuevaPresentNombre.trim()) { showFlash("El nombre de la presentación es obligatorio", "error"); return; }
    const factor = Number(nuevoFactor);
    if (!factor || factor <= 0) { showFlash("Factor inválido", "error"); return; }
    setGuardando(true);
    const payload = {
      modo: "NUEVO",
      conteo_ids: [selected.id],
      producto: { nombre: nuevoNombre.trim(), unidad_base: nuevoUnidad.trim() },
      presentacion: { nombre: nuevaPresentNombre.trim(), factor_unidad_base: factor },
      identificador: codigoBarras
        ? { valor: codigoBarras, tipo: tipoId, origen: "fabricante" }
        : null,
    };
    const { error } = await supabase.rpc("promover_huerfano", { p_payload: payload });
    if (error) { showFlash("Error: " + error.message, "error"); }
    else {
      showFlash(`Producto "${nuevoNombre}" creado y vinculado`);
      resetForm();
      cargar();
    }
    setGuardando(false);
  };

  /* ── descartar ───────────────────────────────────────────────────── */
  const descartar = async (h) => {
    setGuardando(true);
    const { error } = await supabase.rpc("descartar_huerfano", { p_conteo_ids: [h.id] });
    if (error) { showFlash("Error: " + error.message, "error"); }
    else {
      showFlash("Artículo descartado", "warn");
      if (selected?.id === h.id) resetForm();
      cargar();
    }
    setGuardando(false);
  };

  /* ── render ──────────────────────────────────────────────────────── */
  return (
    <div className="max-w-lg mx-auto pt-4 px-4 space-y-4">
      <div className="flex items-center gap-2">
        <ArrowUpFromLine className="text-slate-700" />
        <h1 className="text-xl font-bold text-slate-800">Artículos huérfanos</h1>
        <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
          {huerfanos.length} pendientes
        </span>
        <button onClick={cargar} disabled={loading}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {flash && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
          ${flash.type === "ok" ? "bg-green-50 text-green-700"
          : flash.type === "warn" ? "bg-amber-50 text-amber-700"
          : "bg-red-50 text-red-700"}`}>
          {flash.type === "ok" ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {flash.msg}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
          <Loader size={14} className="animate-spin" /> Cargando…
        </div>
      )}

      {!loading && huerfanos.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-10">¡Sin huérfanos pendientes! 🎉</p>
      )}

      {huerfanos.map(h => (
        <div key={h.id} className={`bg-white border rounded-xl overflow-hidden
          ${selected?.id === h.id ? "border-blue-400 shadow-sm" : "border-slate-200"}`}>

          {/* cabecera */}
          <div className="px-4 py-3 flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-slate-800 truncate">{h.descripcion_libre}</p>
              <p className="text-xs text-slate-500">
                {labelUbicacion(h)} · {h.cantidad} uds · {new Date(h.capturado_en).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => { setSelected(h); setModo("vincular"); }}
                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50" title="Vincular a existente">
                <Link size={15} />
              </button>
              <button onClick={() => { setSelected(h); setModo("nuevo"); }}
                className="p-1.5 rounded-lg text-green-600 hover:bg-green-50" title="Crear producto nuevo">
                <PlusCircle size={15} />
              </button>
              <button onClick={() => descartar(h)} disabled={guardando}
                className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 disabled:opacity-50" title="Descartar">
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          {/* formulario vincular */}
          {selected?.id === h.id && modo === "vincular" && (
            <div className="border-t px-4 py-3 bg-slate-50 space-y-3">
              <p className="text-xs font-semibold text-slate-600">Vincular a presentación existente</p>
              <select value={presentacionId} onChange={e => setPresentacionId(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="">— Selecciona presentación —</option>
                {presentaciones.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.producto?.nombre} · {p.nombre}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <input value={codigoBarras} onChange={e => setCodigoBarras(e.target.value)}
                  placeholder="Código de barras (opcional)"
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <select value={tipoId} onChange={e => setTipoId(e.target.value)}
                  className="px-2 py-2 border rounded-lg text-sm">
                  <option value="barra">barra</option>
                  <option value="fabrica">fabrica</option>
                </select>
              </div>

              <div className="flex gap-2">
                <button onClick={promoverExistente} disabled={guardando}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 disabled:opacity-50 flex items-center justify-center gap-1">
                  {guardando && <Loader size={12} className="animate-spin" />}
                  Vincular
                </button>
                <button onClick={resetForm}
                  className="px-4 py-2 border rounded-lg text-sm text-slate-500 hover:bg-slate-100">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* formulario nuevo */}
          {selected?.id === h.id && modo === "nuevo" && (
            <div className="border-t px-4 py-3 bg-slate-50 space-y-3">
              <p className="text-xs font-semibold text-slate-600">Crear producto nuevo</p>

              <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
                placeholder="Nombre del producto *"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />

              <div className="flex gap-2">
                <input value={nuevoUnidad} onChange={e => setNuevoUnidad(e.target.value)}
                  placeholder="Unidad base (pza, m, kg…)"
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
              </div>

              <input value={nuevaPresentNombre} onChange={e => setNuevaPresentNombre(e.target.value)}
                placeholder="Nombre de la presentación * (ej: Caja x12)"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />

              <div className="flex gap-2 items-center">
                <label className="text-xs text-slate-500 shrink-0">Factor:</label>
                <input type="number" min="0.0001" step="any" value={nuevoFactor}
                  onChange={e => setNuevoFactor(e.target.value)}
                  className="w-24 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
                <span className="text-xs text-slate-400">{nuevoUnidad || "unidad"}/presentación</span>
              </div>

              <div className="flex gap-2">
                <input value={codigoBarras} onChange={e => setCodigoBarras(e.target.value)}
                  placeholder="Código de barras (opcional)"
                  className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
                <select value={tipoId} onChange={e => setTipoId(e.target.value)}
                  className="px-2 py-2 border rounded-lg text-sm">
                  <option value="barra">barra</option>
                  <option value="fabrica">fabrica</option>
                </select>
              </div>

              <div className="flex gap-2">
                <button onClick={promoverNuevo} disabled={guardando}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-500 disabled:opacity-50 flex items-center justify-center gap-1">
                  {guardando && <Loader size={12} className="animate-spin" />}
                  Crear y vincular
                </button>
                <button onClick={resetForm}
                  className="px-4 py-2 border rounded-lg text-sm text-slate-500 hover:bg-slate-100">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
