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
 *   ubicacion:             id, codigo_zona, estante, nivel
 *   producto:              id, nombre, sku_interno, unidad_base
 *   presentacion:          id, producto_id, nombre, factor_unidad_base, es_base
 *   identificador:         id, presentacion_id, valor, tipo, origen, activo, es_principal
 *                          (resolución por escaneo vía RPC resolver_identificador)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { subirFotoConteo, pathFotoConteo } from "./fotoConteo";
import EscanerCodigo from "./EscanerCodigo";
import { useAuth } from "./auth/AuthProvider";
import {
  Camera, Search, MapPin, CheckCircle, AlertCircle,
  Wifi, WifiOff, ClipboardList, ArrowLeft, Plus, Loader,
} from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────────────── */
const uuid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
const nowISO = () => new Date().toISOString();
const labelUbicacion = (u) => `${u.codigo_zona}-${u.estante}-${u.nivel}`;

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
  const { usuario } = useAuth();
  const [store, setStore] = useState(null);
  const [storeMode, setStoreMode] = useState(null);

  // catálogo desde Supabase
  const [ubicaciones, setUbicaciones] = useState([]);
  const [presentaciones, setPresentaciones] = useState([]);
  const [loadingCatalogo, setLoadingCatalogo] = useState(true);
  const [errorCatalogo, setErrorCatalogo] = useState(null);

  // sesión activa
  const [sesion, setSesion] = useState(null);
  const [creandoSesion, setCreandoSesion] = useState(false);

  // navegación
  const [screen, setScreen] = useState("session"); // session|location|capture|review
  const [ubicacion, setUbicacion] = useState(null);

  // líneas capturadas
  const [lines, setLines] = useState([]);

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

  // cargar catálogo desde Supabase
  useEffect(() => {
    async function cargarCatalogo() {
      setLoadingCatalogo(true);
      try {
        const [{ data: ubs, error: e1 }, { data: pres, error: e2 }] = await Promise.all([
          supabase.from("ubicacion").select("id, codigo_zona, estante, nivel").order("codigo_zona"),
          supabase.from("presentacion").select("id, producto_id, nombre, factor_unidad_base, es_base, producto(id, nombre, sku_interno, unidad_base)").order("nombre"),
        ]);
        if (e1) throw e1;
        if (e2) throw e2;
        setUbicaciones(ubs || []);
        setPresentaciones(pres || []);
      } catch (e) {
        setErrorCatalogo(e.message);
      } finally {
        setLoadingCatalogo(false);
      }
    }
    cargarCatalogo();
  }, []);

  /* ── sync pump offline → Supabase ────────────────────────────────── */
  useEffect(() => {
    if (!isOnline || !store) return;
    const run = async () => {
      const pending = (await store.getAll("conteos")).filter((l) => l._sync !== "ok");
      for (const line of pending) {
        const { _sync, _foto_blob, ...payload } = line;
        try {
          // offline-first: la foto se sube aquí, en el sync (no en la captura).
          if (_foto_blob) {
            await subirFotoConteo({
              sesionId: payload.sesion_id,
              clienteUuid: payload.cliente_uuid,
              archivo: _foto_blob,
            });
          }
          const { error } = await supabase
            .from("conteo_fisico_inicial")
            .upsert(payload, { onConflict: "cliente_uuid" });
          if (!error) {
            await store.put("conteos", { ...line, _sync: "ok" });
            setLines((prev) => prev.map((l) => l.cliente_uuid === line.cliente_uuid ? { ...l, _sync: "ok" } : l));
          }
        } catch {
          // sigue pending; el próximo tick reintenta foto + fila
        }
      }
    };
    run();
    const id = setInterval(run, 15000);
    return () => clearInterval(id);
  }, [isOnline, store]);

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
      setScreen("location");
    } catch (e) {
      setFlash({ type: "error", msg: "Error al crear sesión: " + e.message });
    } finally {
      setCreandoSesion(false);
    }
  };

  /* ── búsqueda de presentaciones (texto: nombre / sku) ────────────── */
  const searchQuery = useCallback((q) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); return; }
    const texto = q.toLowerCase();
    setResults(
      presentaciones.filter((p) =>
        p.nombre.toLowerCase().includes(texto) ||
        p.producto?.nombre.toLowerCase().includes(texto) ||
        p.producto?.sku_interno.toLowerCase().includes(texto)
      )
    );
  }, [presentaciones]);

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

  /* ── guardar línea ────────────────────────────────────────────────── */
  const guardarLinea = async () => {
    if (!store || !sesion || !ubicacion) return;
    if (!esHuerfano && !selected) { setFlash({ type:"error", msg:"Selecciona una presentación" }); return; }
    if (!cantidad || isNaN(cantidad) || Number(cantidad) <= 0) { setFlash({ type:"error", msg:"Cantidad inválida" }); return; }
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
      numero_conteo: 1,
      contador: usuario || "sistema",
      capturado_en: nowISO(),
      estado: "CAPTURADO",
    };

    // El registro local lleva el Blob para subirlo en el sync (offline-first).
    const lineLocal = { ...lineDB, _sync: "pending", _foto_blob: fotoBlob };
    await store.put("conteos", lineLocal);
    setLines((prev) => [...prev, { ...lineDB, _sync: "pending" }]);

    // intentar sync inmediato si hay conexión (foto primero, luego fila)
    if (isOnline) {
      try {
        await subirFotoConteo({ sesionId: sesion.id, clienteUuid, archivo: fotoBlob });
        const { error } = await supabase
          .from("conteo_fisico_inicial")
          .upsert(lineDB, { onConflict: "cliente_uuid" });
        if (!error) {
          await store.put("conteos", { ...lineLocal, _sync: "ok" });
          setLines((prev) => prev.map((l) => l.cliente_uuid === clienteUuid ? { ...l, _sync: "ok" } : l));
        }
      } catch {
        // queda pending; el pump reintenta foto + fila
      }
    }

    setFlash({ type:"ok", msg:"Línea guardada ✓" });
    setTimeout(() => setFlash(null), 2000);
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

      {errorCatalogo && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
          ⚠ Error cargando catálogo: {errorCatalogo}
        </div>
      )}

      <p className="text-sm text-slate-500">
        Persistencia: <span className="font-mono">{storeMode}</span>
        {loadingCatalogo && <span className="ml-2 text-slate-400">· Cargando catálogo…</span>}
        {!loadingCatalogo && <span className="ml-2 text-green-600">· {ubicaciones.length} ubic · {presentaciones.length} pres</span>}
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

  /* ubicación */
  if (screen === "location") return (
    <div className="max-w-md mx-auto pt-6 px-4 space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <MapPin className="text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-800">Selecciona la ubicación</h2>
      </div>
      {ubicaciones.map((u) => (
        <button key={u.id} onClick={() => { setUbicacion(u); setScreen("capture"); }}
          className="w-full text-left px-4 py-3 bg-white border rounded-xl hover:bg-slate-50 font-mono text-sm">
          {labelUbicacion(u)}
        </button>
      ))}
    </div>
  );

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
        <button onClick={() => setScreen("review")} className="ml-auto text-xs text-slate-500 underline">
          Ver ({lines.length})
        </button>
      </div>

      {flash && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm
          ${flash.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {flash.type === "ok" ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {flash.msg}
        </div>
      )}

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
                  <span className="font-medium">{p.producto?.nombre}</span>
                  <span className="text-slate-500"> · {p.nombre}</span>
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
          <input type="number" min="0.001" step="any" value={cantidad}
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
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium
              ${l._sync === "ok" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
              {l._sync === "ok" ? "Sync ✓" : "Pendiente"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
