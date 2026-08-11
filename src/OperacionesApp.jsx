/**
 * OperacionesApp.jsx  —  Fase 4: Operaciones diarias
 * Cableado a Supabase real. Motor de operación en src/lib/operaciones.js.
 *
 * Reducido a Entrada / Traslado / Ajuste (Fase B): la Salida/venta vive
 * en el Catálogo ("Vender ahora"), que reusa el mismo motor compartido.
 *
 * Enum tipo_movimiento real: INV_INICIAL | ENTRADA | SALIDA | AJUSTE | TRASLADO
 * Columnas ubicacion: id, codigo_zona, estante, nivel, compartimiento
 * Columna producto: sku_interno (no sku)
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import TypeaheadProducto from "./TypeaheadProducto";
import {
  ubicacionesParaOperacion, stockEn,
  ejecutarOperacion, asegurarAsignacion,
} from "./lib/operaciones";
import { useUsuarioActual } from "./lib/useAuth";
import { useSucursal } from "./lib/useSucursal";
import { metaProducto } from "./lib/producto";
import {
  PackagePlus, ArrowLeftRight, SlidersHorizontal,
  AlertTriangle, CheckCircle, History, Code2, Loader, ScanLine, Package,
} from "lucide-react";

const MODOS = [
  { id: "ENTRADA",  label: "Entrada",  icon: PackagePlus,       color: "text-green-600" },
  { id: "TRASLADO", label: "Traslado", icon: ArrowLeftRight,    color: "text-blue-600"  },
  { id: "AJUSTE",   label: "Ajuste",   icon: SlidersHorizontal, color: "text-amber-600" },
];

// Ajuste es un movimiento sensible sin confirmación adicional hoy — se
// oculta para 'operario' (confirmado por Ness). Admin ve todo.
const MODOS_SOLO_ADMIN = new Set(["AJUSTE"]);

function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

// Texto informativo "≈ N paquetes de M" a partir de una cantidad en unidad
// base y la presentación de bulto del producto (si tiene una) — no editable,
// no afecta lo que se envía al backend (que siempre viaja en unidad base).
function textoAproxBulto(cantidadBaseStr, presentacionBulto) {
  if (!presentacionBulto || !cantidadBaseStr) return null;
  const n = Number(cantidadBaseStr);
  const factor = Number(presentacionBulto.factor_unidad_base);
  if (!n || n <= 0 || !factor) return null;
  const contenedor = (presentacionBulto.nombre.split(" ")[0] || "paquete").toLowerCase();
  const paquetes = n / factor;
  return `≈ ${cantidadFmt(paquetes)} ${contenedor}${paquetes === 1 ? "" : "s"} de ${cantidadFmt(factor)}`;
}

export default function OperacionesApp() {
  const usuarioActual = useUsuarioActual();
  const { nombreSucursal } = useSucursal();
  const modosVisibles = usuarioActual?.rol === "admin"
    ? MODOS
    : MODOS.filter((m) => !MODOS_SOLO_ADMIN.has(m.id));

  const [modo, setModo] = useState("ENTRADA");

  // presentaciones del producto actualmente seleccionado (NO el catálogo
  // completo — presentacion ya supera las 1.000 filas que Supabase/PostgREST
  // recorta en silencio sin .range()/.limit(); se pide solo lo que hace
  // falta, cuando hace falta, mismo criterio que ubicacionesParaOperacion).
  const [presentacionesProducto, setPresentacionesProducto] = useState([]);
  const [cargandoPresentaciones, setCargandoPresentaciones] = useState(false);

  // producto: typeahead
  const [productoSeleccionado, setProductoSeleccionado] = useState(null); // {id, nombre, sku_interno, unidad_base}
  const [queryProducto, setQueryProducto] = useState("");

  // ubicaciones filtradas por modo (Parte 2)
  const [ubicacionesOrigen, setUbicacionesOrigen] = useState([]);
  const [sinAsignacionOrigen, setSinAsignacionOrigen] = useState(false);
  const [ubicacionesDestino, setUbicacionesDestino] = useState([]);
  const [sinAsignacionDestino, setSinAsignacionDestino] = useState(false);

  // stock actual (consultado al elegir producto+ubicación)
  const [stockActual, setStockActual] = useState(null);
  const [loadingStock, setLoadingStock] = useState(false);

  // historial local de movimientos (solo sesión actual)
  const [movimientos, setMovimientos] = useState([]);

  // estado del formulario
  const [presentacionId, setPresentacionId] = useState("");
  const [ubicacionId, setUbicacionId] = useState("");
  const [ubicacionDestinoId, setUbicacionDestinoId] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [cantidadObjetivo, setCantidadObjetivo] = useState("");
  const [referencia, setReferencia] = useState("");
  const [motivo, setMotivo] = useState("");
  const [showSQL, setShowSQL] = useState(false);
  const [flash, setFlash] = useState(null);
  const [ejecutando, setEjecutando] = useState(false);

  // escáner
  const [showScanner, setShowScanner] = useState(false);
  const resolviendoRef = useRef(false);

  // presentación específica a preferir sobre la base al resolver el próximo
  // fetch de presentaciones (ej: escaneo de código que resuelve a una
  // presentación puntual) — sin esto, el efecto de abajo pisa la elección
  // del escaneo con la base en cuanto termina su fetch async.
  const presentacionPreferidaRef = useRef(null);

  /* ── presentaciones del producto elegido (puntual, no el catálogo) ─── */
  useEffect(() => {
    if (!productoSeleccionado) {
      setPresentacionesProducto([]);
      setPresentacionId("");
      return;
    }
    let cancelado = false;
    setCargandoPresentaciones(true);
    supabase
      .from("presentacion")
      .select("id, producto_id, nombre, factor_unidad_base, es_base")
      .eq("producto_id", productoSeleccionado.id)
      .eq("activo", true)
      .order("es_base", { ascending: false })
      .then(({ data }) => {
        if (cancelado) return;
        const lista = data || [];
        setPresentacionesProducto(lista);
        // Default siempre en la presentación base — nunca arrancar en la de
        // bulto, para minimizar el riesgo de una entrada ×N por error — salvo
        // que venga una preferencia puntual (ej: escaneo de código de barras).
        const preferida = presentacionPreferidaRef.current;
        presentacionPreferidaRef.current = null;
        const elegida = (preferida && lista.find((pr) => pr.id === preferida)) || lista.find((pr) => pr.es_base);
        setPresentacionId(elegida ? String(elegida.id) : "");
        setCargandoPresentaciones(false);
      });
    return () => { cancelado = true; };
  }, [productoSeleccionado]);

  const elegirProducto = useCallback((p, { presentacionIdPreferida } = {}) => {
    presentacionPreferidaRef.current = presentacionIdPreferida ?? null;
    setProductoSeleccionado(p);
    setQueryProducto("");
    setUbicacionId("");
    setUbicacionDestinoId("");
    setStockActual(null);
  }, []);

  /* ── ubicaciones de origen según modo (Parte 2) ───────────────────── */
  useEffect(() => {
    if (!productoSeleccionado) { setUbicacionesOrigen([]); setSinAsignacionOrigen(false); return; }
    let cancelado = false;
    const modoOrigen = modo === "TRASLADO" ? "TRASLADO_ORIGEN" : modo;
    // nombreSucursal antepone la sucursal al label en TRASLADO — por
    // definición cruza sucursales, y "PISO" a secas ya generó una
    // confusión real (brief W5 #5): se leyó como "se movió a otro lado"
    // en vez de "se movió a Tienda".
    ubicacionesParaOperacion({ productoId: productoSeleccionado.id, modo: modoOrigen, nombreSucursal: modo === "TRASLADO" ? nombreSucursal : undefined }).then(({ ubicaciones, sinAsignacion }) => {
      if (cancelado) return;
      setUbicacionesOrigen(ubicaciones);
      setSinAsignacionOrigen(sinAsignacion);
    });
    return () => { cancelado = true; };
  }, [productoSeleccionado, modo, nombreSucursal]);

  /* ── ubicaciones de destino (solo TRASLADO) ───────────────────────── */
  useEffect(() => {
    if (modo !== "TRASLADO" || !productoSeleccionado) { setUbicacionesDestino([]); setSinAsignacionDestino(false); return; }
    let cancelado = false;
    ubicacionesParaOperacion({ productoId: productoSeleccionado.id, modo: "TRASLADO_DESTINO", nombreSucursal }).then(({ ubicaciones, sinAsignacion }) => {
      if (cancelado) return;
      setUbicacionesDestino(ubicaciones.filter((u) => u.id !== Number(ubicacionId)));
      setSinAsignacionDestino(sinAsignacion);
    });
    return () => { cancelado = true; };
  }, [modo, productoSeleccionado, ubicacionId, nombreSucursal]);

  /* ── consultar stock cuando cambia producto+ubicación ────────────── */
  useEffect(() => {
    if (!productoSeleccionado || !ubicacionId) { setStockActual(null); return; }
    let cancelado = false;
    setLoadingStock(true);
    stockEn({ productoId: productoSeleccionado.id, ubicacionId }).then((v) => {
      if (cancelado) return;
      setStockActual(v);
      setLoadingStock(false);
    });
    return () => { cancelado = true; };
  }, [productoSeleccionado, ubicacionId]);

  const showFlash = (msg, type = "ok") => {
    setFlash({ msg, type });
    setTimeout(() => setFlash(null), 3000);
  };

  /* ── escaneo: resolver código → producto + presentación ───────────── */
  // resolver_identificador devuelve TODAS las filas activas que matchean el
  // código (valor no es único: el fabricante reusa código para bote y unidad).
  //   0 filas  -> no reconocido
  //   1 fila   -> autocompleta producto + presentación
  //   >1 filas -> setea producto y fuerza a elegir presentación (lo que pide el esquema)
  const handleScan = async (codigo) => {
    setShowScanner(false);
    const code = (codigo || "").trim();
    if (!code || resolviendoRef.current) return;
    resolviendoRef.current = true;
    const { data, error } = await supabase.rpc("resolver_identificador", { p_codigo: code });
    resolviendoRef.current = false;

    const flashMsg = (msg, type) => { setFlash({ msg, type }); setTimeout(() => setFlash(null), 3500); };
    const rows = Array.isArray(data) ? data : (data ? [data] : []);

    if (error || rows.length === 0) {
      flashMsg(`Código no reconocido: ${code}`, "warn");
      return;
    }

    const productosDistintos = [...new Set(rows.map((r) => r.producto_id))];

    if (productosDistintos.length === 1) {
      const { data: prod } = await supabase
        .from("producto")
        .select("id, nombre, sku_interno, marca, unidad_base")
        .eq("id", rows[0].producto_id)
        .single();
      if (prod) {
        elegirProducto(prod, {
          presentacionIdPreferida: rows.length === 1 ? Number(rows[0].presentacion_id) : null,
        });
      }

      if (rows.length === 1) {
        flashMsg(`${rows[0].producto_nombre} · ${rows[0].presentacion_nombre}`, "ok");
      } else {
        flashMsg(`${rows[0].producto_nombre}: ${rows.length} presentaciones con ese código, elegí cuál`, "warn");
      }
    } else {
      // caso raro: el código apunta a varios productos
      flashMsg(`Código ambiguo (${productosDistintos.length} productos), seleccioná manualmente`, "warn");
    }
  };

  const resetForm = () => {
    setProductoSeleccionado(null); setQueryProducto("");
    setPresentacionId(""); setUbicacionId(""); setUbicacionDestinoId("");
    setCantidad(""); setCantidadObjetivo("");
    setReferencia(""); setMotivo("");
    setStockActual(null);
  };

  const presentacion = presentacionesProducto.find((p) => p.id === Number(presentacionId));
  // Presentación de bulto (no-base) del producto, si tiene una — solo para
  // el texto informativo "≈ N paquetes" en Traslado/Ajuste (Parte B).
  const presentacionBulto = presentacionesProducto.find((p) => !p.es_base);
  const ubicacionLabel = ubicacionesOrigen.find((u) => u.id === Number(ubicacionId))?.label;
  const ubicacionDestinoLabel = ubicacionesDestino.find((u) => u.id === Number(ubicacionDestinoId))?.label;

  const cantidadBase = presentacion && cantidad
    ? Number(cantidad) * presentacion.factor_unidad_base : 0;

  const deltaAjuste = cantidadObjetivo !== "" && stockActual !== null
    ? Number(cantidadObjetivo) - Number(stockActual) : null;

  /* ── SQL preview ─────────────────────────────────────────────────── */
  const sqlPreview = useMemo(() => {
    const productoId = productoSeleccionado?.id;
    if (!presentacionId && modo !== "AJUSTE") return null;
    if (modo === "AJUSTE" && !productoId) return null;

    const usuarioSql = usuarioActual?.nombre || "?";
    if (modo === "ENTRADA") return (
      `SELECT registrar_entrada(\n` +
      `  p_presentacion_id => ${presentacionId},\n` +
      `  p_ubicacion_id    => ${ubicacionId || "?"},\n` +
      `  p_cantidad_pres   => ${cantidad || "?"},\n` +
      `  p_referencia      => '${referencia}',\n` +
      `  p_usuario         => '${usuarioSql}'\n);`
    );
    if (modo === "TRASLADO") return (
      `SELECT registrar_traslado(\n` +
      `  p_presentacion_id   => ${presentacionId},\n` +
      `  p_ubicacion_origen  => ${ubicacionId || "?"},\n` +
      `  p_ubicacion_destino => ${ubicacionDestinoId || "?"},\n` +
      `  p_cantidad_pres     => ${cantidad || "?"},\n` +
      `  p_referencia        => '${referencia}',\n` +
      `  p_usuario           => '${usuarioSql}'\n);`
    );
    if (modo === "AJUSTE") return (
      `SELECT registrar_ajuste(\n` +
      `  p_producto_id             => ${productoId},\n` +
      `  p_ubicacion_id            => ${ubicacionId || "?"},\n` +
      `  p_cantidad_base_objetivo  => ${cantidadObjetivo || "?"},\n` +
      `  p_motivo                  => '${motivo}',\n` +
      `  p_referencia              => '${referencia}',\n` +
      `  p_usuario                 => '${usuarioSql}'\n);`
    );
  }, [modo, productoSeleccionado, presentacionId, ubicacionId, ubicacionDestinoId,
      cantidad, cantidadObjetivo, referencia, motivo, usuarioActual]);

  /* ── ejecutar operación ──────────────────────────────────────────── */
  const ejecutar = async () => {
    if (!ubicacionId) { showFlash("Selecciona una ubicación", "error"); return; }
    const productoId = productoSeleccionado?.id;

    if (modo !== "AJUSTE" && (!presentacionId || !cantidad)) {
      showFlash("Completa presentación y cantidad", "error"); return;
    }
    if (modo === "TRASLADO" && !ubicacionDestinoId) {
      showFlash("Completa la ubicación destino", "error"); return;
    }
    if (modo === "AJUSTE" && (!productoId || !cantidadObjetivo)) {
      showFlash("Completa producto y cantidad objetivo", "error"); return;
    }

    setEjecutando(true);
    const { id: resultado, error } = await ejecutarOperacion({
      modo, productoId, presentacionId, ubicacionId, ubicacionDestinoId,
      cantidad, cantidadObjetivo, motivo, referencia, usuario: usuarioActual.nombre,
    });

    if (error) {
      showFlash("Error: " + error.message, "error");
    } else {
      // ENTRADA/TRASLADO reciben stock: asegurar que la ubicación quede asignada.
      if (modo === "ENTRADA") await asegurarAsignacion(productoId, ubicacionId);
      if (modo === "TRASLADO") await asegurarAsignacion(productoId, ubicacionDestinoId);

      setMovimientos((prev) => [{
        id: resultado,
        tipo: modo,
        producto: productoSeleccionado?.nombre,
        presentacion: presentacion?.nombre,
        ubicacion: ubicacionLabel || "—",
        ubicacionDestino: modo === "TRASLADO" ? (ubicacionDestinoLabel || "—") : null,
        cantidad: modo === "AJUSTE" ? `→ ${cantidadObjetivo} base` : `${cantidad} pres (${cantidadBase.toFixed(2)} base)`,
        referencia,
        ts: new Date().toLocaleTimeString(),
      }, ...prev]);

      const msgs = {
        ENTRADA: `Entrada registrada — kardex ID ${resultado}`,
        TRASLADO: `Traslado registrado — kardex ID ${resultado}`,
        AJUSTE: `Ajuste registrado — kardex ID ${resultado}`,
      };
      showFlash(msgs[modo]);

      // refrescar stock y ubicaciones (pudo haberse creado una asignación nueva)
      if (productoId && ubicacionId) {
        const v = await stockEn({ productoId, ubicacionId });
        setStockActual(v);
      }
      setCantidad(""); setCantidadObjetivo(""); setReferencia(""); setMotivo("");
    }
    setEjecutando(false);
  };

  /* ── render ──────────────────────────────────────────────────────── */
  return (
    <div className="max-w-lg mx-auto pt-4 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Operaciones</h1>
        {cargandoPresentaciones && <Loader size={14} className="animate-spin text-slate-400" />}
      </div>

      {/* selector de modo */}
      <div className="grid grid-cols-4 gap-1 bg-slate-100 rounded-xl p-1">
        {modosVisibles.map(({ id, label, icon: Icon, color }) => (
          <button key={id} onClick={() => { setModo(id); resetForm(); }}
            className={`flex flex-col items-center gap-1 py-2 rounded-lg text-xs font-medium transition-colors
              ${modo === id ? "bg-white shadow-sm " + color : "text-slate-500 hover:text-slate-700"}`}>
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {flash && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
          ${flash.type === "ok" ? "bg-green-50 text-green-700"
          : flash.type === "warn" ? "bg-amber-50 text-amber-700"
          : "bg-red-50 text-red-700"}`}>
          {flash.type === "ok" ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          {flash.msg}
        </div>
      )}

      {/* formulario */}
      <div className="bg-white border rounded-xl p-4 space-y-3">

        {/* escanear código */}
        <button onClick={() => setShowScanner(true)}
          className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-blue-300 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-50">
          <ScanLine size={16} /> Escanear código
        </button>

        {/* producto: typeahead */}
        {productoSeleccionado ? (
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border rounded-lg text-sm">
            <Package size={14} className="text-slate-400 shrink-0" />
            <span className="flex-1 font-medium text-slate-800">{productoSeleccionado.nombre}</span>
            {productoSeleccionado.sku_interno && (
              <span className="text-xs text-slate-400">{productoSeleccionado.sku_interno}</span>
            )}
            <button onClick={() => elegirProducto(null)} className="text-xs text-blue-500 underline shrink-0">
              Cambiar
            </button>
          </div>
        ) : (
          <TypeaheadProducto
            value={queryProducto}
            onChange={setQueryProducto}
            onSeleccionar={elegirProducto}
            placeholder="Buscar producto por nombre o SKU…"
          />
        )}

        {/* presentación — solo Entrada (Parte A). Traslado/Ajuste operan
            siempre en unidad base, sin selector (Parte B). Default en la
            base, nunca arranca en la de bulto (ver el efecto que carga
            presentacionesProducto). */}
        {modo === "ENTRADA" && (
          <select value={presentacionId} onChange={(e) => setPresentacionId(e.target.value)}
            disabled={!productoSeleccionado || cargandoPresentaciones}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-40">
            <option value="">— Presentación —</option>
            {presentacionesProducto.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} (×{p.factor_unidad_base} {productoSeleccionado?.unidad_base})
              </option>
            ))}
          </select>
        )}

        {/* ubicación origen (filtrada por modo — Parte 2) */}
        <select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}
          disabled={!productoSeleccionado}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-40">
          <option value="">{modo === "TRASLADO" ? "— Ubicación origen —" : "— Ubicación —"}</option>
          {ubicacionesOrigen.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}{u.cantidad_base != null ? ` (stock: ${u.cantidad_base})` : ""}{u.es_principal ? " · principal" : ""}
            </option>
          ))}
        </select>
        {productoSeleccionado && ubicacionesOrigen.length === 0 && modo === "TRASLADO" && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle size={12} /> Sin stock disponible para trasladar.
          </p>
        )}
        {productoSeleccionado && sinAsignacionOrigen && modo === "ENTRADA" && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle size={12} /> Este producto no tiene ubicaciones asignadas — se asignará automáticamente al recibir.
          </p>
        )}

        {productoSeleccionado && (
          <p className="text-xs text-slate-500">
            {metaProducto(productoSeleccionado)}
            {metaProducto(productoSeleccionado) && " · "}
            Unidad base: {productoSeleccionado.unidad_base}
          </p>
        )}

        {/* stock actual */}
        {ubicacionId && productoSeleccionado && (
          <p className="text-xs text-slate-500 flex items-center gap-1">
            {loadingStock && <Loader size={10} className="animate-spin" />}
            Stock actual: <strong>{stockActual ?? "—"}</strong> {productoSeleccionado?.unidad_base} base
          </p>
        )}

        {/* ubicación destino (solo TRASLADO) */}
        {modo === "TRASLADO" && (
          <>
            <select value={ubicacionDestinoId} onChange={(e) => setUbicacionDestinoId(e.target.value)}
              disabled={!productoSeleccionado}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-40">
              <option value="">— Ubicación destino —</option>
              {ubicacionesDestino.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}{u.es_principal ? " · principal" : ""}
                </option>
              ))}
            </select>
            {productoSeleccionado && sinAsignacionDestino && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle size={12} /> Este producto no tiene ubicaciones asignadas — se asignará automáticamente al recibir.
              </p>
            )}
          </>
        )}

        {/* cantidad — Entrada: en la presentación elegida arriba, con
            conversión en vivo (Parte A). */}
        {modo === "ENTRADA" && (
          <div>
            <input type="number" min="0.001" step="any" value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              placeholder="Cantidad (en unidades de presentación)"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            {presentacion && cantidad && (
              <p className="text-xs text-slate-400 mt-1">
                = {cantidadBase.toFixed(3)} {productoSeleccionado?.unidad_base} base
              </p>
            )}
          </div>
        )}

        {/* cantidad — Traslado: siempre en unidad base, sin selector
            (Parte B). Texto informativo de bulto si el producto tiene una
            presentación de paquete/bote — no editable, no afecta el envío. */}
        {modo === "TRASLADO" && (
          <div>
            <input type="number" min="0.001" step="any" value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              placeholder={`Cantidad (${productoSeleccionado?.unidad_base || "unidades"} base)`}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            {textoAproxBulto(cantidad, presentacionBulto) && (
              <p className="text-xs text-slate-400 mt-1">{textoAproxBulto(cantidad, presentacionBulto)}</p>
            )}
          </div>
        )}

        {/* cantidad objetivo (solo AJUSTE — en unidades base) */}
        {modo === "AJUSTE" && (
          <div>
            <input type="number" min="0" step="any" value={cantidadObjetivo}
              onChange={(e) => setCantidadObjetivo(e.target.value)}
              placeholder="Cantidad objetivo (unidades base)"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
            {deltaAjuste !== null && (
              <p className={`text-xs mt-1 font-medium ${deltaAjuste >= 0 ? "text-green-600" : "text-red-500"}`}>
                Delta: {deltaAjuste >= 0 ? "+" : ""}{deltaAjuste.toFixed(3)} {productoSeleccionado?.unidad_base}
              </p>
            )}
            {textoAproxBulto(cantidadObjetivo, presentacionBulto) && (
              <p className="text-xs text-slate-400 mt-1">{textoAproxBulto(cantidadObjetivo, presentacionBulto)}</p>
            )}
          </div>
        )}

        {/* motivo (solo AJUSTE) */}
        {modo === "AJUSTE" && (
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo del ajuste *"
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
        )}

        {/* referencia */}
        <input value={referencia} onChange={(e) => setReferencia(e.target.value)}
          placeholder="Referencia (factura, OC, etc.)"
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />

        {/* SQL preview */}
        {sqlPreview && (
          <div>
            <button onClick={() => setShowSQL((v) => !v)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
              <Code2 size={12} /> {showSQL ? "Ocultar SQL" : "Ver SQL"}
            </button>
            {showSQL && (
              <pre className="mt-2 bg-slate-900 text-green-400 text-xs rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                {sqlPreview}
              </pre>
            )}
          </div>
        )}

        <button onClick={ejecutar} disabled={ejecutando || cargandoPresentaciones}
          className="w-full py-3 bg-slate-800 text-white rounded-xl font-semibold hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center gap-2">
          {ejecutando && <Loader size={14} className="animate-spin" />}
          {ejecutando ? "Registrando…" : `Registrar ${MODOS.find((m) => m.id === modo)?.label}`}
        </button>
      </div>

      {/* historial de sesión */}
      {movimientos.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History size={14} className="text-slate-500" />
              <p className="text-sm font-semibold text-slate-700">Kardex (esta sesión)</p>
            </div>
            <button onClick={() => setMovimientos([])}
              className="text-xs text-slate-400 underline">Limpiar</button>
          </div>
          {movimientos.map((m) => (
            <div key={m.id} className="bg-white border rounded-lg px-3 py-2 text-xs flex justify-between items-start gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${
                    m.tipo === "ENTRADA" ? "text-green-600"
                    : m.tipo === "AJUSTE" ? "text-amber-600"
                    : "text-blue-600"}`}>
                    {m.tipo}
                  </span>
                  <span className="text-slate-600">{m.producto}</span>
                  {m.presentacion && <span className="text-slate-400">· {m.presentacion}</span>}
                </div>
                <p className="text-slate-500">
                  {m.ubicacion}
                  {m.ubicacionDestino && ` → ${m.ubicacionDestino}`}
                  {m.referencia && ` · ${m.referencia}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-slate-700">{m.cantidad}</p>
                <p className="text-slate-400">{m.ts}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showScanner && (
        <EscanerCodigo onDetect={handleScan} onClose={() => setShowScanner(false)} />
      )}
    </div>
  );
}
