import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import { metaProducto } from "./lib/producto";
import { sanearFiltro } from "./lib/filtroTexto";
import { fetchAll } from "./lib/fetchAll";
import { useSucursal } from "./lib/useSucursal";
import { useAppNav } from "./lib/useAppNav";
import { resumenATarjetas, nivelAlerta } from "./lib/inventario";
import { controlEfectivo, clasificarFila, progresoSurtido } from "./lib/control";
import {
  Boxes, Package, DollarSign, AlertTriangle, PackageX, Search,
  ArrowUpDown, ArrowUp, ArrowDown, MapPin, SlidersHorizontal, ImageOff, ScanLine, ClipboardList, X,
} from "lucide-react";

const UMBRAL_STORAGE_KEY = "wms_umbral_default";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function precioFmt(v) {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" }).format(v);
}
function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
function etiquetaUbicacion(zona, estante, nivel, compartimiento) {
  const partes = [zona];
  if (estante && nivel) partes.push(`${estante} ${nivel}`);
  else if (estante) partes.push(estante);
  if (compartimiento) partes.push(compartimiento);
  return partes.join(" › ");
}

// Agrupa filas (producto×ubicación) por familia, preservando el orden de
// aparición. Solo aporta un encabezado cuando 2+ productos distintos de la
// misma familia están presentes en las filas dadas — si el filtro/búsqueda
// deja a un solo integrante visible, ese grupo queda "suelto" (sin encabezado).
function agruparPorFamilia(filas, mapaFamilia) {
  const grupos = new Map();
  const orden = [];
  for (const f of filas) {
    const fam = mapaFamilia.get(f.producto_id);
    const key = fam?.familia_id ?? `p:${f.producto_id}`;
    if (!grupos.has(key)) {
      grupos.set(key, { familia_id: fam?.familia_id ?? null, familia_nombre: fam?.familia_nombre ?? null, filas: [], productoIds: new Set() });
      orden.push(key);
    }
    const g = grupos.get(key);
    g.filas.push(f);
    g.productoIds.add(f.producto_id);
  }
  return orden.map(k => grupos.get(k));
}

const ETIQUETA_CAMPO = {
  producto_nombre: "Producto",
  codigo_zona: "Ubicación",
  cantidad_base: "Cantidad",
  valor_linea: "Valor",
};

// Brief W3 #1: la cantidad ya no alcanza sola — hay que decir de qué tipo
// de número se trata. Un negativo en control libre es información (lo
// vendido desde que empezó el modo libre), nunca se pinta como error.
function CeldaCantidad({ f, estado, bajo }) {
  const n = Number(f.cantidad_base);
  const texto = `${cantidadFmt(n)} ${f.unidad_base}`;

  if (estado === "estricto_cero") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
        <PackageX size={11} /> {texto}
      </span>
    );
  }
  if (estado === "libre_negativo") {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        title="Se vendieron unidades desde que empezó el control libre. Al contar, este número se resuelve."
      >
        <span className="font-medium text-slate-700">{texto}</span>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">vendido sin contar</span>
      </span>
    );
  }
  if (estado === "libre_sin_inventariar") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-medium text-slate-700">{texto}</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">sin inventariar</span>
      </span>
    );
  }
  // estricto_stock
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`font-medium ${bajo ? "text-amber-700" : "text-slate-700"}`}>
        {bajo && <AlertTriangle size={11} className="mr-1 inline" />}
        {texto}
      </span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">estricto</span>
    </span>
  );
}

function FilaInventario({ f, estado, bajo, onContar }) {
  return (
    <tr className={bajo || estado === "estricto_cero" ? "is-alert" : ""}>
      <td className="cation-sticky-product px-3 py-2.5">
        <div className="flex items-center gap-2">
          {f.imagen_url
            ? <img src={f.imagen_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
            : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100"><ImageOff size={13} className="text-slate-300" /></div>}
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800" title={f.producto_nombre}>{f.producto_nombre}</p>
            {metaProducto({ marca: f.marca, sku_interno: f.sku_interno }) && (
              <p className="truncate text-xs text-slate-400">
                {metaProducto({ marca: f.marca, sku_interno: f.sku_interno })}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-1 text-slate-600">
          <MapPin size={12} className="text-slate-400" />
          {etiquetaUbicacion(f.codigo_zona, f.estante, f.nivel, f.compartimiento)}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        <CeldaCantidad f={f} estado={estado} bajo={bajo} />
      </td>
      <td className="px-3 py-2.5 text-right font-medium text-slate-700 tabular-nums">
        {precioFmt(f.valor_linea)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <button onClick={onContar} aria-label={`Contar ${f.producto_nombre}`}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <ClipboardList size={12} /> Contar
        </button>
      </td>
    </tr>
  );
}

function TarjetaResumen({ icono: Icono, etiqueta, valor, sub, acento = "slate" }) {
  const acentos = {
    slate: "text-slate-400",
    emerald: "text-emerald-500",
    amber: "text-amber-500",
    red: "text-red-500",
  };
  return (
    <div className={`glass-metric glass-metric-${acento}`}>
      <div className="glass-metric-icon"><Icono size={20} className={acentos[acento]} /></div>
      <div>
        <span className="glass-metric-label">{etiqueta}</span>
        <p className="glass-metric-value">{valor}</p>
        {sub && <p className="glass-metric-sub">{sub}</p>}
      </div>
    </div>
  );
}

function ThOrden({ campo, children, className = "", orden, alternarOrden }) {
  return (
    <th scope="col" aria-sort={orden.campo === campo ? (orden.asc ? "ascending" : "descending") : "none"}
      className={`px-3 py-2 text-left ${campo === "producto_nombre" ? "cation-sticky-product" : ""} ${className}`}>
      <button onClick={() => alternarOrden(campo)}
        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800">
        {children}
        {orden.campo === campo
          ? (orden.asc ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)
          : <ArrowUpDown size={11} className="text-slate-300" aria-hidden="true" />}
      </button>
    </th>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function InventarioApp() {
  const { sucursalActivaId, sucursalActiva, nombreSucursal } = useSucursal();
  const { irAConteo } = useAppNav();
  const [resumen, setResumen] = useState(null);
  const [filas, setFilas] = useState([]);
  // producto_id -> {familia_id, familia_nombre, stockMin, controlStock}
  const [mapaProducto, setMapaProducto] = useState(new Map());
  const [progreso, setProgreso] = useState(null); // {inventariados, total, pct} — solo en sucursales LIBRE
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  // Umbral por defecto para productos sin stock_min propio — persiste entre
  // sesiones porque, a diferencia de stock_min, es una preferencia de la
  // persona que mira la pantalla, no un dato del producto.
  const [umbralDefault, setUmbralDefault] = useState(() => {
    if (typeof localStorage === "undefined") return 5;
    const guardado = Number(localStorage.getItem(UMBRAL_STORAGE_KEY));
    return guardado > 0 ? guardado : 5;
  });
  const [orden, setOrden] = useState({ campo: "producto_nombre", asc: true });
  const [filtroAlerta, setFiltroAlerta] = useState("todos"); // todos | bajo | cero
  const [showScanner, setShowScanner] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(UMBRAL_STORAGE_KEY, String(umbralDefault)); } catch { /* localStorage no disponible */ }
  }, [umbralDefault]);

  const handleScan = useCallback(async (codigo) => {
    setShowScanner(false);
    // eslint-disable-next-line no-control-regex
    const code = (codigo || "").trim().replace(/[\x00-\x1F\x7F]/g, "");
    if (!code) return;
    const { data, error } = await supabase.rpc("resolver_identificador", { p_codigo: code });
    if (error) { console.error("resolver_identificador:", error); return; }
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    if (rows.length === 0) return;
    const { data: pres } = await supabase
      .from("presentacion")
      .select("producto:producto_id(nombre)")
      .eq("id", rows[0].presentacion_id)
      .single();
    if (pres?.producto?.nombre) setBusqueda(pres.producto.nombre);
  }, []);

  // Resumen de la sucursal activa: una lectura de v_inventario_resumen (2
  // filas en toda la vista), nada de sumar filas de detalle en el navegador.
  const cargarResumen = useCallback(async () => {
    if (!sucursalActivaId) return;
    const { data, error } = await supabase
      .from("v_inventario_resumen")
      .select("*")
      .eq("sucursal_id", sucursalActivaId)
      .maybeSingle();
    if (error) { console.error("cargarResumen falló:", error); setResumen(null); return; }
    setResumen(resumenATarjetas(data));
  }, [sucursalActivaId]);

  // Banner de progreso (brief W3 #2): solo tiene sentido en sucursales con
  // control_stock_default LIBRE — en ESTRICTO no hay migración gradual que
  // mostrar. count(*) con head:true, no se traen las filas para contarlas
  // (mismo criterio que corrigió el resumen de inventario en W2).
  const cargarProgreso = useCallback(async () => {
    if (!sucursalActivaId || sucursalActiva?.control_stock_default !== "LIBRE") { setProgreso(null); return; }
    const [{ count: total, error: e1 }, { count: inventariados, error: e2 }] = await Promise.all([
      supabase.from("producto_sucursal").select("producto_id", { count: "exact", head: true })
        .eq("sucursal_id", sucursalActivaId).eq("se_vende", true),
      supabase.from("producto_sucursal").select("producto_id", { count: "exact", head: true })
        .eq("sucursal_id", sucursalActivaId).eq("se_vende", true).eq("control_stock", "ESTRICTO"),
    ]);
    if (e1 || e2) { console.error("cargarProgreso falló:", e1 || e2); setProgreso(null); return; }
    setProgreso(progresoSurtido(inventariados, total));
  }, [sucursalActivaId, sucursalActiva]);

  // Tabla detallada (producto × ubicación con stock) de la sucursal activa.
  // Decisión anotada (brief W2 #4): Almacén tiene 1.228 filas hoy, por
  // encima del límite de 1.000 de PostgREST — se usa fetchAll (aceptable a
  // este tamaño) en vez de paginación real. Si el volumen crece de forma
  // sostenida, pasar a .range() con scroll/paginado en la UI.
  const cargarFilas = useCallback(async () => {
    if (!sucursalActivaId) return;
    setCargando(true);
    const textoBusqueda = sanearFiltro(busqueda);
    const construirQuery = () => {
      let q = supabase.from("v_inventario_detalle").select("*").eq("sucursal_id", sucursalActivaId);
      if (textoBusqueda) q = q.or(`producto_nombre.ilike.%${textoBusqueda}%,sku_interno.ilike.%${textoBusqueda}%,marca.ilike.%${textoBusqueda}%`);
      q = q.order(orden.campo, { ascending: orden.asc });
      // Desempate estable para que fetchAll no repita/salte filas entre páginas.
      if (orden.campo !== "producto_id") q = q.order("producto_id", { ascending: true });
      return q;
    };

    let lista = [];
    try {
      lista = await fetchAll(construirQuery);
    } catch (e) {
      console.error("cargarFilas (inventario) falló:", e);
    }
    setFilas(lista);

    // Mapa liviano producto_id -> {familia, stockMin, controlStock}, solo
    // para agrupar visualmente y resolver el estado de control por fila (no
    // altera v_inventario_detalle ni el orden/filtrado de las filas).
    // stock_min sale de producto_sucursal (brief W3 #5) — producto.stock_min
    // quedó huérfano (sigue NULL en todo el catálogo), no se usa más acá.
    const ids = [...new Set(lista.map(f => f.producto_id))];
    if (ids.length > 0) {
      const [{ data: prods }, { data: ps }] = await Promise.all([
        supabase.from("producto").select("id, familia_id, familia:familia_id(nombre)").in("id", ids),
        supabase.from("producto_sucursal").select("producto_id, stock_min, control_stock")
          .eq("sucursal_id", sucursalActivaId).in("producto_id", ids),
      ]);
      const mapaPs = new Map((ps || []).map(p => [p.producto_id, p]));
      const mapa = new Map(
        (prods || []).map(p => {
          const psRow = mapaPs.get(p.id);
          return [p.id, {
            familia_id: p.familia_id,
            familia_nombre: p.familia?.nombre,
            stockMin: psRow?.stock_min ?? null,
            controlStock: psRow?.control_stock ?? null,
          }];
        })
      );
      setMapaProducto(mapa);
    } else {
      setMapaProducto(new Map());
    }

    setCargando(false);
  }, [busqueda, orden, sucursalActivaId]);

  useEffect(() => {
    // Sincroniza con Supabase (sistema externo), no deriva estado de React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    cargarResumen();
    cargarProgreso();
  }, [cargarResumen, cargarProgreso]);
  useEffect(() => {
    const t = setTimeout(cargarFilas, 300);
    return () => clearTimeout(t);
  }, [cargarFilas]);

  function alternarOrden(campo) {
    setOrden(o => o.campo === campo ? { campo, asc: !o.asc } : { campo, asc: true });
  }

  const defaultControl = sucursalActiva?.control_stock_default || "ESTRICTO";

  // Estado de control por fila (brief W3 #1): producto_sucursal.control_stock
  // pisa el default de la sucursal; null hereda.
  const estadoFila = useCallback(
    (f) => clasificarFila(f.cantidad_base, controlEfectivo(mapaProducto.get(f.producto_id)?.controlStock ?? null, defaultControl)),
    [mapaProducto, defaultControl]
  );

  // "Bajo mínimo" solo tiene sentido sobre un número confiable (estricto) —
  // comparar un negativo o un "sin inventariar" contra un mínimo no dice nada.
  const bajoFila = useCallback(
    (f) => estadoFila(f) === "estricto_stock"
      && nivelAlerta(f.cantidad_base, mapaProducto.get(f.producto_id)?.stockMin, umbralDefault) === "bajo",
    [estadoFila, mapaProducto, umbralDefault]
  );

  // Aplicar filtro de alerta sobre las filas cargadas
  const filasFiltradas = filas.filter(f => {
    if (filtroAlerta === "cero") return estadoFila(f) === "estricto_cero";
    if (filtroAlerta === "bajo") return bajoFila(f);
    return true;
  });

  // "Necesitan atención" ya no suma con el número global de v_producto_stock
  // (mezclaba sucursales y productos inactivos) — enCero sale de
  // v_inventario_resumen; bajo se cuenta acá porque depende de stock_min por
  // producto, algo que la vista de resumen no calcula.
  const bajoCount = useMemo(
    () => filas.filter(f => bajoFila(f)).length,
    [filas, bajoFila]
  );
  const alertas = useMemo(
    () => filas.filter(f => estadoFila(f) === "estricto_cero" || bajoFila(f)).slice(0, 5),
    [filas, estadoFila, bajoFila]
  );

  // El agrupamiento por familia solo tiene sentido con el orden por defecto
  // (Producto) — con cualquier otro criterio se desactiva para no producir
  // un agrupamiento incoherente con el orden pedido.
  const agrupando = orden.campo === "producto_nombre";
  const bloques = agrupando ? agruparPorFamilia(filasFiltradas, mapaProducto) : null;

  return (
    <div className="glass-inventory mx-auto max-w-7xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Estado de inventario</h2>
          <p className="text-sm text-slate-500">
            Stock en {nombreSucursal(sucursalActivaId) || "…"}
          </p>
        </div>
        {/* Ajuste de umbral por defecto */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
          <SlidersHorizontal size={14} className="text-slate-400" />
          <label htmlFor="inventario-umbral" className="text-xs text-slate-500">Umbral por defecto (para productos sin mínimo definido)</label>
          <input
            id="inventario-umbral" type="number" min={0} value={umbralDefault}
            onChange={e => setUmbralDefault(Math.max(0, Number(e.target.value)))}
            className="w-14 rounded border border-slate-300 px-2 py-0.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Resumen */}
      {resumen && (
        <div className="glass-metrics mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <TarjetaResumen icono={Package} etiqueta="Productos con stock"
            valor={resumen.totalProductos} acento="slate" />
          <TarjetaResumen icono={Boxes} etiqueta="Unidades en stock"
            valor={cantidadFmt(resumen.totalUnidades)} acento="emerald" />
          <TarjetaResumen icono={DollarSign} etiqueta="Valor del inventario"
            valor={precioFmt(resumen.valorTotal)} acento="emerald" />
          <TarjetaResumen icono={AlertTriangle} etiqueta="Necesitan atención"
            valor={resumen.enCero + bajoCount}
            sub={`${resumen.enCero} en cero · ${bajoCount} bajo`}
            acento={resumen.enCero + bajoCount > 0 ? "amber" : "slate"} />
        </div>
      )}

      {/* Banner de progreso — solo en sucursales con control_stock_default LIBRE (brief W3 #2) */}
      {progreso && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{nombreSucursal(sucursalActivaId)} en control libre</span>
            {" — se puede vender sin stock. Cada producto que contás pasa a control estricto por su cuenta."}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-amber-100">
              <div className="h-full rounded-full bg-amber-500" style={{ width: `${progreso.pct}%` }} />
            </div>
            <span className="whitespace-nowrap text-xs font-medium text-amber-700">
              {progreso.inventariados} de {progreso.total} contados
            </span>
          </div>
        </div>
      )}

      {showScanner && <EscanerCodigo onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      <div className="glass-inventory-layout">
      <section className="min-w-0" aria-label="Inventario actual">
      {/* Controles tabla */}
      <div className="cation-filters mb-3 flex flex-wrap items-center gap-2">
        <div className="cation-filter-search relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            aria-label="Buscar en inventario"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleScan(e.target.value); } }}
            placeholder="Buscar por nombre, SKU o código de barras…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-10 text-sm focus:border-slate-500 focus:outline-none"
          />
          {busqueda && <button type="button" onClick={() => setBusqueda("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Limpiar búsqueda"><X size={15} /></button>}
        </div>
        <button onClick={() => setShowScanner(true)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
          <ScanLine size={15} /> Escanear
        </button>
        {/* Filtros de alerta */}
        <div className="flex rounded-lg border border-slate-300 p-0.5 text-sm">
          {[
            { id: "todos", label: "Todos" },
            { id: "bajo",  label: "Stock bajo" },
            { id: "cero",  label: "En cero" },
          ].map(f => (
            <button key={f.id} onClick={() => setFiltroAlerta(f.id)} aria-pressed={filtroAlerta === f.id}
              className={`rounded px-3 py-1.5 font-medium
                ${filtroAlerta === f.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Aviso: agrupamiento por familia desactivado con este orden */}
      {!agrupando && !cargando && filasFiltradas.length > 0 && (
        <p className="mb-2 text-xs text-slate-400">
          Orden por {ETIQUETA_CAMPO[orden.campo] || orden.campo} — vista sin agrupar.
        </p>
      )}

      {/* Tabla */}
      <div className="cation-table-card">
        <div className="cation-table-toolbar"><div><strong>Inventario actual</strong><span>{cargando ? "Cargando…" : `${filasFiltradas.length} líneas visibles`}</span></div></div>
        <div className="cation-table-scroll" tabIndex={0} aria-label="Tabla de inventario, desplázate horizontalmente para ver todas las columnas">
          <table className="cation-data-table cation-table-estado w-full text-sm">
            <caption className="sr-only">Estado del inventario por producto y ubicación</caption>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <ThOrden campo="producto_nombre" orden={orden} alternarOrden={alternarOrden}>Producto</ThOrden>
                <ThOrden campo="codigo_zona" orden={orden} alternarOrden={alternarOrden}>Ubicación</ThOrden>
                <ThOrden campo="cantidad_base" className="text-right" orden={orden} alternarOrden={alternarOrden}>Cantidad</ThOrden>
                <ThOrden campo="valor_linea" className="text-right" orden={orden} alternarOrden={alternarOrden}>Valor</ThOrden>
                <th scope="col" className="px-3 py-2 text-right"><span className="sr-only">Acciones</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : filasFiltradas.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">
                  {filas.length === 0
                    ? "Sin stock registrado todavía. Aparecerá al hacer los primeros conteos."
                    : "No hay filas que coincidan con el filtro."}
                </td></tr>
              ) : agrupando ? (
                bloques.map(g => (
                  <Fragment key={g.familia_id ?? `p:${g.filas[0].producto_id}`}>
                    {g.productoIds.size > 1 && (
                        <tr className="cation-family-row bg-slate-50">
                        <td colSpan={5} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {g.familia_nombre} <span className="font-normal normal-case text-slate-400">({g.productoIds.size} variantes)</span>
                        </td>
                      </tr>
                    )}
                    {g.filas.map(f => (
                      <FilaInventario key={`${f.producto_id}-${f.ubicacion_id}`} f={f} estado={estadoFila(f)} bajo={bajoFila(f)}
                        onContar={() => irAConteo({ productoId: f.producto_id, ubicacionId: f.ubicacion_id })} />
                    ))}
                  </Fragment>
                ))
              ) : (
                filasFiltradas.map(f => (
                  <FilaInventario key={`${f.producto_id}-${f.ubicacion_id}`} f={f} estado={estadoFila(f)} bajo={bajoFila(f)}
                    onContar={() => irAConteo({ productoId: f.producto_id, ubicacionId: f.ubicacion_id })} />
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="cation-table-hint">Desliza para ver las demás columnas →</p>
      </div>

      {!cargando && filasFiltradas.length > 0 && (
        <p className="mt-3 text-right text-xs text-slate-400">
          {!busqueda && resumen && filas.length < resumen.filasDetalle
            ? `${filas.length} de ${resumen.filasDetalle} líneas mostradas — hay más`
            : `${filasFiltradas.length} líneas mostradas`}
        </p>
      )}
      </section>
      <aside className="glass-alert-panel" aria-label="Alertas de inventario">
        <div className="glass-alert-heading">
          <span className="glass-alert-symbol"><AlertTriangle size={19} /></span>
          <div><h3>Necesitan atención</h3><p>Productos para revisar hoy</p></div>
        </div>
        <div className="glass-alert-totals">
          <button type="button" onClick={() => setFiltroAlerta("cero")} aria-pressed={filtroAlerta === "cero"}><strong>{resumen?.enCero ?? 0}</strong><span>En cero</span></button>
          <button type="button" onClick={() => setFiltroAlerta("bajo")} aria-pressed={filtroAlerta === "bajo"}><strong>{bajoCount}</strong><span>Stock bajo</span></button>
        </div>
        {alertas.length ? (
          <div className="glass-alert-list">
            {alertas.map(f => {
              const cero = estadoFila(f) === "estricto_cero";
              return <button type="button" key={`${f.producto_id}-${f.ubicacion_id}`}
                onClick={() => { setBusqueda(f.producto_nombre); setFiltroAlerta("todos"); }}
                title={`Ver ${f.producto_nombre} en inventario`}>
                <span className={`glass-alert-dot ${cero ? "is-zero" : ""}`} />
                <span className="glass-alert-copy"><strong>{f.producto_nombre}</strong><small>{f.codigo_zona || "Sin ubicación"}</small></span>
                <span className="glass-alert-amount">{cero ? "En cero" : `${cantidadFmt(f.cantidad_base)} ${f.unidad_base}`}</span>
              </button>;
            })}
          </div>
        ) : <p className="glass-alert-empty">{cargando ? "Cargando alertas…" : "Sin alertas en el inventario cargado."}</p>}
      </aside>
      </div>
    </div>
  );
}
