import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient";
import {
  X, Save, Camera, Plus, Trash2, Pencil, Barcode, Tag, Check, AlertCircle,
  Lock, Store, Users, Building2, ChevronLeft, ChevronRight, Package2, ImagePlus, Loader
} from "lucide-react";
import EscanerCodigo from "./EscanerCodigo";
import { comprimirYCodificar } from "./lib/capturaFoto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Toast({ msg, tipo = "ok", onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg
      ${tipo === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
      {tipo === "ok" ? <Check size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  );
}

// ─── Editor de producto ──────────────────────────────────────────────────────

export default function EditarProducto({ producto, onClose, onGuardado }) {
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
  });

  const [presentaciones, setPresentaciones] = useState([]);
  const [identificadores, setIdentificadores] = useState([]);
  const [presentacionBaseId, setPresentacionBaseId] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // Presentaciones no-base: cuáles ya tienen movimientos en el Kardex (no se
  // pueden borrar, solo desactivar) — se calcula al cargar, no por click.
  const [presentacionesConMovimientos, setPresentacionesConMovimientos] = useState(new Set());
  const [editandoPresentacionId, setEditandoPresentacionId] = useState(null);
  const [editNombre, setEditNombre] = useState("");
  const [editFactor, setEditFactor] = useState("");
  const [guardandoEdicionPresentacion, setGuardandoEdicionPresentacion] = useState(false);
  // Confirmación simple antes de eliminar/desactivar: { id, tipo: "eliminar" | "desactivar" }
  const [confirmandoPresentacion, setConfirmandoPresentacion] = useState(null);
  const [procesandoPresentacionId, setProcesandoPresentacionId] = useState(null);

  // Alta de identificador
  const [nuevoCodigo, setNuevoCodigo] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState("barra");
  const [escaneando, setEscaneando] = useState(false);
  const [presDestino, setPresDestino] = useState("");

  // Alta de presentación
  const [mostrarNuevaPresentacion, setMostrarNuevaPresentacion] = useState(false);
  const [nuevaPresentNombre, setNuevaPresentNombre] = useState("");
  const [nuevoFactorPresentacion, setNuevoFactorPresentacion] = useState("");
  const [guardandoPresentacion, setGuardandoPresentacion] = useState(false);

  // Completar con fotos (ingest-foto-producto, origen='app')
  const [fotosSeleccionadas, setFotosSeleccionadas] = useState([]);
  const [enviandoFotos, setEnviandoFotos] = useState(false);
  const [resultadoFotos, setResultadoFotos] = useState(null); // { tipo: "ok" | "error", msg }

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data: pres } = await supabase
      .from("presentacion")
      .select("id, nombre, factor_unidad_base, es_base, activo, identificador(id, valor, tipo, es_principal)")
      .eq("producto_id", producto.id)
      .order("es_base", { ascending: false });
    const lista = pres || [];
    setPresentaciones(lista);
    const base = lista.find(p => p.es_base);
    setPresentacionBaseId(base?.id || null);
    setPresDestino(String(base?.id || ""));

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

    // Aplanar identificadores con su presentación
    const ids = [];
    for (const p of lista) {
      for (const id of p.identificador || []) {
        ids.push({ ...id, presentacion_id: p.id, presentacion_nombre: p.nombre });
      }
    }
    setIdentificadores(ids);
    setCargando(false);
  }, [producto.id]);

  useEffect(() => { cargar(); }, [cargar]);

  // ── Guardar datos básicos + precios ──
  async function guardarDatos() {
    if (!form.nombre.trim()) { show("El nombre es obligatorio", "err"); return; }
    setGuardando(true);
    const payload = {
      nombre: form.nombre.trim(),
      marca: form.marca.trim() || null,
      unidad_base: form.unidad_base.trim() || "unidad",
      sku_interno: form.sku_interno.trim() || null,
      precio_base: form.precio_base === "" ? null : Number(form.precio_base),
      precio_mayoreo: form.precio_mayoreo === "" ? null : Number(form.precio_mayoreo),
      precio_institucion: form.precio_institucion === "" ? null : Number(form.precio_institucion),
      actualizado_en: new Date().toISOString(),
    };
    const { error } = await supabase.from("producto").update(payload).eq("id", producto.id);
    setGuardando(false);
    if (error) {
      show(error.message.includes("sku_interno") ? "Ese SKU ya existe en otro producto" : "Error al guardar", "err");
      return;
    }
    show("Cambios guardados");
    onGuardado?.();
  }

  // ── Agregar presentación (siempre es_base = false — la base ya existe
  // desde el bootstrap y no se toca acá) ──
  async function agregarPresentacion() {
    const nombre = nuevaPresentNombre.trim();
    if (!nombre) { show("El nombre de la presentación es obligatorio", "err"); return; }
    const factor = Number(nuevoFactorPresentacion);
    if (!nuevoFactorPresentacion || !factor || factor <= 0) { show("Factor inválido", "err"); return; }
    const dup = presentaciones.some(p => p.nombre.trim().toLowerCase() === nombre.toLowerCase());
    if (dup) { show("Ya existe una presentación con ese nombre", "err"); return; }

    setGuardandoPresentacion(true);
    const { error } = await supabase.from("presentacion").insert({
      producto_id: producto.id,
      nombre,
      factor_unidad_base: factor,
      es_base: false,
    });
    setGuardandoPresentacion(false);
    if (error) { show("Error al agregar la presentación: " + error.message, "err"); return; }

    show("Presentación agregada");
    setNuevaPresentNombre("");
    setNuevoFactorPresentacion("");
    setMostrarNuevaPresentacion(false);
    cargar();
  }

  // ── Editar presentación (nombre/factor — nunca la base) ──
  function empezarEdicionPresentacion(p) {
    setConfirmandoPresentacion(null);
    setEditandoPresentacionId(p.id);
    setEditNombre(p.nombre);
    setEditFactor(String(p.factor_unidad_base));
  }

  function cancelarEdicionPresentacion() {
    setEditandoPresentacionId(null);
    setEditNombre("");
    setEditFactor("");
  }

  async function guardarEdicionPresentacion(id) {
    const nombre = editNombre.trim();
    if (!nombre) { show("El nombre de la presentación es obligatorio", "err"); return; }
    const factor = Number(editFactor);
    if (!editFactor || !factor || factor <= 0) { show("Factor inválido", "err"); return; }
    const dup = presentaciones.some(p => p.id !== id && p.nombre.trim().toLowerCase() === nombre.toLowerCase());
    if (dup) { show("Ya existe una presentación con ese nombre", "err"); return; }

    setGuardandoEdicionPresentacion(true);
    const { error } = await supabase
      .from("presentacion")
      .update({ nombre, factor_unidad_base: factor })
      .eq("id", id);
    setGuardandoEdicionPresentacion(false);
    if (error) { show("Error al guardar la presentación: " + error.message, "err"); return; }

    show("Presentación actualizada");
    cancelarEdicionPresentacion();
    cargar();
  }

  // ── Eliminar (sin movimientos) o desactivar (con movimientos) ──
  // Nunca DELETE de una presentación con historial: rompería la referencia
  // del Kardex, que es append-only. presentacionesConMovimientos ya viene
  // calculado desde cargar(), así que el botón muestra la acción correcta
  // sin volver a chequear al momento del click.
  async function confirmarAccionPresentacion(p) {
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

  // ── Agregar identificador ──
  async function agregarIdentificador(valorParam) {
    const valor = (valorParam ?? nuevoCodigo).trim();
    if (!valor) { show("Escribí o escaneá un código", "err"); return; }
    const presId = Number(presDestino || presentacionBaseId);
    if (!presId) { show("No hay presentación base", "err"); return; }

    // Evitar duplicado exacto en la misma presentación
    const dup = identificadores.some(i => i.valor === valor && i.presentacion_id === presId && i.tipo === nuevoTipo);
    if (dup) { show("Ese código ya está cargado en esa presentación", "err"); return; }

    const { error } = await supabase.from("identificador").insert({
      presentacion_id: presId,
      valor,
      tipo: nuevoTipo,
      origen: "interno",
      es_principal: false,
    });
    if (error) { show("Error al agregar el código", "err"); return; }
    show("Código agregado");
    setNuevoCodigo("");
    cargar();
  }

  async function quitarIdentificador(id) {
    const { error } = await supabase.from("identificador").delete().eq("id", id);
    if (error) { show("Error al quitar", "err"); return; }
    show("Código quitado");
    cargar();
  }

  function onScan(codigo) {
    setEscaneando(false);
    setNuevoCodigo(codigo);
    agregarIdentificador(codigo);
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
    <div className="fixed inset-0 z-[55] flex justify-end bg-black/40" onClick={onClose}>
      {toast && <Toast msg={toast.msg} tipo={toast.tipo} onClose={() => setToast(null)} />}
      {escaneando && <EscanerCodigo onDetect={onScan} onClose={() => setEscaneando(false)} />}

      <div className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Editar producto</h2>
            <p className="text-xs text-slate-400">{producto.nombre}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        <div className="space-y-6 p-5">
          {/* ── Datos básicos ── */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Datos básicos</h3>
            <div className="space-y-3">
              <Campo label="Nombre" value={form.nombre} onChange={v => setForm(f => ({ ...f, nombre: v }))} />
              <div className="grid grid-cols-2 gap-3">
                <Campo label="Marca" value={form.marca} onChange={v => setForm(f => ({ ...f, marca: v }))} />
                <Campo label="Unidad base" value={form.unidad_base} onChange={v => setForm(f => ({ ...f, unidad_base: v }))} />
              </div>
              <Campo label="SKU interno" value={form.sku_interno} onChange={v => setForm(f => ({ ...f, sku_interno: v }))}
                placeholder="Opcional" />
            </div>
          </section>

          {/* ── Precios ── */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Precios</h3>
            <div className="space-y-3">
              <CampoPrecio
                icono={Store} label="Tienda (Retail)" nota="Sincroniza con Shopify"
                value={form.precio_base} onChange={v => setForm(f => ({ ...f, precio_base: v }))} />
              <CampoPrecio
                icono={Users} label="Mayoreo" nota="Interno"
                value={form.precio_mayoreo} onChange={v => setForm(f => ({ ...f, precio_mayoreo: v }))} />
              <CampoPrecio
                icono={Building2} label="Instituciones" nota="Interno"
                value={form.precio_institucion} onChange={v => setForm(f => ({ ...f, precio_institucion: v }))} />
            </div>
          </section>

          <button onClick={guardarDatos} disabled={guardando}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            <Save size={15} /> {guardando ? "Guardando…" : "Guardar cambios"}
          </button>

          {/* ── Completar con fotos ── */}
          <section className="border-t border-slate-100 pt-5">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Completar con fotos
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
                className="hidden" disabled={fotosSeleccionadas.length >= 4 || enviandoFotos}
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
          <section className="border-t border-slate-100 pt-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Presentaciones
            </h3>

            {cargando ? (
              <p className="text-sm text-slate-400">Cargando…</p>
            ) : (
              <div className="mb-3 space-y-1.5">
                {presentaciones.map(p => {
                  if (editandoPresentacionId === p.id) {
                    return (
                      <div key={p.id} className="space-y-2 rounded-lg bg-slate-50 p-3">
                        <input
                          value={editNombre}
                          onChange={e => setEditNombre(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                        />
                        <input
                          type="number" min="0.0001" step="any"
                          value={editFactor}
                          onChange={e => setEditFactor(e.target.value)}
                          placeholder={`Factor (unidades de "${form.unidad_base || "unidad"}" por presentación)`}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button onClick={() => guardarEdicionPresentacion(p.id)} disabled={guardandoEdicionPresentacion}
                            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                            <Save size={14} /> {guardandoEdicionPresentacion ? "Guardando…" : "Guardar"}
                          </button>
                          <button onClick={cancelarEdicionPresentacion}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
                            Cancelar
                          </button>
                        </div>
                      </div>
                    );
                  }

                  const tieneMovimientos = presentacionesConMovimientos.has(p.id);
                  const confirmando = confirmandoPresentacion?.id === p.id ? confirmandoPresentacion.tipo : null;

                  return (
                    <div key={p.id} className={`rounded-lg border px-3 py-2 ${p.activo === false ? "border-slate-100 opacity-50" : "border-slate-200"}`}>
                      <div className="flex items-center gap-2">
                        <Package2 size={14} className="shrink-0 text-slate-400" />
                        <span className="flex-1 text-sm text-slate-800">{p.nombre}</span>
                        <span className="text-xs text-slate-400">×{p.factor_unidad_base}</span>
                        {p.es_base && (
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">base</span>
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
                      {confirmando && (
                        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {confirmando === "desactivar"
                            ? "Esta presentación ya tiene movimientos en el Kardex, no se puede eliminar — se va a desactivar en su lugar."
                            : "¿Eliminar esta presentación? No se puede deshacer."}
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => confirmarAccionPresentacion(p)} disabled={procesandoPresentacionId === p.id}
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
                  value={nuevaPresentNombre}
                  onChange={e => setNuevaPresentNombre(e.target.value)}
                  placeholder='Ej. "Paquete (10 und)", "Caja (24 und)"'
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
                <input
                  type="number" min="0.0001" step="any"
                  value={nuevoFactorPresentacion}
                  onChange={e => setNuevoFactorPresentacion(e.target.value)}
                  placeholder={`Factor (unidades de "${form.unidad_base || "unidad"}" por presentación)`}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button onClick={agregarPresentacion} disabled={guardandoPresentacion}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                    <Plus size={14} /> {guardandoPresentacion ? "Guardando…" : "Guardar presentación"}
                  </button>
                  <button onClick={() => { setMostrarNuevaPresentacion(false); setNuevaPresentNombre(""); setNuevoFactorPresentacion(""); }}
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

          {/* ── Identificadores ── */}
          <section className="border-t border-slate-100 pt-5">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Códigos de identificación
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              Barras y códigos de fábrica para escanear el producto.
            </p>

            {/* Lista actual */}
            {cargando ? (
              <p className="text-sm text-slate-400">Cargando…</p>
            ) : identificadores.length === 0 ? (
              <div className="mb-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-700">
                <span className="flex items-center gap-2">
                  <AlertCircle size={15} /> Este producto no tiene código escaneable.
                </span>
                <span className="mt-1 block text-xs">Agregá uno abajo para poder escanearlo en el conteo.</span>
              </div>
            ) : (
              <div className="mb-3 space-y-1.5">
                {identificadores.map(id => (
                  <div key={id.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <Barcode size={14} className="text-slate-400" />
                    <span className="font-mono text-sm text-slate-800">{id.valor}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium
                      ${id.tipo === "barra" ? "bg-blue-100 text-blue-700"
                        : id.tipo === "empaque" ? "bg-amber-100 text-amber-700"
                        : "bg-violet-100 text-violet-700"}`}>
                      {id.tipo}
                    </span>
                    <span className="text-xs text-slate-400">{id.presentacion_nombre}</span>
                    <button onClick={() => quitarIdentificador(id.id)}
                      className="ml-auto text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* Alta */}
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="mb-2 flex gap-2">
                <input
                  value={nuevoCodigo}
                  onChange={e => setNuevoCodigo(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && agregarIdentificador()}
                  placeholder="Escribí o escaneá el código"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
                <button onClick={() => setEscaneando(true)}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  title="Escanear con cámara">
                  <Camera size={15} />
                </button>
              </div>
              <div className="flex gap-2">
                <select value={nuevoTipo} onChange={e => setNuevoTipo(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none">
                  <option value="barra">Código de barras</option>
                  <option value="fabrica">Código de fábrica</option>
                </select>
                {presentaciones.length > 1 && (
                  <select value={presDestino} onChange={e => setPresDestino(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none">
                    {presentaciones.map(p => (
                      <option key={p.id} value={p.id}>{p.nombre}{p.es_base ? " (base)" : ""}</option>
                    ))}
                  </select>
                )}
                <button onClick={() => agregarIdentificador()}
                  className="ml-auto flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
                  <Plus size={14} /> Agregar
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponentes de campo ─────────────────────────────────────────────────

function Campo({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <input
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
    { label: "Tienda", valor: producto.precio_base, icono: Store, badge: "Shopify" },
    { label: "Mayoreo", valor: producto.precio_mayoreo, icono: Users, badge: "Interno" },
    { label: "Instituciones", valor: producto.precio_institucion, icono: Building2, badge: "Interno" },
  ];
  const [i, setI] = useState(0);
  const actual = precios[i];
  const Icono = actual.icono;

  const fmt = (v) => v == null || v === ""
    ? "—"
    : new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" }).format(v);

  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-3 text-white">
      <button onClick={() => setI(p => (p - 1 + precios.length) % precios.length)}
        className="rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white">
        <ChevronLeft size={18} />
      </button>
      <div className="flex-1 text-center">
        <div className="mb-0.5 flex items-center justify-center gap-1.5">
          <Icono size={13} className="text-slate-400" />
          <span className="text-xs uppercase tracking-wide text-slate-400">{actual.label}</span>
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">{actual.badge}</span>
        </div>
        <p className="text-xl font-bold transition-all">{fmt(actual.valor)}</p>
        <div className="mt-1 flex justify-center gap-1">
          {precios.map((_, idx) => (
            <span key={idx} className={`h-1 w-1 rounded-full ${idx === i ? "bg-white" : "bg-white/30"}`} />
          ))}
        </div>
      </div>
      <button onClick={() => setI(p => (p + 1) % precios.length)}
        className="rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
