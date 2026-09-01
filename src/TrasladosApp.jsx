/**
 * TrasladosApp.jsx — Brief F: bandeja y despacho de traslados entre
 * sucursales (Almacén ↔ Tienda).
 *
 * La solicitud la crea el POS (crear_solicitud_traslado); acá solo se
 * despacha (con parcial opcional) o se rechaza. La recepción del lado de
 * Tienda no vive en esta bandeja (fuera de alcance de este brief).
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient";
import {
  despacharTraslado, recibirTraslado, cerrarSolicitudTraslado, stockDisponibleSucursal,
  codigosGrisPorProducto,
} from "./lib/operaciones";
import {
  listarBorradores, guardarBorrador, eliminarBorrador,
  estaVencido, antiguedadTexto, vencimientoTexto,
} from "./lib/borradores";
import { useUsuarioActual } from "./lib/useAuth";
import { useSucursal } from "./lib/useSucursal";
import CodigosLinea from "./CodigosLinea";
import {
  Truck, ChevronDown, ChevronUp, Loader, AlertTriangle, X, ArrowRight,
  Save, FileClock, Trash2, RotateCcw,
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

const ETIQUETA_ESTADO_LINEA = { RECHAZADO: "Rechazada", CAMBIADA: "Movida a faltante", RETIRADA: "Retirada" };

// Una línea "resuelta" (RECHAZADO/CAMBIADA/RETIRADA) ya no participa del
// despacho — no se reenvía al RPC ni se le ofrece el selector de acción.
function lineaResuelta(l) {
  return !!l.estado && l.estado !== "POR_DESPACHAR";
}

// Selector Despachar/Rechazar/Faltante por línea — a nivel de módulo (no
// dentro del render de SolicitudCard) para no recrear el tipo en cada
// pasada, mismo criterio que ThOrden en InventarioApp.jsx.
function SelectorAccionLinea({ accion, onChange }) {
  const opciones = [
    { id: "DESPACHAR", label: "Despachar" },
    { id: "RECHAZAR", label: "Rechazar" },
    { id: "FALTANTE", label: "Faltante" },
  ];
  return (
    <div className="flex gap-1">
      {opciones.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${accion === o.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TABS = [
  { id: "SOLICITADO", label: "Pendientes" },
  { id: "EN_TRANSITO", label: "En tránsito" },
  { id: "CERRADOS", label: "Cerrados" },
  { id: "BORRADORES", label: "Borradores" },
];
const ESTADOS_CERRADOS = ["RECIBIDO", "RECHAZADO", "CANCELADO"];

function SolicitudCard({
  solicitud, lineas, codigosPorProducto, borrador, onRefrescar,
  onAplicarDespacho, onCerrarSolicitud, onBorradorGuardado, onBorradorDescartado,
}) {
  const usuarioActual = useUsuarioActual();
  const { nombreSucursal } = useSucursal();
  const [abierto, setAbierto] = useState(false);
  const [cantidades, setCantidades] = useState({});
  // Decisión por línea pendiente: Despachar (default)/Rechazar/Faltante —
  // se resetea junto con `cantidades` cada vez que se abre la card.
  const [acciones, setAcciones] = useState({});
  const [stockAlmacen, setStockAlmacen] = useState(new Map());
  const [cargandoStock, setCargandoStock] = useState(false);
  const [despachando, setDespachando] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [mostrarRechazo, setMostrarRechazo] = useState(false);
  const [notaRechazo, setNotaRechazo] = useState("");
  const [flash, setFlash] = useState(null);
  const [guardandoBorrador, setGuardandoBorrador] = useState(false);
  const [recuperadoDeBorrador, setRecuperadoDeBorrador] = useState(false);
  // Confirmar recepción (EN_TRANSITO): por defecto se acepta todo lo
  // despachado — cantidadesRecepcion arranca prefijada a cantidad_despachada
  // por línea, editable para reportar faltante en tránsito.
  const [cantidadesRecepcion, setCantidadesRecepcion] = useState({});
  const [recibiendo, setRecibiendo] = useState(false);
  const [resultadoRecepcion, setResultadoRecepcion] = useState(null);

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(null), 5000); };
  const esPendiente = solicitud.estado === "SOLICITADO";
  const esEnTransito = solicitud.estado === "EN_TRANSITO";

  // Las cantidades editables viajan en la unidad que se muestra (presentación
  // si la línea la tiene, si no unidad base) — se convierten a cantidad_base
  // recién al armar el payload, la conversión es de UI. Si hay un borrador
  // guardado para esta solicitud, arranca desde ahí en vez del default
  // (cantidad completa pedida) — es la recuperación del brief S1.
  useEffect(() => {
    if (!abierto) return;
    const cantidadesBorrador = borrador?.contenido?.cantidades;
    if (cantidadesBorrador) {
      setCantidades(Object.fromEntries(
        lineas.map((l) => [l.id, cantidadesBorrador[l.id] ?? (l.presentacion_id ? l.cantidad_presentacion : l.cantidad_base)]),
      ));
      setRecuperadoDeBorrador(true);
    } else {
      setCantidades(Object.fromEntries(lineas.map((l) => [l.id, l.presentacion_id ? l.cantidad_presentacion : l.cantidad_base])));
      setRecuperadoDeBorrador(false);
    }
    setAcciones({});
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

  function accionDe(lineaId) {
    return acciones[lineaId] || "DESPACHAR";
  }
  function setAccionLinea(lineaId, accion) {
    setAcciones((prev) => ({ ...prev, [lineaId]: accion }));
  }

  // cantidad_despachada (y por lo tanto cantidad_recibida) siempre viaja en
  // unidad base — a diferencia de `cantidades` de arriba, acá no hace falta
  // convertir por presentación. Se seedea al render (no en un efecto) para
  // no disparar un render en cascada — mismo patrón que React recomienda
  // para "resetear estado cuando cambia una prop".
  const [seedRecepcionAbierto, setSeedRecepcionAbierto] = useState(false);
  if (abierto && esEnTransito && !seedRecepcionAbierto) {
    setSeedRecepcionAbierto(true);
    setCantidadesRecepcion(Object.fromEntries(lineas.map((l) => [l.id, String(l.cantidad_despachada ?? 0)])));
    setResultadoRecepcion(null);
  } else if (!abierto && seedRecepcionAbierto) {
    setSeedRecepcionAbierto(false);
  }

  function actualizarCantidadRecepcion(lineaId, valor) {
    setCantidadesRecepcion((prev) => ({ ...prev, [lineaId]: valor }));
  }

  async function handleGuardarBorrador() {
    setGuardandoBorrador(true);
    const { data, error } = await guardarBorrador({
      id: borrador?.id,
      tipo: "TRASLADO",
      sucursalId: solicitud.sucursal_origen_id,
      titulo: `Traslado #${solicitud.id} · despacho parcial`,
      contenido: { solicitud_id: solicitud.id, cantidades },
      usuarioId: usuarioActual.id,
    });
    setGuardandoBorrador(false);
    if (error) { showFlash(error.message); return; }
    onBorradorGuardado(data);
    showFlash("Borrador guardado");
  }

  async function handleDescartarBorrador() {
    if (!borrador) return;
    const { error } = await eliminarBorrador(borrador.id);
    if (error) { showFlash(error.message); return; }
    onBorradorDescartado(borrador.id);
    setRecuperadoDeBorrador(false);
  }

  function cantidadBaseDe(l) {
    const factor = l.presentacion_id ? Number(l.presentacion?.factor_unidad_base || 1) : 1;
    return (Number(cantidades[l.id]) || 0) * factor;
  }

  async function confirmarDespacho() {
    // Una línea ya resuelta (de un intento previo dentro de la misma
    // apertura de la card, p.ej. bloqueada por stock la vez pasada y ahora
    // sí) no se reenvía — "no incluida en el array" la deja intacta del
    // lado del RPC, así que ni la mandamos.
    const pendientes = lineas.filter((l) => !lineaResuelta(l));
    const invalidas = pendientes.filter((l) => accionDe(l.id) === "DESPACHAR" && (Number.isNaN(cantidadBaseDe(l)) || cantidadBaseDe(l) < 0));
    if (invalidas.length > 0) { showFlash("Cantidad inválida"); return; }
    const sinDecidir = pendientes.filter((l) => accionDe(l.id) === "DESPACHAR" && cantidadBaseDe(l) === 0);
    if (sinDecidir.length > 0) { showFlash("Elegí Rechazar o Faltante para las líneas en 0"); return; }
    if (pendientes.length === 0) return;

    const lineasPayload = pendientes.map((l) => {
      const accion = accionDe(l.id);
      if (accion !== "DESPACHAR") return { linea_id: l.id, accion };
      return { linea_id: l.id, accion: "DESPACHAR", cantidad_base: cantidadBaseDe(l) };
    });
    setDespachando(true);
    const { resultado, error } = await despacharTraslado({ solicitudId: solicitud.id, lineas: lineasPayload, usuario: usuarioActual.nombre });
    setDespachando(false);
    if (error) { showFlash(error.message); return; }
    // El borrador cubre "cantidades a despachar" — una vez que se manda el
    // despacho (aunque haya quedado algo bloqueado por stock) ya cumplió su
    // función, no queda nada que retomar de él.
    if (borrador) await eliminarBorrador(borrador.id);

    const accionesPorLinea = Object.fromEntries(pendientes.map((l) => [l.id, accionDe(l.id)]));
    const cantidadesBasePorLinea = Object.fromEntries(pendientes.map((l) => [l.id, cantidadBaseDe(l)]));
    onAplicarDespacho(solicitud.id, resultado, { accionesPorLinea, cantidadesBasePorLinea });
  }

  async function confirmarRechazo() {
    if (!notaRechazo.trim()) { showFlash("La nota es obligatoria para rechazar"); return; }
    if (!window.confirm("¿Confirmar rechazo de esta solicitud de traslado?")) return;
    setRechazando(true);
    const { error } = await cerrarSolicitudTraslado({ solicitudId: solicitud.id, estado: "RECHAZADO", usuario: usuarioActual.nombre, nota: notaRechazo.trim() });
    setRechazando(false);
    if (error) { showFlash(error.message); return; }
    onCerrarSolicitud(solicitud.id, "RECHAZADO");
  }

  async function confirmarRecepcion() {
    const lineasPayload = lineas.map((l) => ({
      linea_id: l.id,
      cantidad_base: Number(cantidadesRecepcion[l.id]),
    }));
    if (lineasPayload.some((l) => isNaN(l.cantidad_base) || l.cantidad_base < 0)) { showFlash("Cantidad inválida"); return; }
    setRecibiendo(true);
    const { resultado, error } = await recibirTraslado({ solicitudId: solicitud.id, lineas: lineasPayload, usuario: usuarioActual.nombre });
    setRecibiendo(false);
    if (error) { showFlash(error.message); return; }
    // No se refresca todavía — la solicitud pasaría a RECIBIDO y esta card
    // desaparecería de "En tránsito" antes de que se vea si hubo faltante.
    // Se refresca recién cuando el usuario confirma haber visto el resultado.
    setResultadoRecepcion(resultado);
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
        {borrador && (
          <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700" title="Tiene un borrador guardado">
            <FileClock size={11} /> borrador
          </span>
        )}
        <span className="text-xs text-slate-400">{lineas.length} línea{lineas.length === 1 ? "" : "s"}</span>
      </button>

      {abierto && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          {flash && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={12} /> {flash}
            </div>
          )}
          {recuperadoDeBorrador && borrador && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <span className="flex items-center gap-1.5">
                <RotateCcw size={12} />
                Cantidades recuperadas de un borrador de hace {antiguedadTexto(borrador.actualizado_en)} — revisá el stock, puede haber cambiado.
              </span>
              <button onClick={handleDescartarBorrador} className="shrink-0 underline hover:text-blue-900">
                Descartar
              </button>
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
              const resuelta = lineaResuelta(l);
              const accionLinea = accionDe(l.id);
              const stock = stockAlmacen.get(l.producto_id);
              const cantidadBaseIngresada = cantidadBaseDe(l);
              const noAlcanza = esPendiente && !resuelta && accionLinea === "DESPACHAR" && stock != null && cantidadBaseIngresada > stock;
              const unidadEditable = l.presentacion_id ? l.presentacion?.nombre : l.producto?.unidad_base;
              return (
                <div key={l.id} className={`rounded-lg border border-slate-200 px-3 py-2 ${resuelta ? "opacity-50" : ""}`}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium text-slate-800 ${resuelta ? "line-through" : ""}`}>{l.producto?.nombre}</p>
                      {l.producto?.sku_interno && <p className="text-xs text-slate-400">{l.producto.sku_interno}</p>}
                      <CodigosLinea codigos={codigosPorProducto?.get(l.producto_id)} marca={l.producto?.marca} />
                      {l.presentacion_id && l.presentacion && (
                        <p className="text-xs text-slate-400">
                          Pedido: {cantidadFmt(l.cantidad_presentacion)} {l.presentacion.nombre}
                          <span className="block">= {cantidadFmt(l.cantidad_base)} {l.producto?.unidad_base}</span>
                        </p>
                      )}
                    </div>
                    {resuelta ? (
                      <span className="text-sm font-mono text-slate-500 line-through">
                        {cantidadFmt(l.cantidad_despachada ?? l.cantidad_base)}
                      </span>
                    ) : esPendiente ? (
                      accionLinea === "DESPACHAR" ? (
                        <input type="number" min="0" step="any" value={cantidades[l.id] ?? ""}
                          onChange={(e) => actualizarCantidad(l.id, e.target.value)}
                          className="w-24 rounded-lg border px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-300" />
                      ) : (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${accionLinea === "RECHAZAR" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {accionLinea === "RECHAZAR" ? "Se rechaza" : "Va a faltante"}
                        </span>
                      )
                    ) : esEnTransito && !resultadoRecepcion ? (
                      <input type="number" min="0" max={l.cantidad_despachada} step="any" value={cantidadesRecepcion[l.id] ?? ""}
                        onChange={(e) => actualizarCantidadRecepcion(l.id, e.target.value)}
                        className="w-24 rounded-lg border px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-300" />
                    ) : (
                      <span className="text-sm font-mono text-slate-600">{cantidadFmt(l.cantidad_despachada)}</span>
                    )}
                    <span className="text-xs text-slate-400">{esPendiente && !resuelta ? unidadEditable : l.producto?.unidad_base}</span>
                  </div>

                  {resuelta && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {ETIQUETA_ESTADO_LINEA[l.estado] || l.estado}
                      </span>
                      {l.estado === "CAMBIADA" && (
                        <span className="text-xs text-slate-400">
                          {l.tandaFaltanteId ? `→ va en el traslado #${l.tandaFaltanteId}` : "→ movida a faltante"}
                        </span>
                      )}
                    </div>
                  )}

                  {esPendiente && !resuelta && (
                    <div className="mt-2">
                      <SelectorAccionLinea accion={accionLinea} onChange={(a) => setAccionLinea(l.id, a)} />
                    </div>
                  )}

                  {esPendiente && !resuelta && accionLinea === "DESPACHAR" && (
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

                  {esPendiente && !resuelta && l.bloqueoStock && (
                    <p className="mt-1.5 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">
                      No se pudo despachar: faltan {cantidadFmt(l.bloqueoStock.faltan)} {l.producto?.unidad_base}. Ajustá el inventario e intentá de nuevo.
                    </p>
                  )}

                  {esEnTransito && !resultadoRecepcion && (
                    <p className="mt-1 text-xs text-slate-400">Despachado: {cantidadFmt(l.cantidad_despachada)} {l.producto?.unidad_base}</p>
                  )}
                  {!esPendiente && !resuelta && !l.presentacion_id && (
                    <p className="mt-1 text-xs text-slate-400">Pedido: {cantidadFmt(l.cantidad_base)} {l.producto?.unidad_base}</p>
                  )}
                  {!esPendiente && !resuelta && l.cantidad_recibida != null && (
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
              <div className="flex gap-2">
                <button onClick={confirmarDespacho} disabled={despachando}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                  {despachando && <Loader size={14} className="animate-spin" />}
                  {despachando ? "Despachando…" : "Despachar"}
                </button>
                <button onClick={handleGuardarBorrador} disabled={guardandoBorrador}
                  title="Guardar borrador — conservá lo que llevás cargado sin despachar todavía"
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                  {guardandoBorrador ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                </button>
              </div>
              {borrador && !recuperadoDeBorrador && (
                <p className="text-xs text-slate-400">
                  Borrador guardado hace {antiguedadTexto(borrador.actualizado_en)} ({vencimientoTexto(borrador)}).{" "}
                  <button onClick={handleDescartarBorrador} className="underline hover:text-slate-600">Descartar</button>
                </p>
              )}

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

          {esEnTransito && !resultadoRecepcion && (
            <button onClick={confirmarRecepcion} disabled={recibiendo}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
              {recibiendo && <Loader size={14} className="animate-spin" />}
              {recibiendo ? "Confirmando…" : "Confirmar recepción"}
            </button>
          )}

          {esEnTransito && resultadoRecepcion && (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-medium text-emerald-800">
                Recepción confirmada
                {resultadoRecepcion.lineas_con_faltante > 0
                  ? ` — ${resultadoRecepcion.lineas_con_faltante} línea${resultadoRecepcion.lineas_con_faltante === 1 ? "" : "s"} con faltante`
                  : ", sin faltante"}
              </p>
              {resultadoRecepcion.faltantes?.length > 0 && (
                <ul className="space-y-1 text-xs text-amber-700">
                  {resultadoRecepcion.faltantes.map((f) => {
                    const l = lineas.find((x) => x.id === f.linea_id);
                    return (
                      <li key={f.linea_id} className="flex items-start gap-1.5">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span>
                          {l?.producto?.nombre || `Línea ${f.linea_id}`}: despachado {cantidadFmt(f.despachado)}, recibido {cantidadFmt(f.recibido)} — faltan {cantidadFmt(f.faltante)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button onClick={onRefrescar}
                className="w-full rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
                Listo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrasladosApp() {
  const { sucursalActivaId } = useSucursal();
  const [tab, setTab] = useState("SOLICITADO");
  const [solicitudes, setSolicitudes] = useState([]);
  const [lineasPorSolicitud, setLineasPorSolicitud] = useState({});
  const [codigosPorProducto, setCodigosPorProducto] = useState(new Map());
  const [cargando, setCargando] = useState(true);
  const [borradores, setBorradores] = useState([]);

  const cargar = useCallback(async () => {
    if (!sucursalActivaId) return;
    setCargando(true);
    // Un traslado es relevante para la sucursal activa cuando es origen O
    // destino — un traslado hacia Tienda tiene que aparecerle a Tienda para
    // recibirlo y a Almacén para despacharlo, pero no a una tercera
    // sucursal ajena (incluye el caso Tienda ↔ Almacén, no solo Almacén).
    let consulta = supabase
      .from("solicitud_traslado")
      .select("*")
      .or(`sucursal_origen_id.eq.${sucursalActivaId},sucursal_destino_id.eq.${sucursalActivaId}`)
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
  }, [tab, sucursalActivaId]);

  const cargarBorradores = useCallback(async () => {
    const { data } = await listarBorradores({ tipo: "TRASLADO" });
    setBorradores(data);
  }, []);

  // Consulta puntual de UNA solicitud (la tanda de faltantes recién creada
  // por un despacho) — no un cargar() completo, solo para que la tanda
  // nueva aparezca sin esperar al próximo refresco manual/cambio de tab.
  const cargarSolicitudPuntual = useCallback(async (solicitudId) => {
    const { data: sol } = await supabase
      .from("solicitud_traslado").select("*").eq("id", solicitudId).maybeSingle();
    if (!sol) return;
    const { data: lineas } = await supabase
      .from("solicitud_traslado_linea")
      .select("*, producto:producto_id(id, nombre, sku_interno, unidad_base, marca), presentacion:presentacion_id(nombre, factor_unidad_base)")
      .eq("solicitud_id", solicitudId)
      .order("id");
    setSolicitudes((prev) => (prev.some((s) => s.id === sol.id) ? prev : [sol, ...prev]));
    setLineasPorSolicitud((prev) => ({ ...prev, [sol.id]: lineas || [] }));
    const codigosNuevos = await codigosGrisPorProducto((lineas || []).map((l) => l.producto_id));
    setCodigosPorProducto((prev) => new Map([...prev, ...codigosNuevos]));
  }, []);

  // Saca la solicitud de la lista en memoria si su nuevo estado ya no
  // pertenece a la pestaña activa, o la deja con el estado actualizado si
  // sigue perteneciendo — sin volver a golpear la red.
  const patchEstadoSolicitud = useCallback((solicitudId, estado) => {
    setSolicitudes((prev) => {
      const sigueEnTab = estado === tab || (tab === "CERRADOS" && ESTADOS_CERRADOS.includes(estado));
      if (!sigueEnTab) return prev.filter((s) => s.id !== solicitudId);
      return prev.map((s) => (s.id === solicitudId ? { ...s, estado } : s));
    });
  }, [tab]);

  // Parche local tras un despacho (parcial o total) — arregla el problema
  // de fondo de este brief: onRefrescar() en cada acción encadenaba
  // consultas de sobra y, si el token vencía en medio de una ráfaga de
  // despachos seguidos, la renovación chocaba con el rate-limit de
  // Supabase y expulsaba al usuario al login. despachar_traslado ya
  // devuelve todo lo necesario para actualizar en memoria: no hace falta
  // un select nuevo salvo, opcionalmente, por la tanda de faltantes nueva.
  const aplicarResultadoAccion = useCallback((solicitudId, resultado, contexto = {}) => {
    const { accionesPorLinea = {}, cantidadesBasePorLinea = {} } = contexto;
    const rechazadasIds = new Set((resultado.rechazadas || []).map((r) => r.linea_id));
    const bloqueadasPorLinea = new Map((resultado.bloqueadas_por_stock || []).map((b) => [b.linea_id, b]));

    setLineasPorSolicitud((prev) => {
      const actuales = prev[solicitudId];
      if (!actuales) return prev;
      return {
        ...prev,
        [solicitudId]: actuales.map((l) => {
          if (l.estado && l.estado !== "POR_DESPACHAR") return l; // ya resuelta antes, no tocar
          if (rechazadasIds.has(l.id)) return { ...l, estado: "RECHAZADO", bloqueoStock: null };
          if (bloqueadasPorLinea.has(l.id)) return { ...l, bloqueoStock: bloqueadasPorLinea.get(l.id) };
          const accion = accionesPorLinea[l.id];
          if (accion === "FALTANTE") {
            return { ...l, estado: "CAMBIADA", tandaFaltanteId: resultado.tanda_faltante_id ?? null, bloqueoStock: null };
          }
          if (accion === "DESPACHAR") {
            return {
              ...l,
              estado: "DESPACHADA",
              cantidad_despachada: cantidadesBasePorLinea[l.id] ?? l.cantidad_despachada,
              bloqueoStock: null,
            };
          }
          return l; // línea que no se mandó en esta pasada (ya resuelta o no incluida)
        }),
      };
    });

    patchEstadoSolicitud(solicitudId, resultado.estado);

    if (resultado.tanda_faltante_id && tab === "SOLICITADO") {
      cargarSolicitudPuntual(resultado.tanda_faltante_id);
    }
  }, [tab, patchEstadoSolicitud, cargarSolicitudPuntual]);

  useEffect(() => { cargar(); }, [cargar]);
  // Independiente de la pestaña activa: el badge "borrador" en Pendientes
  // necesita el mapa aunque el usuario haya abierto Traslados en Cerrados.
  useEffect(() => { cargarBorradores(); }, [cargarBorradores]);

  const borradorPorSolicitud = useMemo(() => {
    const m = new Map();
    for (const b of borradores) {
      const solId = b.contenido?.solicitud_id;
      if (solId != null) m.set(solId, b);
    }
    return m;
  }, [borradores]);

  const actualizarBorrador = (b) => {
    setBorradores((prev) => {
      const sinEste = prev.filter((x) => x.id !== b.id);
      return [b, ...sinEste];
    });
  };
  const quitarBorrador = (id) => {
    setBorradores((prev) => prev.filter((b) => b.id !== id));
  };

  return (
    <div className="max-w-2xl mx-auto pt-4 px-4 pb-8 space-y-4">
      <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
        <Truck size={20} /> Traslados
      </h1>

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${tab === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {t.label}
            {t.id === "BORRADORES" && borradores.length > 0 && (
              <span className={`rounded-full px-1.5 text-xs ${tab === t.id ? "bg-white/20" : "bg-slate-300 text-slate-700"}`}>
                {borradores.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "BORRADORES" ? (
        <BandejaBorradores
          borradores={borradores}
          onIrASolicitud={() => setTab("SOLICITADO")}
          onDescartado={quitarBorrador}
        />
      ) : cargando ? (
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
              borrador={borradorPorSolicitud.get(s.id)}
              onRefrescar={cargar}
              onAplicarDespacho={aplicarResultadoAccion}
              onCerrarSolicitud={patchEstadoSolicitud}
              onBorradorGuardado={actualizarBorrador}
              onBorradorDescartado={quitarBorrador}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Bandeja de borradores (Brief S1): título, antigüedad y cuánto le queda
// antes de expirar. Un borrador vencido sigue apareciendo acá — el barrido
// que lo borra de verdad corre a los 7 días, no al leer.
function BandejaBorradores({ borradores, onIrASolicitud, onDescartado }) {
  const [descartando, setDescartando] = useState(null);

  async function descartar(id) {
    setDescartando(id);
    const { error } = await eliminarBorrador(id);
    setDescartando(null);
    if (!error) onDescartado(id);
  }

  if (borradores.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
        <FileClock size={32} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm text-slate-400">No tenés borradores guardados.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {borradores.map((b) => {
        const vencido = estaVencido(b);
        return (
          <div key={b.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <FileClock size={16} className={vencido ? "text-slate-300" : "text-blue-500"} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">{b.titulo || `Traslado #${b.contenido?.solicitud_id}`}</p>
              <p className="text-xs text-slate-400">
                Guardado hace {antiguedadTexto(b.actualizado_en)}
                {" · "}
                {vencido
                  ? <span className="font-semibold text-amber-600">vencido</span>
                  : vencimientoTexto(b)}
              </p>
            </div>
            <button onClick={onIrASolicitud}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
              Ir a Pendientes
            </button>
            <button onClick={() => descartar(b.id)} disabled={descartando === b.id}
              className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50">
              {descartando === b.id ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
