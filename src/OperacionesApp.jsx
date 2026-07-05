/**
 * OperacionesApp.jsx  —  Fase 4: Operaciones diarias
 * Cableado a Supabase real. Motor de operación en src/lib/operaciones.js.
 *
 * Enum tipo_movimiento real: INV_INICIAL | ENTRADA | SALIDA | AJUSTE | TRASLADO
 * Columnas ubicacion: id, codigo_zona, estante, nivel, compartimiento
 * Columna producto: sku_interno (no sku)
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import {
  buscarProductos, ubicacionesParaOperacion, stockEn,
  ejecutarOperacion, asegurarAsignacion,
} from "./lib/operaciones";
import {
  PackagePlus, PackageMinus, ArrowLeftRight, SlidersHorizontal,
  AlertTriangle, CheckCircle, History, Code2, Loader, ScanLine, Search, Package,
} from "lucide-react";

const MODOS = [
  { id: "ENTRADA",  label: "Entrada",  icon: PackagePlus,       color: "text-green-600" },
  { id: "SALIDA",   label: "Salida",   icon: PackageMinus,      color: "text-red-500"   },
  { id: "TRASLADO", label: "Traslado", icon: ArrowLeftRight,    color: "text-blue-600"  },
  { id: "AJUSTE",   label: "Ajuste",   icon: SlidersHorizontal, color: "text-amber-600" },
];

export default function OperacionesApp() {
  const [modo, setModo] = useState("ENTRADA");

  // presentaciones (catálogo completo — dataset chico, se filtra local por producto)
  const [presentaciones, setPresentaciones] = useState([]);
  const [loadingCat, setLoadingCat] = useState(true);

  // producto: typeahead
  const [productoSeleccionado, setProductoSeleccionado] = useState(null); // {id, nombre, sku_interno, unidad_base}
  const [queryProducto, setQueryProducto] = useState("");
  const [resultadosProducto, setResultadosProducto] = useState([]);
  const [buscandoProducto, setBuscandoProducto] = useState(false);

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
  const [permitirSobregiro, setPermitirSobregiro] = useState(false);
  const [showSQL, setShowSQL] = useState(false);
  const [flash, setFlash] = useState(null);
  const [ejecutando, setEjecutando] = useState(false);

  // escáner
  const [showScanner, setShowScanner] = useState(false);
  const resolviendoRef = useRef(false);

  /* ── cargar presentaciones (catálogo) ─────────────────────────────── */
  useEffect(() => {
    async function cargar() {
      setLoadingCat(true);
      const { data: pres } = await supabase
        .from("presentacion")
        .select("id, producto_id, nombre, factor_unidad_base, es_base")
        .order("nombre");
      setPresentaciones(pres || []);
      setLoadingCat(false);
    }
    cargar();
  }, []);

  /* ── typeahead de producto (debounce ~300ms) ──────────────────────── */
  useEffect(() => {
    if (!queryProducto.trim()) { setResultadosProducto([]); return; }
    setBuscandoProducto(true);
    const t = setTimeout(async () => {
      const rows = await buscarProductos(queryProducto);
      setResultadosProducto(rows);
      setBuscandoProducto(false);
    }, 300);
    return () => clearTimeout(t);
  }, [queryProducto]);

  const elegirProducto = (p) => {
    setProductoSeleccionado(p);
    setQueryProducto("");
    setResultadosProducto([]);
    setPresentacionId("");
    setUbicacionId("");
    setUbicacionDestinoId("");
    setStockActual(null);
  };

  /* ── ubicaciones de origen según modo (Parte 2) ───────────────────── */
  useEffect(() => {
    if (!productoSeleccionado) { setUbicacionesOrigen([]); setSinAsignacionOrigen(false); return; }
    let cancelado = false;
    const modoOrigen = modo === "TRASLADO" ? "TRASLADO_ORIGEN" : modo;
    ubicacionesParaOperacion({ productoId: productoSeleccionado.id, modo: modoOrigen }).then(({ ubicaciones, sinAsignacion }) => {
      if (cancelado) return;
      setUbicacionesOrigen(ubicaciones);
      setSinAsignacionOrigen(sinAsignacion);
    });
    return () => { cancelado = true; };
  }, [productoSeleccionado, modo]);

  /* ── ubicaciones de destino (solo TRASLADO) ───────────────────────── */
  useEffect(() => {
    if (modo !== "TRASLADO" || !productoSeleccionado) { setUbicacionesDestino([]); setSinAsignacionDestino(false); return; }
    let cancelado = false;
    ubicacionesParaOperacion({ productoId: productoSeleccionado.id, modo: "TRASLADO_DESTINO" }).then(({ ubicaciones, sinAsignacion }) => {
      if (cancelado) return;
      setUbicacionesDestino(ubicaciones.filter((u) => u.id !== Number(ubicacionId)));
      setSinAsignacionDestino(sinAsignacion);
    });
    return () => { cancelado = true; };
  }, [modo, productoSeleccionado, ubicacionId]);

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
  const handleScan = useCallback(async (codigo) => {
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
        .select("id, nombre, sku_interno, unidad_base")
        .eq("id", rows[0].producto_id)
        .single();
      if (prod) elegirProducto(prod);

      if (rows.length === 1) {
        setPresentacionId(String(rows[0].presentacion_id));
        flashMsg(`${rows[0].producto_nombre} · ${rows[0].presentacion_nombre}`, "ok");
      } else {
        flashMsg(`${rows[0].producto_nombre}: ${rows.length} presentaciones con ese código, elegí cuál`, "warn");
      }
    } else {
      // caso raro: el código apunta a varios productos
      flashMsg(`Código ambiguo (${productosDistintos.length} productos), seleccioná manualmente`, "warn");
    }
  }, []);

  const resetForm = () => {
    setProductoSeleccionado(null); setQueryProducto(""); setResultadosProducto([]);
    setPresentacionId(""); setUbicacionId(""); setUbicacionDestinoId("");
    setCantidad(""); setCantidadObjetivo("");
    setReferencia(""); setMotivo(""); setPermitirSobregiro(false);
    setStockActual(null);
  };

  // presentaciones del producto seleccionado
  const presentacionesFiltradas = presentaciones.filter(
    (p) => p.producto_id === productoSeleccionado?.id
  );
  const presentacion = presentaciones.find((p) => p.id === Number(presentacionId));
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

    if (modo === "ENTRADA") return (
      `SELECT registrar_entrada(\n` +
      `  p_presentacion_id => ${presentacionId},\n` +
      `  p_ubicacion_id    => ${ubicacionId || "?"},\n` +
      `  p_cantidad_pres   => ${cantidad || "?"},\n` +
      `  p_referencia      => '${referencia}',\n` +
      `  p_usuario         => 'operario'\n);`
    );
    if (modo === "SALIDA") return (
      `SELECT registrar_salida(\n` +
      `  p_presentacion_id    => ${presentacionId},\n` +
      `  p_ubicacion_id       => ${ubicacionId || "?"},\n` +
      `  p_cantidad_pres      => ${cantidad || "?"},\n` +
      `  p_referencia         => '${referencia}',\n` +
      `  p_usuario            => 'operario',\n` +
      `  p_permitir_sobregiro => ${permitirSobregiro}\n);`
    );
    if (modo === "TRASLADO") return (
      `SELECT registrar_traslado(\n` +
      `  p_presentacion_id   => ${presentacionId},\n` +
      `  p_ubicacion_origen  => ${ubicacionId || "?"},\n` +
      `  p_ubicacion_destino => ${ubicacionDestinoId || "?"},\n` +
      `  p_cantidad_pres     => ${cantidad || "?"},\n` +
      `  p_referencia        => '${referencia}',\n` +
      `  p_usuario           => 'operario'\n);`
    );
    if (modo === "AJUSTE") return (
      `SELECT registrar_ajuste(\n` +
      `  p_producto_id             => ${productoId},\n` +
      `  p_ubicacion_id            => ${ubicacionId || "?"},\n` +
      `  p_cantidad_base_objetivo  => ${cantidadObjetivo || "?"},\n` +
      `  p_motivo                  => '${motivo}',\n` +
      `  p_referencia              => '${referencia}',\n` +
      `  p_usuario                 => 'operario'\n);`
    );
  }, [modo, productoSeleccionado, presentacionId, ubicacionId, ubicacionDestinoId,
      cantidad, cantidadObjetivo, referencia, motivo, permitirSobregiro]);

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
      cantidad, cantidadObjetivo, motivo, referencia, permitirSobregiro,
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
        SALIDA: `Salida registrada — kardex ID ${resultado}`,
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
        {loadingCat && <Loader size={14} className="animate-spin text-slate-400" />}
      </div>

      {/* selector de modo */}
      <div className="grid grid-cols-4 gap-1 bg-slate-100 rounded-xl p-1">
        {MODOS.map(({ id, label, icon: Icon, color }) => (
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
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={queryProducto} onChange={(e) => setQueryProducto(e.target.value)}
              placeholder="Buscar producto por nombre o SKU…"
              className="w-full pl-8 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            {(resultadosProducto.length > 0 || buscandoProducto) && (
              <div className="absolute z-10 mt-1 w-full border rounded-lg divide-y bg-white shadow-lg max-h-64 overflow-y-auto">
                {buscandoProducto && <p className="px-3 py-2 text-sm text-slate-400">Buscando…</p>}
                {resultadosProducto.map((p) => (
                  <button key={p.id} onClick={() => elegirProducto(p)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm flex items-center gap-2">
                    <span className="flex-1 font-medium">{p.nombre}</span>
                    {p.sku_interno && <span className="text-xs text-slate-400">{p.sku_interno}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* presentación (excepto AJUSTE que opera en unidades base) */}
        {modo !== "AJUSTE" && (
          <select value={presentacionId} onChange={(e) => setPresentacionId(e.target.value)}
            disabled={!productoSeleccionado}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-40">
            <option value="">— Presentación —</option>
            {presentacionesFiltradas.map((p) => (
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
        {productoSeleccionado && ubicacionesOrigen.length === 0 && (modo === "SALIDA" || modo === "TRASLADO") && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle size={12} /> Sin stock disponible para salida.
          </p>
        )}
        {productoSeleccionado && sinAsignacionOrigen && modo === "ENTRADA" && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle size={12} /> Este producto no tiene ubicaciones asignadas — se asignará automáticamente al recibir.
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

        {/* cantidad (ENTRADA, SALIDA, TRASLADO) */}
        {modo !== "AJUSTE" && (
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

        {/* permitir sobregiro (solo SALIDA) */}
        {modo === "SALIDA" && (
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={permitirSobregiro}
              onChange={(e) => setPermitirSobregiro(e.target.checked)}
              className="rounded" />
            Permitir sobregiro (stock negativo)
          </label>
        )}

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

        <button onClick={ejecutar} disabled={ejecutando || loadingCat}
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
                    : m.tipo === "SALIDA" ? "text-red-500"
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
