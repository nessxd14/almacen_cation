import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import {
  MapPin, Package, Plus, Pencil, Trash2, Check, X,
  ChevronRight, ChevronDown, Search, Star, AlertCircle,
  Warehouse, LayoutGrid, Box, Layers
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
  const show = (msg, tipo = "ok") => setToast({ msg, tipo });
  const node = toast ? <Toast msg={toast.msg} tipo={toast.tipo} onClose={() => setToast(null)} /> : null;
  return { show, node };
}

// Construye la etiqueta legible de una ubicación
// codigo_zona = zona, estante = tipo ("Pallet"/"Estante"), nivel = número, compartimiento = letra
function etiquetaUbicacion(u) {
  if (!u) return "—";
  const partes = [u.codigo_zona];
  if (u.estante && u.nivel) partes.push(`${u.estante} ${u.nivel}`);
  else if (u.estante) partes.push(u.estante);
  if (u.compartimiento) partes.push(u.compartimiento);
  return partes.join(" › ");
}

// ─── TAB 1: Gestión de Ubicaciones (árbol tipo carpetas) ────────────────────

// Genera el rango de letras inclusivo: rangoLetras("A","F") => ["A","B","C","D","E","F"]
function rangoLetras(desde, hasta) {
  const a = (desde || "").toUpperCase().charCodeAt(0);
  const b = (hasta || "").toUpperCase().charCodeAt(0);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return [];
  const out = [];
  for (let c = a; c <= b; c++) out.push(String.fromCharCode(c));
  return out;
}

// Compara identificadores numéricos como números ("10" después de "2"),
// con fallback a comparación natural por string.
function cmpNum(a, b) {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });
}

// Deriva el árbol zona → estantes (subdivididos o no) + pallets, desde las
// filas planas de `ubicacion`. El nodo "Estante N" es sintético.
function construirArbol(ubicaciones) {
  const zonasMap = new Map();
  for (const u of ubicaciones) {
    if (!zonasMap.has(u.codigo_zona)) {
      zonasMap.set(u.codigo_zona, { zona: u.codigo_zona, estantesMap: new Map(), pallets: [] });
    }
    const z = zonasMap.get(u.codigo_zona);
    if (u.estante === "Pallet") {
      z.pallets.push(u);
    } else if (u.estante === "Estante") {
      const key = String(u.nivel ?? "");
      if (!z.estantesMap.has(key)) z.estantesMap.set(key, []);
      z.estantesMap.get(key).push(u);
    } else {
      // tipo desconocido / sin tipo: lo mostramos como hoja directa de la zona
      z.pallets.push(u);
    }
  }
  return [...zonasMap.values()]
    .map(z => {
      const estantes = [...z.estantesMap.entries()].map(([numero, filas]) => {
        const conLetra = filas.filter(f => f.compartimiento);
        if (conLetra.length > 0) {
          return {
            numero,
            subdividido: true,
            hojas: conLetra.sort((a, b) =>
              String(a.compartimiento).localeCompare(String(b.compartimiento))),
          };
        }
        return { numero, subdividido: false, hoja: filas[0] };
      }).sort((a, b) => cmpNum(a.numero, b.numero));
      const pallets = z.pallets.slice().sort((a, b) => cmpNum(a.nivel, b.nivel));
      return { zona: z.zona, estantes, pallets };
    })
    .sort((a, b) => a.zona.localeCompare(b.zona));
}

// ── piezas de UI reutilizables (a nivel de módulo: identidad estable) ──────
function Indent({ depth, children }) {
  return (
    <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 20 }}>{children}</div>
  );
}

function BtnMini({ onClick, icon: Icon, children, tono = "slate" }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium
        ${tono === "red"
          ? "border-red-200 text-red-600 hover:bg-red-50"
          : "border-slate-200 text-slate-600 hover:bg-slate-100"}`}>
      {Icon && <Icon size={12} />} {children}
    </button>
  );
}

// Inputs "desde A / hasta F" + preview de las letras a generar.
function BulkLetras({ form, setForm }) {
  const letras = rangoLetras(form.desde, form.hasta);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">Compartimientos de</span>
      <input value={form.desde}
        onChange={e => setForm(f => ({ ...f, desde: e.target.value.toUpperCase().slice(0, 1) }))}
        maxLength={1}
        className="w-12 rounded border border-slate-300 px-2 py-1 text-center text-sm uppercase focus:border-slate-500 focus:outline-none" />
      <span className="text-xs text-slate-500">a</span>
      <input value={form.hasta}
        onChange={e => setForm(f => ({ ...f, hasta: e.target.value.toUpperCase().slice(0, 1) }))}
        maxLength={1}
        className="w-12 rounded border border-slate-300 px-2 py-1 text-center text-sm uppercase focus:border-slate-500 focus:outline-none" />
      <span className="text-xs text-slate-400">
        {letras.length ? `→ ${letras.join(", ")}` : "rango inválido"}
      </span>
    </div>
  );
}

// Formulario de edición de una hoja (pallet / estante-sin-letra / compartimiento).
function FormEditarHoja({ fila, depth, form, setForm, onGuardar, onCancelar }) {
  return (
    <div className="border-l-2 border-slate-300 bg-slate-50 px-3 py-2" style={{ marginLeft: depth * 20 }}>
      <div className="flex flex-wrap items-center gap-2">
        {fila.estante === "Pallet" ? (
          <input autoFocus value={form.nivel}
            onChange={e => setForm(f => ({ ...f, nivel: e.target.value }))}
            placeholder="Nº pallet"
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none" />
        ) : (
          <>
            <input autoFocus value={form.nivel}
              onChange={e => setForm(f => ({ ...f, nivel: e.target.value }))}
              placeholder="Nº estante"
              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none" />
            {fila.compartimiento && (
              <input value={form.compartimiento}
                onChange={e => setForm(f => ({ ...f, compartimiento: e.target.value }))}
                placeholder="Letra"
                maxLength={1}
                className="w-16 rounded border border-slate-300 px-2 py-1 text-sm uppercase focus:border-slate-500 focus:outline-none" />
            )}
          </>
        )}
        <button onClick={onGuardar}
          className="flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">
          <Check size={13} /> Guardar
        </button>
        <button onClick={onCancelar}
          className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
          <X size={13} /> Cancelar
        </button>
      </div>
    </div>
  );
}

// Hoja almacenable: muestra etiqueta + nº de productos + acciones, o el form de edición.
function Hoja({ fila, depth, icon: Icon, etiqueta, conteos, editando, form, setForm, onEditar, onEliminar, onGuardar, onCancelar }) {
  if (editando) {
    return <FormEditarHoja fila={fila} depth={depth} form={form} setForm={setForm}
      onGuardar={onGuardar} onCancelar={onCancelar} />;
  }
  return (
    <div className="flex items-center px-3 py-2 hover:bg-slate-50">
      <Indent depth={depth}>
        <Icon size={14} className="text-slate-400" />
        <span className="font-mono text-sm text-slate-700">{etiqueta}</span>
        {conteos[fila.id] > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {conteos[fila.id]} prod
          </span>
        )}
      </Indent>
      <div className="ml-auto flex gap-1">
        <BtnMini onClick={onEditar} icon={Pencil}>Editar</BtnMini>
        <BtnMini onClick={onEliminar} icon={Trash2} tono="red">Eliminar</BtnMini>
      </div>
    </div>
  );
}

function TabUbicaciones() {
  const { show, node: toastNode } = useToast();
  const [ubicaciones, setUbicaciones] = useState([]);
  const [conteos, setConteos] = useState({}); // ubicacion_id -> nº de productos asignados
  const [cargando, setCargando] = useState(true);
  const [abiertos, setAbiertos] = useState(() => new Set());
  // panel = formulario contextual abierto. { kind, zona?, numero?, fila? }
  const [panel, setPanel] = useState(null);
  const [form, setForm] = useState({});

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from("ubicacion")
      .select("*")
      .order("codigo_zona")
      .order("estante")
      .order("nivel")
      .order("compartimiento");
    if (error) show("Error al cargar ubicaciones", "err");
    else setUbicaciones(data || []);
    // conteo de productos por ubicación (best-effort, no bloquea la carga)
    const { data: pus } = await supabase.from("producto_ubicacion").select("ubicacion_id");
    const c = {};
    (pus || []).forEach(r => { c[r.ubicacion_id] = (c[r.ubicacion_id] || 0) + 1; });
    setConteos(c);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const arbol = construirArbol(ubicaciones);

  // ── nodos expandibles ──────────────────────────────────────────────────
  const idZona = (zona) => `zona:${zona}`;
  const idEstante = (zona, numero) => `estante:${zona}:${numero}`;
  const toggle = (id) => setAbiertos(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const expandirTodo = () => {
    const ids = new Set();
    arbol.forEach(z => {
      ids.add(idZona(z.zona));
      z.estantes.forEach(e => { if (e.subdividido) ids.add(idEstante(z.zona, e.numero)); });
    });
    setAbiertos(ids);
  };
  const colapsarTodo = () => setAbiertos(new Set());

  // ── apertura de formularios contextuales ────────────────────────────────
  function abrir(kind, ctx = {}) {
    setPanel({ kind, ...ctx });
    setForm({
      zona: ctx.zona || "",
      tipo: "Estante",
      numero: "",
      modo: "con",            // estante: "con" | "sin" compartimientos
      desde: "A",
      hasta: "F",
      nivel: ctx.fila?.nivel ?? "",
      compartimiento: ctx.fila?.compartimiento ?? "",
    });
  }
  const cerrar = () => setPanel(null);
  const esPanel = (kind, ctx = {}) =>
    panel?.kind === kind &&
    (ctx.zona === undefined || panel.zona === ctx.zona) &&
    (ctx.numero === undefined || String(panel.numero) === String(ctx.numero)) &&
    (ctx.id === undefined || panel.fila?.id === ctx.id);

  // ── operaciones de escritura ────────────────────────────────────────────
  async function insertarFilas(filas) {
    const { error } = await supabase.from("ubicacion").insert(filas);
    return error;
  }

  async function crearPallet() {
    const zona = (form.zona || "").trim();
    const numero = (form.numero || "").trim();
    if (!zona) { show("La zona es obligatoria", "err"); return; }
    if (!numero) { show("El número de pallet es obligatorio", "err"); return; }
    const err = await insertarFilas([{ codigo_zona: zona, estante: "Pallet", nivel: numero, compartimiento: null }]);
    if (err) { show(err.code === "23505" ? "Ya existe ese pallet" : "Error al crear pallet", "err"); return; }
    show("Pallet creado");
    cerrar(); cargar();
  }

  async function crearEstante() {
    const zona = (form.zona || "").trim();
    const numero = (form.numero || "").trim();
    if (!zona) { show("La zona es obligatoria", "err"); return; }
    if (!numero) { show("El número de estante es obligatorio", "err"); return; }
    const existentes = ubicaciones.filter(u =>
      u.codigo_zona === zona && u.estante === "Estante" && String(u.nivel) === String(numero));

    if (form.modo === "sin") {
      if (existentes.length) { show("Ese estante ya existe", "err"); return; }
      const err = await insertarFilas([{ codigo_zona: zona, estante: "Estante", nivel: numero, compartimiento: null }]);
      if (err) { show(err.code === "23505" ? "Ya existe ese estante" : "Error al crear estante", "err"); return; }
      show("Estante creado");
    } else {
      if (existentes.some(u => !u.compartimiento)) { show("Ese estante ya existe sin compartimientos", "err"); return; }
      const letras = rangoLetras(form.desde, form.hasta);
      if (!letras.length) { show("Rango de letras inválido", "err"); return; }
      const ya = new Set(existentes.filter(u => u.compartimiento).map(u => u.compartimiento.toUpperCase()));
      const nuevas = letras.filter(l => !ya.has(l));
      if (!nuevas.length) { show("Esos compartimientos ya existen", "err"); return; }
      const err = await insertarFilas(nuevas.map(l => ({ codigo_zona: zona, estante: "Estante", nivel: numero, compartimiento: l })));
      if (err) { show("Error al crear compartimientos", "err"); return; }
      show(`Estante ${numero} creado con ${nuevas.length} compartimiento(s)`);
    }
    setAbiertos(prev => new Set(prev).add(idZona(zona)));
    cerrar(); cargar();
  }

  async function crearCompartimientos(zona, numero) {
    const letras = rangoLetras(form.desde, form.hasta);
    if (!letras.length) { show("Rango de letras inválido", "err"); return; }
    const existentes = ubicaciones.filter(u =>
      u.codigo_zona === zona && u.estante === "Estante" && String(u.nivel) === String(numero));
    if (existentes.some(u => !u.compartimiento)) { show("Ese estante no admite compartimientos", "err"); return; }
    const ya = new Set(existentes.filter(u => u.compartimiento).map(u => u.compartimiento.toUpperCase()));
    const nuevas = letras.filter(l => !ya.has(l));
    if (!nuevas.length) { show("Esos compartimientos ya existen", "err"); return; }
    const err = await insertarFilas(nuevas.map(l => ({ codigo_zona: zona, estante: "Estante", nivel: String(numero), compartimiento: l })));
    if (err) { show("Error al crear compartimientos", "err"); return; }
    show(`${nuevas.length} compartimiento(s) creado(s)`);
    cerrar(); cargar();
  }

  async function guardarEdicion(fila) {
    const upd = {};
    if (fila.estante === "Pallet") {
      const n = (form.nivel || "").trim();
      if (!n) { show("El número es obligatorio", "err"); return; }
      upd.nivel = n;
    } else if (fila.compartimiento) {
      const n = (form.nivel || "").trim();
      const l = (form.compartimiento || "").trim().toUpperCase();
      if (!n) { show("El número de estante es obligatorio", "err"); return; }
      if (!/^[A-Z]$/.test(l)) { show("La letra debe ser A–Z", "err"); return; }
      upd.nivel = n; upd.compartimiento = l;
    } else {
      const n = (form.nivel || "").trim();
      if (!n) { show("El número de estante es obligatorio", "err"); return; }
      upd.nivel = n;
    }
    const { error } = await supabase.from("ubicacion").update(upd).eq("id", fila.id);
    if (error) { show(error.code === "23505" ? "Ya existe esa ubicación" : "Error al guardar", "err"); return; }
    show("Ubicación actualizada");
    cerrar(); cargar();
  }

  async function eliminar(id) {
    if (!confirm("¿Eliminar esta ubicación? Si tiene productos o movimientos asignados, fallará.")) return;
    const { error } = await supabase.from("ubicacion").delete().eq("id", id);
    if (error) { show("No se puede eliminar — tiene productos o movimientos asignados", "err"); return; }
    show("Ubicación eliminada");
    cargar();
  }

  // helper: props comunes para una <Hoja> almacenable
  const hojaProps = (fila) => ({
    fila,
    conteos,
    editando: esPanel("edit", { id: fila.id }),
    form, setForm,
    onEditar: () => abrir("edit", { fila }),
    onEliminar: () => eliminar(fila.id),
    onGuardar: () => guardarEdicion(fila),
    onCancelar: cerrar,
  });

  return (
    <div>
      {toastNode}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {ubicaciones.length} ubicaciones · {arbol.length} zonas
        </p>
        <div className="flex flex-wrap gap-2">
          <BtnMini onClick={expandirTodo} icon={ChevronDown}>Expandir todo</BtnMini>
          <BtnMini onClick={colapsarTodo} icon={ChevronRight}>Colapsar todo</BtnMini>
          <button
            onClick={() => abrir("nuevaZona")}
            className="flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            <Plus size={15} /> Nueva zona
          </button>
        </div>
      </div>

      {/* alta de zona nueva (con su primer estante/pallet) */}
      {esPanel("nuevaZona") && (
        <div className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input autoFocus value={form.zona}
              onChange={e => setForm(f => ({ ...f, zona: e.target.value }))}
              placeholder="Nombre de la zona (ej. ALMACEN 1)"
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none" />
            <select value={form.tipo}
              onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
              className="rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none">
              <option value="Estante">Estante</option>
              <option value="Pallet">Pallet</option>
            </select>
            <input value={form.numero}
              onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
              placeholder={form.tipo === "Pallet" ? "Nº pallet" : "Nº estante"}
              className="w-28 rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none" />
          </div>
          {form.tipo === "Estante" && (
            <div className="space-y-2">
              <div className="flex gap-4 text-sm text-slate-600">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={form.modo === "con"}
                    onChange={() => setForm(f => ({ ...f, modo: "con" }))} />
                  Con compartimientos
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={form.modo === "sin"}
                    onChange={() => setForm(f => ({ ...f, modo: "sin" }))} />
                  Sin compartimientos
                </label>
              </div>
              {form.modo === "con" && <BulkLetras form={form} setForm={setForm} />}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={form.tipo === "Pallet" ? crearPallet : crearEstante}
              className="flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">
              <Check size={13} /> Crear
            </button>
            <button onClick={cerrar}
              className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
              <X size={13} /> Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {cargando ? (
          <p className="px-4 py-8 text-center text-slate-400">Cargando…</p>
        ) : arbol.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-400">No hay ubicaciones. Agregá la primera zona.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {arbol.map(z => {
              const zonaAbierta = abiertos.has(idZona(z.zona));
              return (
                <div key={z.zona}>
                  {/* nodo ZONA */}
                  <div className="flex items-center bg-slate-50 px-3 py-2.5">
                    <button onClick={() => toggle(idZona(z.zona))}
                      className="flex items-center gap-1.5 font-medium text-slate-800">
                      {zonaAbierta ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                      <Warehouse size={15} className="text-slate-500" />
                      {z.zona}
                    </button>
                    <div className="ml-auto flex gap-1">
                      <BtnMini onClick={() => abrir("addEstante", { zona: z.zona })} icon={Plus}>Estante</BtnMini>
                      <BtnMini onClick={() => abrir("addPallet", { zona: z.zona })} icon={Plus}>Pallet</BtnMini>
                    </div>
                  </div>

                  {/* formularios de alta a nivel de zona */}
                  {esPanel("addPallet", { zona: z.zona }) && (
                    <div className="border-l-2 border-amber-300 bg-amber-50/40 px-3 py-2" style={{ marginLeft: 20 }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Layers size={14} className="text-amber-500" />
                        <input autoFocus value={form.numero}
                          onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
                          placeholder="Nº pallet"
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none" />
                        <button onClick={crearPallet}
                          className="flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">
                          <Check size={13} /> Crear pallet
                        </button>
                        <button onClick={cerrar}
                          className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                          <X size={13} /> Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  {esPanel("addEstante", { zona: z.zona }) && (
                    <div className="space-y-2 border-l-2 border-blue-300 bg-blue-50/40 px-3 py-2" style={{ marginLeft: 20 }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <LayoutGrid size={14} className="text-blue-500" />
                        <input autoFocus value={form.numero}
                          onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
                          placeholder="Nº estante"
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none" />
                        <label className="flex items-center gap-1.5 text-sm text-slate-600">
                          <input type="radio" checked={form.modo === "con"}
                            onChange={() => setForm(f => ({ ...f, modo: "con" }))} />
                          Con compartimientos
                        </label>
                        <label className="flex items-center gap-1.5 text-sm text-slate-600">
                          <input type="radio" checked={form.modo === "sin"}
                            onChange={() => setForm(f => ({ ...f, modo: "sin" }))} />
                          Sin
                        </label>
                      </div>
                      {form.modo === "con" && <BulkLetras form={form} setForm={setForm} />}
                      <div className="flex gap-2">
                        <button onClick={crearEstante}
                          className="flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">
                          <Check size={13} /> Crear estante
                        </button>
                        <button onClick={cerrar}
                          className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                          <X size={13} /> Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* hijos de la zona */}
                  {zonaAbierta && (
                    <div>
                      {z.estantes.map(e => {
                        if (!e.subdividido) {
                          // estante sin compartimientos = hoja directa
                          return (
                            <Hoja key={`e-${e.numero}`} depth={1}
                              icon={LayoutGrid} etiqueta={`Estante ${e.numero}`} {...hojaProps(e.hoja)} />
                          );
                        }
                        const abierto = abiertos.has(idEstante(z.zona, e.numero));
                        return (
                          <div key={`e-${e.numero}`}>
                            {/* nodo ESTANTE sintético */}
                            <div className="flex items-center px-3 py-2 hover:bg-slate-50">
                              <Indent depth={1}>
                                <button onClick={() => toggle(idEstante(z.zona, e.numero))}
                                  className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                                  {abierto ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                                  <LayoutGrid size={14} className="text-blue-500" />
                                  Estante {e.numero}
                                  <span className="text-xs font-normal text-slate-400">({e.hojas.length})</span>
                                </button>
                              </Indent>
                              <div className="ml-auto flex gap-1">
                                <BtnMini onClick={() => abrir("addComp", { zona: z.zona, numero: e.numero })} icon={Plus}>Compartimiento</BtnMini>
                              </div>
                            </div>
                            {esPanel("addComp", { zona: z.zona, numero: e.numero }) && (
                              <div className="space-y-2 border-l-2 border-blue-300 bg-blue-50/40 px-3 py-2" style={{ marginLeft: 40 }}>
                                <BulkLetras form={form} setForm={setForm} />
                                <div className="flex gap-2">
                                  <button onClick={() => crearCompartimientos(z.zona, e.numero)}
                                    className="flex items-center gap-1 rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">
                                    <Check size={13} /> Generar
                                  </button>
                                  <button onClick={cerrar}
                                    className="flex items-center gap-1 rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                                    <X size={13} /> Cancelar
                                  </button>
                                </div>
                              </div>
                            )}
                            {abierto && e.hojas.map(h => (
                              <Hoja key={h.id} depth={2}
                                icon={Box} etiqueta={h.compartimiento} {...hojaProps(h)} />
                            ))}
                          </div>
                        );
                      })}
                      {z.pallets.map(p => (
                        <Hoja key={p.id} depth={1}
                          icon={Layers} etiqueta={`Pallet ${p.nivel}`} {...hojaProps(p)} />
                      ))}
                      {z.estantes.length === 0 && z.pallets.length === 0 && (
                        <p className="px-3 py-2 text-xs text-slate-400" style={{ paddingLeft: 40 }}>
                          Zona vacía — agregá un estante o pallet.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
      .order("compartimiento")
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
      .select("id, es_principal, ubicacion:ubicacion_id(id, codigo_zona, estante, nivel, compartimiento)")
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
                        {a.ubicacion.compartimiento ? ` · ${a.ubicacion.compartimiento}` : ""}
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
