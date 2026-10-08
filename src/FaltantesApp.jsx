/**
 * FaltantesApp.jsx — W6: pantalla de faltantes (brief "reserva de stock y
 * faltantes") + W-PC: bandeja de Compras (lo que se mandó a comprar desde un
 * pedido: SOLICITADA -> COMPRADA -> RECIBIDA, o CANCELADA).

 * Faltantes: Lee v_faltante_producto, ya calculado en la base con FIFO
 * (reserva de clientes primero, reposición después) — acá no se
 * reimplementa ese cálculo, solo se consume y se ordena/presenta.
 *
 * No mezcla el negativo de Tienda en control LIBRE (W3, "vendido sin
 * contar") con esto: son cosas distintas y la vista ya las separa.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "./supabaseClient";
import { ordenarFaltantes } from "./lib/faltantes";
import { ordenarCompras, filtrarCompras, etiquetaEstadoCompra, etiquetaOrigenCompra } from "./lib/compras";
import { diasDesde } from "./lib/fechas";
import { ubicacionesParaOperacion, asegurarAsignacion, marcarCompraComprada, recibirCompra, cancelarCompra } from "./lib/operaciones";
import { useUsuarioActual } from "./lib/useAuth";
import { AlertTriangle, PackageCheck, ImageOff, Loader, RefreshCw, Clock, ShoppingCart, X } from "lucide-react";

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

function VistaFaltantes() {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from("v_faltante_producto")
      .select("*");
    setFilas(ordenarFaltantes(data || []));
    setCargando(false);
  }

  useEffect(() => { cargar(); }, []);

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

/* ── Compras (brief W-PC) ─────────────────────────────────────────────── */

function dineroFmt(v) {
  return Number(v).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCortaFmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-BO", { day: "2-digit", month: "short" });
}

const CHIP_ESTADO = {
  SOLICITADA: "bg-amber-100 text-amber-700",
  COMPRADA: "bg-blue-100 text-blue-700",
};

function FilaCompra({ c, onHecho }) {
  const usuarioActual = useUsuarioActual();
  const [accion, setAccion] = useState(null); // null | "comprar" | "recibir"
  const [costo, setCosto] = useState("");
  const [nota, setNota] = useState("");
  const [ubicaciones, setUbicaciones] = useState([]);
  const [sinAsignacion, setSinAsignacion] = useState(false);
  const [ubicacionId, setUbicacionId] = useState("");
  const [cantidad, setCantidad] = useState(String(c.por_recibir ?? ""));
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState(null);

  const dias = diasDesde(c.solicitado_en);
  const porRecibir = Number(c.por_recibir) || 0;

  async function abrirRecibir() {
    setError(null);
    setAccion("recibir");
    if (c.es_personalizado) return;
    const { ubicaciones: ubs, sinAsignacion: sin } = await ubicacionesParaOperacion({ productoId: c.producto_id, modo: "ENTRADA" });
    setUbicaciones(ubs);
    setSinAsignacion(sin);
    const principal = ubs.find((u) => u.es_principal) ?? ubs[0];
    setUbicacionId(principal ? String(principal.id) : "");
  }

  // Todas las acciones recargan la lista al terminar bien; si el backend
  // rechaza, el mensaje se muestra tal cual.
  async function ejecutar(fn) {
    setTrabajando(true);
    setError(null);
    const { error: err } = await fn();
    setTrabajando(false);
    if (err) { setError("Error: " + err.message); return false; }
    onHecho();
    return true;
  }

  function marcarComprada() {
    if (costo !== "" && !(Number(costo) >= 0)) { setError("El costo no puede ser negativo"); return; }
    return ejecutar(() => marcarCompraComprada({ solicitudId: c.solicitud_id, costoTotal: costo, nota: nota.trim() || null, usuario: usuarioActual.nombre }));
  }

  async function recibir() {
    if (c.es_personalizado) {
      if (!window.confirm("¿Confirmás que llegó este ítem a pedido?")) return;
      await ejecutar(() => recibirCompra({ solicitudId: c.solicitud_id, usuario: usuarioActual.nombre }));
      return;
    }
    const n = Number(cantidad);
    if (!ubicacionId) { setError("Elegí la ubicación donde se recibe"); return; }
    if (!(n > 0) || n > porRecibir) { setError(`La cantidad debe ser mayor que 0 y hasta ${cantidadFmt(porRecibir)}`); return; }
    const uid = Number(ubicacionId);
    const ok = await ejecutar(() => recibirCompra({ solicitudId: c.solicitud_id, ubicacionId: uid, cantidadBase: n, usuario: usuarioActual.nombre }));
    // Igual que una ENTRADA en Operaciones: si el producto no tenía esta ubicación asignada, queda asignada.
    if (ok) await asegurarAsignacion(c.producto_id, uid).catch(() => {});
  }

  async function cancelar() {
    const motivo = window.prompt("Motivo (opcional) para cancelar la compra:");
    if (motivo === null) return;
    await ejecutar(() => cancelarCompra({ solicitudId: c.solicitud_id, motivo: motivo.trim() || null, usuario: usuarioActual.nombre }));
  }

  return (
    <tr className="hover:bg-slate-50 align-top">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {c.imagen_url
            ? <img src={c.imagen_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" />
            : <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100"><ImageOff size={13} className="text-slate-300" /></div>}
          <div className="min-w-0">
            <p className="font-medium text-slate-800">{c.producto_nombre}</p>
            <p className="truncate text-xs text-slate-400">
              {c.es_personalizado ? "Ítem a pedido" : [c.marca, c.sku_interno].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-sm text-slate-600">
        {cantidadFmt(c.por_recibir)} {c.unidad}
        {Number(c.cantidad_recibida) > 0 && (
          <p className="text-xs text-slate-400">recibido {cantidadFmt(c.cantidad_recibida)} de {cantidadFmt(c.cantidad_base)}</p>
        )}
      </td>
      <td className="px-3 py-2.5 text-sm">
        <Link to={`/pedidos/${c.pedido_id}`} className="font-medium text-blue-600 hover:underline">{c.pedido_numero}</Link>
        {c.pedido_titulo && <p className="max-w-[12rem] truncate text-xs text-slate-400" title={c.pedido_titulo}>{c.pedido_titulo}</p>}
      </td>
      <td className="px-3 py-2.5 text-sm text-slate-500">
        <p>{etiquetaOrigenCompra(c.origen)} · {c.solicitado_por}</p>
        <p className="inline-flex items-center gap-1 text-xs">
          <Clock size={11} className={dias >= 14 ? "text-red-500" : dias >= 7 ? "text-amber-500" : "text-slate-400"} />
          {dias == null ? "—" : dias === 0 ? "hoy" : `${dias} día${dias === 1 ? "" : "s"}`}
        </p>
        {c.motivo && <p className="max-w-[12rem] truncate text-xs text-slate-400" title={c.motivo}>{c.motivo}</p>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-sm">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${CHIP_ESTADO[c.estado] || "bg-slate-100 text-slate-600"}`}>
          {etiquetaEstadoCompra(c.estado)}
        </span>
        {c.estado === "COMPRADA" && (
          <p className="mt-0.5 text-xs text-slate-400">
            {c.comprado_por}{c.comprado_en ? ` · ${fechaCortaFmt(c.comprado_en)}` : ""}
            {c.costo_total != null && ` · Bs ${dineroFmt(c.costo_total)}`}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5 min-w-[13rem]">
        {error && (
          <p className="mb-1.5 flex items-start gap-1 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        {accion === "comprar" && (
          <div className="space-y-1.5 rounded-lg border border-blue-200 bg-blue-50 p-2">
            <input type="number" min="0" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="Costo total (opcional)"
              className="w-full rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional)"
              className="w-full rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <div className="flex gap-1.5">
              <button onClick={marcarComprada} disabled={trabajando}
                className="flex-1 rounded-lg bg-blue-600 py-1 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                {trabajando ? "Guardando…" : "Confirmar"}
              </button>
              <button onClick={() => { setAccion(null); setError(null); }} className="rounded-lg border bg-white px-2 py-1 text-xs text-slate-500"><X size={12} /></button>
            </div>
          </div>
        )}

        {accion === "recibir" && !c.es_personalizado && (
          <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
            {sinAsignacion && (
              <p className="flex items-center gap-1 text-xs text-amber-600">
                <AlertTriangle size={12} /> Este producto no tiene ubicaciones asignadas — se asignará automáticamente al recibir.
              </p>
            )}
            <select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}
              className="w-full rounded-lg border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300">
              {ubicaciones.length === 0 && <option value="">Cargando ubicaciones…</option>}
              {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.label}{u.es_principal ? " · principal" : ""}</option>)}
            </select>
            <input type="number" min="0.001" max={porRecibir} step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)}
              aria-label="Cantidad a recibir"
              className="w-full rounded-lg border px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-emerald-300" />
            <div className="flex gap-1.5">
              <button onClick={recibir} disabled={trabajando}
                className="flex-1 rounded-lg bg-emerald-600 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                {trabajando ? "Recibiendo…" : "Confirmar recepción"}
              </button>
              <button onClick={() => { setAccion(null); setError(null); }} className="rounded-lg border bg-white px-2 py-1 text-xs text-slate-500"><X size={12} /></button>
            </div>
          </div>
        )}

        {accion === null && (
          <div className="flex flex-wrap gap-1.5">
            {c.estado === "SOLICITADA" && (
              <button onClick={() => { setError(null); setAccion("comprar"); }} disabled={trabajando}
                className="rounded-lg border border-blue-200 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50">
                Marcar comprada
              </button>
            )}
            <button onClick={c.es_personalizado ? recibir : abrirRecibir} disabled={trabajando}
              className="rounded-lg border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
              Recibir
            </button>
            {!c.es_personalizado && (
              <button onClick={cancelar} disabled={trabajando}
                className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
                Cancelar
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function VistaCompras({ onConteo }) {
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [estado, setEstado] = useState("TODAS");
  const [texto, setTexto] = useState("");

  const aplicar = useCallback(({ data, error }) => {
    if (error) setErrorCarga("Error: " + error.message);
    else {
      setErrorCarga(null);
      const ordenadas = ordenarCompras(data || []);
      setFilas(ordenadas);
      onConteo?.(ordenadas.length);
    }
    setCargando(false);
  }, [onConteo]);

  // Recarga manual (Actualizar y tras cada acción).
  const cargar = useCallback(() => {
    setCargando(true);
    return supabase.from("v_compras_pendientes").select("*").then(aplicar);
  }, [aplicar]);

  // Carga inicial: el setState ocurre dentro del then, no sincrónico en el efecto.
  useEffect(() => {
    let activo = true;
    supabase.from("v_compras_pendientes").select("*").then((r) => { if (activo) aplicar(r); });
    return () => { activo = false; };
  }, [aplicar]);

  const visibles = filtrarCompras(filas, { estado, texto });
  const OPCIONES = [["TODAS", "Todas"], ["SOLICITADA", "Solicitadas"], ["COMPRADA", "Compradas"]];

  return (
    <div className="max-w-5xl mx-auto pt-2 px-4 pb-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <ShoppingCart size={20} /> Compras
        </h1>
        <button onClick={cargar}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {OPCIONES.map(([id, label]) => (
          <button key={id} onClick={() => setEstado(id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${estado === id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar producto, SKU o pedido…"
          className="min-w-[14rem] flex-1 rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
      </div>

      {errorCarga && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle size={12} /> {errorCarga}
        </div>
      )}

      {cargando ? (
        <div className="py-16 text-center text-slate-400"><Loader size={16} className="mx-auto animate-spin" /></div>
      ) : visibles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <PackageCheck size={32} className="mx-auto mb-3 text-emerald-300" />
          <p className="text-sm text-slate-500">No hay compras pendientes.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5">Producto</th>
                <th className="px-3 py-2.5">Cantidad</th>
                <th className="px-3 py-2.5">Pedido</th>
                <th className="px-3 py-2.5">Pedido por</th>
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((c) => <FilaCompra key={c.solicitud_id} c={c} onHecho={cargar} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Pantalla: interruptor Faltantes | Compras ────────────────────────── */
export default function FaltantesApp() {
  const [vista, setVista] = useState("faltantes");
  const [conteo, setConteo] = useState(null);

  // El contador de "Compras" se ve también desde Faltantes: consulta liviana, solo el conteo.
  useEffect(() => {
    let activo = true;
    supabase.from("v_compras_pendientes").select("solicitud_id", { count: "exact", head: true })
      .then(({ count }) => { if (activo && count != null) setConteo(count); });
    return () => { activo = false; };
  }, []);

  const opciones = [
    ["faltantes", "Faltantes"],
    ["compras", conteo != null ? `Compras (${conteo})` : "Compras"],
  ];
  return (
    <div>
      <div className="max-w-5xl mx-auto pt-4 px-4">
        <div role="tablist" className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {opciones.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={vista === id} onClick={() => setVista(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${vista === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {vista === "faltantes" ? <VistaFaltantes /> : <VistaCompras onConteo={setConteo} />}
    </div>
  );
}
