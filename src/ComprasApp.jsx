import { useState, useEffect, useCallback } from "react";
import { ShoppingBag, Loader, AlertTriangle, CheckCircle2, Printer, PackagePlus } from "lucide-react";
import { supabase } from "./supabaseClient";
import { useUsuarioActual } from "./lib/useAuth";
import { registrarEntradaCompra } from "./lib/operaciones";

/* ── helpers locales (mismos que PedidosApp, sin exportar desde ahí para
 * no tocar ese archivo más de lo necesario) ────────────────────────── */
function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/*
 * Compras — Faltantes de tandas (cerrar_tanda_pedido)
 * ════════════════════════════════════════════════════════════════════
 * Un pedido con tanda_de_id apunta a otro pedido: nació porque
 * cerrar_tanda_pedido movió ahí lo que no se pudo despachar en la tanda
 * anterior. Esta pantalla es donde Compras registra qué de eso consiguió
 * comprar y cuánto — eso agrega STOCK REAL (kardex ENTRADA en la ubicación
 * de recepción de la sucursal), no solo cierra la línea. El despacho en sí
 * lo sigue haciendo el almacenero por el flujo normal de Pedidos, una vez
 * que el stock ya está disponible.
 *
 * No hace comprar_directo (ese cierra la línea SIN tocar Kardex — es para
 * cuando no tiene sentido reponer stock general, un caso distinto).
 */
export default function ComprasApp() {
  const usuarioActual = useUsuarioActual();
  const [pedidos, setPedidos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(null); // id del pedido expandido

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data: hijos } = await supabase
      .from("pedido")
      .select("id, tanda_de_id, numero_tanda, referencia, creado_en, cliente:cliente_id(nombre)")
      .not("tanda_de_id", "is", null)
      .neq("estado", "CANCELADO")
      .order("creado_en", { ascending: false });

    const ids = (hijos || []).map((p) => p.id);
    if (!ids.length) { setPedidos([]); setCargando(false); return; }

    const { data: lineas } = await supabase
      .from("pedido_linea")
      .select(`
        id, pedido_id, cantidad_base, cantidad_presentacion, presentacion_id, sucursal_origen_id, descripcion, nota,
        producto:producto_id(id, nombre, sku_interno, unidad_base),
        presentacion:presentacion_id(nombre, factor_unidad_base)
      `)
      .in("pedido_id", ids)
      .in("estado", ["POR_DESPACHAR", "PENDIENTE"])
      .order("id");

    const porPedido = new Map();
    for (const l of lineas || []) {
      if (!porPedido.has(l.pedido_id)) porPedido.set(l.pedido_id, []);
      porPedido.get(l.pedido_id).push(l);
    }

    // solo pedidos que todavía tienen algo sin comprar/despachar
    const conFaltante = (hijos || [])
      .map((p) => ({ ...p, lineas: porPedido.get(p.id) || [] }))
      .filter((p) => p.lineas.length > 0);

    setPedidos(conFaltante);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (cargando) {
    return <div className="py-16 text-center text-slate-400"><Loader size={20} className="mx-auto animate-spin" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto pt-4 px-4 pb-16 space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <ShoppingBag size={20} /> Compras — faltantes de tandas
        </h1>
        {pedidos.length > 0 && (
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Printer size={15} /> Imprimir todo
          </button>
        )}
      </div>

      {pedidos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center print:hidden">
          <PackagePlus size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">No hay faltantes pendientes de comprar.</p>
        </div>
      ) : (
        pedidos.map((p) => (
          <PedidoFaltante key={p.id} pedido={p} abierto={abierto === p.id}
            onToggle={() => setAbierto(abierto === p.id ? null : p.id)}
            usuario={usuarioActual.nombre} onRegistrado={cargar} />
        ))
      )}
    </div>
  );
}

function PedidoFaltante({ pedido, abierto, onToggle, usuario, onRegistrado }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-white overflow-hidden break-inside-avoid">
      <button onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-amber-50/50 print:hidden">
        <span className="font-mono text-xs text-slate-400">#{pedido.id}</span>
        <span className="text-sm font-medium text-amber-700">Tanda {pedido.numero_tanda}</span>
        <span className="flex-1 truncate text-sm text-slate-600">
          {pedido.cliente?.nombre || pedido.referencia || "—"} — pedido origen #{pedido.tanda_de_id}
        </span>
        <span className="text-xs text-slate-400">{pedido.lineas.length} ítem(s)</span>
      </button>

      {/* encabezado solo para impresión — igual estilo que ReporteImpresionPedido */}
      <div className="hidden print:block px-4 pt-3">
        <h2 className="text-lg font-bold text-slate-900">Faltante — Pedido #{pedido.id} (Tanda {pedido.numero_tanda})</h2>
        <p className="text-sm text-slate-600">
          {pedido.cliente?.nombre && <>Cliente: {pedido.cliente.nombre} — </>}
          Origen: pedido #{pedido.tanda_de_id}
        </p>
      </div>

      <table className={`w-full border-collapse text-sm print:table ${abierto ? "" : "hidden print:table"}`}>
        <thead>
          <tr className="border-y border-slate-200 bg-slate-50 text-left print:border-b-2 print:border-slate-800 print:bg-transparent">
            <th className="py-2 pl-4 pr-2 font-medium text-slate-500 print:font-semibold print:text-slate-800">Producto</th>
            <th className="py-2 pr-2 font-medium text-slate-500 print:font-semibold print:text-slate-800">Falta</th>
            <th className="py-2 pr-2 font-medium text-slate-500 print:hidden">Comprado</th>
            <th className="py-2 pr-2 font-medium text-slate-500 print:hidden">Costo unit.</th>
            <th className="py-2 pr-4 font-medium text-slate-500 print:hidden"></th>
            <th className="hidden py-2 pr-2 font-semibold text-slate-800 print:table-cell">Comprado: ___</th>
            <th className="hidden py-2 pr-4 font-semibold text-slate-800 print:table-cell">Costo: ___</th>
          </tr>
        </thead>
        <tbody>
          {pedido.lineas.map((l) => (
            <FilaCompra key={l.id} linea={l} usuario={usuario} onRegistrado={onRegistrado} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilaCompra({ linea, usuario, onRegistrado }) {
  const [cantidad, setCantidad] = useState(String(linea.cantidad_presentacion ?? linea.cantidad_base ?? ""));
  const [costo, setCosto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState(false);
  const [error, setError] = useState(null);

  const unidadPres = linea.presentacion?.nombre || linea.producto?.unidad_base || "";

  async function registrar() {
    const cant = Number(cantidad);
    if (!cant || cant <= 0) { setError("Cantidad inválida"); return; }
    setGuardando(true);
    setError(null);
    const { error: err } = await registrarEntradaCompra({
      presentacionId: linea.presentacion_id,
      sucursalId: linea.sucursal_origen_id,
      cantidadPres: cant,
      costoUnitario: costo ? Number(costo) : null,
      referencia: `Compra faltante — Pedido #${linea.pedido_id} línea ${linea.id}`,
      usuario,
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    setHecho(true);
    onRegistrado();
  }

  if (hecho) {
    return (
      <tr className="border-b border-slate-100 bg-emerald-50/60">
        <td className="py-2 pl-4 pr-2 text-slate-700">{linea.producto?.nombre || linea.descripcion}</td>
        <td colSpan={4} className="py-2 pr-4 text-emerald-700">
          <span className="flex items-center gap-1.5"><CheckCircle2 size={14} /> Entrada registrada — ya disponible para despachar.</span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-2 pl-4 pr-2">
        <p className="font-medium text-slate-900">{linea.producto?.nombre || linea.descripcion}</p>
        {linea.producto?.sku_interno && <p className="text-xs text-slate-500">{linea.producto.sku_interno}</p>}
      </td>
      <td className="py-2 pr-2 whitespace-nowrap text-slate-600">
        {cantidadFmt(linea.cantidad_presentacion ?? linea.cantidad_base)} {unidadPres}
      </td>
      <td className="py-2 pr-2 print:hidden">
        <input type="number" min="0" step="0.01" value={cantidad} onChange={(e) => setCantidad(e.target.value)}
          className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm" />
      </td>
      <td className="py-2 pr-2 print:hidden">
        <input type="number" min="0" step="0.01" placeholder="opcional" value={costo} onChange={(e) => setCosto(e.target.value)}
          className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm" />
      </td>
      <td className="py-2 pr-4 print:hidden">
        <button onClick={registrar} disabled={guardando}
          className="flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">
          {guardando ? <Loader size={12} className="animate-spin" /> : <PackagePlus size={12} />}
          Registrar
        </button>
        {error && <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertTriangle size={11} /> {error}</p>}
      </td>
      <td className="hidden py-3 pr-2 print:table-cell">&nbsp;</td>
      <td className="hidden py-3 pr-4 print:table-cell">&nbsp;</td>
    </tr>
  );
}
