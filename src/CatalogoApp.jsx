import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import {
  Search, LayoutGrid, List, Package, X, Tag, MapPin, Barcode,
  Link2, Link2Off, ImageOff, Filter, ChevronRight, Boxes, History, Pencil
} from "lucide-react";
import { HistorialMovimientos } from "./HistorialApp";
import EditarProducto, { CarruselPrecios } from "./EditarProducto";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function precioFmt(v) {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" }).format(v);
}

function etiquetaUbicacion(u) {
  if (!u) return "—";
  const partes = [u.codigo_zona];
  if (u.estante && u.nivel) partes.push(`${u.estante} ${u.nivel}`);
  else if (u.estante) partes.push(u.estante);
  if (u.compartimiento) partes.push(u.compartimiento);
  return partes.join(" › ");
}

// Formatea cantidad sin decimales innecesarios (5.0000 -> 5, 2.5000 -> 2.5)
function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

// Badge de stock: gris si 0, ámbar si bajo (<=5), verde si hay
function BadgeStock({ cantidad, unidad }) {
  const n = Number(cantidad || 0);
  const estilo = n === 0
    ? "bg-slate-100 text-slate-400"
    : n <= 5
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";
  return (
    <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${estilo}`}
      title={`${cantidadFmt(n)} ${unidad || "u"} en stock`}>
      <Boxes size={11} /> {cantidadFmt(n)}
    </span>
  );
}

// Imagen con fallback a placeholder
function ImagenProducto({ url, nombre, className }) {
  const [error, setError] = useState(false);
  if (!url || error) {
    return (
      <div className={`flex items-center justify-center bg-slate-100 ${className}`}>
        <ImageOff size={20} className="text-slate-300" />
      </div>
    );
  }
  return (
    <img src={url} alt={nombre} onError={() => setError(true)}
      className={`object-cover ${className}`} loading="lazy" />
  );
}

// ─── Panel de detalle ────────────────────────────────────────────────────────

function DetalleProducto({ producto, onClose, onActualizado }) {
  const [detalle, setDetalle] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [vistaPanel, setVistaPanel] = useState("detalle"); // "detalle" | "historial"
  const [editando, setEditando] = useState(false);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      setCargando(true);
      // Atributos
      const { data: atribs } = await supabase
        .from("producto_atributo")
        .select("atributo_valor:atributo_valor_id(valor, atributo:atributo_id(nombre))")
        .eq("producto_id", producto.id);
      // Ubicaciones
      const { data: ubics } = await supabase
        .from("producto_ubicacion")
        .select("es_principal, ubicacion:ubicacion_id(codigo_zona, estante, nivel, compartimiento)")
        .eq("producto_id", producto.id)
        .order("es_principal", { ascending: false });
      // Identificadores (vía presentaciones del producto)
      const { data: pres } = await supabase
        .from("presentacion")
        .select("id, nombre, factor_unidad_base, es_base, identificador(valor, tipo)")
        .eq("producto_id", producto.id);
      // Stock por ubicación
      const { data: stock } = await supabase
        .from("stock_actual")
        .select("cantidad_base, ubicacion:ubicacion_id(codigo_zona, estante, nivel, compartimiento)")
        .eq("producto_id", producto.id);

      if (activo) {
        setDetalle({
          atributos: atribs || [],
          ubicaciones: ubics || [],
          presentaciones: pres || [],
          stock: stock || [],
        });
        setCargando(false);
      }
    }
    cargar();
    return () => { activo = false; };
  }, [producto.id]);

  const mapeado = !!producto.shopify_variant_id;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* Header con imagen */}
        <div className="relative">
          <ImagenProducto url={producto.imagen_url} nombre={producto.nombre}
            className="h-56 w-full" />
          <div className="absolute right-3 top-3 flex gap-2">
            <button onClick={() => setEditando(true)}
              className="flex items-center gap-1 rounded-full bg-white/90 px-3 py-2 text-sm font-medium text-slate-700 shadow hover:bg-white"
              title="Editar producto">
              <Pencil size={15} /> Editar
            </button>
            <button onClick={onClose}
              className="rounded-full bg-white/90 p-2 text-slate-600 shadow hover:bg-white">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">{producto.nombre}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {producto.sku_interno && (
                <span className="text-sm text-slate-500">SKU: {producto.sku_interno}</span>
              )}
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium
                ${mapeado ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                {mapeado ? <Link2 size={11} /> : <Link2Off size={11} />}
                {mapeado ? "En Shopify" : "Sin mapear"}
              </span>
            </div>
          </div>

          <div className="mb-5">
            <CarruselPrecios producto={producto} />
          </div>

          {/* Subtabs: Detalle / Movimientos */}
          <div className="mb-5 flex gap-1 rounded-lg bg-slate-100 p-1">
            <button onClick={() => setVistaPanel("detalle")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium
                ${vistaPanel === "detalle" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
              <Package size={14} /> Detalle
            </button>
            <button onClick={() => setVistaPanel("historial")}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium
                ${vistaPanel === "historial" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
              <History size={14} /> Movimientos
            </button>
          </div>

          {vistaPanel === "historial" ? (
            <HistorialMovimientos productoId={producto.id} compacto />
          ) : (
          <>
          {/* Stock total destacado */}
          {!cargando && (
            <div className="mb-5 flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <Boxes size={20} className="text-slate-400" />
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Stock total</p>
                <p className="text-lg font-bold text-slate-900">
                  {cantidadFmt(detalle.stock.reduce((s, r) => s + Number(r.cantidad_base || 0), 0))}
                  <span className="ml-1 text-sm font-normal text-slate-400">{producto.unidad_base}</span>
                </p>
              </div>
            </div>
          )}

          {cargando ? (
            <p className="text-sm text-slate-400">Cargando detalle…</p>
          ) : (
            <div className="space-y-5">
              {/* Atributos */}
              {detalle.atributos.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <Tag size={12} /> Atributos
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {detalle.atributos.map((a, i) => (
                      <span key={i} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                        <span className="text-slate-400">{a.atributo_valor?.atributo?.nombre}: </span>
                        {a.atributo_valor?.valor}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Presentaciones e identificadores */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Package size={12} /> Presentaciones
                </h3>
                <div className="space-y-2">
                  {detalle.presentaciones.map((p, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-800">
                          {p.nombre} {p.es_base && <span className="text-xs text-slate-400">(base)</span>}
                        </span>
                        <span className="text-xs text-slate-500">×{p.factor_unidad_base}</span>
                      </div>
                      {p.identificador?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {p.identificador.map((id, j) => (
                            <span key={j} className="flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500">
                              <Barcode size={10} />
                              {id.valor}
                              <span className="text-slate-300">({id.tipo})</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Ubicaciones con su stock */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <MapPin size={12} /> Stock por ubicación
                </h3>
                {detalle.stock.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Sin stock registrado todavía. Aparecerá al hacer el primer conteo.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {detalle.stock.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                        <MapPin size={13} className="text-slate-400" />
                        <span className="flex-1 text-slate-700">{etiquetaUbicacion(s.ubicacion)}</span>
                        <span className="font-semibold text-slate-900">
                          {cantidadFmt(s.cantidad_base)}
                          <span className="ml-1 text-xs font-normal text-slate-400">{producto.unidad_base}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Ubicaciones asignadas sin stock (para saber dónde debería ir) */}
                {detalle.ubicaciones.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-xs text-slate-400">Ubicaciones asignadas:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detalle.ubicaciones.map((u, i) => (
                        <span key={i} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          <MapPin size={10} className={u.es_principal ? "text-slate-700" : "text-slate-400"} />
                          {etiquetaUbicacion(u.ubicacion)}
                          {u.es_principal && <span className="text-slate-400">·principal</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {editando && (
        <EditarProducto
          producto={producto}
          onClose={() => setEditando(false)}
          onGuardado={() => { onActualizado?.(); }}
        />
      )}
    </div>
  );
}

// ─── Tarjeta galería ─────────────────────────────────────────────────────────

function TarjetaGaleria({ p, onClick }) {
  const mapeado = !!p.shopify_variant_id;
  return (
    <button onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition-shadow hover:shadow-md">
      <div className="relative aspect-square w-full overflow-hidden">
        <ImagenProducto url={p.imagen_url} nombre={p.nombre}
          className="h-full w-full transition-transform group-hover:scale-105" />
        {!mapeado && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5 text-xs font-medium text-white">
            <Link2Off size={10} /> Sin mapear
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <p className="line-clamp-2 text-sm font-medium text-slate-800">{p.nombre}</p>
        {p.sku_interno && <p className="mt-0.5 text-xs text-slate-400">{p.sku_interno}</p>}
        <div className="mt-auto flex items-center justify-between pt-2">
          <p className="text-sm font-bold text-slate-900">{precioFmt(p.precio_base)}</p>
          <BadgeStock cantidad={p.stock_total} unidad={p.unidad_base} />
        </div>
      </div>
    </button>
  );
}

// ─── Fila lista ──────────────────────────────────────────────────────────────

function FilaLista({ p, onClick }) {
  const mapeado = !!p.shopify_variant_id;
  return (
    <button onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 hover:bg-slate-50">
      <ImagenProducto url={p.imagen_url} nombre={p.nombre}
        className="h-11 w-11 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{p.nombre}</p>
        {p.sku_interno && <p className="truncate text-xs text-slate-400">{p.sku_interno}</p>}
      </div>
      {!mapeado && <Link2Off size={14} className="shrink-0 text-slate-300" />}
      <BadgeStock cantidad={p.stock_total} unidad={p.unidad_base} />
      <span className="shrink-0 text-sm font-semibold text-slate-900">{precioFmt(p.precio_base)}</span>
      <ChevronRight size={15} className="shrink-0 text-slate-300" />
    </button>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

const PAGINA = 40;

export default function CatalogoApp() {
  const [vista, setVista] = useState("galeria");   // "galeria" | "lista"
  const [busqueda, setBusqueda] = useState("");
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [seleccionado, setSeleccionado] = useState(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);

  // Filtro por atributo
  const [atributos, setAtributos] = useState([]);
  const [filtroValorId, setFiltroValorId] = useState("");

  const debounceRef = useRef(null);

  // Cargar lista de valores de atributo para el filtro
  useEffect(() => {
    supabase
      .from("atributo_valor")
      .select("id, valor, atributo:atributo_id(nombre)")
      .order("valor")
      .then(({ data }) => setAtributos(data || []));
  }, []);

  const cargar = useCallback(async (q, valorId, pag) => {
    setCargando(true);

    // Si hay filtro de atributo, primero traemos los producto_id que lo tienen
    let idsFiltro = null;
    if (valorId) {
      const { data } = await supabase
        .from("producto_atributo")
        .select("producto_id")
        .eq("atributo_valor_id", valorId);
      idsFiltro = (data || []).map(r => r.producto_id);
      if (idsFiltro.length === 0) {
        setProductos([]); setTotal(0); setCargando(false); return;
      }
    }

    let query = supabase
      .from("producto")
      .select("id, nombre, sku_interno, marca, unidad_base, precio_base, precio_mayoreo, precio_institucion, shopify_variant_id, imagen_url", { count: "exact" })
      .eq("activo", true);

    if (q.trim()) query = query.or(`nombre.ilike.%${q.trim()}%,sku_interno.ilike.%${q.trim()}%`);
    if (idsFiltro) query = query.in("id", idsFiltro);

    query = query.order("nombre").range(pag * PAGINA, pag * PAGINA + PAGINA - 1);

    const { data, count } = await query;
    const lista = data || [];

    // Stock total de esta página desde la vista pre-agregada
    if (lista.length > 0) {
      const ids = lista.map(p => p.id);
      const { data: stocks } = await supabase
        .from("v_producto_stock")
        .select("producto_id, stock_total")
        .in("producto_id", ids);
      const mapaStock = new Map((stocks || []).map(s => [s.producto_id, s.stock_total]));
      for (const p of lista) p.stock_total = mapaStock.get(p.id) ?? 0;
    }

    setProductos(lista);
    setTotal(count || 0);
    setCargando(false);
  }, []);

  // Buscar con debounce / resetear página al cambiar filtros
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPagina(0);
      cargar(busqueda, filtroValorId, 0);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [busqueda, filtroValorId, cargar]);

  // Cambio de página
  useEffect(() => {
    cargar(busqueda, filtroValorId, pagina);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina]);

  const totalPaginas = Math.ceil(total / PAGINA);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-slate-800">Catálogo</h1>
        <p className="text-sm text-slate-500">{total} productos activos</p>
      </div>

      {/* Controles */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o SKU…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>

        {/* Filtro atributo */}
        <div className="relative">
          <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={filtroValorId}
            onChange={e => setFiltroValorId(e.target.value)}
            className="rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-slate-500 focus:outline-none">
            <option value="">Todos los atributos</option>
            {atributos.map(a => (
              <option key={a.id} value={a.id}>
                {a.atributo?.nombre}: {a.valor}
              </option>
            ))}
          </select>
        </div>

        {/* Toggle vista */}
        <div className="flex rounded-lg border border-slate-300 p-0.5">
          <button onClick={() => setVista("galeria")}
            className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium
              ${vista === "galeria" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            <LayoutGrid size={15} />
          </button>
          <button onClick={() => setVista("lista")}
            className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-sm font-medium
              ${vista === "lista" ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            <List size={15} />
          </button>
        </div>
      </div>

      {/* Resultados */}
      {cargando ? (
        <div className="py-16 text-center text-slate-400">Cargando productos…</div>
      ) : productos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <Package size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">No se encontraron productos con esos criterios.</p>
        </div>
      ) : vista === "galeria" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {productos.map(p => (
            <TarjetaGaleria key={p.id} p={p} onClick={() => setSeleccionado(p)} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {productos.map(p => (
            <FilaLista key={p.id} p={p} onClick={() => setSeleccionado(p)} />
          ))}
        </div>
      )}

      {/* Paginación */}
      {totalPaginas > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            onClick={() => setPagina(p => Math.max(0, p - 1))}
            disabled={pagina === 0}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            Anterior
          </button>
          <span className="text-sm text-slate-500">
            Página {pagina + 1} de {totalPaginas}
          </span>
          <button
            onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))}
            disabled={pagina >= totalPaginas - 1}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            Siguiente
          </button>
        </div>
      )}

      {/* Detalle */}
      {seleccionado && (
        <DetalleProducto
          producto={seleccionado}
          onClose={() => setSeleccionado(null)}
          onActualizado={() => { cargar(busqueda, filtroValorId, pagina); }}
        />
      )}
    </div>
  );
}
