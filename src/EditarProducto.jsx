import { useState, useEffect, useCallback, useMemo, useId } from "react";
import { supabase } from "./supabaseClient";
import {
  X, Save, Camera, Plus, Trash2, Pencil, Barcode, Check, AlertCircle,
  Lock, Store, Users, Building2, Briefcase, Package2, ImagePlus, Loader, FileText,
} from "lucide-react";
import EscanerCodigo from "./EscanerCodigo";
import { comprimirYCodificar } from "./lib/capturaFoto";
import { subirImagenProducto, tipoImagenValido } from "./lib/imagenProducto";
import { useUsuarioActual } from "./lib/useAuth";
import {
  TIPOS_PRECIO, puedeEditarPrecios, factorDeCadena, opcionesContenedor,
  textoEquivalencia, precioCalculado, advertenciaPrecioBajo, formatearBs, formatearCantidad,
} from "./lib/presentaciones";
import CatalogDialog from "./CatalogDialog";
import ImagenProducto from "./ImagenProducto";
import CampoUnidadBase from "./CampoUnidadBase";
import "./producto.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Toast({ msg, tipo = "ok", onClose }) {
  useEffect(() => {
    // Los errores de la base (p. ej. los documentos que bloquean un cambio
    // de factor) pueden ser largos: se dejan más tiempo en pantalla.
    const t = setTimeout(onClose, tipo === "ok" ? 3000 : 9000);
    return () => clearTimeout(t);
  }, [onClose, tipo]);
  return (
    <div role={tipo === "ok" ? "status" : "alert"} className={`product-editor-feedback flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg
      ${tipo === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
      {tipo === "ok" ? <Check size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  );
}

// ─── Editor de producto ──────────────────────────────────────────────────────

export default function EditarProducto({ producto, onClose, onGuardado }) {
  const usuarioActual = useUsuarioActual();
  const esAdmin = usuarioActual?.rol === "admin";
  // Precios por presentación: admin y gerente (= app_es_admin() en la base).
  const puedePrecios = puedeEditarPrecios(usuarioActual?.rol);
  const [toast, setToast] = useState(null);
  const show = (msg, tipo = "ok") => setToast({ msg, tipo });

  // Datos básicos + precios
  const [form, setForm] = useState({
    nombre: producto.nombre || "",
    marca: producto.marca || "",
    sku_interno: producto.sku_interno || "",
    unidad_base: producto.unidad_base || "unidad",
    precio_base: producto.precio_base ?? "",          // Tienda/Retail
    precio_mayoreo: producto.precio_mayoreo ?? "",
    precio_institucion: producto.precio_institucion ?? "",
    precio_corporativo: producto.precio_corporativo ?? "",
  });

  const [presentaciones, setPresentaciones] = useState([]);
  const [identificadores, setIdentificadores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [seccion, setSeccion] = useState("general");

  // Presentaciones no-base: cuáles ya tienen movimientos en el Kardex (no se
  // pueden borrar, solo desactivar) — se calcula al cargar, no por click.
  const [presentacionesConMovimientos, setPresentacionesConMovimientos] = useState(new Set());
  // Presentaciones no-base referenciadas por un pedido o traslado todavía
  // abierto — bloquean tanto eliminar como desactivar (una línea sin poder
  // despacharse a mitad de un pedido pendiente es peor que no chequear).
  const [presentacionesConDocumentosAbiertos, setPresentacionesConDocumentosAbiertos] = useState(new Set());
  const [editandoPresentacionId, setEditandoPresentacionId] = useState(null);
  const [editNombre, setEditNombre] = useState("");
  const [editFactor, setEditFactor] = useState("");
  // "unidades" → factor_unidad_base directo; "cadena" → N × otra presentación
  // (contiene_presentacion_id + contiene_cantidad; el factor lo calcula el trigger).
  const [editModo, setEditModo] = useState("unidades");
  const [editContieneId, setEditContieneId] = useState("");
  const [editCantidad, setEditCantidad] = useState("");
  const [guardandoEdicionPresentacion, setGuardandoEdicionPresentacion] = useState(false);
  // Confirmación simple antes de eliminar/desactivar: { id, tipo: "eliminar" | "desactivar" }
  const [confirmandoPresentacion, setConfirmandoPresentacion] = useState(null);
  const [procesandoPresentacionId, setProcesandoPresentacionId] = useState(null);

  // Código por fila de presentación (base -> tipo 'barra', bulto -> 'empaque')
  const [codigoPorPresentacion, setCodigoPorPresentacion] = useState({});
  const [scanTarget, setScanTarget] = useState(null); // presentacion_id que está esperando el escaneo

  // Alta de presentación
  const [mostrarNuevaPresentacion, setMostrarNuevaPresentacion] = useState(false);
  const [nuevaPresentNombre, setNuevaPresentNombre] = useState("");
  const [nuevoFactorPresentacion, setNuevoFactorPresentacion] = useState("");
  const [nuevoModo, setNuevoModo] = useState("unidades");
  const [nuevoContieneId, setNuevoContieneId] = useState("");
  const [nuevaCantidad, setNuevaCantidad] = useState("");

  // Precios por presentación: filas de v_presentacion_precio por id, y lo
  // que se está tipeando por presentación ({ [id]: { precio: "", … } }).
  const [preciosResueltos, setPreciosResueltos] = useState({});
  const [preciosEdit, setPreciosEdit] = useState({});
  const [preciosAbiertoId, setPreciosAbiertoId] = useState(null);
  const [guardandoPreciosId, setGuardandoPreciosId] = useState(null);
  const [guardandoPresentacion, setGuardandoPresentacion] = useState(false);

  // Ficha técnica (producto.ficha_md / ficha_actualizada_en) — no viene en
  // el `producto` de la grilla (es texto pesado), se resuelve en cargar().
  const [mostrarFicha, setMostrarFicha] = useState(!!producto.ficha_md);
  const [fichaMd, setFichaMd] = useState("");
  const [fichaActualizadaEn, setFichaActualizadaEn] = useState(null);
  const [guardandoFicha, setGuardandoFicha] = useState(false);

  // Completar con fotos (ingest-foto-producto, origen='app')
  const [fotosSeleccionadas, setFotosSeleccionadas] = useState([]);
  const [enviandoFotos, setEnviandoFotos] = useState(false);
  const [resultadoFotos, setResultadoFotos] = useState(null); // { tipo: "ok" | "error", msg }

  // Foto principal directa (brief S4 parte B) — circuito aparte de
  // "Completar con fotos": esto pisa producto.imagen_url al toque, sin pasar
  // por revisión. El circuito de OpenClaw (arriba) no se toca.
  const [imagenUrl, setImagenUrl] = useState(producto.imagen_url || "");
  const [subiendoImagen, setSubiendoImagen] = useState(false);
  const [errorImagen, setErrorImagen] = useState(null);

  async function subirFotoPrincipal(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErrorImagen(null);
    if (!tipoImagenValido(file)) { setErrorImagen("Formato no soportado — usá JPEG, PNG o WebP"); return; }
    setSubiendoImagen(true);
    try {
      // El tamaño no se valida acá: subirImagenProducto comprime del lado
      // del cliente para entrar en el límite del bucket (2 MB) y solo
      // falla si ni comprimida entra.
      const url = await subirImagenProducto(producto.id, file);
      setImagenUrl(url);
      show("Foto actualizada");
      onGuardado?.({ imagen_url: url });
    } catch (err) {
      setErrorImagen(err.message);
    } finally {
      setSubiendoImagen(false);
    }
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    const [{ data: pres }, { data: prodFicha }, { data: vistaPrecios }] = await Promise.all([
      supabase
        .from("presentacion")
        .select(`id, nombre, factor_unidad_base, es_base, activo, contiene_presentacion_id, contiene_cantidad,
          ${TIPOS_PRECIO.map(t => t.columna).join(", ")}, identificador(id, valor, tipo, es_principal)`)
        .eq("producto_id", producto.id)
        .order("es_base", { ascending: false })
        .order("factor_unidad_base"),
      supabase.from("producto").select("ficha_md, ficha_actualizada_en").eq("id", producto.id).single(),
      puedePrecios
        ? supabase.from("v_presentacion_precio").select("*").eq("producto_id", producto.id)
        : Promise.resolve({ data: [] }),
    ]);
    const lista = pres || [];
    setPresentaciones(lista);
    setPreciosResueltos(Object.fromEntries((vistaPrecios || []).map(r => [r.presentacion_id, r])));
    setPreciosEdit(Object.fromEntries(lista.filter(p => !p.es_base).map(p => [
      p.id, Object.fromEntries(TIPOS_PRECIO.map(t => [t.columna, p[t.columna] ?? ""])),
    ])));

    setFichaMd(prodFicha?.ficha_md || "");
    setFichaActualizadaEn(prodFicha?.ficha_actualizada_en || null);
    if (prodFicha?.ficha_md) setMostrarFicha(true);

    // Chequeo de movimientos por presentación no-base (nunca la tabla
    // completa: acotado a las pocas presentaciones de este producto) — la
    // base nunca se edita/borra/desactiva, no hace falta chequearla.
    const idsNoBase = lista.filter(p => !p.es_base).map(p => p.id);
    const conMovimientos = new Set();
    await Promise.all(idsNoBase.map(async (id) => {
      const { count } = await supabase
        .from("kardex_transacciones")
        .select("id", { count: "exact", head: true })
        .eq("presentacion_id", id);
      if (count > 0) conMovimientos.add(id);
    }));
    setPresentacionesConMovimientos(conMovimientos);

    // Documentos abiertos que referencian una presentación no-base: líneas
    // de pedido todavía por despachar/pendientes, o de una solicitud de
    // traslado todavía solicitada/en tránsito. Desactivar una presentación
    // en medio de eso deja la línea sin poder despacharse.
    const abiertos = new Set();
    if (idsNoBase.length > 0) {
      const [{ data: lineasPedido }, { data: lineasTraslado }] = await Promise.all([
        supabase.from("pedido_linea").select("presentacion_id")
          .in("presentacion_id", idsNoBase).in("estado", ["POR_DESPACHAR", "PENDIENTE"]),
        supabase.from("solicitud_traslado_linea").select("presentacion_id, solicitud:solicitud_id(estado)")
          .in("presentacion_id", idsNoBase),
      ]);
      for (const r of lineasPedido || []) abiertos.add(r.presentacion_id);
      for (const r of lineasTraslado || []) {
        if (r.solicitud && ["SOLICITADO", "EN_TRANSITO"].includes(r.solicitud.estado)) abiertos.add(r.presentacion_id);
      }
    }
    setPresentacionesConDocumentosAbiertos(abiertos);

    // Aplanar identificadores con su presentación
    const ids = [];
    for (const p of lista) {
      for (const id of p.identificador || []) {
        ids.push({ ...id, presentacion_id: p.id, presentacion_nombre: p.nombre });
      }
    }
    setIdentificadores(ids);
    setCargando(false);
  }, [producto.id, puedePrecios]);

  useEffect(() => { cargar(); }, [cargar]);

  // ── Guardar datos básicos + precios ──
  async function guardarDatos() {
    if (!form.nombre.trim()) { show("El nombre es obligatorio", "err"); return; }
    setGuardando(true);
    const payload = {
      nombre: form.nombre.trim(),
      marca: form.marca.trim() || null,
      sku_interno: form.sku_interno.trim() || null,
      actualizado_en: new Date().toISOString(),
      ...(esAdmin ? {
        precio_base: form.precio_base === "" ? null : Number(form.precio_base),
        precio_mayoreo: form.precio_mayoreo === "" ? null : Number(form.precio_mayoreo),
        precio_institucion: form.precio_institucion === "" ? null : Number(form.precio_institucion),
        precio_corporativo: form.precio_corporativo === "" ? null : Number(form.precio_corporativo),
      } : {}),
    };
    const { error } = await supabase.from("producto").update(payload).eq("id", producto.id);
    setGuardando(false);
    if (error) {
      show(
        error.message.includes("sku_interno") ? "Ese SKU ya existe en otro producto"
        : error.message.includes("rol admin") ? "Los precios solo los puede cambiar un administrador"
        : "Error al guardar", "err");
      return;
    }
    show("Cambios guardados");
    onGuardado?.(payload);
  }

  // ── Guardar ficha técnica (independiente — no pasa por el trigger de
  // precios, cualquier usuario logueado puede cargarla) ──
  async function guardarFicha() {
    setGuardandoFicha(true);
    const fichaActualizada = fichaMd.trim() ? new Date().toISOString() : null;
    const { error } = await supabase.from("producto")
      .update({ ficha_md: fichaMd.trim() || null, ficha_actualizada_en: fichaActualizada })
      .eq("id", producto.id);
    setGuardandoFicha(false);
    if (error) { show("Error al guardar la ficha: " + error.message, "err"); return; }
    setFichaActualizadaEn(fichaActualizada);
    show("Ficha técnica guardada");
  }

  // Nombre de "1 unidad" para todos los textos de equivalencia: la base
  // manda (renombrarla copia el nombre a producto.unidad_base en la base).
  const baseNombre = presentaciones.find(p => p.es_base)?.nombre || form.unidad_base || "Unidad";

  // Validación común de alta/edición de una presentación no-base. Devuelve
  // { error } o { campos } listos para el insert/update. En modo cadena el
  // factor se calcula acá solo para el chequeo de duplicados: no se manda,
  // lo calcula el trigger.
  function validarPresentacion({ id = null, nombre, modo, factor, contieneId, cantidad }) {
    nombre = nombre.trim();
    if (!nombre) return { error: "El nombre de la presentación es obligatorio" };
    const dup = presentaciones.some(p => p.id !== id && p.nombre.trim().toLowerCase() === nombre.toLowerCase());
    if (dup) return { error: "Ya existe una presentación con ese nombre" };

    let factorFinal, campos;
    if (modo === "cadena") {
      if (!contieneId) return { error: "Elegí qué presentación trae adentro" };
      const n = Number(cantidad);
      if (!Number.isInteger(n) || n <= 1) return { error: "La cantidad debe ser un entero mayor a 1" };
      factorFinal = factorDeCadena(presentaciones, contieneId, n);
      if (factorFinal == null) return { error: "No se pudo calcular la equivalencia" };
      campos = { nombre, contiene_presentacion_id: Number(contieneId), contiene_cantidad: n };
    } else {
      factorFinal = Number(factor);
      if (!Number.isInteger(factorFinal) || factorFinal <= 1) return { error: "El factor debe ser un entero mayor a 1" };
      campos = { nombre, factor_unidad_base: factorFinal, contiene_presentacion_id: null, contiene_cantidad: null };
    }
    const dupFactor = presentaciones.some(p => p.id !== id && Number(p.factor_unidad_base) === factorFinal);
    if (dupFactor) return { error: "Ya existe una presentación con ese factor" };
    return { campos };
  }

  // ── Agregar presentación (siempre es_base = false — la base ya existe
  // desde el bootstrap y no se toca acá) ──
  async function agregarPresentacion() {
    const { error: invalida, campos } = validarPresentacion({
      nombre: nuevaPresentNombre, modo: nuevoModo, factor: nuevoFactorPresentacion,
      contieneId: nuevoContieneId, cantidad: nuevaCantidad,
    });
    if (invalida) { show(invalida, "err"); return; }

    setGuardandoPresentacion(true);
    const { error } = await supabase.from("presentacion").insert({
      producto_id: producto.id,
      ...campos,
      es_base: false,
    });
    setGuardandoPresentacion(false);
    // Mensaje de la base tal cual: los triggers explican qué está mal.
    if (error) { show(error.message, "err"); return; }

    show("Presentación agregada");
    cerrarNuevaPresentacion();
    cargar();
  }

  function cerrarNuevaPresentacion() {
    setMostrarNuevaPresentacion(false);
    setNuevaPresentNombre("");
    setNuevoFactorPresentacion("");
    setNuevoModo("unidades");
    setNuevoContieneId("");
    setNuevaCantidad("");
  }

  // ── Editar presentación (nombre/factor/cadena; de la base solo el nombre) ──
  function empezarEdicionPresentacion(p) {
    setConfirmandoPresentacion(null);
    setEditandoPresentacionId(p.id);
    setEditNombre(p.nombre);
    setEditFactor(String(p.factor_unidad_base));
    setEditModo(p.contiene_presentacion_id != null ? "cadena" : "unidades");
    setEditContieneId(p.contiene_presentacion_id != null ? String(p.contiene_presentacion_id) : "");
    setEditCantidad(p.contiene_cantidad != null ? String(Number(p.contiene_cantidad)) : "");
  }

  function cancelarEdicionPresentacion() {
    setEditandoPresentacionId(null);
    setEditNombre("");
    setEditFactor("");
    setEditModo("unidades");
    setEditContieneId("");
    setEditCantidad("");
  }

  async function guardarEdicionPresentacion(id) {
    const { error: invalida, campos } = validarPresentacion({
      id, nombre: editNombre, modo: editModo, factor: editFactor,
      contieneId: editContieneId, cantidad: editCantidad,
    });
    if (invalida) { show(invalida, "err"); return; }

    setGuardandoEdicionPresentacion(true);
    const { error } = await supabase.from("presentacion").update(campos).eq("id", id);
    setGuardandoEdicionPresentacion(false);
    // Incluye el rechazo por documentos abiertos, con su lista: se muestra tal cual.
    if (error) { show(error.message, "err"); return; }

    show("Presentación actualizada");
    cancelarEdicionPresentacion();
    cargar();
  }

  // ── Renombrar la base ("¿Qué es 1 unidad?") — nunca factor ni precios ──
  async function guardarNombreBase(id) {
    const nombre = editNombre.trim();
    if (!nombre) { show("Decí qué es 1 unidad (Hoja, Pieza, Metro…)", "err"); return; }
    const dup = presentaciones.some(p => p.id !== id && p.nombre.trim().toLowerCase() === nombre.toLowerCase());
    if (dup) { show("Ya existe una presentación con ese nombre", "err"); return; }

    setGuardandoEdicionPresentacion(true);
    const { error } = await supabase.from("presentacion").update({ nombre }).eq("id", id);
    setGuardandoEdicionPresentacion(false);
    if (error) { show(error.message, "err"); return; }

    // El trigger copió el nombre a producto.unidad_base.
    setForm(f => ({ ...f, unidad_base: nombre }));
    onGuardado?.({ unidad_base: nombre });
    show("Unidad base actualizada");
    cancelarEdicionPresentacion();
    cargar();
  }

  // ── Precios propios de una presentación (vacío = null = se calcula) ──
  async function guardarPreciosPresentacion(p) {
    const edit = preciosEdit[p.id] || {};
    const campos = {};
    for (const { columna, label } of TIPOS_PRECIO) {
      const v = String(edit[columna] ?? "").trim();
      const n = v === "" ? null : Number(v);
      if (n != null && (!Number.isFinite(n) || n < 0)) { show(`Precio ${label} inválido`, "err"); return; }
      campos[columna] = n;
    }
    setGuardandoPreciosId(p.id);
    const { error } = await supabase.from("presentacion").update(campos).eq("id", p.id);
    setGuardandoPreciosId(null);
    if (error) { show(error.message, "err"); return; }
    show("Precios guardados");
    cargar();
  }

  // ── Eliminar (sin movimientos) o desactivar (con movimientos) ──
  // Nunca DELETE de una presentación con historial: rompería la referencia
  // del Kardex, que es append-only. presentacionesConMovimientos ya viene
  // calculado desde cargar(), así que el botón muestra la acción correcta
  // sin volver a chequear al momento del click.
  async function confirmarAccionPresentacion(p) {
    if (presentacionesConDocumentosAbiertos.has(p.id)) {
      show("No se puede: tiene pedidos o traslados abiertos usando esta presentación", "err");
      setConfirmandoPresentacion(null);
      return;
    }
    const tieneMovimientos = presentacionesConMovimientos.has(p.id);
    setProcesandoPresentacionId(p.id);
    const { error } = tieneMovimientos
      ? await supabase.from("presentacion").update({ activo: false }).eq("id", p.id)
      : await supabase.from("presentacion").delete().eq("id", p.id);
    setProcesandoPresentacionId(null);
    setConfirmandoPresentacion(null);
    if (error) {
      show(`Error al ${tieneMovimientos ? "desactivar" : "eliminar"} la presentación: ` + error.message, "err");
      return;
    }
    show(tieneMovimientos ? "Presentación desactivada" : "Presentación eliminada");
    cargar();
  }

  // ── Código por presentación: cada fila (base o bulto) tiene su propio
  // campo — tipo se decide por la fila, no por selector ──
  async function agregarCodigoPresentacion(pres) {
    const valor = (codigoPorPresentacion[pres.id] || "").trim();
    if (!valor) { show("Escribí o escaneá un código", "err"); return; }
    const tipo = pres.es_base ? "barra" : "empaque";

    const dup = identificadores.some(i => i.valor === valor && i.presentacion_id === pres.id && i.tipo === tipo);
    if (dup) { show("Ese código ya está cargado en esa presentación", "err"); return; }

    const { error } = await supabase.from("identificador").insert({
      presentacion_id: pres.id,
      valor,
      tipo,
      origen: "interno",
      es_principal: false,
    });
    if (error) { show("Error al agregar el código", "err"); return; }
    show("Código agregado");
    setCodigoPorPresentacion(prev => ({ ...prev, [pres.id]: "" }));
    cargar();
  }

  async function quitarIdentificador(id) {
    const { error } = await supabase.from("identificador").delete().eq("id", id);
    if (error) { show("Error al quitar", "err"); return; }
    show("Código quitado");
    cargar();
  }

  function onScan(codigo) {
    const presId = scanTarget;
    setScanTarget(null);
    if (!presId) return;
    setCodigoPorPresentacion(prev => ({ ...prev, [presId]: codigo }));
  }

  // ── Completar con fotos ──
  const previewsFotos = useMemo(
    () => fotosSeleccionadas.map(f => URL.createObjectURL(f)),
    [fotosSeleccionadas]
  );
  useEffect(() => () => { previewsFotos.forEach(u => URL.revokeObjectURL(u)); }, [previewsFotos]);

  function seleccionarFotos(e) {
    const elegidas = Array.from(e.target.files || []);
    e.target.value = "";
    if (elegidas.length === 0) return;
    setFotosSeleccionadas(prev => [...prev, ...elegidas].slice(0, 4));
    setResultadoFotos(null);
  }

  function quitarFoto(idx) {
    setFotosSeleccionadas(prev => prev.filter((_, i) => i !== idx));
    setResultadoFotos(null);
  }

  async function enviarFotos() {
    if (fotosSeleccionadas.length === 0) return;
    setEnviandoFotos(true);
    setResultadoFotos(null);
    const cantidad = fotosSeleccionadas.length;
    try {
      const fotosBase64 = await Promise.all(fotosSeleccionadas.map(f => comprimirYCodificar(f)));
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-foto-producto`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({ producto_id: producto.id, fotos_base64: fotosBase64, origen: "app" }),
      });
      // La función devuelve JSON solo en 200/502; 400/401/500 son texto plano.
      const crudo = await res.text();
      let json = {};
      try { json = crudo ? JSON.parse(crudo) : {}; } catch { json = { error: crudo }; }

      if (res.status === 502) {
        // Sesión y fotos ya se guardaron en Storage antes del intento de extracción —
        // no hace falta (ni se puede todavía) reintentar mandando las mismas fotos.
        setResultadoFotos({
          tipo: "error",
          msg: `Las fotos se guardaron, pero la IA no pudo leerlas (${json.error || "error desconocido"}). No se perdieron — no hace falta volver a mandarlas.`,
        });
        setFotosSeleccionadas([]);
      } else if (!res.ok) {
        setResultadoFotos({ tipo: "error", msg: json.error || `Error al enviar las fotos (HTTP ${res.status})` });
      } else {
        const n = json.propuestas?.length ?? 0;
        setResultadoFotos({
          tipo: "ok",
          msg: `${cantidad} foto${cantidad === 1 ? "" : "s"} enviada${cantidad === 1 ? "" : "s"}, ${n} campo${n === 1 ? "" : "s"} propuesto${n === 1 ? "" : "s"} para revisión.`,
        });
        setFotosSeleccionadas([]);
      }
    } catch (e) {
      setResultadoFotos({ tipo: "error", msg: "Error de red al enviar las fotos: " + e.message });
    } finally {
      setEnviandoFotos(false);
    }
  }

  return (
    <CatalogDialog label="Editar producto" onClose={onClose} className="product-editor product-dialog">
      {scanTarget != null && <CatalogDialog label="Escanear código" onClose={() => setScanTarget(null)} className="product-scanner"><EscanerCodigo onDetect={onScan} onClose={() => setScanTarget(null)} /></CatalogDialog>}

        {/* Header */}
        <header className="product-dialog-header">
          <div className="product-editor-heading">
            <ImagenProducto url={imagenUrl} nombre={producto.nombre} className="product-editor-thumbnail" />
            <div><span className="product-eyebrow">PROPIEDADES DEL PRODUCTO</span><h2>Editar producto</h2><p title={producto.nombre}>{producto.nombre}</p></div>
          </div>
          <button type="button" onClick={onClose} className="product-icon-button" aria-label="Cerrar edición"><X size={20} /></button>
        </header>
        <nav className="product-editor-nav" aria-label="Secciones de edición">
          {[
            { id: "general", label: "General", icon: Pencil },
            { id: "fotos", label: "Fotografías", icon: Camera },
            { id: "presentaciones", label: "Presentaciones", icon: Package2 },
            { id: "ficha", label: "Ficha técnica", icon: FileText },
          ].map(item => <button key={item.id} type="button" aria-pressed={seccion === item.id} onClick={() => setSeccion(item.id)}><item.icon size={16} />{item.label}</button>)}
        </nav>

        <div className="product-dialog-scroll product-editor-body">
          {/* ── Datos básicos ── */}
          <section className="product-form-section" hidden={seccion !== "general"}>
            <h3><Package2 size={18} /> Datos básicos</h3>
            <p className="product-section-description">Identifica el producto y su unidad de venta.</p>
            <div className="space-y-3">
              <Campo label="Nombre" value={form.nombre} onChange={v => setForm(f => ({ ...f, nombre: v }))} />
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Marca" value={form.marca} onChange={v => setForm(f => ({ ...f, marca: v }))} />
                <div>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Unidad base</span>
                  <button type="button" onClick={() => setSeccion("presentaciones")}
                    title="Se cambia en Presentaciones (¿Qué es 1 unidad?)"
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">
                    {baseNombre} <Pencil size={13} className="text-slate-400" />
                  </button>
                </div>
              </div>
              <Campo label="SKU interno" value={form.sku_interno} onChange={v => setForm(f => ({ ...f, sku_interno: v }))}
                placeholder="Opcional" />
            </div>
          </section>

          {/* ── Precios ── */}
          <section className="product-form-section" hidden={seccion !== "general"}>
            <h3><Store size={18} /> Precios por canal</h3>
            <p className="product-section-description">Importes en bolivianos por unidad base.</p>
            {esAdmin ? (
              <div className="space-y-3">
                <CampoPrecio
                  icono={Store} label="Tienda (Retail)" nota="Canal retail del POS"
                  value={form.precio_base} onChange={v => setForm(f => ({ ...f, precio_base: v }))} />
                <CampoPrecio
                  icono={Users} label="Mayoreo" nota="Interno"
                  value={form.precio_mayoreo} onChange={v => setForm(f => ({ ...f, precio_mayoreo: v }))} />
                <CampoPrecio
                  icono={Building2} label="Instituciones" nota="Interno"
                  value={form.precio_institucion} onChange={v => setForm(f => ({ ...f, precio_institucion: v }))} />
                <CampoPrecio
                  icono={Briefcase} label="Corporativo" nota="Interno"
                  value={form.precio_corporativo} onChange={v => setForm(f => ({ ...f, precio_corporativo: v }))} />
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                <Lock size={14} className="shrink-0 text-slate-400" />
                Solo un administrador puede ver y cambiar los precios.
              </div>
            )}
          </section>

          {/* ── Foto principal (brief S4 parte B) — directa, sin revisión.
              Circuito aparte de "Completar con fotos" de más abajo, que
              sigue yendo por OpenClaw sin cambios. Solo admin: mismo trigger
              que ya bloquea precios para el resto de los roles. ── */}
          <section className="product-form-section" hidden={seccion !== "fotos"}>
            <h3><ImagePlus size={18} /> Foto principal</h3>
            {esAdmin ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">
                  Reemplaza la imagen del catálogo al toque, sin pasar por revisión.
                </p>
                <div className="flex items-center gap-3">
                  {imagenUrl ? (
                    <img src={imagenUrl} alt={producto.nombre} className="product-photo-preview" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-300">
                      <ImagePlus size={20} />
                    </div>
                  )}
                  <label className={`flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm
                    ${subiendoImagen ? "cursor-not-allowed border-slate-200 text-slate-300" : "cursor-pointer border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                    {subiendoImagen ? <Loader size={15} className="animate-spin" /> : <ImagePlus size={15} />}
                    {subiendoImagen ? "Subiendo…" : imagenUrl ? "Cambiar foto" : "Subir foto"}
                    <input type="file" accept="image/jpeg,image/png,image/webp"
                      className="sr-only" disabled={subiendoImagen} onChange={subirFotoPrincipal} />
                  </label>
                </div>
                {errorImagen && <p className="text-xs text-red-600">{errorImagen}</p>}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                <Lock size={14} className="shrink-0 text-slate-400" />
                Solo un administrador puede cambiar la foto principal.
              </div>
            )}
          </section>

          {/* ── Completar con fotos ── */}
          <section className="product-form-section" hidden={seccion !== "fotos"}>
            <h3>
              <Camera size={18} /> Completar con fotos
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              Subí 1 a 4 fotos del producto — la IA propone código de fábrica, código de barra,
              empaque, marca y nombre para revisar después en la pantalla "Revisión".
            </p>

            {previewsFotos.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {previewsFotos.map((url, i) => (
                  <div key={i} className="relative h-16 w-16">
                    <img src={url} alt="" className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
                    <button onClick={() => quitarFoto(i)} disabled={enviandoFotos}
                      className="absolute -right-1.5 -top-1.5 rounded-full border border-slate-300 bg-white p-0.5 text-slate-500 hover:text-red-600 disabled:opacity-50">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className={`flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm
              ${fotosSeleccionadas.length >= 4 || enviandoFotos
                ? "cursor-not-allowed border-slate-200 text-slate-300"
                : "cursor-pointer border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
              <ImagePlus size={15} />
              {fotosSeleccionadas.length === 0 ? "Elegir o sacar fotos" : `Agregar más (${fotosSeleccionadas.length}/4)`}
              <input type="file" accept="image/*" capture="environment" multiple
                className="sr-only" disabled={fotosSeleccionadas.length >= 4 || enviandoFotos}
                onChange={seleccionarFotos} />
            </label>

            {fotosSeleccionadas.length > 0 && (
              <button onClick={enviarFotos} disabled={enviandoFotos}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                {enviandoFotos
                  ? <><Loader size={15} className="animate-spin" /> Analizando fotos…</>
                  : <><ImagePlus size={15} /> Enviar {fotosSeleccionadas.length} foto{fotosSeleccionadas.length === 1 ? "" : "s"}</>}
              </button>
            )}

            {resultadoFotos && (
              <div className={`mt-2 rounded-lg px-3 py-2 text-xs
                ${resultadoFotos.tipo === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                {resultadoFotos.msg}
              </div>
            )}
          </section>

          {/* ── Presentaciones ── */}
          <section className="product-form-section product-form-wide" hidden={seccion !== "presentaciones"}>
            <h3>
              <Package2 size={18} /> Presentaciones y códigos
            </h3>
            <p className="product-section-description">Configura unidades, empaques y códigos para escanear. Cada cambio se guarda con su acción.</p>

            {cargando ? (
              <p className="text-sm text-slate-400">Cargando…</p>
            ) : (
              <div className="mb-3 space-y-1.5">
                {presentaciones.map(p => {
                  if (editandoPresentacionId === p.id && p.es_base) {
                    return (
                      <div key={p.id} className="space-y-2 rounded-lg bg-slate-50 p-3">
                        <CampoUnidadBase value={editNombre} onChange={setEditNombre} />
                        <BotonesEdicion guardando={guardandoEdicionPresentacion}
                          onGuardar={() => guardarNombreBase(p.id)} onCancelar={cancelarEdicionPresentacion} />
                      </div>
                    );
                  }
                  if (editandoPresentacionId === p.id) {
                    return (
                      <div key={p.id} className="space-y-2 rounded-lg bg-slate-50 p-3">
                        <input
                          aria-label="Nombre de la presentación"
                          value={editNombre}
                          onChange={e => setEditNombre(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                        />
                        <CamposContenido
                          nombre={editNombre} baseNombre={baseNombre} presentaciones={presentaciones}
                          opciones={opcionesContenedor(presentaciones, p.id)}
                          modo={editModo} onModo={setEditModo}
                          factor={editFactor} onFactor={setEditFactor}
                          contieneId={editContieneId} onContieneId={setEditContieneId}
                          cantidad={editCantidad} onCantidad={setEditCantidad} />
                        <BotonesEdicion guardando={guardandoEdicionPresentacion}
                          onGuardar={() => guardarEdicionPresentacion(p.id)} onCancelar={cancelarEdicionPresentacion} />
                      </div>
                    );
                  }

                  const tieneMovimientos = presentacionesConMovimientos.has(p.id);
                  const tieneDocumentosAbiertos = presentacionesConDocumentosAbiertos.has(p.id);
                  const confirmando = confirmandoPresentacion?.id === p.id ? confirmandoPresentacion.tipo : null;
                  const codigosDeEsta = identificadores.filter(i => i.presentacion_id === p.id);
                  const contenida = presentaciones.find(x => x.id === p.contiene_presentacion_id);
                  const resuelto = preciosResueltos[p.id];
                  const filaBase = Object.values(preciosResueltos).find(r => r.es_base);
                  const aviso = !p.es_base && puedePrecios && resuelto && filaBase
                    ? advertenciaPrecioBajo({
                      nombre: p.nombre, precio: resuelto.precio_retail, factor: p.factor_unidad_base,
                      baseNombre, precioBase: filaBase.precio_retail,
                    })
                    : null;

                  return (
                    <div key={p.id} className={`rounded-lg border px-3 py-2 ${p.activo === false ? "border-slate-100 opacity-50" : "border-slate-200"}`}>
                      <div className="flex items-center gap-2">
                        <Package2 size={14} className="shrink-0 text-slate-400" />
                        <span className="flex-1 text-sm text-slate-800">
                          {p.nombre}
                          {p.es_base
                            ? <span className="ml-2 text-xs text-slate-400">= 1 unidad base</span>
                            : <span className="ml-2 text-xs text-slate-400">
                              = {formatearCantidad(p.factor_unidad_base)} {baseNombre}
                              {contenida && !contenida.es_base && ` (${formatearCantidad(p.contiene_cantidad)} × ${contenida.nombre})`}
                            </span>}
                        </span>
                        {p.es_base && (
                          <>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">base</span>
                            <button onClick={() => empezarEdicionPresentacion(p)}
                              className="shrink-0 text-slate-400 hover:text-slate-700" title="¿Qué es 1 unidad?">
                              <Pencil size={14} />
                            </button>
                          </>
                        )}
                        {!p.es_base && p.activo === false && (
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">Inactiva</span>
                        )}
                        {!p.es_base && !confirmando && (
                          <>
                            <button onClick={() => empezarEdicionPresentacion(p)}
                              className="shrink-0 text-slate-400 hover:text-slate-700" title="Editar">
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => setConfirmandoPresentacion({ id: p.id, tipo: tieneMovimientos ? "desactivar" : "eliminar" })}
                              className="shrink-0 text-red-500 hover:text-red-700"
                              title={tieneMovimientos ? "Desactivar" : "Eliminar"}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>

                      {/* Código propio de la fila — barra en la base, empaque en el bulto */}
                      <div className="mt-2 flex items-center gap-2">
                        <Barcode size={12} className="shrink-0 text-slate-400" />
                        <input aria-label={`Código de ${p.nombre}`} value={codigoPorPresentacion[p.id] || ""}
                          onChange={e => setCodigoPorPresentacion(prev => ({ ...prev, [p.id]: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && agregarCodigoPresentacion(p)}
                          placeholder={p.es_base ? "Código de barras" : "Código de empaque"}
                          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none" />
                        <button onClick={() => setScanTarget(p.id)} title="Escanear"
                          className="shrink-0 rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-slate-600 hover:bg-slate-100">
                          <Camera size={12} />
                        </button>
                        <button onClick={() => agregarCodigoPresentacion(p)} title="Agregar"
                          className="shrink-0 rounded-lg bg-slate-900 px-1.5 py-1 text-white hover:bg-slate-700">
                          <Plus size={12} />
                        </button>
                      </div>
                      {codigosDeEsta.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {codigosDeEsta.map(id => (
                            <span key={id.id} className="flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500">
                              <span className="font-mono">{id.valor}</span>
                              <span className="text-slate-300">({id.tipo})</span>
                              <button onClick={() => quitarIdentificador(id.id)} aria-label={`Quitar código ${id.valor}`} className="text-slate-300 hover:text-red-500">
                                <X size={10} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}

                      {aviso && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                          <AlertCircle size={13} className="mt-0.5 shrink-0" /> {aviso}
                        </p>
                      )}

                      {/* Precios propios (admin/gerente). Vacío = se calcula. */}
                      {!p.es_base && puedePrecios && (preciosAbiertoId === p.id ? (
                        <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2">
                          {TIPOS_PRECIO.map(({ columna, resuelto: col, label }) => {
                            const calc = precioCalculado(filaBase, col, p.factor_unidad_base);
                            return (
                              <label key={columna} className="flex items-center gap-2 text-xs text-slate-600">
                                <span className="w-24 shrink-0">{label}</span>
                                <span className="text-slate-400">Bs</span>
                                <input type="number" min={0} step="0.01"
                                  aria-label={`Precio ${label} de ${p.nombre}`}
                                  value={preciosEdit[p.id]?.[columna] ?? ""}
                                  onChange={e => setPreciosEdit(prev => ({ ...prev, [p.id]: { ...prev[p.id], [columna]: e.target.value } }))}
                                  placeholder={calc != null ? `${formatearBs(calc)} (calculado)` : "Sin precio"}
                                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs focus:border-slate-500 focus:outline-none" />
                              </label>
                            );
                          })}
                          <p className="text-xs text-slate-400">Vacío = precio del producto × {formatearCantidad(p.factor_unidad_base)}.</p>
                          <div className="flex gap-2">
                            <button onClick={() => guardarPreciosPresentacion(p)} disabled={guardandoPreciosId === p.id}
                              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                              <Save size={12} /> {guardandoPreciosId === p.id ? "Guardando…" : "Guardar precios"}
                            </button>
                            <button onClick={() => setPreciosAbiertoId(null)}
                              className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">
                              Cerrar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setPreciosAbiertoId(p.id)}
                          className="mt-2 flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                          <Store size={12} /> Precios
                          {resuelto && <span className="font-normal text-slate-500">
                            · Público {resuelto.precio_retail != null ? formatearBs(resuelto.precio_retail) : "—"}
                            {resuelto.tiene_precio_propio ? " (propio)" : " (calculado)"}
                          </span>}
                        </button>
                      ))}

                      {tieneDocumentosAbiertos && !p.es_base && (
                        <p className="mt-2 text-xs text-amber-600">
                          Tiene pedidos o traslados abiertos — no se puede desactivar hasta que se cierren.
                        </p>
                      )}
                      {confirmando && (
                        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {confirmando === "desactivar"
                            ? "Esta presentación ya tiene movimientos en el Kardex, no se puede eliminar — se va a desactivar en su lugar."
                            : "¿Eliminar esta presentación? No se puede deshacer."}
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => confirmarAccionPresentacion(p)} disabled={procesandoPresentacionId === p.id || tieneDocumentosAbiertos}
                              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                              {procesandoPresentacionId === p.id ? "Procesando…" : confirmando === "desactivar" ? "Desactivar" : "Eliminar"}
                            </button>
                            <button onClick={() => setConfirmandoPresentacion(null)}
                              className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {mostrarNuevaPresentacion ? (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                <input
                  aria-label="Nombre de la nueva presentación"
                  value={nuevaPresentNombre}
                  onChange={e => setNuevaPresentNombre(e.target.value)}
                  placeholder='Ej. "Paquete", "Caja", "Caja master"'
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
                <CamposContenido
                  nombre={nuevaPresentNombre} baseNombre={baseNombre} presentaciones={presentaciones}
                  opciones={opcionesContenedor(presentaciones, null)}
                  modo={nuevoModo} onModo={setNuevoModo}
                  factor={nuevoFactorPresentacion} onFactor={setNuevoFactorPresentacion}
                  contieneId={nuevoContieneId} onContieneId={setNuevoContieneId}
                  cantidad={nuevaCantidad} onCantidad={setNuevaCantidad} />
                <div className="flex gap-2">
                  <button onClick={agregarPresentacion} disabled={guardandoPresentacion}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                    <Plus size={14} /> {guardandoPresentacion ? "Guardando…" : "Guardar presentación"}
                  </button>
                  <button onClick={cerrarNuevaPresentacion}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setMostrarNuevaPresentacion(true)}
                className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
                <Plus size={14} /> Agregar presentación
              </button>
            )}
          </section>

          {seccion === "presentaciones" && !cargando && identificadores.length === 0 && (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-700">
              <span className="flex items-center gap-2">
                <AlertCircle size={15} /> Este producto no tiene código escaneable.
              </span>
              <span className="mt-1 block text-xs">Agregá uno en la presentación correspondiente, arriba.</span>
            </div>
          )}

          {/* ── Ficha técnica ── */}
          <section className="product-form-section product-form-wide" hidden={seccion !== "ficha"}>
            <h3><FileText size={18} /> Ficha técnica</h3>
            <p className="product-section-description">Añade especificaciones, materiales y características. Puedes usar Markdown.</p>
            {!mostrarFicha ? (
              <button onClick={() => setMostrarFicha(true)}
                className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
                <FileText size={14} /> Agregar ficha técnica
              </button>
            ) : (
              <div className="space-y-1.5">
                <textarea aria-label="Contenido de la ficha técnica" value={fichaMd} onChange={e => setFichaMd(e.target.value)}
                  rows={12} placeholder="Pegá acá el Markdown de la ficha técnica…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-slate-500 focus:outline-none" />
                {fichaActualizadaEn && (
                  <p className="text-xs text-slate-400">
                    Actualizada: {new Date(fichaActualizadaEn).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                )}
                <button onClick={guardarFicha} disabled={guardandoFicha}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                  <Save size={13} /> {guardandoFicha ? "Guardando…" : "Guardar ficha"}
                </button>
              </div>
            )}
          </section>
        </div>
        {toast && <Toast msg={toast.msg} tipo={toast.tipo} onClose={() => setToast(null)} />}
        <footer className="product-editor-footer">
          <p>{seccion === "general" ? "Guarda los datos básicos y los precios de esta sección." : "Los cambios se guardan con la acción de cada sección."}</p>
          <button type="button" className="product-secondary-button" onClick={onClose}>Cerrar</button>
          {seccion === "general" && <button type="button" onClick={guardarDatos} disabled={guardando} className="product-primary-button">
            {guardando ? <Loader size={16} className="animate-spin" /> : <Save size={16} />}{guardando ? "Guardando…" : "Guardar cambios"}
          </button>}
        </footer>
    </CatalogDialog>
  );
}

// ─── Subcomponentes de campo ─────────────────────────────────────────────────

function BotonesEdicion({ guardando, onGuardar, onCancelar }) {
  return (
    <div className="flex gap-2">
      <button onClick={onGuardar} disabled={guardando}
        className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        <Save size={14} /> {guardando ? "Guardando…" : "Guardar"}
      </button>
      <button onClick={onCancelar}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
        Cancelar
      </button>
    </div>
  );
}

// "Trae…": N unidades base (factor directo) o N × otra presentación (cadena).
function CamposContenido({
  nombre, baseNombre, presentaciones, opciones, modo, onModo,
  factor, onFactor, contieneId, onContieneId, cantidad, onCantidad,
}) {
  const contiene = presentaciones.find(p => String(p.id) === String(contieneId)) || null;
  const factorCalc = modo === "cadena"
    ? factorDeCadena(presentaciones, contieneId, cantidad)
    : (Number(factor) > 0 ? Number(factor) : null);
  const clase = "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <span className="font-medium">Trae…</span>
        {[["unidades", `N ${baseNombre}`], ["cadena", "N × otra presentación"]].map(([valor, label]) => (
          <button key={valor} type="button" onClick={() => onModo(valor)} aria-pressed={modo === valor}
            className={`rounded-full border px-2 py-0.5 ${modo === valor ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 hover:bg-slate-100"}`}>
            {label}
          </button>
        ))}
      </div>
      {modo === "cadena" ? (
        <div className="flex gap-2">
          <input aria-label="Cantidad que trae" type="number" min="2" step="1" value={cantidad}
            onChange={e => onCantidad(e.target.value)} placeholder="N" className={`w-20 ${clase}`} />
          <span className="self-center text-sm text-slate-400">×</span>
          <select aria-label="Presentación que trae adentro" value={contieneId}
            onChange={e => onContieneId(e.target.value)} className={`min-w-0 flex-1 ${clase}`}>
            <option value="">Elegí una presentación…</option>
            {opciones.map(p => (
              <option key={p.id} value={p.id}>
                {p.nombre}{p.es_base ? " (base)" : ` (= ${formatearCantidad(p.factor_unidad_base)} ${baseNombre})`}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input aria-label="Unidades base por presentación" type="number" min="2" step="1" value={factor}
          onChange={e => onFactor(e.target.value)}
          placeholder={`Cuántas ${baseNombre} trae`} className={`w-full ${clase}`} />
      )}
      <p className="text-xs font-medium text-slate-500">
        {textoEquivalencia({
          nombre, factor: factorCalc, baseNombre,
          contiene: modo === "cadena" ? contiene : null, cantidad: modo === "cadena" ? cantidad : null,
        })}
      </p>
    </div>
  );
}

function Campo({ label, value, onChange, placeholder }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
      />
    </div>
  );
}

function CampoPrecio({ icono: Icono, label, nota, value, onChange }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
      <Icono size={16} className="shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-400">{nota}</p>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-sm text-slate-400">Bs</span>
        <input
          aria-label={`Precio ${label}`}
          type="number" min={0} step="0.01" value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0.00"
          className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
    </div>
  );
}

// ─── Carrusel de precios (solo lectura, para el preview) ─────────────────────

export function CarruselPrecios({ producto }) {
  const precios = [
    { label: "Tienda", valor: producto.precio_base, icono: Store, badge: "Retail" },
    { label: "Mayoreo", valor: producto.precio_mayoreo, icono: Users, badge: "Interno" },
    { label: "Instituciones", valor: producto.precio_institucion, icono: Building2, badge: "Interno" },
    { label: "Corporativo", valor: producto.precio_corporativo, icono: Briefcase, badge: "Interno" },
  ];
  const fmt = (v) => v == null || v === ""
    ? "—"
    : new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" }).format(v);

  return (
    <dl className="product-price-grid" aria-label="Precios por canal">
      {precios.map(({ label, valor, icono: Icono }) => <div key={label}>
        <dt><Icono size={14} />{label}</dt><dd>{fmt(valor)}</dd>
      </div>)}
    </dl>
  );
}
