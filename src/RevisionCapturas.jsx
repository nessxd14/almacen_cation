/**
 * RevisionCapturas.jsx — revisión admin de capturas de fotos de producto.
 *
 * Consume producto_captura_sesion / producto_captura_foto /
 * producto_dato_propuesto, ya llenadas por la Edge Function
 * ingest-foto-producto (OpenClaw + botón de captura in-app, ese último
 * todavía sin construir). Esta pantalla NUNCA escribe a esas tres tablas
 * salvo al aprobar/rechazar un campo puntual — nada se dispara por el solo
 * hecho de mirarla.
 *
 * `empaque` (addendum_empaque_revision_capturas.md): código de barra de la
 * caja/empaque mayor, distinto del `codigo_barra` de la unidad individual.
 * Mismo destino que codigo_fabrica/codigo_barra (`identificador`), solo
 * cambia `tipo`. La migración que suma 'empaque' a identificador.tipo ya
 * está aplicada.
 *
 * Imagen principal (addendum_imagen_principal.md): "Usar como imagen
 * principal" descarga la foto del bucket privado `capturas_producto`, la
 * sube al bucket público `producto_imagenes` (path determinístico
 * `producto_{id}.jpg`, upsert) y guarda la URL pública en
 * `producto.imagen_url`. Acción independiente del estado de los
 * producto_dato_propuesto — no requiere que la sesión tenga campos
 * pendientes ni resueltos. Solo disponible si sesion.producto_id no es NULL.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "./supabaseClient";
import { urlFirmadaCaptura } from "./fotoCaptura";
import TypeaheadProducto from "./TypeaheadProducto";
import { useUsuarioActual } from "./lib/useAuth";
import {
  Images, Link, PlusCircle, CheckCircle, XCircle, AlertCircle, AlertTriangle,
  Loader, RefreshCw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ImageOff, Star,
} from "lucide-react";

const CAMPO_LABELS = {
  codigo_fabrica: "Código de fábrica",
  codigo_barra: "Código de barra",
  empaque: "Código de empaque",
  marca_sugerida: "Marca sugerida",
  nombre_sugerido: "Nombre sugerido",
};

// Campos que van a identificador — mapeo campo -> tipo. codigo_fabrica y
// codigo_barra ya se resolvían así; empaque entra con el mismo camino de
// escritura (ver addendum_empaque_revision_capturas.md).
const CAMPO_A_TIPO_IDENTIFICADOR = {
  codigo_fabrica: "fabrica",
  codigo_barra: "barra",
  empaque: "empaque",
};

function badgeConfianza(c) {
  if (c == null) return "bg-slate-100 text-slate-500";
  if (c > 0.8) return "bg-green-100 text-green-700";
  if (c >= 0.5) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-500";
}

export default function RevisionCapturas() {
  const usuario = useUsuarioActual();
  const [sesiones, setSesiones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [fotoUrls, setFotoUrls] = useState({}); // fotoId -> signed url
  const [cargandoFotos, setCargandoFotos] = useState(false);
  const [guardandoCampoId, setGuardandoCampoId] = useState(null);
  const [guardandoTodos, setGuardandoTodos] = useState(false);
  const [edits, setEdits] = useState({}); // datoId -> valor editado
  const [galeriaIdx, setGaleriaIdx] = useState(0);
  const [promoviendoFotoId, setPromoviendoFotoId] = useState(null);
  const [confirmandoImagen, setConfirmandoImagen] = useState(null); // { sesionId, fotoId } | null

  // huérfanos: modo de resolución activo por sesión
  const [modoHuerfano, setModoHuerfano] = useState({}); // sesionId -> 'vincular' | 'nuevo'
  const [buscaProducto, setBuscaProducto] = useState("");
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoUnidad, setNuevoUnidad] = useState("unidad");
  const [nuevoMarca, setNuevoMarca] = useState("");
  const [guardandoHuerfano, setGuardandoHuerfano] = useState(false);

  const presBaseCache = useRef({}); // producto_id -> presentacion_id base

  const showFlash = (msg, type = "ok") => {
    setFlash({ msg, type });
    setTimeout(() => setFlash(null), 3500);
  };

  const cargar = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("producto_captura_sesion")
      .select(`
        id, producto_id, origen, creado_en,
        producto(id, nombre, marca, shopify_variant_id, imagen_url),
        producto_captura_foto(id, foto_ref, orden),
        producto_dato_propuesto(id, campo, valor_propuesto, valor_corregido, confianza, estado, revisado_por, revisado_en)
      `)
      .order("creado_en", { ascending: false });
    if (error) { showFlash("Error al cargar: " + error.message, "error"); setLoading(false); return; }
    const pendientes = (data || [])
      .map(s => ({ ...s, producto_captura_foto: (s.producto_captura_foto || []).slice().sort((a, b) => a.orden - b.orden) }))
      .filter(s => (s.producto_dato_propuesto || []).some(d => d.estado === "pendiente"));
    setSesiones(pendientes);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const resetHuerfanoForm = () => {
    setBuscaProducto(""); setNuevoNombre(""); setNuevoUnidad("unidad"); setNuevoMarca("");
  };

  const toggleExpand = async (sesion) => {
    if (expandedId === sesion.id) { setExpandedId(null); return; }
    setExpandedId(sesion.id);
    setGaleriaIdx(0);
    resetHuerfanoForm();
    setModoHuerfano(m => ({ ...m, [sesion.id]: sesion.producto_id ? null : (m[sesion.id] || "vincular") }));

    const faltantes = sesion.producto_captura_foto.filter(f => !fotoUrls[f.id]);
    if (faltantes.length === 0) return;
    setCargandoFotos(true);
    const pares = await Promise.all(faltantes.map(async f => [f.id, await urlFirmadaCaptura(f.foto_ref)]));
    setFotoUrls(prev => {
      const next = { ...prev };
      for (const [id, url] of pares) next[id] = url;
      return next;
    });
    setCargandoFotos(false);
  };

  async function presentacionBaseId(productoId) {
    if (presBaseCache.current[productoId]) return presBaseCache.current[productoId];
    const { data } = await supabase
      .from("presentacion").select("id")
      .eq("producto_id", productoId).eq("es_base", true).limit(1).maybeSingle();
    if (data) presBaseCache.current[productoId] = data.id;
    return data?.id ?? null;
  }

  // ── vincular huérfano a producto existente ──
  async function vincularHuerfano(sesion, producto) {
    setGuardandoHuerfano(true);
    const { error } = await supabase
      .from("producto_captura_sesion").update({ producto_id: producto.id }).eq("id", sesion.id);
    setGuardandoHuerfano(false);
    if (error) { showFlash("Error al vincular: " + error.message, "error"); return; }
    showFlash(`Vinculado a "${producto.nombre}"`);
    resetHuerfanoForm();
    cargar();
  }

  // ── crear producto nuevo para un huérfano ──
  async function crearProductoParaHuerfano(sesion) {
    if (!nuevoNombre.trim()) { showFlash("El nombre del producto es obligatorio", "error"); return; }
    setGuardandoHuerfano(true);
    const { data: prod, error: errProd } = await supabase
      .from("producto")
      .insert({ nombre: nuevoNombre.trim(), unidad_base: nuevoUnidad.trim() || "unidad", marca: nuevoMarca.trim() || null })
      .select("id, nombre").single();
    if (errProd) { showFlash("Error al crear el producto: " + errProd.message, "error"); setGuardandoHuerfano(false); return; }

    const { error: errPres } = await supabase
      .from("presentacion").insert({ producto_id: prod.id, nombre: "Unidad", factor_unidad_base: 1, es_base: true });
    if (errPres) { showFlash("Producto creado, pero falló la presentación base: " + errPres.message, "error"); setGuardandoHuerfano(false); return; }

    const { error: errSesion } = await supabase
      .from("producto_captura_sesion").update({ producto_id: prod.id }).eq("id", sesion.id);
    setGuardandoHuerfano(false);
    if (errSesion) { showFlash("Error al vincular la sesión: " + errSesion.message, "error"); return; }

    showFlash(`Producto "${prod.nombre}" creado y vinculado`);
    resetHuerfanoForm();
    cargar();
  }

  // ── usar foto como imagen principal del producto ──
  function clickImagenPrincipal(sesion, foto) {
    if (!sesion.producto_id) return;
    if (sesion.producto?.imagen_url) {
      setConfirmandoImagen({ sesionId: sesion.id, fotoId: foto.id });
    } else {
      promoverImagenPrincipal(sesion, foto);
    }
  }

  async function promoverImagenPrincipal(sesion, foto) {
    setConfirmandoImagen(null);
    setPromoviendoFotoId(foto.id);
    try {
      // La copia directa capturas_producto -> producto_imagenes desde el
      // cliente falla con RLS de forma no explicada (ver
      // addendum_imagen_principal_edge_function.md) — se resuelve
      // server-side con service_role vía esta función.
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("https://zxoxougwgstrarwymlvd.supabase.co/functions/v1/promover-imagen-principal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ producto_id: sesion.producto_id, foto_ref: foto.foto_ref }),
      });
      if (!res.ok) {
        const texto = await res.text();
        throw new Error(texto || `HTTP ${res.status}`);
      }

      showFlash("Imagen principal actualizada");
      cargar();
    } catch (e) {
      showFlash("Error al promover la imagen: " + e.message, "error");
    } finally {
      setPromoviendoFotoId(null);
    }
  }

  // ── aprobar / rechazar campo por campo ──
  // Escribe el dato en su tabla destino (si aplica) y marca el dato propuesto
  // como aprobado. No hace UPDATE masivo: cada campo pasa por acá, incluso
  // cuando se dispara desde "Aprobar todos".
  async function escribirAprobado(dato, sesion) {
    const valor = (edits[dato.id] ?? dato.valor_corregido ?? dato.valor_propuesto ?? "").trim();
    if (!valor) throw new Error("El valor no puede quedar vacío");
    const valorCorregido = valor !== dato.valor_propuesto ? valor : null;

    const tipoIdentificador = CAMPO_A_TIPO_IDENTIFICADOR[dato.campo];
    if (tipoIdentificador) {
      const presId = await presentacionBaseId(sesion.producto_id);
      if (!presId) throw new Error("El producto no tiene presentación base");
      const { error } = await supabase.from("identificador")
        .insert({ presentacion_id: presId, valor, tipo: tipoIdentificador, origen: "fabricante" });
      if (error) throw error;
    } else if (dato.campo === "marca_sugerida") {
      const { error } = await supabase.from("producto").update({ marca: valor }).eq("id", sesion.producto_id);
      if (error) throw error;
    } else if (dato.campo === "nombre_sugerido") {
      const { error } = await supabase.from("producto").update({ nombre: valor }).eq("id", sesion.producto_id);
      if (error) throw error;
    }

    const { error: errDato } = await supabase.from("producto_dato_propuesto").update({
      estado: "aprobado",
      valor_corregido: valorCorregido,
      revisado_por: usuario?.email || null,
      revisado_en: new Date().toISOString(),
    }).eq("id", dato.id);
    if (errDato) throw errDato;
  }

  async function aprobarCampo(dato, sesion) {
    setGuardandoCampoId(dato.id);
    try {
      await escribirAprobado(dato, sesion);
      showFlash("Campo aprobado");
      cargar();
    } catch (e) {
      showFlash("Error: " + e.message, "error");
    } finally {
      setGuardandoCampoId(null);
    }
  }

  async function rechazarCampo(dato) {
    setGuardandoCampoId(dato.id);
    const { error } = await supabase.from("producto_dato_propuesto").update({
      estado: "rechazado",
      revisado_por: usuario?.email || null,
      revisado_en: new Date().toISOString(),
    }).eq("id", dato.id);
    setGuardandoCampoId(null);
    if (error) { showFlash("Error: " + error.message, "error"); return; }
    showFlash("Campo rechazado", "warn");
    cargar();
  }

  async function aprobarTodos(sesion, pendientes) {
    setGuardandoTodos(true);
    let fallos = 0;
    for (const dato of pendientes) {
      try { await escribirAprobado(dato, sesion); }
      catch { fallos++; }
    }
    setGuardandoTodos(false);
    showFlash(fallos === 0 ? "Todos los campos aprobados" : `Aprobados con ${fallos} error(es)`, fallos === 0 ? "ok" : "error");
    cargar();
  }

  return (
    <div className="max-w-2xl mx-auto pt-4 px-4 space-y-4 pb-10">
      <div className="flex items-center gap-2">
        <Images className="text-slate-700" />
        <h1 className="text-xl font-bold text-slate-800">Revisión de capturas</h1>
        <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
          {sesiones.length} pendientes
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

      {!loading && sesiones.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-10">¡Sin capturas pendientes de revisión! 🎉</p>
      )}

      {sesiones.map(sesion => {
        const expanded = expandedId === sesion.id;
        const pendientes = sesion.producto_dato_propuesto.filter(d => d.estado === "pendiente");
        const primeraFoto = sesion.producto_captura_foto[0];
        const esHuerfano = !sesion.producto_id;

        return (
          <div key={sesion.id} className={`bg-white border rounded-xl overflow-hidden
            ${expanded ? "border-blue-400 shadow-sm" : "border-slate-200"}`}>

            {/* cabecera */}
            <button onClick={() => toggleExpand(sesion)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
              <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center">
                {primeraFoto && fotoUrls[primeraFoto.id]
                  ? <img src={fotoUrls[primeraFoto.id]} alt="" className="h-full w-full object-cover" />
                  : <ImageOff size={16} className="text-slate-300" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-slate-800 truncate">
                  {sesion.producto?.nombre || "Sin identificar"}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {esHuerfano && (
                    <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-medium">Sin identificar</span>
                  )}
                  <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{sesion.origen}</span>
                  <span className="text-xs text-slate-400">{pendientes.length} campo(s) pendiente(s)</span>
                </div>
              </div>
              {expanded ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
            </button>

            {expanded && (
              <div className="border-t border-slate-100 px-4 py-3 space-y-4 bg-slate-50">
                {/* galería */}
                {sesion.producto_captura_foto.length > 0 && (
                  <div>
                    <div className="relative rounded-lg overflow-hidden bg-slate-200 h-56 flex items-center justify-center">
                      {cargandoFotos && !fotoUrls[sesion.producto_captura_foto[galeriaIdx]?.id] ? (
                        <Loader size={18} className="animate-spin text-slate-400" />
                      ) : fotoUrls[sesion.producto_captura_foto[galeriaIdx]?.id] ? (
                        <img src={fotoUrls[sesion.producto_captura_foto[galeriaIdx].id]} alt=""
                          className="h-full w-full object-contain bg-black/5" />
                      ) : (
                        <ImageOff size={24} className="text-slate-400" />
                      )}
                      {sesion.producto_captura_foto.length > 1 && (
                        <>
                          <button onClick={() => setGaleriaIdx(i => (i - 1 + sesion.producto_captura_foto.length) % sesion.producto_captura_foto.length)}
                            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 text-white hover:bg-black/60">
                            <ChevronLeft size={16} />
                          </button>
                          <button onClick={() => setGaleriaIdx(i => (i + 1) % sesion.producto_captura_foto.length)}
                            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 text-white hover:bg-black/60">
                            <ChevronRight size={16} />
                          </button>
                          <span className="absolute bottom-1 right-1 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
                            {galeriaIdx + 1}/{sesion.producto_captura_foto.length}
                          </span>
                        </>
                      )}
                    </div>

                    {!esHuerfano && (() => {
                      const fotoActual = sesion.producto_captura_foto[galeriaIdx];
                      const confirmandoEsta = confirmandoImagen?.sesionId === sesion.id && confirmandoImagen?.fotoId === fotoActual.id;
                      const ocupadaEsta = promoviendoFotoId === fotoActual.id;
                      return (
                        <div className="mt-2">
                          {confirmandoEsta ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-2">
                              <p>
                                Este producto ya tiene una imagen principal cargada — se va a reemplazar.
                                {sesion.producto?.shopify_variant_id && " No afecta a Shopify, y bootstrap_catalogo.mjs no toca imagen_url, así que no se revierte sola."}
                              </p>
                              <div className="flex gap-2">
                                <button onClick={() => promoverImagenPrincipal(sesion, fotoActual)}
                                  className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500">
                                  Sí, reemplazar
                                </button>
                                <button onClick={() => setConfirmandoImagen(null)}
                                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button onClick={() => clickImagenPrincipal(sesion, fotoActual)} disabled={ocupadaEsta}
                              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50">
                              {ocupadaEsta ? <Loader size={13} className="animate-spin" /> : <Star size={13} />}
                              {ocupadaEsta ? "Promoviendo…" : "Usar como imagen principal"}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* resolución de huérfano */}
                {esHuerfano && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 space-y-3">
                    <p className="text-xs font-semibold text-orange-800">
                      Esta sesión no tiene producto asignado — vinculá o creá uno antes de poder aprobar campos.
                    </p>
                    <div className="flex gap-1.5">
                      <button onClick={() => setModoHuerfano(m => ({ ...m, [sesion.id]: "vincular" }))}
                        className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium
                          ${modoHuerfano[sesion.id] === "vincular" ? "bg-blue-600 text-white" : "bg-white border border-slate-300 text-slate-600"}`}>
                        <Link size={13} /> Vincular existente
                      </button>
                      <button onClick={() => setModoHuerfano(m => ({ ...m, [sesion.id]: "nuevo" }))}
                        className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium
                          ${modoHuerfano[sesion.id] === "nuevo" ? "bg-green-600 text-white" : "bg-white border border-slate-300 text-slate-600"}`}>
                        <PlusCircle size={13} /> Crear nuevo
                      </button>
                    </div>

                    {modoHuerfano[sesion.id] === "vincular" && (
                      <TypeaheadProducto
                        value={buscaProducto}
                        onChange={setBuscaProducto}
                        onSeleccionar={(producto) => vincularHuerfano(sesion, producto)}
                        placeholder="Buscar producto…"
                      />
                    )}

                    {modoHuerfano[sesion.id] === "nuevo" && (
                      <div className="space-y-2">
                        <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)}
                          placeholder="Nombre del producto *"
                          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
                        <div className="flex gap-2">
                          <input value={nuevoMarca} onChange={e => setNuevoMarca(e.target.value)}
                            placeholder="Marca"
                            className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
                          <input value={nuevoUnidad} onChange={e => setNuevoUnidad(e.target.value)}
                            placeholder="Unidad base"
                            className="w-28 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
                        </div>
                        <button onClick={() => crearProductoParaHuerfano(sesion)} disabled={guardandoHuerfano}
                          className="w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-500 disabled:opacity-50 flex items-center justify-center gap-1">
                          {guardandoHuerfano && <Loader size={12} className="animate-spin" />}
                          Crear y vincular
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* campos pendientes */}
                {!esHuerfano && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-600">Datos propuestos</p>
                      {pendientes.length > 1 && (
                        <button onClick={() => aprobarTodos(sesion, pendientes)} disabled={guardandoTodos}
                          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50">
                          {guardandoTodos && <Loader size={11} className="animate-spin" />}
                          Aprobar todos los pendientes
                        </button>
                      )}
                    </div>

                    {pendientes.map(dato => {
                      const valorActual = edits[dato.id] ?? dato.valor_corregido ?? dato.valor_propuesto ?? "";
                      const ocupado = guardandoCampoId === dato.id || guardandoTodos;
                      return (
                        <div key={dato.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-700">{CAMPO_LABELS[dato.campo] || dato.campo}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${badgeConfianza(dato.confianza)}`}>
                              {dato.confianza == null ? "sin confianza" : `${Math.round(dato.confianza * 100)}%`}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">Propuesto: <span className="font-mono">{dato.valor_propuesto}</span></p>

                          {dato.campo === "nombre_sugerido" && sesion.producto?.shopify_variant_id && (
                            <p className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                              Este producto tiene shopify_variant_id de una importación anterior — no hay
                              sincronización activa con Shopify, pero si alguna vez se vuelve a correr
                              bootstrap_catalogo.mjs a mano, ese script reimporta el nombre y pisaría este cambio.
                            </p>
                          )}

                          <div className="flex gap-2">
                            <input value={valorActual}
                              onChange={e => setEdits(prev => ({ ...prev, [dato.id]: e.target.value }))}
                              className="flex-1 px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                            <button onClick={() => aprobarCampo(dato, sesion)} disabled={ocupado}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-500 disabled:opacity-50">
                              <CheckCircle size={13} /> Aprobar
                            </button>
                            <button onClick={() => rechazarCampo(dato)} disabled={ocupado}
                              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-red-300 text-red-600 rounded-lg text-xs font-medium hover:bg-red-50 disabled:opacity-50">
                              <XCircle size={13} /> Rechazar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
