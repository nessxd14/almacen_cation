/**
 * TableroAlmacenApp.jsx — Tablero de pedidos para TV del almacén, estilo
 * pantalla de cocina (KDS): tres columnas fijas, sin interacción, pensado
 * para leerse de lejos. Ruta propia /tablero (ver App.jsx), fuera del shell
 * de pestañas — esta pantalla no lleva sidebar ni topbar de la app.
 *
 * La clasificación en columnas vive en lib/tablero.js (clasificar) y usa
 * tal cual lineas_total/lineas_resueltas que ya trae v_tablero_almacen_pedidos
 * — no se reinventa acá qué es una línea "resuelta".
 */
import { useCallback, useEffect, useState } from "react";
import { Loader, PackageSearch } from "lucide-react";
import { fetchTablero, clasificar, suscribirTablero } from "./lib/tablero";

const REFRESCO_RESPALDO_MS = 30000;

const CATEGORIA_ESTILOS = {
  MAYOR:         { label: "Mayoreo",       cls: "bg-amber-500 text-slate-950" },
  TIENDA:        { label: "Tienda directa", cls: "bg-sky-500 text-slate-950" },
  INSTITUCIONAL: { label: "Institucional", cls: "bg-violet-500 text-slate-950" },
  MUNICIPAL:     { label: "Corporativo",   cls: "bg-fuchsia-500 text-slate-950" },
  CORPORATIVO:   { label: "Corporativo",   cls: "bg-fuchsia-500 text-slate-950" },
};

function badgeCategoria(categoria) {
  return CATEGORIA_ESTILOS[categoria] || { label: categoria || "—", cls: "bg-slate-500 text-slate-950" };
}

function tiempoRelativo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const restoMin = min % 60;
  return restoMin > 0 ? `hace ${h}h ${restoMin}min` : `hace ${h}h`;
}

const COLUMNAS = [
  { id: "pendiente",   titulo: "Pendiente",       acento: "border-red-500",     puntito: "bg-red-500" },
  { id: "preparacion", titulo: "En preparación",  acento: "border-amber-500",   puntito: "bg-amber-500" },
  { id: "listo",       titulo: "Listo",           acento: "border-emerald-500", puntito: "bg-emerald-500" },
];

function TarjetaPedido({ pedido, esListo }) {
  const cat = badgeCategoria(pedido.categoria);
  const desde = esListo ? (pedido.ultimo_movimiento_en || pedido.creado_en) : pedido.creado_en;
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <span className="text-3xl font-bold tracking-tight text-white">
          {pedido.numero || `#${pedido.id}`}
        </span>
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold uppercase tracking-wide ${cat.cls}`}>
          {cat.label}
        </span>
      </div>
      <p className="mt-2 truncate text-xl text-slate-200">{pedido.titulo || "—"}</p>
      <p className="mt-3 text-lg font-medium text-slate-400">{tiempoRelativo(desde)}</p>
      {!esListo && (
        <p className="mt-1 text-base text-slate-500">
          {pedido.lineas_resueltas}/{pedido.lineas_total} líneas
        </p>
      )}
    </div>
  );
}

function Columna({ config, pedidos }) {
  return (
    <div className={`flex min-h-0 flex-col rounded-2xl border-t-8 bg-slate-950 ${config.acento}`}>
      <div className="flex items-center gap-3 px-5 py-4">
        <span className={`h-4 w-4 rounded-full ${config.puntito}`} />
        <h2 className="text-2xl font-extrabold uppercase tracking-wide text-white">{config.titulo}</h2>
        <span className="ml-auto text-2xl font-bold text-slate-500">{pedidos.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
        {pedidos.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-slate-700 text-center">
            <p className="text-xl font-medium text-slate-600">Sin pedidos en {config.titulo.toLowerCase()}</p>
          </div>
        ) : (
          pedidos.map((p) => (
            <TarjetaPedido key={p.id} pedido={p} esListo={config.id === "listo"} />
          ))
        )}
      </div>
    </div>
  );
}

export default function TableroAlmacenApp() {
  const [columnas, setColumnas] = useState({ pendiente: [], preparacion: [], listo: [] });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const pedidos = await fetchTablero();
      setColumnas(clasificar(pedidos));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(cargar, 0);
    const cancelarSuscripcion = suscribirTablero(cargar);
    // Respaldo por si el WebSocket de Realtime se cae y no reconecta solo
    // — la pantalla no tiene a nadie mirándola de cerca para notar que se
    // congeló, así que igual se refresca sola cada 30s.
    const intervalo = setInterval(cargar, REFRESCO_RESPALDO_MS);
    return () => {
      clearTimeout(t);
      cancelarSuscripcion();
      clearInterval(intervalo);
    };
  }, [cargar]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-slate-950 p-6">
      <header className="mb-5 flex items-center gap-3">
        <PackageSearch size={32} className="text-slate-400" />
        <h1 className="text-3xl font-extrabold text-white">Tablero de Almacén</h1>
        {cargando && <Loader size={22} className="ml-2 animate-spin text-slate-500" />}
        {error && (
          <span className="ml-auto rounded-lg bg-red-950 px-3 py-1.5 text-sm font-medium text-red-300">
            Error actualizando: {error}
          </span>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-6">
        {COLUMNAS.map((c) => (
          <Columna key={c.id} config={c} pedidos={columnas[c.id]} />
        ))}
      </div>
    </div>
  );
}
