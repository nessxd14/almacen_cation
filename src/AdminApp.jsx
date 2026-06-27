import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import {
  MapPin, Package, Plus, Pencil, Trash2, Check, X,
  ChevronRight, Search, Star, AlertCircle
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function Toast({ msg, tipo = "ok", onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg
      ${tipo === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
      {tipo === "ok" ? <Check size={16} /> : <AlertCircle size={16} />}
      {msg}
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, tipo = "ok") => setToast({ msg, tipo }), []);
  const node = toast ? <Toast msg={toast.msg} tipo={toast.tipo} onClose={() => setToast(null)} /> : null;
  return { show, node };
}

// Construye la etiqueta legible de una ubicación
// codigo_zona = zona, estante = tipo ("Pallet"/"Estante"), nivel = código ("3"/"B")
function etiquetaUbicacion(u) {
  if (!u) return "—";
  const partes = [u.codigo_zona];
  if (u.estante && u.nivel) partes.push(`${u.estante} ${u.nivel}`);
  else if (u.estante) partes.push(u.estante);
  return partes.join(" › ");
}

// ─── TAB 1: Gestión de Ubicaciones ──────────────────────────────────────────

const TIPOS_SOPORTE = ["Pallet", "Estante"];

// FilaForm definido fuera de TabUbicaciones para evitar recreación en cada render
function FilaForm({ form, setForm, cancelar, onGuardar }) {
  return (
    <tr className="bg-slate-50">
      <td className="px-4 py-2">
        <input
          autoFocus
          value={form.codigo_zona}
          onChange={e => setForm(f => ({ ...f, codigo_zona: e.target.value }))}
          placeholder="Bodega Principal"
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </td>
      <td className="px-4 py-2">
        <select
          value={form.estante}
          onChange={e => setForm(f => ({ ...f, estante: e.target.value }))}
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none">
          {TIPOS_SOPORTE.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-4 py-2">
        <input
          value={form.nivel}
          onChange={e => setForm(f => ({ ...f, nivel: e.target.value }))}
          placeholder={form.estante === "Pallet" ? "1, 2, 3…" : "A, B, C…"}
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      </td>
      <td className="px-4 py-2">
        <div className="flex gap-2">
          <button
            onClick={onGuardar}
            className="flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">
            <Check size={13} /> Guardar
          </button>
          <button
            onClick={cancelar}
            className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
            <X size={13} /> Cancelar
          </button>
        </div>
      </td>
    </tr>
  );
}

function TabUbicaciones() {
  const { show, node: toastNode } = useToast();
  const [ubicaciones, setUbicaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  // estante = tipo soporte ("Pallet"/"Estante"), nivel = identificador ("3"/"B")
  const [form, setForm] = useState({ codigo_zona: "", estante: "Pallet", nivel: "" });

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from("ubicacion")
      .select("*")
      .order("codigo_zona")
      .order("estante")
      .order("nivel");
    if (error) show("Error al cargar ubicaciones", "err");
    else setUbicaciones(data || []);
    setCargando(false);
  }, [show]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardarNueva() {
    if (!form.codigo_zona.trim()) { show("La zona es obligatoria", "err"); return; }
    if (!form.nivel.trim()) { show("El número/letra es obligatorio", "err"); return; }
    const { error } = await supabase.from("ubicacion").insert({
      codigo_zona: form.codigo_zona.trim(),
      estante: form.estante,                  // tipo: "Pallet" o "Estante"
      nivel: form.nivel.trim().toUpperCase(), // código: "3" o "B"
    });
    if (error) { show("Error al crear ubicación", "err"); return; }
    show("Ubicación creada");
    setNuevo(false);
    setForm({ codigo_zona: "", estante: "Pallet", nivel: "" });
    cargar();
  }

  async function guardarEdicion(id) {
    if (!form.codigo_zona.trim()) { show("La zona es obligatoria", "err"); return; }
    if (!form.nivel.trim()) { show("El número/letra es obligatorio", "err"); return; }
    const { error } = await supabase.from("ubicacion").update({
      codigo_zona: form.codigo_zona.trim(),
      estante: form.estante,
      nivel: form.nivel.trim().toUpperCase(),
    }).eq("id", id);
    if (error) { show("Error al guardar", "err"); return; }
    show("Ubicación actualizada");
    setEditando(null);
    cargar();
  }

  async function eliminar(id) {
    if (!confirm("¿Eliminar esta ubicación? Si tiene productos o transacciones asignadas, fallará.")) return;
    const { error } = await supabase.from("ubicacion").delete().eq("id", id);
    if (error) { show("No se puede eliminar — tiene referencias activas", "err"); return; }
    show("Ubicación eliminada");
    cargar();
  }

  function iniciarEdicion(u) {
    setEditando(u.id);
    setNuevo(false);
    setForm({
      codigo_zona: u.codigo_zona,
      estante: u.estante || "Pallet",
      nivel: u.nivel || "",
    });
  }

  function cancelar() {
    setEditando(null);
    setNuevo(false);
    setForm({ codigo_zona: "", estante: "Pallet", nivel: "" });
  }


  // Agrupar por zona para lectura más clara
  const porZona = ubicaciones.reduce((acc, u) => {
    if (!acc[u.codigo_zona]) acc[u.codigo_zona] = [];
    acc[u.codigo_zona].push(u);
    return acc;
  }, {});

  return (
    <div>
      {toastNode}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">{ubicaciones.length} ubicaciones registradas</p>
        {!nuevo && !editando && (
          <button
            onClick={() => { setNuevo(true); setEditando(null); setForm({ codigo_zona: "", estante: "Pallet", nivel: "" }); }}
            className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            <Plus size={15} /> Nueva ubicación
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 w-2/5">Zona</th>
              <th className="px-4 py-3 w-1/5">Tipo</th>
              <th className="px-4 py-3 w-1/5">Nro / Letra</th>
              <th className="px-4 py-3 w-1/5">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {nuevo && <FilaForm form={form} setForm={setForm} cancelar={cancelar} onGuardar={guardarNueva} />}
            {cargando ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>
            ) : ubicaciones.length === 0 && !nuevo ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                No hay ubicaciones. Agregá la primera.
              </td></tr>
            ) : (
              Object.entries(porZona).map(([zona, items]) => (
                items.map((u, idx) => editando === u.id ? (
                  <FilaForm key={u.id} form={form} setForm={setForm} cancelar={cancelar} onGuardar={() => guardarEdicion(u.id)} />
                ) : (
                  <tr key={u.id} className="hover:bg-slate-50">
                    {/* Zona solo en primera fila del grupo */}
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {idx === 0
                        ? <span className="flex items-center gap-2"><MapPin size={13} className="text-slate-400" />{zona}</span>
                        : <span className="pl-5 text-slate-300">↳</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium
                        ${u.estante === "Pallet"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-blue-100 text-blue-700"}`}>
                        {u.estante || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">{u.nivel || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => iniciarEdicion(u)}
                          className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">
                          <Pencil size={12} /> Editar
                        </button>
                        <button
                          onClick={() => eliminar(u.id)}
                          className="flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                          <Trash2 size={12} /> Quitar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TAB 2: Asignación Producto ↔ Ubicación ─────────────────────────────────

function TabAsignaciones() {
  const { show, node: toastNode } = useToast();
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [seleccionado, setSeleccionado] = useState(null);
  const [asignaciones, setAsignaciones] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [nuevaUbicId, setNuevaUbicId] = useState("");
  const [agregando, setAgregando] = useState(false);

  useEffect(() => {
    supabase
      .from("ubicacion")
      .select("*")
      .order("codigo_zona")
      .order("estante")
      .order("nivel")
      .then(({ data }) => setUbicaciones(data || []));
  }, []);

  async function buscarProductos(q) {
    if (!q.trim()) { setProductos([]); return; }
    setBuscando(true);
    const { data } = await supabase
      .from("producto")
      .select("id, nombre, sku_interno")
      .ilike("nombre", `%${q}%`)
      .eq("activo", true)
      .order("nombre")
      .limit(20);
    setProductos(data || []);
    setBuscando(false);
  }

  useEffect(() => {
    const t = setTimeout(() => buscarProductos(busqueda), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  async function seleccionarProducto(p) {
    setSeleccionado(p);
    setProductos([]);
    setBusqueda("");
    cargarAsignaciones(p.id);
  }

  async function cargarAsignaciones(productoId) {
    const { data } = await supabase
      .from("producto_ubicacion")
      .select("id, es_principal, ubicacion:ubicacion_id(id, codigo_zona, estante, nivel)")
      .eq("producto_id", productoId)
      .order("es_principal", { ascending: false });
    setAsignaciones(data || []);
  }

  async function agregarUbicacion() {
    if (!nuevaUbicId) { show("Elegí una ubicación", "err"); return; }
    setAgregando(true);
    const yaTiene = asignaciones.some(a => String(a.ubicacion.id) === String(nuevaUbicId));
    if (yaTiene) { show("Este producto ya tiene esa ubicación", "err"); setAgregando(false); return; }

    const esPrimera = asignaciones.length === 0;
    const { error } = await supabase.from("producto_ubicacion").insert({
      producto_id: seleccionado.id,
      ubicacion_id: Number(nuevaUbicId),
      es_principal: esPrimera,
    });
    if (error) { show("Error al asignar", "err"); setAgregando(false); return; }
    show("Ubicación asignada");
    setNuevaUbicId("");
    cargarAsignaciones(seleccionado.id);
    setAgregando(false);
  }

  async function marcarPrincipal(asignacionId) {
    await supabase
      .from("producto_ubicacion")
      .update({ es_principal: false })
      .eq("producto_id", seleccionado.id);
    const { error } = await supabase
      .from("producto_ubicacion")
      .update({ es_principal: true })
      .eq("id", asignacionId);
    if (error) { show("Error al actualizar", "err"); return; }
    show("Ubicación principal actualizada");
    cargarAsignaciones(seleccionado.id);
  }

  async function quitarAsignacion(asignacionId) {
    const { error } = await supabase.from("producto_ubicacion").delete().eq("id", asignacionId);
    if (error) { show("Error al quitar", "err"); return; }
    show("Asignación eliminada");
    cargarAsignaciones(seleccionado.id);
  }

  const asignadasIds = new Set(asignaciones.map(a => a.ubicacion.id));
  const disponibles = ubicaciones.filter(u => !asignadasIds.has(u.id));

  return (
    <div>
      {toastNode}

      {/* Buscador */}
      <div className="mb-6">
        <label className="mb-1 block text-sm font-medium text-slate-700">Buscar producto</label>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={e => { setBusqueda(e.target.value); setSeleccionado(null); }}
            placeholder="Nombre del producto…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        {(productos.length > 0 || buscando) && (
          <div className="mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {buscando && <p className="px-4 py-3 text-sm text-slate-400">Buscando…</p>}
            {productos.map(p => (
              <button
                key={p.id}
                onClick={() => seleccionarProducto(p)}
                className="flex w-full items-center gap-2 border-b border-slate-100 px-4 py-3 text-left text-sm last:border-0 hover:bg-slate-50">
                <Package size={14} className="shrink-0 text-slate-400" />
                <span className="flex-1 font-medium text-slate-800">{p.nombre}</span>
                {p.sku_interno && <span className="text-xs text-slate-400">{p.sku_interno}</span>}
                <ChevronRight size={14} className="shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Panel producto seleccionado */}
      {seleccionado && (
        <div>
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-slate-900 px-5 py-4">
            <Package size={18} className="text-slate-400" />
            <div>
              <p className="font-semibold text-white">{seleccionado.nombre}</p>
              {seleccionado.sku_interno && (
                <p className="text-xs text-slate-400">SKU: {seleccionado.sku_interno}</p>
              )}
            </div>
            <button
              onClick={() => { setSeleccionado(null); setAsignaciones([]); }}
              className="ml-auto text-slate-400 hover:text-white">
              <X size={18} />
            </button>
          </div>

          {/* Ubicaciones actuales */}
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Ubicaciones asignadas
            </h3>
            {asignaciones.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                Sin ubicaciones asignadas todavía.
              </p>
            ) : (
              <div className="space-y-2">
                {asignaciones.map(a => (
                  <div key={a.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
                    <MapPin size={15} className={a.es_principal ? "text-slate-900" : "text-slate-300"} />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-slate-800">{etiquetaUbicacion(a.ubicacion)}</p>
                      <p className="text-xs text-slate-400">
                        <span className={`rounded-full px-1.5 py-0.5
                          ${a.ubicacion.estante === "Pallet"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-blue-100 text-blue-700"}`}>
                          {a.ubicacion.estante}
                        </span>
                        {" "}{a.ubicacion.nivel}
                      </p>
                    </div>
                    {a.es_principal && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        Principal
                      </span>
                    )}
                    <div className="flex gap-2">
                      {!a.es_principal && (
                        <button
                          onClick={() => marcarPrincipal(a.id)}
                          className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          title="Marcar como principal">
                          <Star size={12} /> Principal
                        </button>
                      )}
                      <button
                        onClick={() => quitarAsignacion(a.id)}
                        className="flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                        <X size={12} /> Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Agregar ubicación */}
          {disponibles.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Agregar ubicación
              </h3>
              <div className="flex gap-2">
                <select
                  value={nuevaUbicId}
                  onChange={e => setNuevaUbicId(e.target.value)}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none">
                  <option value="">Elegir ubicación…</option>
                  {disponibles.map(u => (
                    <option key={u.id} value={u.id}>{etiquetaUbicacion(u)}</option>
                  ))}
                </select>
                <button
                  onClick={agregarUbicacion}
                  disabled={agregando}
                  className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
                  <Plus size={15} /> Asignar
                </button>
              </div>
            </div>
          )}

          {disponibles.length === 0 && asignaciones.length > 0 && (
            <p className="text-xs text-slate-400">
              Este producto ya tiene todas las ubicaciones disponibles asignadas.
            </p>
          )}
        </div>
      )}

      {!seleccionado && !busqueda && (
        <div className="rounded-xl border border-dashed border-slate-200 px-6 py-12 text-center">
          <Package size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">Buscá un producto para ver y editar sus ubicaciones.</p>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal Admin ──────────────────────────────────────────────

const SUBTABS = [
  { id: "ubicaciones",  label: "Ubicaciones",  icon: MapPin,   Comp: TabUbicaciones },
  { id: "asignaciones", label: "Asignaciones", icon: Package,  Comp: TabAsignaciones },
];

export default function AdminApp() {
  const [subtab, setSubtab] = useState("ubicaciones");
  const Active = SUBTABS.find(t => t.id === subtab).Comp;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-slate-800">Administración</h1>
        <p className="text-sm text-slate-500">
          Gestión de ubicaciones del almacén y asignación a productos.
        </p>
      </div>

      <div className="mb-6 flex gap-1 rounded-xl bg-slate-100 p-1">
        {SUBTABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSubtab(id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors
              ${subtab === id
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <Active />
    </div>
  );
}
