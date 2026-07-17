/**
 * TypeaheadProducto — typeahead de producto agrupado por familia.
 * Usa buscarAgrupado(q) (lib/operaciones) en vez de buscarProductos(q):
 * el dropdown muestra un rótulo de familia (no seleccionable) cuando el
 * grupo tiene más de una variante, con las variantes debajo mostrando su
 * atributo distintivo + SKU. Familias de 1 sola variante se listan como
 * fila normal, sin rótulo.
 *
 * Compartido por OperacionesApp y PedidosApp (antes cada uno tenía su
 * propio typeahead inline sobre buscarProductos, duplicado).
 *
 * onSeleccionar recibe {id, nombre, sku_interno, marca, unidad_base} — mismo
 * shape que devolvía buscarProductos (+ marca), para no tocar los
 * consumidores existentes.
 * Si el match vino de un código de barras leído por Enter (scanner físico)
 * se llama con un segundo argumento {presentacionIdPreferida}; los
 * consumidores que no lo esperan simplemente lo ignoran.
 */
import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { supabase } from "./supabaseClient";
import { buscarAgrupado } from "./lib/operaciones";

export default function TypeaheadProducto({ value, onChange, onSeleccionar, placeholder, className = "" }) {
  const [grupos, setGrupos] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [errorResolver, setErrorResolver] = useState(null);

  // activeIndex se resetea acá, síncrono con cada cambio de value (no solo
  // cuando el debounce de abajo termina): si no se reseteara acá, un índice
  // resaltado por una búsqueda anterior podía quedar "vivo" mientras se
  // escribe/escanea un código nuevo, y el Enter terminaba seleccionando esa
  // fila vieja en vez de intentar resolver el código nuevo.
  useEffect(() => {
    setActiveIndex(-1);
    setErrorResolver(null);
    if (!value.trim()) { setGrupos([]); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      const g = await buscarAgrupado(value);
      setGrupos(g);
      setBuscando(false);
    }, 300);
    return () => clearTimeout(t);
  }, [value]);

  // Lista plana de variantes seleccionables, en el mismo orden en que se
  // renderizan — los rótulos de familia no entran acá (no son seleccionables).
  const variantesFlat = grupos.flatMap(g =>
    g.variantes.map(v => ({ ...v, mostrarAtributos: g.variantes.length > 1 }))
  );

  async function seleccionar(v) {
    setGrupos([]);
    setActiveIndex(-1);
    onChange("");
    // buscarAgrupado no trae marca/unidad_base (solo id/nombre/sku/atributos)
    // — se completa acá para que el consumidor reciba el mismo shape que
    // antes devolvía buscarProductos: {id, nombre, sku_interno, marca, unidad_base}.
    const { data } = await supabase
      .from("producto")
      .select("id, nombre, sku_interno, marca, unidad_base")
      .eq("id", v.producto_id)
      .single();
    if (data) onSeleccionar(data);
  }

  // Scanner físico (pistola/lector de mesa): "escribe" el código + Enter, sin
  // pasar por el dropdown de sugerencias (no hay fila resaltada). Antes de
  // tratar el valor como texto de búsqueda libre, se intenta resolver como
  // código de barras — mismo RPC que usa el flujo de cámara (EscanerCodigo).
  // Se limpian caracteres de control (algunos lectores de mesa inyectan un
  // Tab u otro byte de control junto con el código) además del trim normal,
  // y cualquier error de red/consulta se muestra en vez de tragarse en
  // silencio — antes, un error acá se veía igual que "no hace nada".
  // Recibe el valor directo del DOM (e.target.value), no el prop `value` de
  // React: bajo ráfagas muy rápidas de teclas (lector de código de barras
  // físico) el estado puede no haberse re-renderizado todavía cuando llega
  // el Enter, y closurear sobre `value` podía leer un string viejo/vacío —
  // el input real del navegador siempre tiene el valor completo ya tipeado.
  async function intentarResolverComoCodigo(valorActual) {
    // eslint-disable-next-line no-control-regex
    const code = valorActual.trim().replace(/[\x00-\x1F\x7F]/g, "");
    if (!code) return false;
    setErrorResolver(null);
    const { data, error } = await supabase.rpc("resolver_identificador", { p_codigo: code });
    if (error) { console.error("resolver_identificador:", error); setErrorResolver("No se pudo resolver el código"); return false; }
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    if (rows.length === 0) return false;
    const productosDistintos = [...new Set(rows.map(r => r.producto_id))];
    if (productosDistintos.length !== 1) return false; // código ambiguo: dejar que el usuario elija a mano
    const { data: prod, error: errorProd } = await supabase
      .from("producto")
      .select("id, nombre, sku_interno, marca, unidad_base")
      .eq("id", productosDistintos[0])
      .single();
    if (errorProd) { console.error("producto:", errorProd); setErrorResolver("No se pudo resolver el código"); return false; }
    if (!prod) return false;
    setGrupos([]);
    setActiveIndex(-1);
    onChange("");
    onSeleccionar(prod, { presentacionIdPreferida: rows.length === 1 ? Number(rows[0].presentacion_id) : null });
    return true;
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown" && variantesFlat.length > 0) {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % variantesFlat.length);
    } else if (e.key === "ArrowUp" && variantesFlat.length > 0) {
      e.preventDefault();
      setActiveIndex(i => (i <= 0 ? variantesFlat.length : i) - 1);
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < variantesFlat.length) {
        e.preventDefault();
        seleccionar(variantesFlat[activeIndex]);
      } else {
        e.preventDefault();
        intentarResolverComoCodigo(e.target.value);
      }
    } else if (e.key === "Escape") {
      setGrupos([]);
      setActiveIndex(-1);
    }
  }

  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full pl-8 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
      />
      {errorResolver && <p className="mt-1 text-xs text-red-600">{errorResolver}</p>}
      {(variantesFlat.length > 0 || buscando) && (
        <div className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border bg-white shadow-lg divide-y">
          {buscando && <p className="px-3 py-2 text-sm text-slate-400">Buscando…</p>}
          {grupos.map(g => (
            <div key={g.familia_id ?? `p:${g.variantes[0].producto_id}`}>
              {g.variantes.length > 1 && (
                <p className="bg-slate-50 px-3 pt-2 pb-1 text-xs font-medium text-slate-400">{g.familia_nombre}</p>
              )}
              {g.variantes.map(v => {
                const idx = variantesFlat.findIndex(x => x.producto_id === v.producto_id);
                const texto = g.variantes.length > 1 && v.atributos?.length > 0
                  ? v.atributos.map(a => a.valor).join(" · ")
                  : v.nombre;
                return (
                  <button key={v.producto_id}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => seleccionar(v)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50
                      ${idx === activeIndex ? "bg-slate-100" : ""}`}>
                    <span className="flex-1 font-medium">{texto}</span>
                    {v.sku_interno && <span className="text-xs text-slate-400">{v.sku_interno}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
