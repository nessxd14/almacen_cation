/**
 * FaltantesApp.jsx — W6: pantalla de faltantes (brief "reserva de stock y
 * faltantes").
 *
 * Lee v_faltante_producto, ya calculado en la base con FIFO (reserva de
 * clientes primero, reposición después) — acá no se reimplementa ese
 * cálculo, solo se consume y se ordena/presenta.
 *
 * No mezcla el negativo de Tienda en control LIBRE (W3, "vendido sin
 * contar") con esto: son cosas distintas y la vista ya las separa.
 *
 * W-PC2 (Ness 2026-10-08): la bandeja de Compras que vivía acá como una
 * segunda vista (brief W-PC) se retiró — Compras es ahora una sola pantalla
 * en src/ComprasApp.jsx. Lo único que queda de esa integración es el aviso
 * de abajo, con el mismo conteo liviano que ya se usaba.
 */
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { ordenarFaltantes } from "./lib/faltantes";
import { diasDesde } from "./lib/fechas";
import { useAppNav } from "./lib/useAppNav";
import { AlertTriangle, PackageCheck, ImageOff, Loader, RefreshCw, Clock, ShoppingCart } from "lucide-react";

function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

function BadgeFaltante({ valor, tipo }) {
  if (!valor) return <span className="text-xs text-slate-300">—</span>;
  const estilos = tipo === "clientes"
    ? "bg-red-100 text-red-700"
    : "bg-amber-100 text-amber-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${estilos}`}>
      {cantidadFmt(valor)}
    </span>
  );
}

function FilaFaltante({ f }) {
  const dias = diasDesde(f.pedido_mas_viejo);
  return (
    <tr className="hover:bg-slate-50 align-top">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {f.imagen_url
            ? <img src={f.imagen_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
            : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100"><ImageOff size={13} className="text-slate-300" /></div>}
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800">{f.producto_nombre}</p>
            {(f.marca || f.sku_interno) && (
              <p className="truncate text-xs text-slate-400">{[f.marca, f.sku_interno].filter(Boolean).join(" · ")}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-sm text-slate-600">{cantidadFmt(f.stock_fisico)} {f.unidad_base}</td>
      <td className="px-3 py-2.5 whitespace-nowrap text-sm text-slate-600">{cantidadFmt(f.comprometido)} {f.unidad_base}</td>
      <td className="px-3 py-2.5 whitespace-nowrap"><BadgeFaltante valor={f.faltanteClientes} tipo="clientes" /></td>
      <td className="px-3 py-2.5 whitespace-nowrap"><BadgeFaltante valor={f.faltanteReposicion} tipo="reposicion" /></td>
      <td className="px-3 py-2.5 whitespace-nowrap text-sm text-slate-500">
        {dias == null ? "—" : (
          <span className="inline-flex items-center gap-1">
            <Clock size={11} className={dias >= 14 ? "text-red-500" : dias >= 7 ? "text-amber-500" : "text-slate-400"} />
            {dias === 0 ? "hoy" : `${dias} día${dias === 1 ? "" : "s"}`}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 max-w-xs">
        <p className="truncate text-xs text-slate-500" title={f.pedidos_en_espera || ""}>{f.pedidos_en_espera || "—"}</p>
      </td>
    </tr>
  );
}

export default function FaltantesApp() {
  const { setTab } = useAppNav();
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [comprasPendientes, setComprasPendientes] = useState(null);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from("v_faltante_producto")
      .select("*");
    setFilas(ordenarFaltantes(data || []));
    setCargando(false);
  }

  useEffect(() => { cargar(); }, []);

  // Aviso liviano de compras pendientes — mismo conteo head:true del brief
  // W-PC, ahora leído directo acá en vez de en el interruptor que se retiró.
  useEffect(() => {
    let activo = true;
    supabase.from("v_compras_pendientes").select("solicitud_id", { count: "exact", head: true })
      .then(({ count }) => { if (activo && count != null) setComprasPendientes(count); });
    return () => { activo = false; };
  }, []);

  const totalClientes = filas.reduce((s, f) => s + f.faltanteClientes, 0);
  const totalReposicion = filas.reduce((s, f) => s + f.faltanteReposicion, 0);

  return (
    <div className="max-w-5xl mx-auto pt-4 px-4 pb-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <AlertTriangle size={20} /> Faltantes
        </h1>
        <button onClick={cargar}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      {comprasPendientes > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          <span className="flex items-center gap-1.5">
            <ShoppingCart size={14} />
            {comprasPendientes} compra{comprasPendientes === 1 ? "" : "s"} pendiente{comprasPendientes === 1 ? "" : "s"}
          </span>
          <button onClick={() => setTab("compras")}
            className="rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">
            Ver en Compras
          </button>
        </div>
      )}

      {!cargando && filas.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-lg bg-red-50 px-3 py-1.5 text-red-700">
            <span className="font-semibold">{cantidadFmt(totalClientes)}</span> unidades le debemos a clientes
          </span>
          <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-700">
            <span className="font-semibold">{cantidadFmt(totalReposicion)}</span> unidades de reposición sin cubrir
          </span>
        </div>
      )}

      {cargando ? (
        <div className="py-16 text-center text-slate-400">
          <Loader size={16} className="mx-auto animate-spin" />
        </div>
      ) : filas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <PackageCheck size={32} className="mx-auto mb-3 text-emerald-300" />
          <p className="text-sm text-slate-500">Todos los pedidos abiertos se pueden cubrir con el stock actual.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5">Producto</th>
                <th className="px-3 py-2.5">Stock físico</th>
                <th className="px-3 py-2.5">Comprometido</th>
                <th className="px-3 py-2.5">Faltante clientes</th>
                <th className="px-3 py-2.5">Faltante reposición</th>
                <th className="px-3 py-2.5">Desde</th>
                <th className="px-3 py-2.5">Pedidos esperando</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.map((f) => <FilaFaltante key={f.producto_id} f={f} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
