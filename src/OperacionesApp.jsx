/**
 * OperacionesApp.jsx  —  Fase 4: Operaciones diarias
 * Cableado a Supabase real.
 *
 * Firmas RPC confirmadas:
 *   registrar_entrada(p_presentacion_id, p_ubicacion_id, p_cantidad_pres,
 *                     p_referencia, p_usuario?, p_fecha?, p_costo_unitario?, p_idempotencia?)
 *   registrar_salida(p_presentacion_id, p_ubicacion_id, p_cantidad_pres,
 *                    p_referencia, p_usuario?, p_fecha?, p_idempotencia?, p_permitir_sobregiro?)
 *   registrar_ajuste(p_producto_id, p_ubicacion_id, p_cantidad_base_objetivo,
 *                    p_motivo, p_referencia?, p_usuario?, p_fecha?)
 *   registrar_traslado(p_presentacion_id, p_ubicacion_origen, p_ubicacion_destino,
 *                      p_cantidad_pres, p_referencia?, p_usuario?, p_fecha?)
 *
 * Enum tipo_movimiento real: INV_INICIAL | ENTRADA | SALIDA | AJUSTE | TRASLADO
 * Columnas ubicacion: id, codigo_zona, estante, nivel
 * Columna producto: sku_interno (no sku)
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import {
  PackagePlus, PackageMinus, ArrowLeftRight, SlidersHorizontal,
  AlertTriangle, CheckCircle, History, Code2, Loader, RefreshCw, ScanLine,
} from "lucide-react";

const uuid = () => crypto.randomUUID
  ? crypto.randomUUID()
  : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);

const labelUbicacion = (u) => u ? `${u.codigo_zona}-${u.estante}-${u.nivel}` : "—";
const hoy = () => new Date().toISOString().slice(0, 10);

const MODOS = [
  { id: "ENTRADA",  label: "Entrada",  icon: PackagePlus,       color: "text-green-600" },
  { id: "SALIDA",   label: "Salida",   icon: PackageMinus,      color: "text-red-500"   },
  { id: "TRASLADO", label: "Traslado", icon: ArrowLeftRight,    color: "text-blue-600"  },
  { id: "AJUSTE",   label: "Ajuste",   icon: SlidersHorizontal, color: "text-amber-600" },
];

export default function OperacionesApp() {
  const [modo, setModo] = useState("ENTRADA");

  // catálogo
  const [productos, setProductos] = useState([]);
  const [presentaciones, setPresentaciones] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [loadingCat, setLoadingCat] = useState(true);

  // stock actual (consultado al elegir producto+ubicación)
  const [stockActual, setStockActual] = useState(null);
  const [loadingStock, setLoadingStock] = useState(false);

  // historial local de movimientos (solo sesión actual)
  const [movimientos, setMovimientos] = useState([]);

  // estado del formulario
  const [productoId, setProductoId] = useState("");
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

  /* ── cargar catálogo ─────────────────────────────────────────────── */
  useEffect(() => {
    async function cargar() {
      setLoadingCat(true);
      const [{ data: prods }, { data: pres }, { data: ubs }] = await Promise.all([
        supabase.from("producto").select("id, nombre, sku_interno, unidad_base").eq("activo", true).order("nombre"),
        supabase.from("presentacion").select("id, producto_id, nombre, factor_unidad_base, es_base").order("nombre"),
        supabase.from("ubicacion").select("id, codigo_zona, estante, nivel").order("codigo_zona"),
      ]);
      setProductos(prods || []);
      setPresentaciones(pres || []);
      setUbicaciones(ubs || []);
      setLoadingCat(false);
    }
    cargar();
  }, []);

  /* ── consultar stock cuando cambia producto+ubicación ────────────── */
  useEffect(() => {
    if (!productoId || !ubicacionId) { setStockActual(null); return; }
    async function consultarStock() {
      setLoadingStock(true);
      const { data } = await supabase
        .from("stock_actual")
        .select("cantidad_base")
        .eq("producto_id", Number(productoId))
        .eq("ubicacion_id", Number(ubicacionId))
        .maybeSingle();
      setStockActual(data?.cantidad_base ?? 0);
      setLoadingStock(false);
    }
    consultarStock();
  }, [productoId, ubicacionId]);

  const showFlash = (msg, type = "ok") => {
    setFlash({ msg, type });
    setTimeout(() => setFlash(null), 3000);
  };

  /* ── escaneo: resolver código → presentación ─────────────────────── */
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

    const productosDistintos = [...new Set(rows.map(r => r.producto_id))];

    if (rows.length === 1) {
      setProductoId(String(rows[0].producto_id));
      setPresentacionId(String(rows[0].presentacion_id));
      flashMsg(`${rows[0].producto_nombre} · ${rows[0].presentacion_nombre}`, "ok");
    } else if (productosDistintos.length === 1) {
      // mismo producto, varias presentaciones comparten el código → elegir
      setProductoId(String(rows[0].producto_id));
      setPresentacionId("");
      flashMsg(`${rows[0].producto_nombre}: ${rows.length} presentaciones con ese código, elegí cuál`, "warn");
    } else {
      // caso raro: el código apunta a varios productos
      setProductoId("");
      setPresentacionId("");
      flashMsg(`Código ambiguo (${productosDistintos.length} productos), seleccioná manualmente`, "warn");
    }
  }, []);

  const resetForm = () => {
    setProductoId(""); setPresentacionId(""); setUbicacionId("");
    setUbicacionDestinoId(""); setCantidad(""); setCantidadObjetivo("");
    setReferencia(""); setMotivo(""); setPermitirSobregiro(false);
    setStockActual(null);
  };

  // presentaciones del producto seleccionado
  const presentacionesFiltradas = presentaciones.filter(
    p => p.producto_id === Number(productoId)
  );
  const presentacion = presentaciones.find(p => p.id === Number(presentacionId));
  const producto = productos.find(p => p.id === Number(productoId));
  const ubicacion = ubicaciones.find(u => u.id === Number(ubicacionId));
  const ubicacionDestino = ubicaciones.find(u => u.id === Number(ubicacionDestinoId));

  const cantidadBase = presentacion && cantidad
    ? Number(cantidad) * presentacion.factor_unidad_base : 0;

  const deltaAjuste = cantidadObjetivo !== "" && stockActual !== null
    ? Number(cantidadObjetivo) - Number(stockActual) : null;

  /* ── SQL preview ─────────────────────────────────────────────────── */
  const sqlPreview = useMemo(() => {
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
  }, [modo, productoId, presentacionId, ubicacionId, ubicacionDestinoId,
      cantidad, cantidadObjetivo, referencia, motivo, permitirSobregiro]);

  /* ── ejecutar operación ──────────────────────────────────────────── */
  const ejecutar = async () => {
    if (!ubicacionId) { showFlash("Selecciona una ubicación", "error"); return; }
    setEjecutando(true);

    let resultado = null;
    let error = null;

    if (modo === "ENTRADA") {
      if (!presentacionId || !cantidad) { showFlash("Completa presentación y cantidad", "error"); setEjecutando(false); return; }
      ({ data: resultado, error } = await supabase.rpc("registrar_entrada", {
        p_presentacion_id: Number(presentacionId),
        p_ubicacion_id: Number(ubicacionId),
        p_cantidad_pres: Number(cantidad),
        p_referencia: referencia || "Sin referencia",
        p_usuario: "operario",
        p_fecha: hoy(),
        p_idempotencia: uuid(),
      }));
    }

    else if (modo === "SALIDA") {
      if (!presentacionId || !cantidad) { showFlash("Completa presentación y cantidad", "error"); setEjecutando(false); return; }
      ({ data: resultado, error } = await supabase.rpc("registrar_salida", {
        p_presentacion_id: Number(presentacionId),
        p_ubicacion_id: Number(ubicacionId),
        p_cantidad_pres: Number(cantidad),
        p_referencia: referencia || "Sin referencia",
        p_usuario: "operario",
        p_fecha: hoy(),
        p_idempotencia: uuid(),
        p_permitir_sobregiro: permitirSobregiro,
      }));
    }

    else if (modo === "TRASLADO") {
      if (!presentacionId || !cantidad || !ubicacionDestinoId) {
        showFlash("Completa presentación, cantidad y ubicación destino", "error");
        setEjecutando(false); return;
      }
      ({ data: resultado, error } = await supabase.rpc("registrar_traslado", {
        p_presentacion_id: Number(presentacionId),
        p_ubicacion_origen: Number(ubicacionId),
        p_ubicacion_destino: Number(ubicacionDestinoId),
        p_cantidad_pres: Number(cantidad),
        p_referencia: referencia || "Sin referencia",
        p_usuario: "operario",
        p_fecha: hoy(),
      }));
    }

    else if (modo === "AJUSTE") {
      if (!productoId || !cantidadObjetivo) {
        showFlash("Completa producto y cantidad objetivo", "error");
        setEjecutando(false); return;
      }
      ({ data: resultado, error } = await supabase.rpc("registrar_ajuste", {
        p_producto_id: Number(productoId),
        p_ubicacion_id: Number(ubicacionId),
        p_cantidad_base_objetivo: Number(cantidadObjetivo),
        p_motivo: motivo || "Ajuste manual",
        p_referencia: referencia || null,
        p_usuario: "operario",
        p_fecha: hoy(),
      }));
    }

    if (error) {
      showFlash("Error: " + error.message, "error");
    } else {
      // registrar en historial local
      setMovimientos(prev => [{
        id: resultado,
        tipo: modo,
        producto: producto?.nombre,
        presentacion: presentacion?.nombre,
        ubicacion: labelUbicacion(ubicacion),
        ubicacionDestino: modo === "TRASLADO" ? labelUbicacion(ubicacionDestino) : null,
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

      // refrescar stock
      if (productoId && ubicacionId) {
        const { data } = await supabase
          .from("stock_actual")
          .select("cantidad_base")
          .eq("producto_id", Number(productoId))
          .eq("ubicacion_id", Number(ubicacionId))
          .maybeSingle();
        setStockActual(data?.cantidad_base ?? 0);
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
        {!loadingCat && (
          <span className="text-xs text-green-600">
            {productos.length} prod · {ubicaciones.length} ubic
          </span>
        )}
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

        {/* producto (todos los modos) */}
        <select value={productoId}
          onChange={e => { setProductoId(e.target.value); setPresentacionId(""); setStockActual(null); }}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
          <option value="">— Producto —</option>
          {productos.map(p => (
            <option key={p.id} value={p.id}>{p.nombre} ({p.sku_interno})</option>
          ))}
        </select>

        {/* presentación (excepto AJUSTE que opera en unidades base) */}
        {modo !== "AJUSTE" && (
          <select value={presentacionId} onChange={e => setPresentacionId(e.target.value)}
            disabled={!productoId}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-40">
            <option value="">— Presentación —</option>
            {presentacionesFiltradas.map(p => (
              <option key={p.id} value={p.id}>
                {p.nombre} (×{p.factor_unidad_base} {producto?.unidad_base})
              </option>
            ))}
          </select>
        )}

        {/* ubicación origen */}
        <select value={ubicacionId} onChange={e => setUbicacionId(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
          <option value="">{modo === "TRASLADO" ? "— Ubicación origen —" : "— Ubicación —"}</option>
          {ubicaciones.map(u => (
            <option key={u.id} value={u.id}>{labelUbicacion(u)}</option>
          ))}
        </select>

        {/* stock actual */}
        {ubicacionId && productoId && (
          <p className="text-xs text-slate-500 flex items-center gap-1">
            {loadingStock && <Loader size={10} className="animate-spin" />}
            Stock actual: <strong>{stockActual ?? "—"}</strong> {producto?.unidad_base} base
          </p>
        )}

        {/* ubicación destino (solo TRASLADO) */}
        {modo === "TRASLADO" && (
          <select value={ubicacionDestinoId} onChange={e => setUbicacionDestinoId(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
            <option value="">— Ubicación destino —</option>
            {ubicaciones.filter(u => u.id !== Number(ubicacionId)).map(u => (
              <option key={u.id} value={u.id}>{labelUbicacion(u)}</option>
            ))}
          </select>
        )}

        {/* cantidad (ENTRADA, SALIDA, TRASLADO) */}
        {modo !== "AJUSTE" && (
          <div>
            <input type="number" min="0.001" step="any" value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              placeholder="Cantidad (en unidades de presentación)"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            {presentacion && cantidad && (
              <p className="text-xs text-slate-400 mt-1">
                = {cantidadBase.toFixed(3)} {producto?.unidad_base} base
              </p>
            )}
          </div>
        )}

        {/* cantidad objetivo (solo AJUSTE — en unidades base) */}
        {modo === "AJUSTE" && (
          <div>
            <input type="number" min="0" step="any" value={cantidadObjetivo}
              onChange={e => setCantidadObjetivo(e.target.value)}
              placeholder="Cantidad objetivo (unidades base)"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
            {deltaAjuste !== null && (
              <p className={`text-xs mt-1 font-medium ${deltaAjuste >= 0 ? "text-green-600" : "text-red-500"}`}>
                Delta: {deltaAjuste >= 0 ? "+" : ""}{deltaAjuste.toFixed(3)} {producto?.unidad_base}
              </p>
            )}
          </div>
        )}

        {/* motivo (solo AJUSTE) */}
        {modo === "AJUSTE" && (
          <input value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder="Motivo del ajuste *"
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
        )}

        {/* referencia */}
        <input value={referencia} onChange={e => setReferencia(e.target.value)}
          placeholder="Referencia (factura, OC, etc.)"
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />

        {/* permitir sobregiro (solo SALIDA) */}
        {modo === "SALIDA" && (
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={permitirSobregiro}
              onChange={e => setPermitirSobregiro(e.target.checked)}
              className="rounded" />
            Permitir sobregiro (stock negativo)
          </label>
        )}

        {/* SQL preview */}
        {sqlPreview && (
          <div>
            <button onClick={() => setShowSQL(v => !v)}
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
          {ejecutando ? "Registrando…" : `Registrar ${MODOS.find(m => m.id === modo)?.label}`}
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
          {movimientos.map(m => (
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
