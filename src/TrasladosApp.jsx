/**
 * TrasladosApp.jsx — Brief F: bandeja y despacho de traslados entre
 * sucursales (Almacén ↔ Tienda).
 *
 * La solicitud la crea el POS (crear_solicitud_traslado); acá solo se
 * despacha (con parcial opcional) o se rechaza. La recepción del lado de
 * Tienda no vive en esta bandeja (fuera de alcance de este brief).
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import {
  despacharTraslado, cerrarSolicitudTraslado, stockDisponibleSucursal,
  codigosGrisPorProducto,
} from "./lib/operaciones";
import { useUsuarioActual } from "./lib/useAuth";
import { useSucursal } from "./lib/useSucursal";
import CodigosLinea from "./CodigosLinea";
import {
  Truck, ChevronDown, ChevronUp, Loader, AlertTriangle, X, ArrowRight,
} from "lucide-react";

function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
function fechaFmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const MOTIVO_LABELS = { VENTA_DIRECTA: "Venta directa", REPOSICION: "Reposición", DEVOLUCION: "Devolución" };

const TABS = [
  { id: "SOLICITADO", label: "Pendientes" },
  { id: "EN_TRANSITO", label: "En tránsito" },
  { id: "CERRADOS", label: "Cerrados" },
];
const ESTADOS_CERRADOS = ["RECIBIDO", "RECHAZADO", "CANCELADO"];

function SolicitudCard({ solicitud, lineas, codigosPorProducto, onRefrescar }) {
  const usuarioActual = useUsuarioActual();
  const { nombreSucursal } = useSucursal();
  const [abierto, setAbierto] = useState(false);
  const [cantidades, setCantidades] = useState({});
  const [stockAlmacen, setStockAlmacen] = useState(new Map());
  const [cargandoStock, setCargandoStock] = useState(false);
  const [despachando, setDespachando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [mostrarRechazo, setMostrarRechazo] = useState(false);
  const [notaRechazo, setNotaRechazo] = useState("");
  const [flash, setFlash] = useState(null);

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 5000); };
  const esPendiente = solicitud.estado === "SOLICITADO";

  // Las cantidades editables viajan en la unidad que se muestra (presentación
  // si la línea la tiene, si no unidad base) — se convierten a cantidad_base
  // recién al armar el payload, la conversión es de UI.
  useEffect(() => {
    if (!abierto) return;
    setCantidades(Object.fromEntries(lineas.map((l) => [l.id, l.presentacion_id ? l.cantidad_presentacion : l.cantidad_base])));
    if (!esPendiente) return;
    let activo = true;
    setCargandoStock(true);
    stockDisponibleSucursal(lineas.map((l) => l.producto_id), solicitud.sucursal_origen_id)
      .then((mapa) => { if (activo) { setStockAlmacen(mapa); setCargandoStock(false); } });
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  function actualizarCantidad(lineaId, valor) {
    setCantidades((prev) => ({ ...prev, [lineaId]: valor }));
  }

  function cantidadBaseDe(l) {
    const factor = l.presentacion_id ? Number(l.presentacion?.factor_unidad_base || 1) : 1;
    return (Number(cantidades[l.id]) || 0) * factor;
  }

  async function confirmarDespacho() {
    const lineasPayload = lineas.map((l) => ({ linea_id: l.id, cantidad_base: cantidadBaseDe(l) }));
    if (lineasPayload.some((l) => l.cantidad_base < 0)) { showFlash("Cantidad inválida"); return; }
    setDespachando(true);
    const { error } = await despacharTraslado({ solicitudId: solicitud.id, lineas: lineasPayload, usuario: usuarioActual.nombre });
    setDespachando(false);
    if (error) { showFlash(error.message); return; }
    onRefrescar();
  }

  async function confirmarRechazo() {
    if (!notaRechazo.trim()) { showFlash("La nota es obligatoria para rechazar"); return; }
    if (!window.confirm("¿Confirmar rechazo de esta solicitud de traslado?")) return;
    setRechazando(true);
    const { error } = await cerrarSolicitudTraslado({ solicitudId: solicitud.id, estado: "RECHAZADO", usuario: usuarioActual.nombre, nota: notaRechazo.trim() });
    setRechazando(false);
    if (error) { showFlash(error.message); return; }
    onRefrescar();
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {abierto ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">
            Traslado #{solicitud.id} · {MOTIVO_LABELS[solicitud.motivo] || solicitud.motivo}
          </p>
          <p className="text-xs text-slate-400 flex items-center gap-1">
            {nombreSucursal(solicitud.sucursal_origen_id)} <ArrowRight size={11} /> {nombreSucursal(solicitud.sucursal_destino_id)}
            {" · "}{solicitud.solicitado_por} · {fechaFmt(solicitud.solicitado_en)}
          </p>
        </div>
        <span className="text-xs text-slate-400">{lineas.length} línea{lineas.length === 1 ? "" : "s"}</span>
      </button>

      {abierto && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          {flash && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={12} /> {flash}
            </div>
          )}

          {(solicitud.referencia || solicitud.nota) && (
            <p className="text-xs text-slate-500">
              {solicitud.referencia && <span>Ref: {solicitud.referencia}</span>}
              {solicitud.referencia && solicitud.nota && " · "}
              {solicitud.nota && <span>{solicitud.nota}</span>}
            </p>
          )}

          <div className="space-y-2">
            {lineas.map((l) => {
              const stock = stockAlmacen.get(l.producto_id);
              const cantidadBaseIngresada = cantidadBaseDe(l);
              const noAlcanza = esPendiente && stock != null && cantidadBaseIngresada > stock;
              const unidadEditable = l.presentacion_id ? l.presentacion?.nombre : l.producto?.unidad_base;
              return (
                <div key={l.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">{l.producto?.nombre}</p>
                      {l.producto?.sku_interno && <p className="text-xs text-slate-400">{l.producto.sku_interno}</p>}
                      <CodigosLinea codigos={codigosPorProducto?.get(l.producto_id)} marca={l.producto?.marca} />
                      {l.presentacion_id && l.presentacion && (
                        <p className="text-xs text-slate-400">
                          Pedido: {cantidadFmt(l.cantidad_presentacion)} {l.presentacion.nombre}
                          <span className="block">= {cantidadFmt(l.cantidad_base)} {l.producto?.unidad_base}</span>
                        </p>
                      )}
                    </div>
                    {esPendiente ? (
                      <input type="number" min="0" step="any" value={cantidades[l.id] ?? ""}
                        onChange={(e) => actualizarCantidad(l.id, e.target.value)}
                        className="w-24 rounded-lg border px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    ) : (
                      <span className="text-sm font-mono text-slate-600">{cantidadFmt(l.cantidad_despachada)}</span>
                    )}
                    <span className="text-xs text-slate-400">{esPendiente ? unidadEditable : l.producto?.unidad_base}</span>
                  </div>
                  {esPendiente && (
                    <>
                      {l.presentacion_id && (
                        <p className="mt-1 text-xs text-slate-400">= {cantidadFmt(cantidadBaseIngresada)} {l.producto?.unidad_base}</p>
                      )}
                      <p className={`mt-1 text-xs ${noAlcanza ? "text-red-600" : "text-slate-400"}`}>
                        {cargandoStock ? "Consultando stock…" : stock != null
                          ? `Stock en ${nombreSucursal(solicitud.sucursal_origen_id)}: ${cantidadFmt(stock)}${noAlcanza ? " — no alcanza" : ""}`
                          : null}
                      </p>
                    </>
                  )}
                  {!esPendiente && !l.presentacion_id && (
                    <p className="mt-1 text-xs text-slate-400">Pedido: {cantidadFmt(l.cantidad_base)} {l.producto?.unidad_base}</p>
                  )}
                  {!esPendiente && l.cantidad_recibida != null && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                      Recibido: {cantidadFmt(l.cantidad_recibida)} {l.producto?.unidad_base}
                      {Number(l.cantidad_recibida) < Number(l.cantidad_despachada) && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          faltan {cantidadFmt(Number(l.cantidad_despachada) - Number(l.cantidad_recibida))}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {esPendiente && (
            <div className="space-y-2">
              <button onClick={confirmarDespacho} disabled={despachando}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                {despachando && <Loader size={14} className="animate-spin" />}
                {despachando ? "Despachando…" : "Despachar"}
              </button>

              {!mostrarRechazo ? (
                <button onClick={() => setMostrarRechazo(true)} className="text-xs text-red-600 underline">
                  Rechazar solicitud
                </button>
              ) : (
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                  <input value={notaRechazo} onChange={(e) => setNotaRechazo(e.target.value)}
                    placeholder="Nota del rechazo *"
                    className="w-full rounded-lg border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300" />
                  <div className="flex gap-2">
                    <button onClick={confirmarRechazo} disabled={rechazando}
                      className="flex-1 rounded-lg bg-red-600 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
                      {rechazando ? "Guardando…" : "Confirmar rechazo"}
                    </button>
                    <button onClick={() => setMostrarRechazo(false)} className="rounded-lg border px-3 py-1.5 text-sm text-slate-500">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrasladosApp() {
  const [tab, setTab] = useState("SOLICITADO");
  const [solicitudes, setSolicitudes] = useState([]);
  const [lineasPorSolicitud, setLineasPorSolicitud] = useState({});
  const [codigosPorProducto, setCodigosPorProducto] = useState(new Map());
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    let consulta = supabase
      .from("solicitud_traslado")
      .select("*")
      .order("creado_en", { ascending: false });
    consulta = tab === "CERRADOS"
      ? consulta.in("estado", ESTADOS_CERRADOS).limit(50)
      : consulta.eq("estado", tab).limit(200);
    const { data: sol } = await consulta;

    const solIds = (sol || []).map((s) => s.id);
    const { data: lineas } = solIds.length
      ? await supabase.from("solicitud_traslado_linea")
          .select("*, producto:producto_id(id, nombre, sku_interno, unidad_base, marca), presentacion:presentacion_id(nombre, factor_unidad_base)")
          .in("solicitud_id", solIds)
          .order("id")
      : { data: [] };

    const grupo = {};
    for (const l of lineas || []) (grupo[l.solicitud_id] ||= []).push(l);
    const codigos = await codigosGrisPorProducto((lineas || []).map((l) => l.producto_id));

    setSolicitudes(sol || []);
    setLineasPorSolicitud(grupo);
    setCodigosPorProducto(codigos);
    setCargando(false);
  }, [tab]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="max-w-2xl mx-auto pt-4 px-4 pb-8 space-y-4">
      <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
        <Truck size={20} /> Traslados
      </h1>

      <div className="flex gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="py-16 text-center text-slate-400">
          <Loader size={16} className="mx-auto animate-spin" />
        </div>
      ) : solicitudes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <Truck size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">Sin solicitudes acá.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {solicitudes.map((s) => (
            <SolicitudCard
              key={s.id}
              solicitud={s}
              lineas={lineasPorSolicitud[s.id] || []}
              codigosPorProducto={codigosPorProducto}
              onRefrescar={cargar}
            />
          ))}
        </div>
      )}
    </div>
  );
}
