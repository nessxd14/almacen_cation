/**
 * PreciosApp.jsx — Brief WMS Ronda 3: pestaña "Precios".
 *
 * Tabla editable de los 4 precios (por unidad suelta) sobre el catálogo
 * completo (1.492 productos activos). Sin migraciones, no toca el Kardex.
 *
 * Trampa central del brief: PostgREST trunca en 1.000 filas en silencio.
 * Toda consulta acá pasa por .range() explícito, y el modo "sin precio"
 * (que puede superar 1.000 ids) pagina el fetch de ids en lotes de 1.000
 * antes de ordenar por stock — nunca se le pide a PostgREST más de 1.000
 * filas de una.
 *
 * Rubro: NO implementado. `familia` no tiene columna de categoría — el
 * dato de productType de Shopify nunca llegó a la base. Necesita una
 * migración y una decisión de origen del dato con Ness; no es tarea de
 * esta pantalla (ver brief, sección "Familia y rubro").
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import { stockPorSucursalBatch, codigosGrisPorProducto } from "./lib/operaciones";
import { useUsuarioActual } from "./lib/useAuth";
import { Tag, Search, Filter, Boxes, Lock, AlertTriangle, Loader, DollarSign } from "lucide-react";

const PAGE_SIZE = 50;
const CAMPOS_PRECIO = ["precio_base", "precio_mayoreo", "precio_institucion", "precio_municipal"];
const COLUMNAS_PRECIO = [
  { campo: "precio_base", label: "Tienda (retail)" },
  { campo: "precio_mayoreo", label: "Mayoreo" },
  { campo: "precio_institucion", label: "Instituciones" },
  { campo: "precio_municipal", label: "Municipal" },
];
const SUCURSAL_LABELS = { 1: "Almacén", 2: "Tienda" };

function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
function precioFmt(v) {
  return Number(v).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Resuelve producto_id que matchean un texto contra código de barra (tipo
// 'barra', cualquier presentación) — el buscador cubre nombre/SKU/código.
async function idsPorCodigo(texto) {
  const { data } = await supabase
    .from("identificador")
    .select("presentacion:presentacion_id(producto_id)")
    .eq("tipo", "barra")
    .ilike("valor", `%${texto}%`)
    .limit(200);
  return [...new Set((data || []).map((r) => r.presentacion?.producto_id).filter(Boolean))];
}

// Aplica marca/familia/texto a un query builder de `producto` — reusado
// tanto por la paginación normal como por el fetch de ids en modo "sin precio".
async function aplicarFiltros(query, { texto, marca, familia }) {
  if (marca === "SIN_MARCA") query = query.or("marca.is.null,marca.eq.");
  else if (marca) query = query.eq("marca", marca);

  if (familia === "SIN_FAMILIA") query = query.is("familia_id", null);
  else if (familia) query = query.eq("familia_id", Number(familia));

  if (texto) {
    const idsCodigo = await idsPorCodigo(texto);
    const orParts = [`nombre.ilike.%${texto}%`, `sku_interno.ilike.%${texto}%`];
    if (idsCodigo.length) orParts.push(`id.in.(${idsCodigo.join(",")})`);
    query = query.or(orParts.join(","));
  }
  return query;
}

// Trae TODAS las filas que matchean, paginando de a 1.000 — nunca se le
// pide a PostgREST un rango que exceda su propio límite silencioso.
async function fetchTodosLosIds(filtros, soloSinPrecio) {
  let ids = [];
  let desde = 0;
  for (;;) {
    let q = supabase.from("producto").select("id").eq("activo", true);
    if (soloSinPrecio) q = q.or("precio_base.eq.0,precio_base.is.null");
    q = await aplicarFiltros(q, filtros);
    q = q.range(desde, desde + 999);
    const { data } = await q;
    ids = ids.concat((data || []).map((r) => r.id));
    if (!data || data.length < 1000) break;
    desde += 1000;
  }
  return ids;
}

async function fetchStockTotalPorIds(ids) {
  const mapa = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data } = await supabase.from("v_producto_stock").select("producto_id, stock_total").in("producto_id", chunk);
    for (const r of data || []) mapa.set(r.producto_id, Number(r.stock_total) || 0);
  }
  return mapa;
}

export default function PreciosApp() {
  const usuarioActual = useUsuarioActual();
  const esAdmin = usuarioActual?.rol === "admin";

  const [busquedaInput, setBusquedaInput] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [marcaSeleccionada, setMarcaSeleccionada] = useState("");
  const [familiaSeleccionada, setFamiliaSeleccionada] = useState("");
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);

  const [marcas, setMarcas] = useState([]);
  const [sinMarcaCount, setSinMarcaCount] = useState(0);
  const [familias, setFamilias] = useState([]);

  const [pagina, setPagina] = useState(0);
  const [filas, setFilas] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [stockPorProducto, setStockPorProducto] = useState(new Map());
  const [codigosPorProducto, setCodigosPorProducto] = useState(new Map());

  // Modo "sin precio": ids ya ordenados por stock desc, calculado una vez
  // por combinación de filtros (no en cada cambio de página).
  const [idsSinPrecio, setIdsSinPrecio] = useState([]);

  const [editandoId, setEditandoId] = useState(null);
  const [valoresEdicion, setValoresEdicion] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);
  const [errorFila, setErrorFila] = useState(null);

  // Debounce del buscador
  const debounceRef = useRef(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setBusqueda(busquedaInput.trim()), 300);
    return () => clearTimeout(debounceRef.current);
  }, [busquedaInput]);

  // Marcas (89 distintas esperadas) — una sola carga, paginada de a 1.000
  // por si el catálogo crece más allá de eso.
  useEffect(() => {
    (async () => {
      let filas = [];
      let desde = 0;
      for (;;) {
        const { data } = await supabase.from("producto").select("marca").eq("activo", true).range(desde, desde + 999);
        filas = filas.concat(data || []);
        if (!data || data.length < 1000) break;
        desde += 1000;
      }
      const set = new Set();
      let sinMarca = 0;
      for (const r of filas) {
        const m = (r.marca || "").trim();
        if (m) set.add(m); else sinMarca++;
      }
      setMarcas([...set].sort((a, b) => a.localeCompare(b)));
      setSinMarcaCount(sinMarca);
    })();
  }, []);

  // Familias — filtro opcional, "sale gratis" (77 filas, una sola consulta).
  useEffect(() => {
    supabase.from("familia").select("id, nombre").order("nombre")
      .then(({ data }) => setFamilias(data || []));
  }, []);

  const filtrosActuales = { texto: busqueda, marca: marcaSeleccionada, familia: familiaSeleccionada };
  const filtrosKey = JSON.stringify(filtrosActuales) + (soloSinPrecio ? "|sinprecio" : "");

  // Al cambiar filtros: volver a página 0 y, en modo "sin precio", recalcular
  // el set completo de ids ordenado por stock (una vez por combinación de
  // filtros, nunca en cada cambio de página).
  useEffect(() => {
    setPagina(0);
    if (!soloSinPrecio) { setIdsSinPrecio([]); return; }
    let activo = true;
    (async () => {
      const ids = await fetchTodosLosIds(filtrosActuales, true);
      const stockMap = await fetchStockTotalPorIds(ids);
      ids.sort((a, b) => (stockMap.get(b) || 0) - (stockMap.get(a) || 0));
      if (activo) setIdsSinPrecio(ids);
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosKey]);

  const cargarPagina = useCallback(async () => {
    setCargando(true);

    let filasPagina = [];
    let totalFilas;

    if (soloSinPrecio) {
      totalFilas = idsSinPrecio.length;
      const pageIds = idsSinPrecio.slice(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE);
      if (pageIds.length > 0) {
        const { data } = await supabase.from("producto")
          .select("id, nombre, marca, sku_interno, precio_base, precio_mayoreo, precio_institucion, precio_municipal, familia_id")
          .in("id", pageIds);
        const porId = new Map((data || []).map((r) => [r.id, r]));
        filasPagina = pageIds.map((id) => porId.get(id)).filter(Boolean);
      }
    } else {
      let query = supabase.from("producto")
        .select("id, nombre, marca, sku_interno, precio_base, precio_mayoreo, precio_institucion, precio_municipal, familia_id", { count: "exact" })
        .eq("activo", true);
      query = await aplicarFiltros(query, filtrosActuales);
      query = query.order("nombre").range(pagina * PAGE_SIZE, pagina * PAGE_SIZE + PAGE_SIZE - 1);
      const { data, count } = await query;
      filasPagina = data || [];
      totalFilas = count || 0;
    }

    setFilas(filasPagina);
    setTotal(totalFilas);

    const ids = filasPagina.map((f) => f.id);
    const [stockMapa, codigosMapa] = await Promise.all([
      stockPorSucursalBatch(ids),
      codigosGrisPorProducto(ids),
    ]);
    setStockPorProducto(stockMapa);
    setCodigosPorProducto(codigosMapa);
    setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrosKey, pagina, soloSinPrecio, idsSinPrecio]);

  useEffect(() => { cargarPagina(); }, [cargarPagina]);

  const totalPaginas = Math.ceil(total / PAGE_SIZE);

  function empezarEdicion(fila) {
    if (!esAdmin) return;
    setErrorFila(null);
    setEditandoId(fila.id);
    setValoresEdicion(Object.fromEntries(CAMPOS_PRECIO.map((c) => [c, fila[c] ?? ""])));
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setErrorFila(null);
  }

  async function confirmarEdicion() {
    if (editandoId == null) return;
    const original = filas.find((f) => f.id === editandoId);
    if (!original) { setEditandoId(null); return; }

    const payload = {};
    for (const campo of CAMPOS_PRECIO) {
      const val = valoresEdicion[campo];
      const num = val === "" || val == null ? null : Number(val);
      if (num !== (original[campo] ?? null)) payload[campo] = num;
    }
    if (Object.keys(payload).length === 0) { setEditandoId(null); return; }

    setGuardandoId(editandoId);
    const { error } = await supabase.from("producto").update(payload).eq("id", editandoId);
    setGuardandoId(null);

    if (error) {
      setErrorFila({
        id: editandoId,
        msg: error.code === "42501" || error.message.includes("rol admin")
          ? "Los precios solo los puede cambiar un administrador"
          : "Error al guardar: " + error.message,
      });
      return; // se queda en modo edición para reintentar o Escape
    }

    setFilas((prev) => prev.map((f) => f.id === editandoId ? { ...f, ...payload } : f));
    setEditandoId(null);
    setErrorFila(null);
  }

  function onKeyDownCelda(e) {
    if (e.key === "Enter") { e.preventDefault(); confirmarEdicion(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelarEdicion(); }
  }

  function onBlurFila(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) confirmarEdicion();
  }

  const marcaLabel = marcaSeleccionada === "SIN_MARCA" ? "Sin marca" : marcaSeleccionada;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <DollarSign size={18} /> Precios
        </h1>
        <p className="text-sm text-slate-500">
          {total} producto{total === 1 ? "" : "s"}
          {marcaSeleccionada && ` · marca ${marcaLabel}`}
          {!esAdmin && " · solo lectura"}
        </p>
      </div>

      {!esAdmin && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          <Lock size={14} className="shrink-0 text-slate-400" />
          Solo un administrador puede editar los precios acá.
        </div>
      )}

      {/* Controles */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={busquedaInput} onChange={(e) => setBusquedaInput(e.target.value)}
            placeholder="Buscar por nombre, SKU o código de barras…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm focus:border-slate-500 focus:outline-none" />
        </div>

        <div className="relative">
          <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <select value={marcaSeleccionada} onChange={(e) => setMarcaSeleccionada(e.target.value)}
            className="rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-slate-500 focus:outline-none">
            <option value="">Todas las marcas</option>
            <option value="SIN_MARCA">Sin marca ({sinMarcaCount})</option>
            {marcas.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {familias.length > 0 && (
          <div className="relative">
            <Tag size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <select value={familiaSeleccionada} onChange={(e) => setFamiliaSeleccionada(e.target.value)}
              className="rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-slate-500 focus:outline-none">
              <option value="">Todas las familias</option>
              <option value="SIN_FAMILIA">Sin familia</option>
              {familias.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
          </div>
        )}

        <button onClick={() => setSoloSinPrecio((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium
            ${soloSinPrecio ? "border-amber-400 bg-amber-50 text-amber-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
          <AlertTriangle size={14} /> Sin precio
        </button>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Código de barra</th>
              <th className="px-3 py-2">Stock</th>
              {COLUMNAS_PRECIO.map((c) => (
                <th key={c.campo} className="px-3 py-2 text-right">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={8} className="py-16 text-center text-slate-400">Cargando…</td></tr>
            ) : filas.length === 0 ? (
              <tr><td colSpan={8} className="py-16 text-center text-slate-400">Sin resultados.</td></tr>
            ) : (
              filas.map((f) => {
                const stockMapa = stockPorProducto.get(f.id);
                const stockTotal = stockMapa ? [...stockMapa.values()].reduce((s, v) => s + v, 0) : 0;
                const codigos = codigosPorProducto.get(f.id);
                const editando = editandoId === f.id;
                const guardando = guardandoId === f.id;
                const errorEstaFila = errorFila?.id === f.id ? errorFila.msg : null;

                return (
                  <tr key={f.id}
                    onBlur={editando ? onBlurFila : undefined}
                    className="border-b border-slate-100 align-top last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <p title={f.nombre} className="line-clamp-2 max-w-xs font-medium text-slate-800">{f.nombre}</p>
                      {f.marca && <p className="text-xs text-slate-400">{f.marca}</p>}
                      {guardando && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                          <Loader size={10} className="animate-spin" /> Guardando…
                        </p>
                      )}
                      {errorEstaFila && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-red-600">
                          <AlertTriangle size={10} /> {errorEstaFila}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{f.sku_interno || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{codigos?.barra || "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      <p className="flex items-center gap-1 font-medium text-slate-800">
                        <Boxes size={11} className="text-slate-400" /> {cantidadFmt(stockTotal)}
                      </p>
                      <p className="text-slate-400">
                        {SUCURSAL_LABELS[1]} {cantidadFmt(stockMapa?.get(1) || 0)} · {SUCURSAL_LABELS[2]} {cantidadFmt(stockMapa?.get(2) || 0)}
                      </p>
                    </td>
                    {COLUMNAS_PRECIO.map((c) => (
                      <td key={c.campo} className="px-3 py-2 text-right">
                        {editando ? (
                          <input type="number" min="0" step="0.01" autoFocus={c.campo === "precio_base"}
                            value={valoresEdicion[c.campo]}
                            onChange={(e) => setValoresEdicion((prev) => ({ ...prev, [c.campo]: e.target.value }))}
                            onKeyDown={onKeyDownCelda}
                            className="w-24 rounded-lg border border-blue-300 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                        ) : (
                          <button onClick={() => empezarEdicion(f)} disabled={!esAdmin}
                            className={`w-24 rounded-lg px-2 py-1 text-right ${esAdmin ? "hover:bg-slate-100" : "cursor-default"}
                              ${f[c.campo] === 0 ? "text-amber-600 font-medium" : f[c.campo] == null ? "text-slate-300" : "text-slate-800"}`}>
                            {f[c.campo] == null ? "—" : precioFmt(f[c.campo])}
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPaginas > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            Anterior
          </button>
          <span className="text-sm text-slate-500">Página {pagina + 1} de {totalPaginas}</span>
          <button onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))} disabled={pagina >= totalPaginas - 1}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
