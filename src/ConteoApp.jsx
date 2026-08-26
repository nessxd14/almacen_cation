/**
 * ConteoApp.jsx  —  Fase 2: Captura de conteo físico
 * Cableado a Supabase real.
 *
 * Esquema confirmado:
 *   sesion_conteo:         id, nombre, metodo, estado, iniciada_en, cerrada_en
 *   conteo_fisico_inicial: id, sesion_id, ubicacion_id, presentacion_id,
 *                          es_no_catalogado, descripcion_libre, cantidad,
 *                          factor_a_base_snap, identificador_raw, foto_ref,
 *                          contador, numero_conteo, cliente_uuid, dispositivo_id,
 *                          capturado_en, sincronizado_en, estado
 *   ubicacion:             id, codigo_zona, estante, nivel, compartimiento
 *   producto:              id, nombre, sku_interno, unidad_base
 *   presentacion:          id, producto_id, nombre, factor_unidad_base, es_base
 *   identificador:         id, presentacion_id, valor, tipo, origen, activo, es_principal
 *                          (resolución por escaneo vía RPC resolver_identificador)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient";
import { subirFotoConteo, pathFotoConteo } from "./fotoConteo";
import { syncLinea } from "./lib/guardarLinea";
import EscanerCodigo from "./EscanerCodigo";
import { fetchAll } from "./lib/fetchAll";
import { useUsuarioActual } from "./lib/useAuth";
import { useSucursal } from "./lib/useSucursal";
import { useAppNav } from "./lib/useAppNav";
import { metaProducto } from "./lib/producto";
import {
  Camera, Search, MapPin, CheckCircle, AlertCircle, AlertTriangle, Info,
  Wifi, WifiOff, ClipboardList, ArrowLeft, Plus, Loader, ImageOff, RefreshCw,
} from "lucide-react";

const FLASH_STYLES = {
  ok: "bg-green-50 text-green-700",
  neutral: "bg-slate-100 text-slate-600",
  warn: "bg-amber-50 text-amber-700",
  info: "bg-blue-50 text-blue-700",
  error: "bg-red-50 text-red-700",
};
const FLASH_ICONS = {
  ok: CheckCircle,
  neutral: CheckCircle,
  warn: AlertTriangle,
  info: Info,
  error: AlertCircle,
};

function PendingBanner({ pendingCount, isOnline, onRetry }) {
  if (!pendingCount) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-amber-50 border border-amber-200 text-amber-700">
      <AlertTriangle size={14} />
      <span>{pendingCount} línea{pendingCount === 1 ? "" : "s"} sin subir</span>
      <button onClick={onRetry} disabled={!isOnline}
        className="ml-auto flex items-center gap-1 underline disabled:opacity-40 disabled:no-underline">
        <RefreshCw size={12} /> Reintentar subida
      </button>
    </div>
  );
}

/* ── helpers ─────────────────────────────────────────────────────────── */
const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
const nowISO = () => new Date().toISOString();
const labelUbicacion = (u) =>
  [u.codigo_zona, u.estante, u.nivel, u.compartimiento].filter(Boolean).join("-");

/* ── IndexedDB para offline ───────────────────────────────────────────── */
const DB_NAME = "conteo_wms";
function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no-idb"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("conteos"))
        db.createObjectStore("conteos", { keyPath: "cliente_uuid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbAdapter(db) {
  const tx = (store, mode, fn) =>
    new Promise((res, rej) => {
      const rq = fn(db.transaction(store, mode).objectStore(store));
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  return {
    mode: "idb",
    getAll: (s) => tx(s, "readonly", (os) => os.getAll()),
    put: (s, v) => tx(s, "readwrite", (os) => os.put(v)),
  };
}
function memAdapter() {
  const st = { conteos: new Map() };
  return {
    mode: "memory",
    getAll: async (s) => Array.from(st[s].values()),
    put: async (s, v) => { st[s].set(v.cliente_uuid, v); },
  };
}
async function initPersistence() {
  try { return idbAdapter(await openDB()); }
  catch { return memAdapter(); }
}

/* ═══════════════════════════════════════════════════════════════════════ */
export default function ConteoApp() {
  const usuarioActual = useUsuarioActual();
  const { sucursalActivaId, nombreSucursal } = useSucursal();
  const { conteoPrefill, setConteoPrefill } = useAppNav();
  const [store, setStore] = useState(null);
  const [storeMode, setStoreMode] = useState(null);

  // catálogo desde Supabase
  const [ubicaciones, setUbicaciones] = useState([]);
  const [presentaciones, setPresentaciones] = useState([]);
  const [identificadores, setIdentificadores] = useState([]);
  const [loadingCatalogo, setLoadingCatalogo] = useState(true);
  const [errorCatalogo, setErrorCatalogo] = useState(null);

  // sesión activa
  const [sesion, setSesion] = useState(null);
  const [creandoSesion, setCreandoSesion] = useState(false);

  // navegación
  const [screen, setScreen] = useState("session"); // session|contador|location|capture|review
  const [ubicacion, setUbicacion] = useState(null);
  // DOBLE_CIEGO: qué ronda está haciendo ESTE contador en ESTE dispositivo —
  // nunca se persiste en sesion_conteo (es compartida entre los dos
  // contadores), solo vive acá y se usa como numero_conteo al guardar.
  // null hasta que se pregunta explícitamente "¿primer o segundo contador?".
  const [numeroContador, setNumeroContador] = useState(null);

  // líneas capturadas
  const [lines, setLines] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);

  // estado de red
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [forceOffline, setForceOffline] = useState(false);
  const isOnline = online && !forceOffline;

  // captura
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cantidad, setCantidad] = useState("");
  const [esHuerfano, setEsHuerfano] = useState(false);
  const [descLibre, setDescLibre] = useState("");
  const [fotoBlob, setFotoBlob] = useState(null);
  const [flash, setFlash] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const inputRef = useRef(null);
  const fotoInputRef = useRef(null);

  /* ── init ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    initPersistence().then((s) => { setStore(s); setStoreMode(s.mode); });
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // cargar catálogo desde Supabase — completo, paginando: esta pantalla
  // necesita TODAS las presentaciones/identificadores en memoria para la
  // búsqueda offline (searchQuery) y para resolver escaneos (handleScan)
  // sin red. presentacion e identificador ya superan las 1.000 filas que
  // Supabase/PostgREST recorta en silencio sin .range() — un solo select
  // dejaba afuera los productos más nuevos (ver fetchAll).
  useEffect(() => {
    async function cargarCatalogo() {
      setLoadingCatalogo(true);
      try {
        const [ubs, pres, ids] = await Promise.all([
          fetchAll(() => supabase.from("ubicacion").select("id, codigo_zona, estante, nivel, compartimiento, sucursal_id").order("codigo_zona").order("estante").order("nivel").order("compartimiento")),
          fetchAll(() => supabase.from("presentacion").select("id, producto_id, nombre, factor_unidad_base, es_base, producto(id, nombre, sku_interno, marca, unidad_base)").order("id")),
          fetchAll(() => supabase.from("identificador").select("presentacion_id, valor").eq("activo", true).order("id")),
        ]);
        setUbicaciones(ubs);
        setPresentaciones(pres);
        setIdentificadores(ids);
      } catch (e) {
        setErrorCatalogo(e.message);
      } finally {
        setLoadingCatalogo(false);
      }
    }
    cargarCatalogo();
  }, []);

  /* ── contador de líneas sin subir (persiste entre pantallas) ───────── */
  const refreshPendingCount = useCallback(async () => {
    if (!store) return;
    const all = await store.getAll("conteos");
    setPendingCount(all.filter((l) => l._sync !== "ok").length);
  }, [store]);

  useEffect(() => {
    // Sincroniza el contador con IndexedDB (fuente externa), no con estado de React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPendingCount();
  }, [refreshPendingCount]);

  /* ── sync pump offline → Supabase ────────────────────────────────── */
  // fila primero, foto después: el dato del conteo vale más que la foto,
  // y foto_ref ya es determinístico por cliente_uuid, así que la fila
  // puede quedar guardada aunque la foto todavía no exista en Storage.
  const runSyncPump = useCallback(async () => {
    if (!store) return;
    const pending = (await store.getAll("conteos")).filter((l) => l._sync !== "ok");
    for (const line of pending) {
      const { _sync, _foto_blob, ...lineDB } = line;
      const { syncState } = await syncLinea({
        isOnline: true,
        supabase,
        subirFotoConteo,
        lineDB,
        fotoBlob: _foto_blob,
        rowAlreadySaved: _sync === "sin_foto",
      });
      await store.put("conteos", { ...line, _sync: syncState, _foto_blob: syncState === "ok" ? undefined : _foto_blob });
      setLines((prev) => prev.map((l) => l.cliente_uuid === line.cliente_uuid ? { ...l, _sync: syncState } : l));
    }
    await refreshPendingCount();
  }, [store, refreshPendingCount]);

  useEffect(() => {
    if (!isOnline || !store) return;
    // Polling contra Supabase/IndexedDB (sistemas externos), no derivación de estado de React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runSyncPump();
    const id = setInterval(runSyncPump, 15000);
    return () => clearInterval(id);
  }, [isOnline, store, runSyncPump]);

  // Después de saber quién es el contador (o directo, en modo SIMPLE):
  // Brief W3 #3: el botón "Contar" de Inventario llega con producto y
  // ubicación ya elegidos — saltar location/búsqueda directo a captura.
  // Si la ubicación llega prefijada, también hay que fijarla en la sesión
  // (mismo camino que elegirUbicacion) — es la primera vez que se sabe
  // contra qué ubicación va a correr esta sesión.
  const entrarCaptura = useCallback(async (sesionActual) => {
    if (conteoPrefill) {
      const ubic = ubicaciones.find((u) => u.id === conteoPrefill.ubicacionId);
      const pres = presentaciones.find((p) => p.producto_id === conteoPrefill.productoId && p.es_base)
        || presentaciones.find((p) => p.producto_id === conteoPrefill.productoId);
      setConteoPrefill(null);
      if (ubic && pres) {
        setUbicacion(ubic);
        setSelected(pres);
        setScreen("capture");
        if (!sesionActual.ubicacion_id) {
          const { data } = await supabase.from("sesion_conteo").update({ ubicacion_id: ubic.id }).eq("id", sesionActual.id).select().single();
          if (data) setSesion(data);
        }
        return;
      }
    }
    setScreen("location");
  }, [conteoPrefill, ubicaciones, presentaciones, setConteoPrefill]);

  /* ── crear sesión en Supabase ─────────────────────────────────────── */
  const crearSesion = async (metodo) => {
    setCreandoSesion(true);
    try {
      const { data, error } = await supabase
        .from("sesion_conteo")
        .insert({ nombre: `Conteo ${new Date().toLocaleDateString()}`, metodo, estado: "ABIERTA", iniciada_en: nowISO() })
        .select()
        .single();
      if (error) throw error;
      setSesion(data);

      if (metodo === "DOBLE_CIEGO") {
        setNumeroContador(null);
        setScreen("contador");
        return;
      }
      setNumeroContador(1);
      await entrarCaptura(data);
    } catch (e) {
      setFlash({ type: "error", msg: "Error al crear sesión: " + e.message });
    } finally {
      setCreandoSesion(false);
    }
  };

  // Elegir de qué ronda es este contador — pantalla exclusiva de
  // DOBLE_CIEGO. Limpia `lines` (vista local de este dispositivo) para que
  // el segundo contador, si retoma el mismo teléfono, no vea de arranque lo
  // que cargó el primero.
  const elegirNumeroContador = async (n) => {
    setNumeroContador(n);
    setLines([]);
    await entrarCaptura(sesion);
  };

  /* ── búsqueda de presentaciones (texto: nombre / sku / código de barras) ── */
  const searchQuery = useCallback((q) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const texto = q.toLowerCase();
    const idsPorCodigo = new Set(
      identificadores
        .filter((i) => i.valor.toLowerCase().includes(texto))
        .map((i) => i.presentacion_id)
    );
    setResults(
      presentaciones
        .filter((p) =>
          p.nombre.toLowerCase().includes(texto) ||
          p.producto?.nombre?.toLowerCase().includes(texto) ||
          p.producto?.sku_interno?.toLowerCase().includes(texto) ||
          p.producto?.marca?.toLowerCase().includes(texto) ||
          idsPorCodigo.has(p.id)
        )
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
    );
  }, [presentaciones, identificadores]);

  /* ── escaneo: resuelve el código vía RPC resolver_identificador ───── */
  const handleScan = useCallback(async (codigo) => {
    setScanning(false);
    const code = (codigo || "").trim();
    if (!code) return;
    const { data, error } = await supabase.rpc("resolver_identificador", { p_codigo: code });
    const rows = Array.isArray(data) ? data : (data ? [data] : []);

    if (error || rows.length === 0) {
      setFlash({ type: "error", msg: `Código no reconocido: ${code}` });
      setTimeout(() => setFlash(null), 2500);
      return;
    }

    if (rows.length === 1) {
      const pres = presentaciones.find((p) => p.id === rows[0].presentacion_id);
      if (pres) { setSelected(pres); setResults([]); setQuery(""); }
      else { setFlash({ type: "error", msg: "Presentación fuera del catálogo cargado" }); }
    } else {
      // varias presentaciones comparten el código → mostrar lista para elegir
      const matches = rows
        .map((r) => presentaciones.find((p) => p.id === r.presentacion_id))
        .filter(Boolean);
      setResults(matches);
      setQuery("");
      setFlash({ type: "ok", msg: `${rows.length} presentaciones con ese código, elegí` });
      setTimeout(() => setFlash(null), 2500);
    }
  }, [presentaciones]);

  const resetCapture = () => {
    setQuery(""); setResults([]); setSelected(null);
    setCantidad(""); setEsHuerfano(false); setDescLibre(""); setFotoBlob(null);
  };

  const ubicacionesSucursal = useMemo(
    () => ubicaciones.filter((u) => u.sucursal_id === sucursalActivaId),
    [ubicaciones, sucursalActivaId]
  );

  // Si cambian la sucursal activa (header) con una ubicación ya elegida,
  // esa ubicación puede ser de otra sucursal — no dejar contar contra ella.
  useEffect(() => {
    if (ubicacion && ubicacion.sucursal_id !== sucursalActivaId) {
      // Reacciona a un cambio externo (sucursal activa en el header), no deriva estado local.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUbicacion(null);
      setScreen("location");
    }
  }, [sucursalActivaId, ubicacion]);

  // Fija la sesión a esta ubicación la primera vez que se elige (brief #3:
  // "por ubicación" — una sesión no puede terminar mezclando conteos de dos
  // ubicaciones distintas). Sesiones ya fijadas no deberían llegar acá — la
  // pantalla "location" las bloquea antes — pero el guard es gratis.
  const elegirUbicacion = async (u) => {
    setUbicacion(u);
    if (sesion && !sesion.ubicacion_id) {
      const { data, error } = await supabase.from("sesion_conteo").update({ ubicacion_id: u.id }).eq("id", sesion.id).select().single();
      if (!error && data) setSesion(data);
    }
    setScreen("capture");
  };

  /* ── guardar línea ────────────────────────────────────────────────── */
  const guardarLinea = async () => {
    if (!store || !sesion || !ubicacion) return;
    if (!numeroContador) { setFlash({ type:"error", msg:"No se definió qué contador es este dispositivo" }); return; }
    if (!esHuerfano && !selected) { setFlash({ type:"error", msg:"Selecciona una presentación" }); return; }
    if (cantidad === "" || isNaN(cantidad) || Number(cantidad) < 0) { setFlash({ type:"error", msg:"Cantidad inválida" }); return; }
    if (!fotoBlob) { setFlash({ type:"error", msg:"La foto es obligatoria" }); return; }
    if (esHuerfano && !descLibre.trim()) { setFlash({ type:"error", msg:"Describe el artículo huérfano" }); return; }

    setGuardando(true);
    const clienteUuid = uuid();
    // Path determinístico anclado a cliente_uuid: lo conocemos ANTES de subir,
    // así foto_ref (NOT NULL) queda válido aunque la subida ocurra en el sync.
    const fotoPath = pathFotoConteo(sesion.id, clienteUuid);

    const lineDB = {
      cliente_uuid: clienteUuid,
      sesion_id: sesion.id,
      presentacion_id: esHuerfano ? null : selected.id,
      ubicacion_id: ubicacion.id,
      cantidad: Number(cantidad),
      es_no_catalogado: esHuerfano,
      descripcion_libre: esHuerfano ? descLibre : null,
      foto_ref: fotoPath,
      factor_a_base_snap: esHuerfano ? null : selected.factor_unidad_base,
      numero_conteo: numeroContador,
      contador: usuarioActual.nombre,
      capturado_en: nowISO(),
      estado: "CAPTURADO",
    };

    // El registro local lleva el Blob para subirlo en el sync (offline-first).
    const lineLocal = { ...lineDB, _sync: "pending", _foto_blob: fotoBlob };
    await store.put("conteos", lineLocal);
    setLines((prev) => [...prev, { ...lineDB, _sync: "pending" }]);
    await refreshPendingCount();

    // intentar sync inmediato: la fila primero, la foto después. El flash
    // final refleja el estado real — nunca un ✓ verde si la fila no llegó.
    const { syncState, flash } = await syncLinea({ isOnline, supabase, subirFotoConteo, lineDB, fotoBlob });
    await store.put("conteos", { ...lineLocal, _sync: syncState, _foto_blob: syncState === "ok" ? undefined : fotoBlob });
    setLines((prev) => prev.map((l) => l.cliente_uuid === clienteUuid ? { ...l, _sync: syncState } : l));
    await refreshPendingCount();

    // Brief W3 #3 — corazón de la migración gradual: contar un producto lo
    // pasa a control ESTRICTO en producto_sucursal, sin tocar a los demás.
    // Solo cuando la fila ya está confirmada en el servidor (nunca sobre
    // "pending" — no la vio nadie todavía) y hay un producto real detrás
    // (los huérfanos no tienen producto_id que marcar). RPC pedida a Ness
    // (marcar_inventariado); best-effort — si falla, la línea ya quedó
    // guardada, solo no avanzó la barra de progreso de Surtido.
    if (!esHuerfano && (syncState === "ok" || syncState === "sin_foto")) {
      const { error: errMarcar } = await supabase.rpc("marcar_inventariado", {
        p_producto_id: selected.producto_id,
        p_sucursal_id: ubicacion.sucursal_id,
      });
      if (errMarcar) console.error("marcar_inventariado falló:", errMarcar);
    }

    setFlash(flash);
    setTimeout(() => setFlash(null), 2500);
    resetCapture();
    setGuardando(false);
    inputRef.current?.focus();
  };

  /* ── PANTALLAS ───────────────────────────────────────────────────── */
  if (!store) return (
    <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
      <Loader size={16} className="animate-spin" /> Iniciando…
    </div>
  );

  /* sesión */
  if (screen === "session") return (
    <div className="max-w-md mx-auto pt-10 px-4 space-y-4">
      <div className="flex items-center gap-2 mb-6">
        <ClipboardList className="text-slate-700" />
        <h1 className="text-xl font-bold text-slate-800">Nueva sesión de conteo</h1>
      </div>

      <PendingBanner pendingCount={pendingCount} isOnline={isOnline} onRetry={runSyncPump} />

      {errorCatalogo && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          ⚠ Error cargando catálogo: {errorCatalogo}
        </div>
      )}

      <p className="text-sm text-slate-500">
        Persistencia: <span className="font-mono">{storeMode}</span>
        {loadingCatalogo && <span className="ml-2 text-slate-400">· Cargando catálogo…</span>}
        {!loadingCatalogo && <span className="ml-2 text-green-600">· {ubicacionesSucursal.length} ubic · {presentaciones.length} pres</span>}
      </p>

      <button
        onClick={() => crearSesion("SIMPLE")}
        disabled={creandoSesion || loadingCatalogo}
        className="w-full py-3 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-700 disabled:opacity-50">
        {creandoSesion ? "Creando…" : "Conteo simple"}
      </button>
      <button
        onClick={() => crearSesion("DOBLE_CIEGO")}
        disabled={creandoSesion || loadingCatalogo}
        className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-500 disabled:opacity-50">
        Conteo doble ciego
      </button>

      <div className="flex items-center gap-2 text-xs text-slate-400 mt-4">
        {isOnline
          ? <Wifi size={14} className="text-green-500" />
          : <WifiOff size={14} className="text-red-400" />}
        <span>{isOnline ? "En línea" : "Sin conexión — guardando localmente"}</span>
        <button onClick={() => setForceOffline((v) => !v)} className="ml-auto text-xs underline text-slate-400">
          {forceOffline ? "Volver a online" : "Simular offline"}
        </button>
      </div>
    </div>
  );

  /* quién es este contador — solo DOBLE_CIEGO, una vez por dispositivo.
     No expone nada del otro contador, es puramente "quién sos vos". */
  if (screen === "contador") return (
    <div className="max-w-md mx-auto pt-10 px-4 space-y-4">
      <div className="flex items-center gap-2 mb-6">
        <ClipboardList className="text-slate-700" />
        <h1 className="text-xl font-bold text-slate-800">¿Sos el primer o el segundo contador?</h1>
      </div>
      <p className="text-sm text-slate-500">
        Doble ciego: cada contador cuenta por separado, sin ver lo que cargó el otro. Elegí tu ronda en este dispositivo.
      </p>
      <button onClick={() => elegirNumeroContador(1)}
        className="w-full py-3 bg-slate-800 text-white rounded-xl font-medium hover:bg-slate-700">
        Soy el primer contador
      </button>
      <button onClick={() => elegirNumeroContador(2)}
        className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-500">
        Soy el segundo contador
      </button>
      {numeroContador && ubicacion && (
        <button onClick={() => setScreen("capture")} className="w-full text-center text-xs text-slate-400 underline">
          Cancelar, seguir como contador {numeroContador}
        </button>
      )}
    </div>
  );

  /* ubicación — filtradas a la sucursal activa: sin esto, Cristian
     (Tienda) podía contar contra una ubicación de Almacén sin barrera.
     Una vez que la sesión fijó ubicacion_id (brief #3, "por ubicación") ya
     no se puede elegir otra — la pantalla solo deja volver a la fijada. */
  if (screen === "location") {
    const ubicFija = sesion?.ubicacion_id ? ubicaciones.find((u) => u.id === sesion.ubicacion_id) : null;
    return (
      <div className="max-w-md mx-auto pt-6 px-4 space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <MapPin className="text-slate-700" />
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Selecciona la ubicación</h2>
            <p className="text-xs text-slate-400">{nombreSucursal(sucursalActivaId) || "…"}</p>
          </div>
        </div>
        <PendingBanner pendingCount={pendingCount} isOnline={isOnline} onRetry={runSyncPump} />
        {ubicFija ? (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Esta sesión ya quedó fija a esta ubicación — no se puede contar otra mientras esté abierta.
            </div>
            <button onClick={() => { setUbicacion(ubicFija); setScreen("capture"); }}
              className="w-full text-left px-4 py-3 bg-white border-2 border-slate-800 rounded-xl font-mono text-sm">
              {labelUbicacion(ubicFija)}
            </button>
          </>
        ) : (
          <>
            {ubicacionesSucursal.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">Sin ubicaciones cargadas para esta sucursal.</p>
            )}
            {ubicacionesSucursal.map((u) => (
              <button key={u.id} onClick={() => elegirUbicacion(u)}
                className="w-full text-left px-4 py-3 bg-white border rounded-xl hover:bg-slate-50 font-mono text-sm">
                {labelUbicacion(u)}
              </button>
            ))}
          </>
        )}
      </div>
    );
  }

  /* captura */
  if (screen === "capture") return (
    <div className="max-w-md mx-auto pt-4 px-4 space-y-3">
      {scanning && <EscanerCodigo onDetect={handleScan} onClose={() => setScanning(false)} />}

      <div className="flex items-center gap-2">
        <button onClick={() => setScreen("location")} className="text-slate-500 hover:text-slate-700">
          <ArrowLeft size={18} />
        </button>
        <h2 className="font-semibold text-slate-800">
          Captura — <span className="font-mono text-blue-600">{labelUbicacion(ubicacion)}</span>
        </h2>
        {sesion?.metodo === "DOBLE_CIEGO" && (
          <button
            onClick={() => setScreen("contador")}
            title="Cambiar de contador (para pasar el dispositivo a la otra ronda)"
            className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200">
            Contador {numeroContador} · cambiar
          </button>
        )}
        <button onClick={() => setScreen("review")} className="ml-auto text-xs text-slate-500 underline">
          Ver ({lines.length})
        </button>
      </div>

      <PendingBanner pendingCount={pendingCount} isOnline={isOnline} onRetry={runSyncPump} />

      {flash && (() => {
        const FlashIcon = FLASH_ICONS[flash.type] ?? AlertCircle;
        return (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${FLASH_STYLES[flash.type] ?? FLASH_STYLES.error}`}>
            <FlashIcon size={14} />
            {flash.msg}
          </div>
        );
      })()}

      {!selected && !esHuerfano && (
        <>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input ref={inputRef} value={query} onChange={(e) => searchQuery(e.target.value)}
                placeholder="Código de barras o nombre…"
                className="w-full pl-8 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            </div>
            <button onClick={() => setScanning(true)} className="px-3 py-2 bg-slate-800 text-white rounded-lg">
              <Camera size={16} />
            </button>
          </div>
          {results.length > 0 && (
            <div className="border rounded-lg divide-y bg-white">
              {results.map((p) => (
                <button key={p.id} onClick={() => { setSelected(p); setResults([]); setQuery(""); }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                  <div>
                    <span className="font-medium">{p.producto?.nombre}</span>
                    <span className="text-slate-500"> · {p.nombre}</span>
                  </div>
                  {metaProducto(p.producto) && (
                    <p className="text-xs text-slate-500">{metaProducto(p.producto)}</p>
                  )}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setEsHuerfano(true)}
            className="flex items-center gap-1 text-xs text-amber-600 underline">
            <Plus size={12} /> Artículo sin código / no catalogado
          </button>
        </>
      )}

      {selected && !esHuerfano && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm">
          <p className="font-semibold text-blue-800">{selected.producto?.nombre}</p>
          {metaProducto(selected.producto) && (
            <p className="text-xs text-slate-500">{metaProducto(selected.producto)}</p>
          )}
          <p className="text-blue-600">{selected.nombre} · factor {selected.factor_unidad_base} {selected.producto?.unidad_base}</p>
          <button onClick={() => setSelected(null)} className="text-xs text-blue-400 underline mt-1">Cambiar</button>
        </div>
      )}

      {esHuerfano && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-amber-700">Artículo no catalogado</p>
          <input value={descLibre} onChange={(e) => setDescLibre(e.target.value)}
            placeholder="Descripción del artículo…"
            className="w-full px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
          <button onClick={() => { setEsHuerfano(false); setDescLibre(""); }}
            className="text-xs text-amber-500 underline">Cancelar</button>
        </div>
      )}

      {(selected || esHuerfano) && (
        <div className="space-y-2">
          <input type="number" min="0" step="any" value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            placeholder="Cantidad contada"
            className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
          {selected && cantidad && !isNaN(cantidad) && (
            <p className="text-xs text-slate-500">
              = {(Number(cantidad) * selected.factor_unidad_base).toFixed(2)} {selected.producto?.unidad_base} base
            </p>
          )}
        </div>
      )}

      {(selected || esHuerfano) && (
        <>
          <input
            ref={fotoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => setFotoBlob(e.target.files?.[0] ?? null)}
          />
          <button onClick={() => fotoInputRef.current?.click()}
            className={`flex items-center gap-2 w-full px-3 py-2 border-2 border-dashed rounded-lg text-sm
              ${fotoBlob ? "border-green-400 text-green-600 bg-green-50" : "border-slate-300 text-slate-500 hover:bg-slate-50"}`}>
            <Camera size={16} />
            {fotoBlob ? "Foto capturada ✓ (tocá para recapturar)" : "Tomar foto (obligatoria)"}
          </button>
        </>
      )}

      {(selected || esHuerfano) && (
        <button onClick={guardarLinea} disabled={guardando}
          className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-500 disabled:opacity-50 flex items-center justify-center gap-2">
          {guardando && <Loader size={14} className="animate-spin" />}
          {guardando ? "Guardando…" : "Guardar línea"}
        </button>
      )}
    </div>
  );

  /* revisión */
  if (screen === "review") return (
    <div className="max-w-md mx-auto pt-4 px-4 space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setScreen("capture")} className="text-slate-500 hover:text-slate-700">
          <ArrowLeft size={18} />
        </button>
        <h2 className="font-semibold text-slate-800">Líneas capturadas ({lines.length})</h2>
      </div>
      <PendingBanner pendingCount={pendingCount} isOnline={isOnline} onRetry={runSyncPump} />
      {lines.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Sin líneas aún</p>}
      {lines.map((l) => {
        const pres = presentaciones.find((p) => p.id === l.presentacion_id);
        return (
          <div key={l.cliente_uuid} className="bg-white border rounded-lg px-3 py-2 text-sm flex justify-between items-center">
            <div>
              {l.es_no_catalogado
                ? <p className="font-medium text-amber-700">⚠ {l.descripcion_libre}</p>
                : <p className="font-medium">{pres?.producto?.nombre} · {pres?.nombre}</p>}
              <p className="text-slate-500">Cant: {l.cantidad}</p>
            </div>
            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
              ${l._sync === "ok" ? "bg-green-100 text-green-700"
                : l._sync === "sin_foto" ? "bg-slate-200 text-slate-600"
                : "bg-amber-100 text-amber-700"}`}>
              {l._sync === "sin_foto" && <ImageOff size={12} />}
              {l._sync === "ok" ? "Sync ✓" : l._sync === "sin_foto" ? "Sync sin foto" : "Pendiente"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
