/**
 * NuevoProducto.jsx — Brief WMS (unidades base): alta de productos ahora que
 * Shopify salió del circuito. Ronda 2: múltiples presentaciones extra,
 * código por presentación, y ficha técnica opcional.
 *
 * Invariantes de diseño (no negociables, ver brief):
 * - unidad_base fija en 'unidad', no editable — el tamaño de bulto vive en
 *   `presentacion`, nunca en unidad_base.
 * - Siempre se crea la presentación base ('Unidad', factor 1, es_base) —
 *   sin ella fallan registrar_venta/registrar_entrada. No se puede editar
 *   ni borrar acá.
 * - Cada presentación extra: factor entero > 1, sin factores repetidos
 *   entre sí en el mismo producto.
 * - Código de la base va con tipo 'barra'; código de cada bulto, 'empaque'.
 * - Los 4 precios solo viajan en el payload si el usuario es admin (el
 *   trigger precio_solo_admin solo cubre UPDATE, no INSERT).
 * - La entrada inicial se registra por RPC (registrar_entrada), nunca por
 *   INSERT directo a stock_actual — el Kardex es append-only.
 * - ficha_md/ficha_actualizada_en no pasan por el trigger de precios —
 *   cualquier usuario logueado puede cargar la ficha.
 */

import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";
import { ejecutarOperacion, asegurarAsignacion, labelUbicacion } from "./lib/operaciones";
import { useUsuarioActual } from "./lib/useAuth";
import EscanerCodigo from "./EscanerCodigo";
import {
  X, Save, Loader, AlertCircle, Package2, Barcode, Camera, Plus, Trash2,
  Store, Users, Building2, Landmark, Boxes, FileText,
} from "lucide-react";

const uuid = () => crypto.randomUUID ? crypto.randomUUID() : "tmp-" + Date.now() + "-" + Math.random().toString(16).slice(2);

// Deshace lo que ya se haya insertado si un paso posterior falla — en el
// orden inverso de creación (identificador -> presentacion -> producto),
// porque las FK no tienen ON DELETE CASCADE hacia producto/presentacion.
async function rollback(productoId, presentacionIds) {
  if (!productoId) return;
  if (presentacionIds?.length) {
    await supabase.from("identificador").delete().in("presentacion_id", presentacionIds);
    await supabase.from("presentacion").delete().in("id", presentacionIds);
  }
  await supabase.from("producto").delete().eq("id", productoId);
}

export default function NuevoProducto({ onClose, onCreado }) {
  const usuarioActual = useUsuarioActual();
  const esAdmin = usuarioActual?.rol === "admin";

  const [nombre, setNombre] = useState("");
  const [marca, setMarca] = useState("");
  const [skuInterno, setSkuInterno] = useState("");

  const [codigoBase, setCodigoBase] = useState("");
  // Presentaciones extra (bulto): [{ key, nombre, factor, codigo }]
  const [presentacionesExtra, setPresentacionesExtra] = useState([]);
  const [scanTarget, setScanTarget] = useState(null); // "base" | key de una fila extra

  const [precios, setPrecios] = useState({
    precio_base: "", precio_mayoreo: "", precio_institucion: "", precio_municipal: "",
  });

  const [mostrarEntrada, setMostrarEntrada] = useState(false);
  const [ubicaciones, setUbicaciones] = useState([]);
  const [ubicacionId, setUbicacionId] = useState("");
  const [cantidadInicial, setCantidadInicial] = useState("");

  const [mostrarFicha, setMostrarFicha] = useState(false);
  const [fichaMd, setFichaMd] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!mostrarEntrada || ubicaciones.length > 0) return;
    supabase.from("ubicacion")
      .select("id, codigo_zona, estante, nivel, compartimiento")
      .order("codigo_zona").order("estante").order("nivel").order("compartimiento")
      .then(({ data }) => {
        setUbicaciones(data || []);
        if (data?.length) setUbicacionId(String(data[0].id));
      });
  }, [mostrarEntrada, ubicaciones.length]);

  function agregarPresentacionExtra() {
    setPresentacionesExtra((prev) => [...prev, { key: uuid(), nombre: "", factor: "", codigo: "" }]);
  }
  function actualizarPresentacionExtra(key, campo, valor) {
    setPresentacionesExtra((prev) => prev.map((p) => p.key === key ? { ...p, [campo]: valor } : p));
  }
  function quitarPresentacionExtra(key) {
    setPresentacionesExtra((prev) => prev.filter((p) => p.key !== key));
  }

  function onScan(codigo) {
    const target = scanTarget;
    setScanTarget(null);
    if (!target) return;
    if (target === "base") setCodigoBase(codigo);
    else actualizarPresentacionExtra(target, "codigo", codigo);
  }

  async function crear() {
    setError(null);
    if (!nombre.trim()) { setError("El nombre es obligatorio"); return; }

    for (const p of presentacionesExtra) {
      if (!p.nombre.trim()) { setError("Todas las presentaciones extra necesitan un nombre"); return; }
      const factor = Number(p.factor);
      if (!Number.isInteger(factor) || factor <= 1) {
        setError(`Factor inválido en "${p.nombre}" — debe ser un entero mayor a 1`); return;
      }
    }
    const factores = presentacionesExtra.map((p) => Number(p.factor));
    if (new Set(factores).size !== factores.length) {
      setError("No puede haber dos presentaciones con el mismo factor"); return;
    }

    if (mostrarEntrada) {
      if (!ubicacionId) { setError("Elegí una ubicación para la entrada inicial"); return; }
      if (!cantidadInicial || Number(cantidadInicial) <= 0) { setError("Cantidad inicial inválida"); return; }
    }

    setGuardando(true);

    const payloadProducto = {
      nombre: nombre.trim(),
      marca: marca.trim() || null,
      sku_interno: skuInterno.trim() || null,
      unidad_base: "unidad",
      activo: true,
      ...(esAdmin ? {
        precio_base: precios.precio_base === "" ? null : Number(precios.precio_base),
        precio_mayoreo: precios.precio_mayoreo === "" ? null : Number(precios.precio_mayoreo),
        precio_institucion: precios.precio_institucion === "" ? null : Number(precios.precio_institucion),
        precio_municipal: precios.precio_municipal === "" ? null : Number(precios.precio_municipal),
      } : {}),
      ...(mostrarFicha && fichaMd.trim() ? { ficha_md: fichaMd.trim(), ficha_actualizada_en: new Date().toISOString() } : {}),
    };

    const { data: prod, error: errProd } = await supabase
      .from("producto").insert(payloadProducto).select("id").single();
    if (errProd) {
      setGuardando(false);
      setError(errProd.message.includes("sku_interno") ? "Ese SKU ya existe en otro producto" : "Error al crear el producto: " + errProd.message);
      return;
    }
    const productoId = prod.id;

    const { data: presBase, error: errBase } = await supabase
      .from("presentacion")
      .insert({ producto_id: productoId, nombre: "Unidad", factor_unidad_base: 1, es_base: true })
      .select("id").single();
    if (errBase) {
      await rollback(productoId, []);
      setGuardando(false);
      setError("Error al crear la presentación base: " + errBase.message);
      return;
    }
    const presentacionesCreadas = [presBase.id];
    const idsPresExtra = [];

    for (const p of presentacionesExtra) {
      const { data: presRow, error: errPres } = await supabase
        .from("presentacion")
        .insert({ producto_id: productoId, nombre: p.nombre.trim(), factor_unidad_base: Number(p.factor), es_base: false })
        .select("id").single();
      if (errPres) {
        await rollback(productoId, presentacionesCreadas);
        setGuardando(false);
        setError(`Error al crear la presentación "${p.nombre}": ` + errPres.message);
        return;
      }
      presentacionesCreadas.push(presRow.id);
      idsPresExtra.push(presRow.id);
    }

    const codigos = [];
    if (codigoBase.trim()) codigos.push({ presentacion_id: presBase.id, valor: codigoBase.trim(), tipo: "barra", origen: "interno", es_principal: false });
    presentacionesExtra.forEach((p, i) => {
      if (p.codigo.trim()) codigos.push({ presentacion_id: idsPresExtra[i], valor: p.codigo.trim(), tipo: "empaque", origen: "interno", es_principal: false });
    });
    if (codigos.length > 0) {
      const { error: errCod } = await supabase.from("identificador").insert(codigos);
      if (errCod) {
        await rollback(productoId, presentacionesCreadas);
        setGuardando(false);
        setError("Error al guardar los códigos: " + errCod.message);
        return;
      }
    }

    if (mostrarEntrada) {
      const { error: errEntrada } = await ejecutarOperacion({
        modo: "ENTRADA",
        presentacionId: presBase.id,
        ubicacionId: Number(ubicacionId),
        cantidad: Number(cantidadInicial),
        referencia: "Alta de producto",
        usuario: usuarioActual.nombre,
      });
      if (errEntrada) {
        await rollback(productoId, presentacionesCreadas);
        setGuardando(false);
        setError("Error al registrar la entrada inicial: " + errEntrada.message);
        return;
      }
      await asegurarAsignacion(productoId, Number(ubicacionId));
    }

    setGuardando(false);
    onCreado?.(productoId);
  }

  return (
    <div className="fixed inset-0 z-[55] flex justify-end bg-black/40" onClick={onClose}>
      {scanTarget && <EscanerCodigo onDetect={onScan} onClose={() => setScanTarget(null)} />}

      <div className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Nuevo producto</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        <div className="space-y-6 p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {/* ── Datos básicos ── */}
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Datos básicos</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Nombre</label>
                <input value={nombre} onChange={e => setNombre(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Marca</label>
                  <input value={marca} onChange={e => setMarca(e.target.value)} placeholder="Opcional"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">SKU interno</label>
                  <input value={skuInterno} onChange={e => setSkuInterno(e.target.value)} placeholder="Opcional"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
                </div>
              </div>
              <p className="text-xs text-slate-400">Unidad base: <span className="font-medium text-slate-600">unidad</span> — fija, el tamaño de bulto se define abajo.</p>
            </div>
          </section>

          {/* ── Presentaciones ── */}
          <section className="border-t border-slate-100 pt-5">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Presentaciones</h3>
            <p className="mb-3 text-xs text-slate-400">La base ("Unidad", ×1) siempre se crea. Agregá las de bulto que necesites (Paquete, Caja…).</p>

            <div className="space-y-2">
              {/* Base — fija, no editable */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Package2 size={14} className="shrink-0 text-slate-400" />
                  <span className="flex-1 text-sm font-medium text-slate-700">Unidad</span>
                  <span className="text-xs text-slate-400">×1</span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">base</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Barcode size={13} className="shrink-0 text-slate-400" />
                  <input value={codigoBase} onChange={e => setCodigoBase(e.target.value)}
                    placeholder="Código de barras (opcional)"
                    className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none" />
                  <button onClick={() => setScanTarget("base")} title="Escanear"
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-600 hover:bg-slate-100">
                    <Camera size={14} />
                  </button>
                </div>
              </div>

              {/* Extra — dinámicas */}
              {presentacionesExtra.map((p) => (
                <div key={p.key} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input value={p.nombre} onChange={e => actualizarPresentacionExtra(p.key, "nombre", e.target.value)}
                      placeholder='Ej. "Caja (24 und)"'
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none" />
                    <input type="number" min="2" step="1" value={p.factor}
                      onChange={e => actualizarPresentacionExtra(p.key, "factor", e.target.value)}
                      placeholder="Factor"
                      className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right focus:border-slate-500 focus:outline-none" />
                    <button onClick={() => quitarPresentacionExtra(p.key)} className="text-slate-300 hover:text-red-500">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Barcode size={13} className="shrink-0 text-slate-400" />
                    <input value={p.codigo} onChange={e => actualizarPresentacionExtra(p.key, "codigo", e.target.value)}
                      placeholder="Código de empaque (opcional)"
                      className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none" />
                    <button onClick={() => setScanTarget(p.key)} title="Escanear"
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-600 hover:bg-slate-100">
                      <Camera size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={agregarPresentacionExtra}
              className="mt-2 flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
              <Plus size={14} /> Agregar presentación
            </button>
          </section>

          {/* ── Precios (solo admin) ── */}
          <section className="border-t border-slate-100 pt-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Precios</h3>
            {esAdmin ? (
              <div className="space-y-3">
                <CampoPrecio icono={Store} label="Tienda (Retail)"
                  value={precios.precio_base} onChange={v => setPrecios(p => ({ ...p, precio_base: v }))} />
                <CampoPrecio icono={Users} label="Mayoreo"
                  value={precios.precio_mayoreo} onChange={v => setPrecios(p => ({ ...p, precio_mayoreo: v }))} />
                <CampoPrecio icono={Building2} label="Instituciones"
                  value={precios.precio_institucion} onChange={v => setPrecios(p => ({ ...p, precio_institucion: v }))} />
                <CampoPrecio icono={Landmark} label="Municipal"
                  value={precios.precio_municipal} onChange={v => setPrecios(p => ({ ...p, precio_municipal: v }))} />
              </div>
            ) : (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                Solo un administrador puede fijar precios. El producto se crea sin precio y se completa después.
              </p>
            )}
          </section>

          {/* ── Entrada inicial ── */}
          <section className="border-t border-slate-100 pt-5">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Entrada inicial</h3>
            <p className="mb-3 text-xs text-slate-400">Opcional — registra stock inicial por RPC, en unidad base.</p>
            {!mostrarEntrada ? (
              <button onClick={() => setMostrarEntrada(true)}
                className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
                <Boxes size={14} /> Agregar entrada inicial
              </button>
            ) : (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                <select value={ubicacionId} onChange={e => setUbicacionId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none">
                  {ubicaciones.map(u => (
                    <option key={u.id} value={u.id}>{labelUbicacion(u)}</option>
                  ))}
                </select>
                <input type="number" min="0.001" step="any" value={cantidadInicial} onChange={e => setCantidadInicial(e.target.value)}
                  placeholder="Cantidad (unidad base)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
                <button onClick={() => { setMostrarEntrada(false); setCantidadInicial(""); }}
                  className="text-xs text-slate-500 underline">Quitar</button>
              </div>
            )}
          </section>

          {/* ── Ficha técnica ── */}
          <section className="border-t border-slate-100 pt-5">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ficha técnica</h3>
            <p className="mb-3 text-xs text-slate-400">Opcional — Markdown pegado tal cual.</p>
            {!mostrarFicha ? (
              <button onClick={() => setMostrarFicha(true)}
                className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
                <FileText size={14} /> Agregar ficha técnica
              </button>
            ) : (
              <div className="space-y-2">
                <textarea value={fichaMd} onChange={e => setFichaMd(e.target.value)}
                  rows={12} placeholder="Pegá acá el Markdown de la ficha técnica…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-slate-500 focus:outline-none" />
                <button onClick={() => { setMostrarFicha(false); setFichaMd(""); }}
                  className="text-xs text-slate-500 underline">Quitar</button>
              </div>
            )}
          </section>

          <button onClick={crear} disabled={guardando}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {guardando ? <Loader size={15} className="animate-spin" /> : <Save size={15} />}
            {guardando ? "Creando…" : "Crear producto"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CampoPrecio({ icono: Icono, label, value, onChange }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
      <Icono size={16} className="shrink-0 text-slate-400" />
      <p className="min-w-0 flex-1 text-sm font-medium text-slate-700">{label}</p>
      <div className="flex items-center gap-1">
        <span className="text-sm text-slate-400">Bs</span>
        <input type="number" min={0} step="0.01" value={value} onChange={e => onChange(e.target.value)}
          placeholder="0.00"
          className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm focus:border-slate-500 focus:outline-none" />
      </div>
    </div>
  );
}
