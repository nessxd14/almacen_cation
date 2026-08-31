import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";
import {
  Search, LayoutGrid, List, Package, X, Tag, MapPin, Barcode,
  Link2, Link2Off, ImageOff, Filter, ChevronRight, ChevronDown, Boxes, History, Pencil, ScanLine,
  ShoppingCart, CheckCircle, AlertTriangle, Loader, PackagePlus, Plus, FileText,
} from "lucide-react";
import { HistorialMovimientos } from "./HistorialApp";
import EditarProducto, { CarruselPrecios } from "./EditarProducto";
import NuevoProducto from "./NuevoProducto";
import EscanerCodigo from "./EscanerCodigo";
import { ubicacionesParaOperacion, calcularPick, crearPedido, despacharLinea, buscarAgrupado, stockPorSucursalBatch } from "./lib/operaciones";
import { agregarAlBorrador } from "./lib/pedidoBorrador";
import { useUsuarioActual } from "./lib/useAuth";
import { useSucursal } from "./lib/useSucursal";
import { metaProducto, marcaFmt } from "./lib/producto";
import { sumaStockPorSucursal, desgloseStockPorSucursal, textoDesgloseSucursal } from "./lib/stockSucursal";
import { labelUbicacionConSucursal } from "./lib/despacho";
import { fetchAll } from "./lib/fetchAll";

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

// Texto informativo "≈ N paquetes de M" a partir de una cantidad en unidad
// base y la presentación de bulto del producto (si tiene una) — no editable,
// no afecta lo que se envía al backend (que siempre viaja en unidad base).
function textoAproxBulto(cantidadBaseStr, presentacionBulto) {
  if (!presentacionBulto || !cantidadBaseStr) return null;
  const n = Number(cantidadBaseStr);
  const factor = Number(presentacionBulto.factor_unidad_base);
  if (!n || n <= 0 || !factor) return null;
  const contenedor = (presentacionBulto.nombre.split(" ")[0] || "paquete").toLowerCase();
  const paquetes = n / factor;
  return `≈ ${cantidadFmt(paquetes)} ${contenedor}${paquetes === 1 ? "" : "s"} de ${cantidadFmt(factor)}`;
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

// Coma decimal (consistente con precioFmt/"Bs 5,00"), sin decimales
// sobrantes: 51 -> "51", 2.04 -> "2,04" (nunca "2,0400000...").
function numeroFmt(v) {
  return new Intl.NumberFormat("es-BO", { maximumFractionDigits: 2 }).format(v);
}

// Desglose real del stock total convertido a cada presentación no-base
// activa del producto — no un contador ("+N presentaciones"), el cálculo
// mismo: stock_total / factor_unidad_base, con "≈" adelante porque es
// derivado, no un dato guardado. Sin presentaciones extra: no renderiza
// nada, sin espacio vacío.
function DesgloseConversiones({ stockTotal, presentaciones }) {
  const extra = (presentaciones || []).filter(p => !p.es_base && p.activo !== false);
  if (extra.length === 0) return null;
  return (
    <>
      {extra.map(p => (
        <span key={p.id} className="ml-1 text-sm font-normal text-slate-400">
          · ≈ {numeroFmt(Number(stockTotal) / Number(p.factor_unidad_base))} {p.nombre}
        </span>
      ))}
    </>
  );
}

// Brief W9: línea secundaria "Almacén 1.170 · Tienda 75" debajo del total —
// no reemplaza el total, lo desglosa. Nada que renderizar con 0 o 1
// sucursal con stock (el total ya lo dice) — ver lib/stockSucursal.js.
function DesgloseSucursalLinea({ stockPorSucursal, className }) {
  const { sucursales } = useSucursal();
  const desglose = desgloseStockPorSucursal(stockPorSucursal, sucursales);
  const texto = textoDesgloseSucursal(desglose, numeroFmt);
  if (!texto) return null;
  return <p className={className || "text-xs text-slate-400"}>{texto}</p>;
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
  const { sucursales, nombreSucursal } = useSucursal();
  const [detalle, setDetalle] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [vistaPanel, setVistaPanel] = useState("detalle"); // "detalle" | "historial"
  const [editando, setEditando] = useState(false);
  const [mostrarUbicaciones, setMostrarUbicaciones] = useState(false);

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
        .select("id, nombre, factor_unidad_base, es_base, activo, identificador(valor, tipo)")
        .eq("producto_id", producto.id);
      // Stock por ubicación (incluye virtuales — necesario para el total real)
      const { data: stock } = await supabase
        .from("stock_actual")
        .select("cantidad_base, ubicacion:ubicacion_id(codigo_zona, estante, nivel, compartimiento, sucursal_id, sucursal:sucursal_id(nombre, tipo))")
        .eq("producto_id", producto.id);
      // Ficha técnica — texto pesado, no viene en el producto de la grilla.
      const { data: ficha } = await supabase
        .from("producto")
        .select("ficha_md")
        .eq("id", producto.id)
        .single();

      if (activo) {
        setDetalle({
          atributos: atribs || [],
          ubicaciones: ubics || [],
          presentaciones: pres || [],
          stock: stock || [],
          fichaMd: ficha?.ficha_md || null,
        });
        setCargando(false);
      }
    }
    cargar();
    return () => { activo = false; };
  }, [producto.id]);

  const mapeado = !!producto.shopify_variant_id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* Header con imagen */}
        <div className="relative">
          <ImagenProducto url={producto.imagen_url} nombre={producto.nombre}
            className="h-56 w-full rounded-t-2xl" />
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
            {marcaFmt(producto.marca) && (
              <p className="text-xs text-slate-500">{marcaFmt(producto.marca)}</p>
            )}
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
          {/* Stock total destacado + "Presente en X ubicaciones" desplegable */}
          {!cargando && (() => {
            const ubicacionesConStock = detalle.stock.filter(
              s => s.ubicacion?.sucursal?.tipo !== "virtual" && Number(s.cantidad_base) !== 0
            );
            const stockTotal = detalle.stock.reduce((s, r) => s + Number(r.cantidad_base || 0), 0);
            // Brief W9 tarea 2: mismo desglose por sucursal que la tarjeta del
            // Catálogo, agregado acá desde las filas de stock por ubicación.
            const mapaPorSucursal = new Map();
            for (const r of detalle.stock) {
              const sid = r.ubicacion?.sucursal_id;
              if (sid == null) continue;
              mapaPorSucursal.set(sid, (mapaPorSucursal.get(sid) || 0) + Number(r.cantidad_base || 0));
            }
            const desgloseSucursales = desgloseStockPorSucursal(mapaPorSucursal, sucursales);
            return (
              <div className="mb-5 rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Boxes size={20} className="text-slate-400" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Stock total</p>
                    <p className="text-lg font-bold text-slate-900">
                      {cantidadFmt(stockTotal)}
                      <span className="ml-1 text-sm font-normal text-slate-400">{producto.unidad_base}</span>
                      <DesgloseConversiones stockTotal={stockTotal} presentaciones={detalle.presentaciones} />
                    </p>
                    {desgloseSucursales.map((d) => (
                      <p key={d.sucursalId} className="text-xs text-slate-400">
                        {d.nombre} <span className="font-medium text-slate-500">{cantidadFmt(d.cantidad)}</span> {producto.unidad_base}
                      </p>
                    ))}
                  </div>
                </div>

                <button onClick={() => setMostrarUbicaciones(v => !v)}
                  className="mt-2 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
                  {mostrarUbicaciones ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Presente en {ubicacionesConStock.length} {ubicacionesConStock.length === 1 ? "ubicación" : "ubicaciones"}
                </button>

                {mostrarUbicaciones && (
                  <div className="mt-2 space-y-1.5 border-t border-slate-200 pt-2">
                    {ubicacionesConStock.length === 0 ? (
                      <p className="text-sm text-slate-400">
                        Sin stock registrado todavía. Aparecerá al hacer el primer conteo.
                      </p>
                    ) : (
                      ubicacionesConStock.map((s, i) => {
                        const n = Number(s.cantidad_base);
                        const negativo = n < 0;
                        return (
                          <div key={i} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm
                            ${negativo ? "border-red-200 bg-red-50" : "border-slate-200"}`}>
                            <MapPin size={13} className={negativo ? "text-red-500" : "text-slate-400"} />
                            <span className={`flex-1 ${negativo ? "text-red-700" : "text-slate-700"}`}>
                              {labelUbicacionConSucursal(etiquetaUbicacion(s.ubicacion), s.ubicacion?.sucursal_id, nombreSucursal)}
                            </span>
                            <span className={`font-semibold ${negativo ? "text-red-600" : "text-slate-900"}`}>
                              {cantidadFmt(n)}
                              <span className={`ml-1 text-xs font-normal ${negativo ? "text-red-400" : "text-slate-400"}`}>
                                {producto.unidad_base}
                              </span>
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })()}

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

              {/* Ubicaciones asignadas sin stock (para saber dónde debería ir) */}
              {detalle.ubicaciones.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <MapPin size={12} /> Ubicaciones asignadas
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {detalle.ubicaciones.map((u, i) => (
                      <span key={i} className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        <MapPin size={10} className={u.es_principal ? "text-slate-700" : "text-slate-400"} />
                        {etiquetaUbicacion(u.ubicacion)}
                        {u.es_principal && <span className="text-slate-400">·principal</span>}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Ficha técnica — Markdown pegado, sin sumar dependencia de
                  renderizado todavía: texto plano en <pre> (ver addendum). */}
              {detalle.fichaMd && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <FileText size={12} /> Ficha técnica
                  </h3>
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{detalle.fichaMd}</pre>
                </section>
              )}
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

// ─── Quick-view: modal centrado con la operación de venta ──────────────────
// Reemplaza al antiguo drawer lateral. La grilla es solo preview; acá vive
// la decisión de "Vender ahora" o "Agregar a pedido" (Fase C).

function QuickView({ producto, onClose, onVerDetalle, onVenderAhora, onAgregarPedido }) {
  const mapeado = !!producto.shopify_variant_id;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="relative">
          <ImagenProducto url={producto.imagen_url} nombre={producto.nombre}
            className="h-48 w-full rounded-t-2xl" />
          <button onClick={onClose}
            className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-slate-600 shadow hover:bg-white">
            <X size={18} />
          </button>
          {!mapeado && (
            <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-slate-900/80 px-2 py-0.5 text-xs font-medium text-white">
              <Link2Off size={10} /> Sin mapear
            </span>
          )}
        </div>

        <div className="p-5 text-center">
          <h2 className="text-lg font-semibold text-slate-900">{producto.nombre}</h2>
          {producto.sku_interno && <p className="text-sm text-slate-400">SKU: {producto.sku_interno}</p>}
          <p className="mt-2 text-2xl font-bold text-slate-900">{precioFmt(producto.precio_base)}</p>
          <div className="mt-2 flex justify-center">
            <BadgeStock cantidad={producto.stock_total} unidad={producto.unidad_base} />
          </div>
          <DesgloseSucursalLinea stockPorSucursal={producto.stock_por_sucursal} className="mt-1 text-xs text-slate-400" />

          <div className="mt-5 space-y-2">
            <button onClick={onVenderAhora}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700">
              <ShoppingCart size={16} /> Vender ahora
            </button>
            <button onClick={onAgregarPedido}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <PackagePlus size={16} /> Agregar a pedido
            </button>
          </div>

          <button onClick={onVerDetalle} className="mt-4 text-sm text-slate-500 underline">
            Ver detalle completo
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Vender ahora: crea un pedido de 1 línea y lo despacha con el pick auto ──
// Unificado bajo el mismo modelo de Fase C (Despacho de pedidos): una venta
// de Tienda hecha así obtiene su ventana de reversión de 30 min igual que
// cualquier despacho.

const CATEGORIAS_VENTA = [
  { id: "MAYOR",  label: "Mayor" },
  { id: "TIENDA", label: "Tienda directa" },
];

function VenderAhoraModal({ producto, onClose, onVendido }) {
  const usuarioActual = useUsuarioActual();
  const [presentaciones, setPresentaciones] = useState([]);
  const [presentacionId, setPresentacionId] = useState("");
  const [ubicacionesStock, setUbicacionesStock] = useState([]);
  const [previewPick, setPreviewPick] = useState(null);
  const [categoria, setCategoria] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [referencia, setReferencia] = useState("");
  const [flash, setFlash] = useState(null);
  const [ejecutando, setEjecutando] = useState(false);

  useEffect(() => {
    let activo = true;
    supabase.from("presentacion")
      .select("id, nombre, factor_unidad_base, es_base")
      .eq("producto_id", producto.id)
      .eq("activo", true)
      .order("es_base", { ascending: false })
      .then(({ data }) => {
        if (!activo) return;
        setPresentaciones(data || []);
        const base = (data || []).find(p => p.es_base) || (data || [])[0];
        if (base) setPresentacionId(String(base.id));
      });
    return () => { activo = false; };
  }, [producto.id]);

  useEffect(() => {
    let activo = true;
    ubicacionesParaOperacion({ productoId: producto.id, modo: "SALIDA" }).then(({ ubicaciones }) => {
      if (activo) setUbicacionesStock(ubicaciones);
    });
    return () => { activo = false; };
  }, [producto.id]);

  const presentacion = presentaciones.find(p => p.id === Number(presentacionId));
  // Presentación de bulto (no-base), si el producto tiene una — solo para
  // el texto informativo "≈ N paquetes"; Vender ahora siempre opera en
  // unidad base (Parte B), sin selector de presentación.
  const presentacionBulto = presentaciones.find(p => !p.es_base);

  // preview del pick automático (mayor stock primero) mientras se ajusta la cantidad
  useEffect(() => {
    let activo = true;
    if (!presentacion || !cantidad || Number(cantidad) <= 0) { setPreviewPick(null); return; }
    const cantidadBase = Number(cantidad) * presentacion.factor_unidad_base;
    calcularPick({ productoId: producto.id, cantidadBase }).then((r) => { if (activo) setPreviewPick(r); });
    return () => { activo = false; };
  }, [producto.id, presentacion, cantidad]);

  const labelUbic = (id) => ubicacionesStock.find(u => u.id === id)?.label || `Ubicación ${id}`;
  const showFlash = (msg, type) => { setFlash({ msg, type }); setTimeout(() => setFlash(null), 4000); };

  async function confirmar() {
    if (!categoria) { showFlash("Selecciona la categoría de venta", "error"); return; }
    if (!presentacionId) { showFlash("Selecciona una presentación", "error"); return; }
    if (!cantidad || Number(cantidad) <= 0) { showFlash("Cantidad inválida", "error"); return; }

    setEjecutando(true);
    const catLabel = CATEGORIAS_VENTA.find(c => c.id === categoria)?.label || categoria;
    const refFinal = referencia.trim() || `Venta directa · ${catLabel}`;
    const cantidadBase = Number(cantidad) * presentacion.factor_unidad_base;

    const { id: pedidoId, error: errorPedido } = await crearPedido({
      categoria,
      referencia: refFinal,
      lineas: [{ producto_id: producto.id, cantidad_base: cantidadBase }],
      usuario: usuarioActual.nombre,
    });
    if (errorPedido) { setEjecutando(false); showFlash("Error: " + errorPedido.message, "error"); return; }

    const { data: lineaRow, error: errorLinea } = await supabase
      .from("pedido_linea").select("id").eq("pedido_id", pedidoId).limit(1).single();

    if (errorLinea || !lineaRow) {
      setEjecutando(false);
      showFlash(`El pedido #${pedidoId} se creó pero no se pudo despachar. Resolvelo desde Pedidos.`, "error");
      return;
    }

    const { asignaciones, faltante } = await calcularPick({ productoId: producto.id, cantidadBase });

    if (asignaciones.length === 0) {
      setEjecutando(false);
      onVendido?.({ pedidoId, faltante: cantidadBase, sinDespachar: true });
      return;
    }

    const { resultado, error: errorDespacho } = await despacharLinea({ lineaId: lineaRow.id, asignaciones, usuario: usuarioActual.nombre });
    setEjecutando(false);
    if (errorDespacho) { showFlash("Error al despachar: " + errorDespacho.message, "error"); return; }

    onVendido?.({ pedidoId, resultado, faltante });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!ejecutando) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Vender ahora</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500">{producto.nombre}</p>

        {flash && (
          <div className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm
            ${flash.type === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
            {flash.type === "error" ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
            {flash.msg}
          </div>
        )}

        <div className="space-y-3">
          {/* categoría: siempre se pregunta — define despacho manual vs Shopify */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Categoría de venta</label>
            <div className="flex gap-2">
              {CATEGORIAS_VENTA.map(c => (
                <button key={c.id} onClick={() => setCategoria(c.id)}
                  className={`flex-1 rounded-lg border py-2 text-sm font-medium
                    ${categoria === c.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Siempre en unidad base, sin selector de presentación (Parte B) */}
          <div>
            <input type="number" min="0.001" step="any" value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              placeholder={`Cantidad (${producto.unidad_base} base)`}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            {textoAproxBulto(cantidad, presentacionBulto) && (
              <p className="mt-1 text-xs text-slate-400">{textoAproxBulto(cantidad, presentacionBulto)}</p>
            )}
          </div>

          {/* preview del pick automático — informativo, se recalcula al despachar */}
          {previewPick && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {previewPick.asignaciones.length === 0 ? (
                <p className="flex items-center gap-1 text-amber-600">
                  <AlertTriangle size={12} /> Sin stock disponible — quedará pendiente en el pedido.
                </p>
              ) : (
                <>
                  <p className="mb-1 font-medium text-slate-500">Se despachará de:</p>
                  <ul className="space-y-0.5">
                    {previewPick.asignaciones.map(a => (
                      <li key={a.ubicacion_id}>• {labelUbic(a.ubicacion_id)} — {a.cantidad_base}</li>
                    ))}
                  </ul>
                  {previewPick.faltante > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-amber-600">
                      <AlertTriangle size={12} /> Faltan {previewPick.faltante} — quedará pendiente.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <input value={referencia} onChange={e => setReferencia(e.target.value)}
            placeholder="Referencia (opcional)"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />

          <button onClick={confirmar} disabled={ejecutando}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
            {ejecutando && <Loader size={14} className="animate-spin" />}
            {ejecutando ? "Registrando…" : "Confirmar venta"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Texto principal de la tarjeta/fila: si es una variante dentro de una familia
// agrupada, muestra su(s) atributo(s) distintivo(s) en vez de repetir el
// nombre completo de la familia (ej. "Naranja", o "Naranja · L").
function textoVariante(p, mostrarAtributos) {
  if (mostrarAtributos && p.atributos?.length > 0) {
    return p.atributos.map(a => a.valor).join(" · ");
  }
  return p.nombre;
}

// ─── Encabezado de familia (separador visual, no clickeable) ────────────────

function EncabezadoFamilia({ grupo }) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2.5">
      <ImagenProducto url={grupo.familia_imagen_url} nombre={grupo.familia_nombre}
        className="h-7 w-7 shrink-0 rounded-md" />
      <h3 className="truncate text-sm font-semibold text-slate-700">{grupo.familia_nombre}</h3>
      <span className="shrink-0 text-xs text-slate-400">({grupo.variantes.length})</span>
    </div>
  );
}

function EncabezadoFamiliaFila({ grupo }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
      <ImagenProducto url={grupo.familia_imagen_url} nombre={grupo.familia_nombre}
        className="h-6 w-6 shrink-0 rounded" />
      <span className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{grupo.familia_nombre}</span>
      <span className="shrink-0 text-xs text-slate-400">({grupo.variantes.length})</span>
    </div>
  );
}

// ─── Tarjeta galería ─────────────────────────────────────────────────────────

function TarjetaGaleria({ p, mostrarAtributos, onClick }) {
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
        <p className="line-clamp-2 text-sm font-medium text-slate-800">{textoVariante(p, mostrarAtributos)}</p>
        {metaProducto(p) && <p className="mt-0.5 text-xs text-slate-400">{metaProducto(p)}</p>}
        <div className="mt-auto flex items-center justify-between pt-2">
          <p className="text-sm font-bold text-slate-900">{precioFmt(p.precio_base)}</p>
          <BadgeStock cantidad={p.stock_total} unidad={p.unidad_base} />
        </div>
        <DesgloseSucursalLinea stockPorSucursal={p.stock_por_sucursal} className="mt-1 text-right text-xs text-slate-400" />
      </div>
    </button>
  );
}

// ─── Fila lista ──────────────────────────────────────────────────────────────

function FilaLista({ p, mostrarAtributos, indentado, onClick }) {
  const mapeado = !!p.shopify_variant_id;
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-slate-100 py-2.5 text-left last:border-0 hover:bg-slate-50
        ${indentado ? "pl-9 pr-3" : "px-3"}`}>
      <ImagenProducto url={p.imagen_url} nombre={p.nombre}
        className="h-11 w-11 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{textoVariante(p, mostrarAtributos)}</p>
        {metaProducto(p) && <p className="truncate text-xs text-slate-400">{metaProducto(p)}</p>}
      </div>
      {!mapeado && <Link2Off size={14} className="shrink-0 text-slate-300" />}
      <div className="shrink-0 text-right">
        <BadgeStock cantidad={p.stock_total} unidad={p.unidad_base} />
        <DesgloseSucursalLinea stockPorSucursal={p.stock_por_sucursal} className="mt-0.5 text-xs text-slate-400" />
      </div>
      <span className="shrink-0 text-sm font-semibold text-slate-900">{precioFmt(p.precio_base)}</span>
      <ChevronRight size={15} className="shrink-0 text-slate-300" />
    </button>
  );
}

// ─── Arma bloques de render: familias agrupadas quedan con su propio
// encabezado + subgrilla; las familias de 1 sola variante (o sin familia)
// se acumulan en bloques "sueltos" compartidos, sin encabezado — mismo
// aspecto que la grilla plana de siempre. ──────────────────────────────────
function armarBloques(grupos) {
  const bloques = [];
  let buffer = [];
  for (const g of grupos) {
    if (g.variantes.length > 1) {
      if (buffer.length > 0) { bloques.push({ tipo: "sueltos", variantes: buffer }); buffer = []; }
      bloques.push({ tipo: "familia", grupo: g });
    } else {
      buffer.push(g.variantes[0]);
    }
  }
  if (buffer.length > 0) bloques.push({ tipo: "sueltos", variantes: buffer });
  return bloques;
}

// Arma la misma forma de "grupos" que devuelve buscarAgrupado (búsqueda),
// pero para una página plana de productos (browse-all): agrupa por
// familia_id usando un mapa liviano producto_id -> {familia_id,
// familia_nombre, atributos}, sin tocar la paginación — el agrupamiento
// queda acotado a los productos de la página actual (una familia con
// variantes repartidas en dos páginas no se junta entre páginas).
function agruparPorFamiliaLocal(lista, mapaFamilia) {
  const grupos = new Map();
  const orden = [];
  for (const p of lista) {
    const fam = mapaFamilia.get(p.id);
    const key = fam?.familia_id ?? `p:${p.id}`;
    if (!grupos.has(key)) {
      grupos.set(key, {
        familia_id: fam?.familia_id ?? null,
        familia_nombre: fam?.familia_nombre ?? p.nombre,
        familia_imagen_url: null,
        variantes: [],
      });
      orden.push(key);
    }
    const g = grupos.get(key);
    if (!g.familia_imagen_url && p.imagen_url) g.familia_imagen_url = p.imagen_url;
    g.variantes.push({ ...p, atributos: fam?.atributos || [] });
  }
  return orden.map(k => grupos.get(k));
}

// ─── Componente principal ────────────────────────────────────────────────────

const PAGINA = 40;

export default function CatalogoApp() {
  const [vista, setVista] = useState("galeria");   // "galeria" | "lista"
  const [busqueda, setBusqueda] = useState("");
  const [grupos, setGrupos] = useState([]);        // [{familia_id, familia_nombre, familia_imagen_url, variantes}]
  const [buscando, setBuscando] = useState(false);  // true si hay texto de búsqueda activo (sin paginación)
  const [cargando, setCargando] = useState(true);
  const [seleccionado, setSeleccionado] = useState(null);     // quick-view (grilla)
  const [detalleCompleto, setDetalleCompleto] = useState(null); // "ver detalle completo"
  const [vendiendo, setVendiendo] = useState(null);           // modal "vender ahora"
  const [creando, setCreando] = useState(false);              // modal "nuevo producto"
  const [ventaFlash, setVentaFlash] = useState(null);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);

  // Filtro por atributo
  const [atributos, setAtributos] = useState([]);
  const [filtroValorId, setFiltroValorId] = useState("");

  const [showScanner, setShowScanner] = useState(false);
  const debounceRef = useRef(null);
  const cargarTokenRef = useRef(0);

  // Resuelve un código (cámara o scanner físico + Enter en el buscador) y
  // abre directo el quick-view del producto — no pasa por la búsqueda de
  // texto. Ambiguo entre productos distintos: no hay uno solo para abrir,
  // se deja como estaba (el usuario busca a mano).
  const handleScan = useCallback(async (codigo) => {
    setShowScanner(false);
    // eslint-disable-next-line no-control-regex
    const code = (codigo || "").trim().replace(/[\x00-\x1F\x7F]/g, "");
    if (!code) return;
    const { data, error } = await supabase.rpc("resolver_identificador", { p_codigo: code });
    if (error) { console.error("resolver_identificador:", error); return; }
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    if (rows.length === 0) return;
    const productosDistintos = [...new Set(rows.map(r => r.producto_id))];
    if (productosDistintos.length !== 1) return;
    const [{ data: prod }, { data: stock }] = await Promise.all([
      supabase
        .from("producto")
        .select("id, nombre, sku_interno, marca, unidad_base, precio_base, precio_mayoreo, precio_institucion, precio_corporativo, shopify_variant_id, imagen_url")
        .eq("id", productosDistintos[0])
        .single(),
      supabase.from("v_producto_stock").select("stock_total").eq("producto_id", productosDistintos[0]).maybeSingle(),
    ]);
    if (prod) {
      setBusqueda("");
      setSeleccionado({ ...prod, stock_total: stock?.stock_total ?? 0 });
    }
  }, []);

  // Cargar lista de valores de atributo para el filtro
  useEffect(() => {
    fetchAll(() =>
      supabase.from("atributo_valor").select("id, valor, atributo:atributo_id(nombre)").order("valor")
    )
      .then(setAtributos)
      .catch(() => {
        setVentaFlash({ msg: "No se pudo cargar el filtro de atributos completo", type: "error" });
        setTimeout(() => setVentaFlash(null), 4000);
      });
  }, []);

  // Completa las variantes que devuelve buscarAgrupado (solo id/nombre/sku/atributos)
  // con los campos que ya usan las tarjetas/quick-view/detalle: precio, stock,
  // imagen, mapeo Shopify, etc. — mismos campos que la query plana de siempre.
  const enriquecerVariantes = async (gruposCrudos) => {
    const ids = gruposCrudos.flatMap(g => g.variantes.map(v => v.producto_id));
    if (ids.length === 0) return [];

    // Brief W9: buscarAgrupado puede traer hasta 200 ids acá. stockPorSucursalBatch
    // hace un .in() sobre stock_actual sin .range() — PostgREST trunca en 1.000
    // filas en silencio. Hoy hay ~1 fila de stock por producto (200 ids ≈ 200
    // filas), lejos del límite; si stock_actual pasa a tener más filas por
    // producto, revisar esto (mismo cuidado que ya existe en PreciosApp.jsx).
    const [{ data: detalles }, mapaStockPorProducto] = await Promise.all([
      supabase
        .from("producto")
        .select("id, nombre, sku_interno, marca, unidad_base, precio_base, precio_mayoreo, precio_institucion, precio_corporativo, shopify_variant_id, imagen_url")
        .in("id", ids),
      stockPorSucursalBatch(ids),
    ]);
    const mapaDet = new Map((detalles || []).map(d => [d.id, d]));

    return gruposCrudos.map(g => ({
      ...g,
      variantes: g.variantes
        .filter(v => mapaDet.has(v.producto_id))
        .map(v => {
          const stockPorSucursal = mapaStockPorProducto.get(v.producto_id) || new Map();
          return {
            ...mapaDet.get(v.producto_id),
            atributos: v.atributos,
            stock_total: sumaStockPorSucursal(stockPorSucursal),
            stock_por_sucursal: stockPorSucursal,
          };
        }),
    })).filter(g => g.variantes.length > 0);
  };

  const cargar = useCallback(async (q, valorId, pag) => {
    const miToken = ++cargarTokenRef.current;
    setCargando(true);
    const texto = q.trim();

    if (texto) {
      // Búsqueda agrupada por familia (motor: lib/operaciones.buscarAgrupado)
      let gruposCrudos = await buscarAgrupado(texto);

      if (valorId) {
        const { data } = await supabase
          .from("producto_atributo")
          .select("producto_id")
          .eq("atributo_valor_id", valorId);
        const idsFiltro = new Set((data || []).map(r => r.producto_id));
        gruposCrudos = gruposCrudos
          .map(g => ({ ...g, variantes: g.variantes.filter(v => idsFiltro.has(v.producto_id)) }))
          .filter(g => g.variantes.length > 0);
      }

      const gruposCompletos = await enriquecerVariantes(gruposCrudos);
      const totalVariantes = gruposCompletos.reduce((s, g) => s + g.variantes.length, 0);

      if (cargarTokenRef.current !== miToken) return; // respuesta obsoleta, la pisó una búsqueda más nueva
      setGrupos(gruposCompletos);
      setTotal(totalVariantes);
      setBuscando(true);
      setCargando(false);
      return;
    }

    // Sin texto de búsqueda: navegación paginada de siempre, sin agrupar
    // (buscarAgrupado es un motor de búsqueda, no un listado general).
    let idsFiltro = null;
    if (valorId) {
      const { data } = await supabase
        .from("producto_atributo")
        .select("producto_id")
        .eq("atributo_valor_id", valorId);
      idsFiltro = (data || []).map(r => r.producto_id);
      if (idsFiltro.length === 0) {
        if (cargarTokenRef.current !== miToken) return;
        setGrupos([]); setTotal(0); setBuscando(false); setCargando(false); return;
      }
    }

    let query = supabase
      .from("producto")
      .select("id, nombre, sku_interno, marca, unidad_base, precio_base, precio_mayoreo, precio_institucion, precio_corporativo, shopify_variant_id, imagen_url", { count: "exact" })
      .eq("activo", true);

    if (idsFiltro) query = query.in("id", idsFiltro);
    query = query.order("nombre").range(pag * PAGINA, pag * PAGINA + PAGINA - 1);

    const { data, count } = await query;
    const lista = data || [];

    let mapaFamilia = new Map();
    if (lista.length > 0) {
      const ids = lista.map(p => p.id);
      // La grilla pagina de a 40 productos (PAGINA) — muy lejos del límite de
      // 1.000 filas de PostgREST que sí hay que cuidar en enriquecerVariantes.
      const [mapaStockPorProducto, { data: extra }] = await Promise.all([
        stockPorSucursalBatch(ids),
        // Mapa liviano producto_id -> familia + atributos, solo para agrupar
        // visualmente esta página — no reemplaza la query paginada de arriba.
        supabase
          .from("producto")
          .select("id, familia_id, familia:familia_id(nombre), producto_atributo(atributo_valor:atributo_valor_id(valor, atributo:atributo_id(nombre)))")
          .in("id", ids),
      ]);
      for (const p of lista) {
        const stockPorSucursal = mapaStockPorProducto.get(p.id) || new Map();
        p.stock_total = sumaStockPorSucursal(stockPorSucursal);
        p.stock_por_sucursal = stockPorSucursal;
      }

      mapaFamilia = new Map((extra || []).map(p => [p.id, {
        familia_id: p.familia_id,
        familia_nombre: p.familia?.nombre,
        atributos: (p.producto_atributo || [])
          .filter(pa => pa.atributo_valor)
          .map(pa => ({ atributo: pa.atributo_valor.atributo?.nombre, valor: pa.atributo_valor.valor })),
      }]));
    }

    if (cargarTokenRef.current !== miToken) return; // respuesta obsoleta, la pisó una búsqueda/página más nueva
    setGrupos(agruparPorFamiliaLocal(lista, mapaFamilia));
    setTotal(count || 0);
    setBuscando(false);
    setCargando(false);
  }, []);

  // Resetear a la página 0 cuando cambian los filtros de búsqueda (no dispara
  // carga por sí solo: el efecto de abajo reacciona a `pagina` igual).
  useEffect(() => {
    setPagina(0);
  }, [busqueda, filtroValorId]);

  // Único efecto que dispara la carga — reacciona a búsqueda, filtro y
  // página. Debounced siempre (300ms), así los tres cambios (búsqueda,
  // filtro, el reset de página de arriba) colapsan en una sola consulta en
  // vez de dos disparándose en paralelo.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      cargar(busqueda, filtroValorId, pagina);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [busqueda, filtroValorId, pagina, cargar]);

  const totalPaginas = Math.ceil(total / PAGINA);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Catálogo</h1>
          <p className="text-sm text-slate-500">{total} productos activos</p>
        </div>
        <button onClick={() => setCreando(true)}
          className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
          <Plus size={15} /> Nuevo producto
        </button>
      </div>

      {showScanner && <EscanerCodigo onDetect={handleScan} onClose={() => setShowScanner(false)} />}

      {/* Controles */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
      ) : grupos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <Package size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">No se encontraron productos con esos criterios.</p>
        </div>
      ) : vista === "galeria" ? (
        <div className="space-y-6">
          {armarBloques(grupos).map((b, i) => b.tipo === "familia" ? (
            <div key={`f-${b.grupo.familia_id}`}>
              <EncabezadoFamilia grupo={b.grupo} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {b.grupo.variantes.map(v => (
                  <TarjetaGaleria key={v.id} p={v} mostrarAtributos onClick={() => setSeleccionado(v)} />
                ))}
              </div>
            </div>
          ) : (
            <div key={`s-${i}`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {b.variantes.map(v => (
                <TarjetaGaleria key={v.id} p={v} onClick={() => setSeleccionado(v)} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {armarBloques(grupos).map((b, i) => b.tipo === "familia" ? (
            <div key={`f-${b.grupo.familia_id}`}>
              <EncabezadoFamiliaFila grupo={b.grupo} />
              {b.grupo.variantes.map(v => (
                <FilaLista key={v.id} p={v} mostrarAtributos indentado onClick={() => setSeleccionado(v)} />
              ))}
            </div>
          ) : (
            <div key={`s-${i}`}>
              {b.variantes.map(v => (
                <FilaLista key={v.id} p={v} onClick={() => setSeleccionado(v)} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Paginación (solo navegando sin búsqueda activa; los resultados de
          búsqueda agrupada se muestran completos, sin paginar) */}
      {!buscando && totalPaginas > 1 && (
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

      {/* Flash de venta (sobrevive al cierre de los modales) */}
      {ventaFlash && (
        <div className={`fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-2 text-sm text-white shadow-lg
          ${ventaFlash.type === "error" ? "bg-red-600" : ventaFlash.type === "warn" ? "bg-amber-600" : "bg-emerald-600"}`}>
          {ventaFlash.type === "error" || ventaFlash.type === "warn" ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
          {ventaFlash.msg}
        </div>
      )}

      {/* Quick-view: preview + Vender ahora / Agregar a pedido */}
      {seleccionado && !vendiendo && (
        <QuickView
          producto={seleccionado}
          onClose={() => setSeleccionado(null)}
          onVerDetalle={() => { setDetalleCompleto(seleccionado); setSeleccionado(null); }}
          onVenderAhora={() => setVendiendo(seleccionado)}
          onAgregarPedido={() => {
            agregarAlBorrador(seleccionado, 1);
            setSeleccionado(null);
            setVentaFlash({ msg: `${seleccionado.nombre} agregado al pedido en borrador — anda a la pestaña Pedidos`, type: "ok" });
            setTimeout(() => setVentaFlash(null), 4000);
          }}
        />
      )}

      {/* Vender ahora: crea+despacha un pedido de 1 línea (modelo unificado, Fase C) */}
      {vendiendo && (
        <VenderAhoraModal
          producto={vendiendo}
          onClose={() => setVendiendo(null)}
          onVendido={({ resultado, faltante, sinDespachar }) => {
            setVendiendo(null);
            setSeleccionado(null);
            const msg = sinDespachar
              ? "Pedido creado, sin stock disponible ahora — quedó pendiente (ver Pedidos)"
              : faltante > 0
                ? `Venta registrada parcialmente — ${faltante} pendiente de stock (ver Pedidos)`
                : resultado?.reversible_hasta
                  ? "Venta registrada ✓ — reversible por 30 min (ver Pedidos)"
                  : "Venta registrada ✓";
            setVentaFlash({ msg, type: sinDespachar || faltante > 0 ? "warn" : "ok" });
            setTimeout(() => setVentaFlash(null), 4000);
            cargar(busqueda, filtroValorId, pagina);
          }}
        />
      )}

      {/* Ver detalle completo: historial, presentaciones, identificadores, editar, ubicaciones */}
      {detalleCompleto && (
        <DetalleProducto
          producto={detalleCompleto}
          onClose={() => setDetalleCompleto(null)}
          onActualizado={() => { cargar(busqueda, filtroValorId, pagina); }}
        />
      )}

      {creando && (
        <NuevoProducto onClose={() => setCreando(false)}
          onCreado={() => { setCreando(false); cargar(busqueda, filtroValorId, pagina); }} />
      )}
    </div>
  );
}
