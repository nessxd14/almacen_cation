import { useState, useEffect, useCallback, Fragment } from "react";
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import { metaProducto } from "./lib/producto";
import {
  Boxes, Package, DollarSign, AlertTriangle, PackageX, Search,
  ArrowUpDown, MapPin, SlidersHorizontal, ImageOff, ScanLine
} from "lucide-react";

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

function FilaInventario({ f, alerta }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {f.imagen_url
            ? <img src={f.imagen_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
            : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100"><ImageOff size={13} className="text-slate-300" /></div>}
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800">{f.producto_nombre}</p>
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
      <td className="px-3 py-2.5 text-right">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold
          ${alerta === "cero" ? "bg-slate-100 text-slate-400"
            : alerta === "bajo" ? "bg-amber-100 text-amber-700"
            : "bg-emerald-100 text-emerald-700"}`}>
          {alerta === "cero" && <PackageX size={11} />}
          {alerta === "bajo" && <AlertTriangle size={11} />}
          {cantidadFmt(f.cantidad_base)} {f.unidad_base}
        </span>
      </td>
      <td className="px-3 py-2.5 text-right font-medium text-slate-700">
        {precioFmt(f.valor_linea)}
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
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-1 flex items-center gap-2">
        <Icono size={15} className={acentos[acento]} />
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{etiqueta}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900">{valor}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function InventarioApp() {
  const [resumen, setResumen] = useState(null);
  const [filas, setFilas] = useState([]);
  const [mapaFamilia, setMapaFamilia] = useState(new Map()); // producto_id -> {familia_id, familia_nombre}
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [umbral, setUmbral] = useState(5);
  const [orden, setOrden] = useState({ campo: "producto_nombre", asc: true });
  const [filtroAlerta, setFiltroAlerta] = useState("todos"); // todos | bajo | cero
  const [showScanner, setShowScanner] = useState(false);

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

  // Resumen global (sobre TODO el catálogo, no solo lo filtrado)
  const cargarResumen = useCallback(async () => {
    // Total de productos activos
    const { count: totalProductos } = await supabase
      .from("producto").select("id", { count: "exact", head: true }).eq("activo", true);

    // Stock total por producto (incluye ceros vía la vista)
    const { data: stockPorProducto } = await supabase
      .from("v_producto_stock").select("producto_id, stock_total");

    // Valor total: traemos detalle (solo lo que tiene stock)
    const { data: detalle } = await supabase
      .from("v_inventario_detalle").select("cantidad_base, valor_linea");

    const totalUnidades = (detalle || []).reduce((s, r) => s + Number(r.cantidad_base || 0), 0);
    const valorTotal = (detalle || []).reduce((s, r) => s + Number(r.valor_linea || 0), 0);

    const enCero = (stockPorProducto || []).filter(s => Number(s.stock_total) === 0).length;
    const bajo = (stockPorProducto || []).filter(s => {
      const n = Number(s.stock_total);
      return n > 0 && n <= umbral;
    }).length;

    setResumen({
      totalProductos: totalProductos || 0,
      totalUnidades,
      valorTotal,
      enCero,
      bajo,
    });
  }, [umbral]);

  // Tabla detallada (producto × ubicación con stock)
  const cargarFilas = useCallback(async () => {
    setCargando(true);
    let query = supabase.from("v_inventario_detalle").select("*");
    if (busqueda.trim()) query = query.or(`producto_nombre.ilike.%${busqueda.trim()}%,sku_interno.ilike.%${busqueda.trim()}%,marca.ilike.%${busqueda.trim()}%`);
    query = query.order(orden.campo, { ascending: orden.asc });
    const { data } = await query.limit(1000);
    const lista = data || [];
    setFilas(lista);

    // Mapa liviano producto_id -> familia, solo para agrupar visualmente
    // (no altera v_inventario_detalle ni el orden/filtrado de las filas).
    const ids = [...new Set(lista.map(f => f.producto_id))];
    if (ids.length > 0) {
      const { data: prods } = await supabase
        .from("producto")
        .select("id, familia_id, familia:familia_id(nombre)")
        .in("id", ids);
      const mapa = new Map(
        (prods || [])
          .filter(p => p.familia_id != null)
          .map(p => [p.id, { familia_id: p.familia_id, familia_nombre: p.familia?.nombre }])
      );
      setMapaFamilia(mapa);
    } else {
      setMapaFamilia(new Map());
    }

    setCargando(false);
  }, [busqueda, orden]);

  useEffect(() => { cargarResumen(); }, [cargarResumen]);
  useEffect(() => {
    const t = setTimeout(cargarFilas, 300);
    return () => clearTimeout(t);
  }, [cargarFilas]);

  function alternarOrden(campo) {
    setOrden(o => o.campo === campo ? { campo, asc: !o.asc } : { campo, asc: true });
  }

  // Aplicar filtro de alerta sobre las filas cargadas
  const filasFiltradas = filas.filter(f => {
    const n = Number(f.cantidad_base);
    if (filtroAlerta === "cero") return n === 0;
    if (filtroAlerta === "bajo") return n > 0 && n <= umbral;
    return true;
  });

  function nivelAlerta(cantidad) {
    const n = Number(cantidad);
    if (n === 0) return "cero";
    if (n <= umbral) return "bajo";
    return "ok";
  }

  const ThOrden = ({ campo, children, className = "" }) => (
    <th className={`px-3 py-2 text-left ${className}`}>
      <button onClick={() => alternarOrden(campo)}
        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800">
        {children}
        <ArrowUpDown size={11} className={orden.campo === campo ? "text-slate-800" : "text-slate-300"} />
      </button>
    </th>
  );

  // El agrupamiento por familia solo tiene sentido con el orden por defecto
  // (Producto) — con cualquier otro criterio se desactiva para no producir
  // un agrupamiento incoherente con el orden pedido.
  const agrupando = orden.campo === "producto_nombre";
  const bloques = agrupando ? agruparPorFamilia(filasFiltradas, mapaFamilia) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Estado de inventario</h1>
          <p className="text-sm text-slate-500">Vista global del stock en el almacén</p>
        </div>
        {/* Ajuste de umbral */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
          <SlidersHorizontal size={14} className="text-slate-400" />
          <label className="text-xs text-slate-500">Stock bajo si ≤</label>
          <input
            type="number" min={0} value={umbral}
            onChange={e => setUmbral(Math.max(0, Number(e.target.value)))}
            className="w-14 rounded border border-slate-300 px-2 py-0.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Resumen */}
      {resumen && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <TarjetaResumen icono={Package} etiqueta="Productos activos"
            valor={resumen.totalProductos} acento="slate" />
          <TarjetaResumen icono={Boxes} etiqueta="Unidades en stock"
            valor={cantidadFmt(resumen.totalUnidades)} acento="emerald" />
          <TarjetaResumen icono={DollarSign} etiqueta="Valor del inventario"
            valor={precioFmt(resumen.valorTotal)} acento="emerald" />
          <TarjetaResumen icono={AlertTriangle} etiqueta="Necesitan atención"
            valor={resumen.enCero + resumen.bajo}
            sub={`${resumen.enCero} en cero · ${resumen.bajo} bajo`}
            acento={resumen.enCero + resumen.bajo > 0 ? "amber" : "slate"} />
        </div>
      )}

      {showScanner && <EscanerCodigo onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      {/* Controles tabla */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleScan(e.target.value); } }}
            placeholder="Buscar por nombre, SKU o código de barras…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm focus:border-slate-500 focus:outline-none"
          />
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
            <button key={f.id} onClick={() => setFiltroAlerta(f.id)}
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
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <ThOrden campo="producto_nombre">Producto</ThOrden>
                <ThOrden campo="codigo_zona">Ubicación</ThOrden>
                <ThOrden campo="cantidad_base" className="text-right">Cantidad</ThOrden>
                <ThOrden campo="valor_linea" className="text-right">Valor</ThOrden>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr><td colSpan={4} className="px-3 py-10 text-center text-slate-400">Cargando…</td></tr>
              ) : filasFiltradas.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-10 text-center text-slate-400">
                  {filas.length === 0
                    ? "Sin stock registrado todavía. Aparecerá al hacer los primeros conteos."
                    : "No hay filas que coincidan con el filtro."}
                </td></tr>
              ) : agrupando ? (
                bloques.map(g => (
                  <Fragment key={g.familia_id ?? `p:${g.filas[0].producto_id}`}>
                    {g.productoIds.size > 1 && (
                      <tr className="bg-slate-50">
                        <td colSpan={4} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {g.familia_nombre} <span className="font-normal normal-case text-slate-400">({g.productoIds.size} variantes)</span>
                        </td>
                      </tr>
                    )}
                    {g.filas.map(f => (
                      <FilaInventario key={`${f.producto_id}-${f.ubicacion_id}`} f={f} alerta={nivelAlerta(f.cantidad_base)} />
                    ))}
                  </Fragment>
                ))
              ) : (
                filasFiltradas.map(f => (
                  <FilaInventario key={`${f.producto_id}-${f.ubicacion_id}`} f={f} alerta={nivelAlerta(f.cantidad_base)} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!cargando && filasFiltradas.length > 0 && (
        <p className="mt-3 text-right text-xs text-slate-400">
          {filasFiltradas.length} líneas mostradas
        </p>
      )}
    </div>
  );
}
