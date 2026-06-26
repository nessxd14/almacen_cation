import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import {
  X, Save, Camera, Plus, Trash2, Barcode, Tag, Check, AlertCircle,
  Lock, Store, Users, Building2, ChevronLeft, ChevronRight
} from "lucide-react";
import EscanerCodigo from "./EscanerCodigo";

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

  // Alta de identificador
  const [nuevoCodigo, setNuevoCodigo] = useState("");
  const [nuevoTipo, setNuevoTipo] = useState("barra");
  const [escaneando, setEscaneando] = useState(false);
  const [presDestino, setPresDestino] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data: pres } = await supabase
      .from("presentacion")
      .select("id, nombre, factor_unidad_base, es_base, identificador(id, valor, tipo, es_principal)")
      .eq("producto_id", producto.id)
      .order("es_base", { ascending: false });
    setPresentaciones(pres || []);
    const base = (pres || []).find(p => p.es_base);
    setPresentacionBaseId(base?.id || null);
    setPresDestino(String(base?.id || ""));
    // Aplanar identificadores con su presentación
    const ids = [];
    for (const p of pres || []) {
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
                      ${id.tipo === "barra" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700"}`}>
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
