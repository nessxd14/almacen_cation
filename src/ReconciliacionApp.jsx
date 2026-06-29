/**
 * ReconciliacionApp.jsx  —  Fase 3: Conciliación doble ciego
 * Cableado a Supabase real.
 *
 * Esquema confirmado:
 *   conciliacion_linea:
 *     id, sesion_id, presentacion_id, ubicacion_id,
 *     cantidad_conteo_1, cantidad_conteo_2, contador_1, contador_2,
 *     cantidad_conciliada, factor_a_base_snap,
 *     cantidad_base_conciliada (GENERATED ALWAYS — nunca escribir),
 *     metodo_resolucion (enum: AUTO_SIMPLE | AUTO_COINCIDE | MANUAL),
 *     estado (enum: PENDIENTE | CONCILIADA | INYECTADA | DESCARTADA),
 *     resuelto_por (VARCHAR), resuelto_en, creado_en
 *   sesion_conteo: id, nombre, metodo, estado, iniciada_en, cerrada_en
 *   ubicacion: id, codigo_zona, estante, nivel, compartimiento
 *   presentacion: id, producto_id, nombre, factor_unidad_base
 *   producto: id, nombre, sku_interno
 */

import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import {
  Scale, CheckCircle, XCircle, AlertTriangle,
  ChevronDown, ChevronUp, Loader, ArrowLeft,
} from "lucide-react";

const USUARIO_ACTUAL = "Supervisor";
const labelUbicacion = (u) =>
  u ? [u.codigo_zona, u.estante, u.nivel, u.compartimiento].filter(Boolean).join("-") : "—";

export default function ReconciliacionApp() {
  const [sesiones, setSesiones] = useState([]);
  const [sesionId, setSesionId] = useState(null);
  const [lineas, setLineas] = useState([]);
  const [ubicaciones, setUbicaciones] = useState({});
  const [presentaciones, setPresentaciones] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadingSesiones, setLoadingSesiones] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [cantidadFinal, setCantidadFinal] = useState({});
  const [flash, setFlash] = useState(null);
  const [guardando, setGuardando] = useState(null);

  /* ── cargar sesiones doble ciego abiertas ────────────────────────── */
  useEffect(() => {
    async function cargar() {
      setLoadingSesiones(true);
      const { data, error } = await supabase
        .from("sesion_conteo")
        .select("id, nombre, metodo, estado, iniciada_en")
        .eq("metodo", "DOBLE_CIEGO")
        .in("estado", ["ABIERTA", "CONCILIADA"])
        .order("iniciada_en", { ascending: false });
      if (!error) setSesiones(data || []);
      setLoadingSesiones(false);
    }
    cargar();
  }, []);

  /* ── cargar líneas de la sesión seleccionada ─────────────────────── */
  useEffect(() => {
    if (!sesionId) return;
    async function cargarLineas() {
      setLoading(true);
      const { data: lineasData, error } = await supabase
        .from("conciliacion_linea")
        .select("*")
        .eq("sesion_id", sesionId)
        .order("id");

      if (error) { setFlash({ type: "error", msg: error.message }); setLoading(false); return; }

      // cargar ubicaciones y presentaciones relacionadas
      const ubIds = [...new Set(lineasData.map(l => l.ubicacion_id))];
      const prIds = [...new Set(lineasData.map(l => l.presentacion_id))];

      const [{ data: ubs }, { data: pres }] = await Promise.all([
        supabase.from("ubicacion").select("id, codigo_zona, estante, nivel, compartimiento").in("id", ubIds),
        supabase.from("presentacion").select("id, nombre, producto(id, nombre, sku_interno)").in("id", prIds),
      ]);

      const ubMap = Object.fromEntries((ubs || []).map(u => [u.id, u]));
      const prMap = Object.fromEntries((pres || []).map(p => [p.id, p]));
      setUbicaciones(ubMap);
      setPresentaciones(prMap);
      setLineas(lineasData || []);
      setLoading(false);
    }
    cargarLineas();
  }, [sesionId]);

  const showFlash = (msg, type = "ok") => {
    setFlash({ msg, type });
    setTimeout(() => setFlash(null), 3000);
  };

  /* ── conciliar línea ─────────────────────────────────────────────── */
  const conciliar = async (linea, cantidadElegida, metodo = "MANUAL") => {
    setGuardando(linea.id);
    // NUNCA escribir cantidad_base_conciliada — es GENERATED ALWAYS
    const { error } = await supabase
      .from("conciliacion_linea")
      .update({
        cantidad_conciliada: cantidadElegida,
        metodo_resolucion: metodo,
        estado: "CONCILIADA",
        resuelto_por: USUARIO_ACTUAL,
        resuelto_en: new Date().toISOString(),
      })
      .eq("id", linea.id);

    if (error) { showFlash("Error: " + error.message, "error"); }
    else {
      setLineas(prev => prev.map(l => l.id === linea.id
        ? { ...l, cantidad_conciliada: cantidadElegida, metodo_resolucion: metodo,
            estado: "CONCILIADA", resuelto_por: USUARIO_ACTUAL, resuelto_en: new Date().toISOString() }
        : l));
      setExpanded(null);
      showFlash(`Línea conciliada con ${cantidadElegida} unidades`);
    }
    setGuardando(null);
  };

  const descartar = async (linea) => {
    setGuardando(linea.id);
    const { error } = await supabase
      .from("conciliacion_linea")
      .update({
        estado: "DESCARTADA",
        metodo_resolucion: "MANUAL",
        resuelto_por: USUARIO_ACTUAL,
        resuelto_en: new Date().toISOString(),
      })
      .eq("id", linea.id);

    if (error) { showFlash("Error: " + error.message, "error"); }
    else {
      setLineas(prev => prev.map(l => l.id === linea.id
        ? { ...l, estado: "DESCARTADA", resuelto_por: USUARIO_ACTUAL }
        : l));
      setExpanded(null);
      showFlash("Línea descartada", "warn");
    }
    setGuardando(null);
  };

  const pendientes = lineas.filter(l => l.estado === "PENDIENTE");
  const conciliadas = lineas.filter(l => l.estado === "CONCILIADA");
  const descartadas = lineas.filter(l => l.estado === "DESCARTADA");

  /* ── selección de sesión ─────────────────────────────────────────── */
  if (!sesionId) return (
    <div className="max-w-md mx-auto pt-6 px-4 space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Scale className="text-slate-700" />
        <h1 className="text-xl font-bold text-slate-800">Conciliación</h1>
      </div>

      {loadingSesiones && (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader size={14} className="animate-spin" /> Cargando sesiones…
        </div>
      )}

      {!loadingSesiones && sesiones.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-8">
          No hay sesiones doble ciego disponibles.
          <br />Crea una desde la pestaña Conteo.
        </p>
      )}

      {sesiones.map(s => (
        <button key={s.id} onClick={() => setSesionId(s.id)}
          className="w-full text-left px-4 py-3 bg-white border rounded-xl hover:bg-slate-50 space-y-1">
          <p className="font-medium text-slate-800">{s.nombre}</p>
          <p className="text-xs text-slate-500">
            Doble ciego · {s.estado} · {new Date(s.iniciada_en).toLocaleDateString()}
          </p>
        </button>
      ))}
    </div>
  );

  /* ── vista de líneas ─────────────────────────────────────────────── */
  return (
    <div className="max-w-lg mx-auto pt-4 px-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => { setSesionId(null); setLineas([]); }}
            className="text-slate-500 hover:text-slate-700">
            <ArrowLeft size={18} />
          </button>
          <Scale size={18} className="text-slate-700" />
          <h2 className="font-bold text-slate-800">
            {sesiones.find(s => s.id === sesionId)?.nombre}
          </h2>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader size={14} className="animate-spin" /> Cargando líneas…
        </div>
      )}

      {!loading && lineas.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-8">
          Sin líneas en esta sesión aún.
        </p>
      )}

      {!loading && lineas.length > 0 && (
        <div className="flex gap-3 text-xs">
          <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full font-medium">
            {pendientes.length} pendientes
          </span>
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
            {conciliadas.length} conciliadas
          </span>
          {descartadas.length > 0 && (
            <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-full font-medium">
              {descartadas.length} descartadas
            </span>
          )}
        </div>
      )}

      {flash && (
        <div className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2
          ${flash.type === "ok" ? "bg-green-50 text-green-700"
          : flash.type === "warn" ? "bg-amber-50 text-amber-700"
          : "bg-red-50 text-red-700"}`}>
          <CheckCircle size={14} /> {flash.msg}
        </div>
      )}

      {lineas.map(l => {
        const ub = ubicaciones[l.ubicacion_id];
        const pr = presentaciones[l.presentacion_id];
        const diff = l.cantidad_conteo_1 != null && l.cantidad_conteo_2 != null
          ? Math.abs(l.cantidad_conteo_1 - l.cantidad_conteo_2) : null;

        return (
          <div key={l.id} className={`bg-white border rounded-xl overflow-hidden
            ${l.estado === "PENDIENTE" ? "border-amber-300" : "border-slate-200"}`}>

            {/* cabecera */}
            <button className="w-full text-left px-4 py-3 flex items-center justify-between"
              onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
              <div>
                <p className="font-medium text-sm text-slate-800">
                  {pr?.producto?.nombre} · {pr?.nombre}
                </p>
                <p className="text-xs text-slate-500">{labelUbicacion(ub)}</p>
              </div>
              <div className="flex items-center gap-2">
                {l.estado === "PENDIENTE" && diff != null && diff > 0 && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                    <AlertTriangle size={12} /> Δ {diff}
                  </span>
                )}
                {l.estado === "CONCILIADA" && <CheckCircle size={16} className="text-green-500" />}
                {l.estado === "DESCARTADA" && <XCircle size={16} className="text-slate-400" />}
                {guardando === l.id && <Loader size={14} className="animate-spin text-blue-500" />}
                {expanded === l.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </button>

            {/* detalle */}
            {expanded === l.id && (
              <div className="border-t px-4 py-3 space-y-3 bg-slate-50">
                {/* conteos */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white border rounded-lg p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">
                      Conteo 1{l.contador_1 ? ` · ${l.contador_1}` : ""}
                    </p>
                    <p className="text-2xl font-bold text-slate-800">
                      {l.cantidad_conteo_1 ?? "—"}
                    </p>
                  </div>
                  <div className="bg-white border rounded-lg p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">
                      Conteo 2{l.contador_2 ? ` · ${l.contador_2}` : ""}
                    </p>
                    <p className="text-2xl font-bold text-slate-800">
                      {l.cantidad_conteo_2 ?? "—"}
                    </p>
                  </div>
                </div>

                {l.estado === "PENDIENTE" && (
                  <>
                    {/* opciones rápidas */}
                    <div className="flex gap-2">
                      {l.cantidad_conteo_1 != null && (
                        <button onClick={() => conciliar(l, l.cantidad_conteo_1, "MANUAL")}
                          disabled={!!guardando}
                          className="flex-1 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50">
                          Usar conteo 1 ({l.cantidad_conteo_1})
                        </button>
                      )}
                      {l.cantidad_conteo_2 != null && (
                        <button onClick={() => conciliar(l, l.cantidad_conteo_2, "MANUAL")}
                          disabled={!!guardando}
                          className="flex-1 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50">
                          Usar conteo 2 ({l.cantidad_conteo_2})
                        </button>
                      )}
                    </div>

                    {/* cantidad manual */}
                    <div className="flex gap-2">
                      <input
                        type="number" min="0" step="any"
                        placeholder="Cantidad manual…"
                        value={cantidadFinal[l.id] ?? ""}
                        onChange={e => setCantidadFinal(p => ({ ...p, [l.id]: e.target.value }))}
                        className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      <button
                        disabled={!!guardando}
                        onClick={() => {
                          const v = Number(cantidadFinal[l.id]);
                          if (!v || v < 0) return;
                          conciliar(l, v, "MANUAL");
                        }}
                        className="px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-500 disabled:opacity-50">
                        OK
                      </button>
                    </div>

                    <button onClick={() => descartar(l)} disabled={!!guardando}
                      className="w-full py-2 text-xs text-slate-500 border rounded-lg hover:bg-slate-100 disabled:opacity-50">
                      Descartar línea
                    </button>
                  </>
                )}

                {l.estado === "CONCILIADA" && (
                  <div className="text-xs text-green-700 space-y-1">
                    <p>Conciliada con <strong>{l.cantidad_conciliada}</strong> unidades</p>
                    <p>Base: <strong>{(l.cantidad_conciliada * l.factor_a_base_snap).toFixed(4)}</strong></p>
                    <p>Por: <strong>{l.resuelto_por}</strong> · Método: {l.metodo_resolucion}</p>
                  </div>
                )}

                {l.estado === "DESCARTADA" && (
                  <p className="text-xs text-slate-400">Descartada por {l.resuelto_por}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
