import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle, Check, LayoutGrid, Layers, MapPin, Pencil, Plus, Search, Star, Trash2, Warehouse, X,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { fetchAll } from "./lib/fetchAll";
import { sanearFiltro } from "./lib/filtroTexto";
import { useSucursal } from "./lib/useSucursal";
import {
  LETRAS, TIPOS_MUEBLE, abreviaturaZona, codigoUbicacion, compararUbicaciones, esMueble,
  etiquetaUbicacion, rangoNumeros, siguienteLetra,
} from "./lib/ubicacionTexto";

// ─── Mapa de muebles ─────────────────────────────────────────────────────────
// Reemplaza el árbol de carpetas de Administración › Ubicaciones.
// Cada zona muestra sus muebles (Estante A, Pallet B…) como tarjetas, y cada
// mueble sus compartimientos numerados como casillas. Buscar un producto
// ilumina las casillas donde está asignado o tiene stock.

const ESTILO_TIPO = {
  Estante: { icono: LayoutGrid, fondo: "bg-blue-600", suave: "bg-blue-50 text-blue-700 border-blue-200" },
  Pallet: { icono: Layers, fondo: "bg-amber-500", suave: "bg-amber-50 text-amber-800 border-amber-200" },
};

function Aviso({ aviso, onCerrar }) {
  useEffect(() => {
    if (!aviso) return undefined;
    const t = setTimeout(onCerrar, 3500);
    return () => clearTimeout(t);
  }, [aviso, onCerrar]);
  if (!aviso) return null;
  const ok = aviso.tipo === "ok";
  return (
    <div role="status" className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white"}`}>
      {ok ? <Check size={16} /> : <AlertCircle size={16} />}
      {aviso.msg}
    </div>
  );
}

function Boton({ onClick, icon: Icon, children, tono = "neutro", type = "button", disabled, ...rest }) {
  const tonos = {
    neutro: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    rojo: "border-red-200 bg-white text-red-600 hover:bg-red-50",
    primario: "border-slate-900 bg-slate-900 text-white hover:bg-slate-700",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} {...rest}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${tonos[tono]}`}>
      {Icon && <Icon size={14} aria-hidden="true" />}{children}
    </button>
  );
}

// Agrupa las filas planas en zona → muebles → compartimientos.
function agruparZonas(ubicaciones) {
  const zonas = new Map();
  const especiales = [];
  for (const u of [...ubicaciones].sort(compararUbicaciones)) {
    if (!esMueble(u)) { especiales.push(u); continue; }
    if (!zonas.has(u.codigo_zona)) zonas.set(u.codigo_zona, { zona: u.codigo_zona, sucursalId: u.sucursal_id, muebles: new Map() });
    const z = zonas.get(u.codigo_zona);
    const clave = `${u.estante}:${u.nivel}`;
    if (!z.muebles.has(clave)) z.muebles.set(clave, { clave, tipo: u.estante, letra: u.nivel, filas: [] });
    z.muebles.get(clave).filas.push(u);
  }
  return {
    zonas: [...zonas.values()].map(z => ({ ...z, muebles: [...z.muebles.values()] })),
    especiales,
  };
}

function FormNuevoMueble({ ubicaciones, zona, zonaEditable, onCrear, onCancelar }) {
  const [nombreZona, setNombreZona] = useState(zona || "");
  const [tipo, setTipo] = useState("Estante");
  const zonaFinal = (zonaEditable ? nombreZona : zona).trim().toUpperCase();
  const libres = LETRAS.filter(l => !ubicaciones.some(u => u.codigo_zona === zonaFinal && u.estante === tipo && u.nivel === l));
  const [letra, setLetra] = useState(() => siguienteLetra(ubicaciones, zona, "Estante") || "A");
  const [compartimientos, setCompartimientos] = useState("4");
  const letraValida = libres.includes(letra) ? letra : libres[0] || "";

  return (
    <form
      onSubmit={e => { e.preventDefault(); onCrear({ zona: zonaFinal, tipo, letra: letraValida, compartimientos: Number(compartimientos) || 0 }); }}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
      {zonaEditable && (
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Zona
          <input autoFocus required value={nombreZona} onChange={e => setNombreZona(e.target.value)}
            placeholder="Ej. PLANTA BAJA"
            className="min-h-9 w-48 rounded-lg border border-slate-300 bg-white px-2 text-sm uppercase focus:border-blue-500 focus:outline-none" />
        </label>
      )}
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
        Tipo
        <select value={tipo} onChange={e => { setTipo(e.target.value); setLetra(siguienteLetra(ubicaciones, zonaFinal, e.target.value) || ""); }}
          className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm focus:border-blue-500 focus:outline-none">
          {TIPOS_MUEBLE.map(t => <option key={t}>{t}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
        Letra
        <select value={letraValida} onChange={e => setLetra(e.target.value)}
          className="min-h-9 w-20 rounded-lg border border-slate-300 bg-white px-2 text-sm font-bold focus:border-blue-500 focus:outline-none">
          {libres.map(l => <option key={l}>{l}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
        Compartimientos
        <input type="number" min="0" max="99" value={compartimientos} onChange={e => setCompartimientos(e.target.value)}
          aria-describedby="ayuda-compartimientos"
          className="min-h-9 w-24 rounded-lg border border-slate-300 bg-white px-2 text-sm focus:border-blue-500 focus:outline-none" />
      </label>
      <p id="ayuda-compartimientos" className="basis-full text-xs text-slate-500 sm:basis-auto sm:self-center">
        {Number(compartimientos) > 0 ? `Se crean ${tipo} ${letraValida || "?"} › 1 al ${compartimientos}` : `Se crea ${tipo} ${letraValida || "?"} sin divisiones`}
      </p>
      <div className="flex gap-2">
        <Boton type="submit" tono="primario" icon={Check} disabled={!letraValida || !zonaFinal}>Crear</Boton>
        <Boton onClick={onCancelar} icon={X}>Cancelar</Boton>
      </div>
    </form>
  );
}

function TarjetaMueble({ mueble, zona, sucursalId, conteos, resaltadas, ubicaciones, acciones }) {
  const [modo, setModo] = useState(null); // null | "comp" | "letra"
  const [hasta, setHasta] = useState("");
  const [nuevaLetra, setNuevaLetra] = useState(mueble.letra);
  const estilo = ESTILO_TIPO[mueble.tipo] ?? ESTILO_TIPO.Estante;
  const Icono = estilo.icono;
  const compartimientos = mueble.filas.filter(f => f.compartimiento);
  const sinDivisiones = mueble.filas.find(f => !f.compartimiento);
  const productos = mueble.filas.reduce((s, f) => s + (conteos[f.id] || 0), 0);
  const ultimo = compartimientos.reduce((m, f) => Math.max(m, Number(f.compartimiento) || 0), 0);
  const tieneResaltado = mueble.filas.some(f => resaltadas.has(f.id));
  const libres = LETRAS.filter(l => l === mueble.letra || !ubicaciones.some(u => u.codigo_zona === zona && u.estante === mueble.tipo && u.nivel === l));
  const enlace = f => `/ubicaciones/${f.id}/ficha${sucursalId ? `?sucursal=${sucursalId}` : ""}`;

  return (
    <article
      id={`mueble-${zona}-${mueble.clave}`}
      aria-label={`${mueble.tipo} ${mueble.letra}`}
      className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm transition-shadow ${tieneResaltado ? "border-emerald-400 ring-2 ring-emerald-300" : "border-slate-200"}`}>
      <header className="flex items-start gap-3">
        <div aria-hidden="true" className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl font-extrabold text-white ${estilo.fondo}`}>
          {mueble.letra}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
            <Icono size={14} aria-hidden="true" className="text-slate-400" />
            {mueble.tipo} {mueble.letra}
          </h3>
          <p className="text-xs text-slate-500">
            {compartimientos.length ? `${compartimientos.length} compartimientos` : "Sin divisiones"} · {productos} {productos === 1 ? "producto" : "productos"}
          </p>
          <p className="font-mono text-[11px] text-slate-400">{codigoUbicacion(mueble.filas[0]).split("-").slice(0, 2).join("-")}</p>
        </div>
      </header>

      {compartimientos.length > 0 ? (
        <ol className="grid grid-cols-4 gap-1.5" aria-label={`Compartimientos de ${mueble.tipo} ${mueble.letra}`}>
          {compartimientos.map(f => {
            const n = conteos[f.id] || 0;
            const marcada = resaltadas.has(f.id);
            return (
              <li key={f.id}>
                <Link to={enlace(f)} title={`${etiquetaUbicacion(f)} · ${n} productos`}
                  aria-label={`Compartimiento ${f.compartimiento}, ${n} productos${marcada ? ", contiene el producto buscado" : ""}`}
                  className={`flex min-h-11 flex-col items-center justify-center rounded-lg border text-sm font-bold no-underline transition-colors
                    ${marcada ? "border-emerald-500 bg-emerald-500 text-white" : n > 0 ? "border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100" : "border-dashed border-slate-200 text-slate-400 hover:bg-slate-50"}`}>
                  {f.compartimiento}
                  <span className={`text-[10px] font-medium ${marcada ? "text-emerald-50" : "text-slate-400"}`}>{n ? `${n} prod.` : "vacío"}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : sinDivisiones ? (
        <Link to={enlace(sinDivisiones)}
          className={`flex min-h-11 items-center justify-center rounded-lg border text-xs font-semibold no-underline
            ${resaltadas.has(sinDivisiones.id) ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>
          Ver contenido ({conteos[sinDivisiones.id] || 0})
        </Link>
      ) : null}

      {modo === "comp" && (
        <form onSubmit={e => { e.preventDefault(); acciones.agregarCompartimientos(mueble, ultimo + 1, Number(hasta)); setModo(null); }}
          className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Agregar del {ultimo + 1} al
            <input autoFocus type="number" min={ultimo + 1} max="99" required value={hasta} onChange={e => setHasta(e.target.value)}
              className="min-h-9 w-20 rounded-lg border border-slate-300 px-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
          <Boton type="submit" tono="primario" icon={Check}>Agregar</Boton>
          <Boton onClick={() => setModo(null)} icon={X}>Cancelar</Boton>
        </form>
      )}
      {modo === "letra" && (
        <form onSubmit={e => { e.preventDefault(); acciones.cambiarLetra(mueble, nuevaLetra); setModo(null); }}
          className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Nueva letra
            <select autoFocus value={nuevaLetra} onChange={e => setNuevaLetra(e.target.value)}
              className="min-h-9 w-20 rounded-lg border border-slate-300 px-2 text-sm font-bold focus:border-blue-500 focus:outline-none">
              {libres.map(l => <option key={l}>{l}</option>)}
            </select>
          </label>
          <Boton type="submit" tono="primario" icon={Check}>Guardar</Boton>
          <Boton onClick={() => setModo(null)} icon={X}>Cancelar</Boton>
        </form>
      )}

      {modo === null && (
        <footer className="mt-auto flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          {!sinDivisiones && <Boton onClick={() => { setHasta(String(ultimo + 1)); setModo("comp"); }} icon={Plus}>Compartimientos</Boton>}
          <Boton onClick={() => { setNuevaLetra(mueble.letra); setModo("letra"); }} icon={Pencil}>Letra</Boton>
          <Boton onClick={() => acciones.eliminarMueble(mueble)} icon={Trash2} tono="rojo" disabled={productos > 0}
            title={productos > 0 ? "Tiene productos asignados" : undefined}>Eliminar</Boton>
        </footer>
      )}
    </article>
  );
}

// Ubicaciones de la sucursal + cuántos productos tiene asignada cada una.
async function leerMapa(sucursalId) {
  let consulta = supabase.from("ubicacion").select("*");
  if (sucursalId) consulta = consulta.eq("sucursal_id", sucursalId);
  const { data, error } = await consulta;
  const conteos = {};
  try {
    const filas = await fetchAll(() => supabase.from("producto_ubicacion").select("ubicacion_id").order("id"));
    filas.forEach(r => { conteos[r.ubicacion_id] = (conteos[r.ubicacion_id] || 0) + 1; });
  } catch {
    // El conteo es informativo: si falla, el mapa se muestra igual.
  }
  return { ubicaciones: data || [], conteos, error };
}

export default function MapaMuebles() {
  const { sucursalActivaId, nombreSucursal } = useSucursal();
  const [ubicaciones, setUbicaciones] = useState([]);
  const [conteos, setConteos] = useState({});
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState(null);
  const [formZona, setFormZona] = useState(null); // nombre de zona, o "__nueva__"
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState([]);
  const [producto, setProducto] = useState(null);
  const [ubicacionesProducto, setUbicacionesProducto] = useState([]);
  const cerrarAviso = useCallback(() => setAviso(null), []);
  const mostrar = useCallback((msg, tipo = "ok") => setAviso({ msg, tipo }), []);
  const primeraResaltada = useRef(null);

  // Las recargas tras crear/editar reemplazan los datos sin volver a mostrar
  // "Cargando…"; ese indicador solo cubre la primera carga.
  const [version, setVersion] = useState(0);
  const cargar = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    let vigente = true;
    leerMapa(sucursalActivaId).then(({ ubicaciones: filas, conteos: c, error }) => {
      if (!vigente) return;
      if (error) mostrar("No se pudieron cargar las ubicaciones", "err");
      else setUbicaciones(filas);
      setConteos(c);
      setCargando(false);
    });
    return () => { vigente = false; };
  }, [sucursalActivaId, version, mostrar]);

  // ── búsqueda de producto ───────────────────────────────────────────────
  useEffect(() => {
    const texto = sanearFiltro(busqueda);
    if (!texto) return undefined;
    const t = setTimeout(async () => {
      const { data } = await supabase.from("producto")
        .select("id, nombre, sku_interno")
        .or(`nombre.ilike.%${texto}%,sku_interno.ilike.%${texto}%`)
        .eq("activo", true).order("nombre").limit(8);
      setResultados(data || []);
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda]);

  async function elegirProducto(p) {
    setProducto(p);
    setBusqueda("");
    setResultados([]);
    const [asig, stock] = await Promise.all([
      supabase.from("producto_ubicacion").select("es_principal, ubicacion_id").eq("producto_id", p.id),
      supabase.from("stock_actual").select("ubicacion_id, cantidad_base").eq("producto_id", p.id).neq("cantidad_base", 0),
    ]);
    const mapa = new Map();
    (asig.data || []).forEach(a => mapa.set(a.ubicacion_id, { id: a.ubicacion_id, principal: a.es_principal, cantidad: null }));
    (stock.data || []).forEach(s => mapa.set(s.ubicacion_id, { ...(mapa.get(s.ubicacion_id) || { id: s.ubicacion_id, principal: false }), cantidad: Number(s.cantidad_base) }));
    setUbicacionesProducto([...mapa.values()]);
  }

  const resaltadas = useMemo(() => new Set(ubicacionesProducto.map(u => u.id)), [ubicacionesProducto]);
  const porId = useMemo(() => new Map(ubicaciones.map(u => [u.id, u])), [ubicaciones]);
  const { zonas, especiales } = useMemo(() => agruparZonas(ubicaciones), [ubicaciones]);

  // Lleva la vista al primer mueble donde está el producto.
  useEffect(() => {
    if (!ubicacionesProducto.length) return;
    const u = porId.get(ubicacionesProducto.find(x => x.principal)?.id ?? ubicacionesProducto[0].id);
    if (!u || !esMueble(u)) return;
    primeraResaltada.current = document.getElementById(`mueble-${u.codigo_zona}-${u.estante}:${u.nivel}`);
    primeraResaltada.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [ubicacionesProducto, porId]);

  // ── escrituras ─────────────────────────────────────────────────────────
  async function crearMueble({ zona, tipo, letra, compartimientos }, sucursalId) {
    const suc = sucursalId ?? sucursalActivaId;
    if (!zona || !letra) { mostrar("Falta la zona o la letra", "err"); return; }
    if (!suc) { mostrar("Elegí una sucursal arriba antes de crear muebles", "err"); return; }
    const base = { codigo_zona: zona, estante: tipo, nivel: letra, sucursal_id: suc };
    const filas = compartimientos > 0
      ? rangoNumeros(1, compartimientos).map(n => ({ ...base, compartimiento: n }))
      : [{ ...base, compartimiento: null }];
    const { error } = await supabase.from("ubicacion").insert(filas);
    if (error) { mostrar(error.code === "23505" ? `Ya existe ${tipo} ${letra} en ${zona}` : "No se pudo crear el mueble", "err"); return; }
    mostrar(`${tipo} ${letra} creado en ${zona}`);
    setFormZona(null);
    cargar();
  }

  const acciones = {
    async agregarCompartimientos(mueble, desde, hasta) {
      const numeros = rangoNumeros(desde, hasta);
      if (!numeros.length) { mostrar("Rango de compartimientos inválido", "err"); return; }
      const f0 = mueble.filas[0];
      const filas = numeros.map(n => ({ codigo_zona: f0.codigo_zona, estante: f0.estante, nivel: f0.nivel, compartimiento: n, sucursal_id: f0.sucursal_id }));
      const { error } = await supabase.from("ubicacion").insert(filas);
      if (error) { mostrar(error.code === "23505" ? "Alguno de esos compartimientos ya existe" : "No se pudieron agregar", "err"); return; }
      mostrar(`${numeros.length} compartimiento(s) agregado(s)`);
      cargar();
    },
    async cambiarLetra(mueble, letra) {
      if (letra === mueble.letra) return;
      const ids = mueble.filas.map(f => f.id);
      const { error } = await supabase.from("ubicacion").update({ nivel: letra }).in("id", ids);
      if (error) { mostrar(error.code === "23505" ? `La letra ${letra} ya está usada` : "No se pudo cambiar la letra", "err"); return; }
      mostrar(`Ahora es ${mueble.tipo} ${letra}`);
      cargar();
    },
    async eliminarMueble(mueble) {
      if (!confirm(`¿Eliminar ${mueble.tipo} ${mueble.letra} y sus ${mueble.filas.length} casillas? Si tienen movimientos registrados, no se podrá.`)) return;
      const { error } = await supabase.from("ubicacion").delete().in("id", mueble.filas.map(f => f.id));
      if (error) { mostrar("No se puede eliminar: tiene productos o movimientos registrados", "err"); return; }
      mostrar(`${mueble.tipo} ${mueble.letra} eliminado`);
      cargar();
    },
  };

  const totalMuebles = zonas.reduce((s, z) => s + z.muebles.length, 0);

  return (
    <div className="flex flex-col gap-5">
      <Aviso aviso={aviso} onCerrar={cerrarAviso} />

      {/* Buscador + acciones */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-64 flex-1">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)}
              aria-label="Buscar producto en el almacén" placeholder="Buscar producto por nombre o SKU para ver dónde está…"
              className="min-h-11 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none" />
            {busqueda.trim() && resultados.length > 0 && (
              <ul role="listbox" aria-label="Productos encontrados" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {resultados.map(p => (
                  <li key={p.id}>
                    <button type="button" onClick={() => elegirProducto(p)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{p.nombre}</span>
                      <span className="font-mono text-xs text-slate-400">{p.sku_interno}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Boton tono="primario" icon={Plus} onClick={() => setFormZona("__nueva__")}>Nueva zona</Boton>
        </div>

        {producto && (
          <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-emerald-900">{producto.nombre}</p>
              <button type="button" onClick={() => { setProducto(null); setUbicacionesProducto([]); }}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">
                <X size={14} aria-hidden="true" /> Quitar
              </button>
            </div>
            {ubicacionesProducto.length === 0 ? (
              <p className="text-sm text-emerald-900">Sin ubicación asignada ni stock registrado en ninguna casilla.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {ubicacionesProducto
                  .map(x => ({ ...x, u: porId.get(x.id) }))
                  .sort((a, b) => Number(b.principal) - Number(a.principal) || compararUbicaciones(a.u, b.u))
                  .map(x => (
                    <li key={x.id} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-1 text-sm">
                      {x.principal && <Star size={13} aria-label="Principal" className="text-amber-500" />}
                      <span className="whitespace-nowrap font-mono font-bold text-emerald-800">{x.u ? codigoUbicacion(x.u) : `#${x.id}`}</span>
                      <span className="text-slate-600">{x.u ? etiquetaUbicacion(x.u) : "Otra sucursal"}</span>
                      {x.cantidad != null && <span className="font-semibold text-slate-800">{x.cantidad} u.</span>}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-xs text-slate-500">
          {sucursalActivaId ? `${nombreSucursal(sucursalActivaId)} · ` : ""}{zonas.length} zonas · {totalMuebles} muebles · los estantes y pallets van con letra (A–Z) y sus compartimientos con número.
        </p>
      </div>

      {formZona === "__nueva__" && (
        <FormNuevoMueble ubicaciones={ubicaciones} zonaEditable onCrear={v => crearMueble(v)} onCancelar={() => setFormZona(null)} />
      )}

      {cargando ? (
        <p className="py-10 text-center text-sm text-slate-400">Cargando ubicaciones…</p>
      ) : zonas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">No hay muebles en esta sucursal. Creá la primera zona.</p>
      ) : (
        zonas.map(z => (
          <section key={z.zona} aria-label={`Zona ${z.zona}`} className="flex flex-col gap-3">
            <header className="flex flex-wrap items-center gap-3">
              <Warehouse size={18} aria-hidden="true" className="text-slate-500" />
              <h2 className="text-base font-extrabold tracking-tight text-slate-800">{z.zona}</h2>
              <span className="rounded-md bg-slate-200 px-2 py-0.5 font-mono text-xs font-bold text-slate-600">{abreviaturaZona(z.zona)}</span>
              <span className="text-xs text-slate-500">{z.muebles.length} {z.muebles.length === 1 ? "mueble" : "muebles"}</span>
              <div className="ml-auto">
                <Boton icon={Plus} onClick={() => setFormZona(z.zona)}>Mueble</Boton>
              </div>
            </header>
            {formZona === z.zona && (
              <FormNuevoMueble ubicaciones={ubicaciones} zona={z.zona} onCrear={v => crearMueble(v, z.sucursalId)} onCancelar={() => setFormZona(null)} />
            )}
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
              {z.muebles.map(m => (
                <TarjetaMueble key={m.clave} mueble={m} zona={z.zona} sucursalId={z.sucursalId} conteos={conteos}
                  resaltadas={resaltadas} ubicaciones={ubicaciones} acciones={acciones} />
              ))}
            </div>
          </section>
        ))
      )}

      {especiales.length > 0 && (
        <section aria-label="Áreas especiales" className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-600"><MapPin size={15} aria-hidden="true" /> Áreas especiales</h2>
          <ul className="flex flex-wrap gap-2">
            {especiales.map(u => (
              <li key={u.id}>
                <Link to={`/ubicaciones/${u.id}/ficha${u.sucursal_id ? `?sucursal=${u.sucursal_id}` : ""}`}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold no-underline
                    ${resaltadas.has(u.id) ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                  {etiquetaUbicacion(u)}
                  <span className="text-slate-400">{conteos[u.id] || 0}</span>
                  {u.es_recepcion && <span className="rounded bg-blue-100 px-1.5 text-[10px] text-blue-700">recepción</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
