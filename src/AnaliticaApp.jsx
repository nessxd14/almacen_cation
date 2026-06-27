import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/AuthProvider";
import {
  DollarSign, Boxes, AlertTriangle, TrendingDown, Gauge, CalendarClock,
  PackageSearch, Wallet,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function precioFmt(v) {
  if (v == null) return "—";
  return new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB" }).format(v);
}
function numFmt(v, dec = 0) {
  const n = Number(v || 0);
  return n.toLocaleString("es-BO", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function Tarjeta({ icono: Icono, etiqueta, valor, sub, acento = "slate" }) {
  const acentos = {
    slate: "text-slate-400", emerald: "text-emerald-500",
    amber: "text-amber-500", red: "text-red-500",
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
export default function AnaliticaApp() {
  const { esAdmin } = useAuth();
  const [vista, setVista] = useState("valuacion"); // valuacion | reorden
  const [valuacion, setValuacion] = useState([]);
  const [reorden, setReorden] = useState([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [{ data: val }, { data: reo }] = await Promise.all([
      supabase.from("v_valuacion_inventario").select("*").order("valor_inventario", { ascending: false }),
      supabase.from("v_analitica_reorden").select("*").order("necesita_reorden", { ascending: false }),
    ]);
    setValuacion(val || []);
    setReorden(reo || []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Edición inline de los puntos de control (solo admin).
  async function guardarCampo(productoId, campo, valor) {
    const num = valor === "" ? null : Number(valor);
    await supabase.from("producto").update({ [campo]: num }).eq("id", productoId);
    setReorden(prev => prev.map(r =>
      r.producto_id === productoId ? { ...r, [campo]: num } : r));
  }

  const valorTotal = valuacion.reduce((s, r) => s + Number(r.valor_inventario || 0), 0);
  const unidadesTotal = valuacion.reduce((s, r) => s + Number(r.cantidad_actual || 0), 0);
  const nReorden = reorden.filter(r => r.necesita_reorden).length;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-slate-800">Costos y analítica</h1>
        <p className="text-sm text-slate-500">Valuación del inventario a costo promedio y señales de reposición</p>
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Tarjeta icono={Wallet} etiqueta="Valor a costo" valor={precioFmt(valorTotal)}
          sub="Promedio ponderado móvil" acento="emerald" />
        <Tarjeta icono={Boxes} etiqueta="Unidades en stock" valor={cantidadFmt(unidadesTotal)} acento="slate" />
        <Tarjeta icono={AlertTriangle} etiqueta="Necesitan reorden" valor={nReorden}
          sub={`${reorden.length} productos activos`} acento={nReorden > 0 ? "amber" : "slate"} />
      </div>

      {/* Selector de vista */}
      <div className="mb-3 flex rounded-lg border border-slate-300 p-0.5 text-sm w-fit">
        {[
          { id: "valuacion", label: "Valuación", icon: DollarSign },
          { id: "reorden",   label: "Reorden",   icon: Gauge },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setVista(id)}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 font-medium
              ${vista === id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          {cargando ? (
            <p className="px-3 py-10 text-center text-slate-400">Cargando…</p>
          ) : vista === "valuacion" ? (
            <TablaValuacion filas={valuacion} />
          ) : (
            <TablaReorden filas={reorden} esAdmin={esAdmin} onGuardar={guardarCampo} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tabla de valuación ──────────────────────────────────────────────────────
function TablaValuacion({ filas }) {
  if (filas.length === 0) {
    return <p className="px-3 py-10 text-center text-slate-400">Sin datos de valuación todavía.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <th className="px-3 py-2">Producto</th>
          <th className="px-3 py-2 text-right">Cantidad</th>
          <th className="px-3 py-2 text-right">Costo prom.</th>
          <th className="px-3 py-2 text-right">Valor</th>
          <th className="px-3 py-2 text-right">Precio venta</th>
          <th className="px-3 py-2 text-right">Margen</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {filas.map(r => {
          const margen = (r.precio_base != null && Number(r.costo_promedio) > 0)
            ? (Number(r.precio_base) - Number(r.costo_promedio)) / Number(r.precio_base) * 100
            : null;
          return (
            <tr key={r.producto_id} className="hover:bg-slate-50">
              <td className="px-3 py-2.5">
                <p className="font-medium text-slate-800">{r.producto_nombre}</p>
                {r.sku_interno && <p className="text-xs text-slate-400">{r.sku_interno}</p>}
              </td>
              <td className="px-3 py-2.5 text-right text-slate-600">{cantidadFmt(r.cantidad_actual)} {r.unidad_base}</td>
              <td className="px-3 py-2.5 text-right text-slate-600">{precioFmt(r.costo_promedio)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{precioFmt(r.valor_inventario)}</td>
              <td className="px-3 py-2.5 text-right text-slate-500">{precioFmt(r.precio_base)}</td>
              <td className="px-3 py-2.5 text-right">
                {margen == null ? <span className="text-slate-300">—</span>
                  : <span className={margen >= 0 ? "text-emerald-600" : "text-red-600"}>{numFmt(margen, 1)}%</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Tabla de reorden ────────────────────────────────────────────────────────
function TablaReorden({ filas, esAdmin, onGuardar }) {
  if (filas.length === 0) {
    return <p className="px-3 py-10 text-center text-slate-400">Sin productos activos.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <th className="px-3 py-2">Producto</th>
          <th className="px-3 py-2 text-right">Stock</th>
          <th className="px-3 py-2 text-right">Reorden</th>
          <th className="px-3 py-2 text-right">Mínimo</th>
          <th className="px-3 py-2 text-right">Vendido 30d</th>
          <th className="px-3 py-2 text-right"><Gauge size={12} className="inline" /> /día</th>
          <th className="px-3 py-2 text-right"><CalendarClock size={12} className="inline" /> Cobertura</th>
          <th className="px-3 py-2 text-center">Estado</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {filas.map(r => (
          <tr key={r.producto_id} className={`hover:bg-slate-50 ${r.necesita_reorden ? "bg-amber-50/40" : ""}`}>
            <td className="px-3 py-2.5">
              <p className="font-medium text-slate-800">{r.producto_nombre}</p>
              {r.sku_interno && <p className="text-xs text-slate-400">{r.sku_interno}</p>}
            </td>
            <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{cantidadFmt(r.stock_actual)}</td>
            <td className="px-3 py-2.5 text-right">
              <CampoEditable valor={r.punto_reorden} editable={esAdmin}
                onGuardar={v => onGuardar(r.producto_id, "punto_reorden", v)} />
            </td>
            <td className="px-3 py-2.5 text-right">
              <CampoEditable valor={r.stock_min} editable={esAdmin}
                onGuardar={v => onGuardar(r.producto_id, "stock_min", v)} />
            </td>
            <td className="px-3 py-2.5 text-right text-slate-600">{cantidadFmt(r.vendido_30d)}</td>
            <td className="px-3 py-2.5 text-right text-slate-500">{numFmt(r.velocidad_diaria, 2)}</td>
            <td className="px-3 py-2.5 text-right text-slate-500">
              {r.dias_cobertura == null ? "—" : `${numFmt(r.dias_cobertura, 0)} d`}
            </td>
            <td className="px-3 py-2.5 text-center">
              {r.necesita_reorden
                ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"><TrendingDown size={11} /> Reordenar</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><PackageSearch size={11} /> OK</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Input inline: muestra el valor; si es admin permite editarlo (guarda en blur).
function CampoEditable({ valor, editable, onGuardar }) {
  const [local, setLocal] = useState(valor ?? "");
  useEffect(() => { setLocal(valor ?? ""); }, [valor]);

  if (!editable) {
    return <span className="text-slate-600">{valor == null ? "—" : cantidadFmt(valor)}</span>;
  }
  return (
    <input
      type="number" min={0} value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (String(local) !== String(valor ?? "")) onGuardar(local); }}
      placeholder="—"
      className="w-20 rounded border border-slate-300 px-2 py-0.5 text-right text-sm focus:border-slate-500 focus:outline-none"
    />
  );
}
