/**
 * TableroAlmacenApp.jsx — Tablero de pedidos + Venta Directa para TV del
 * almacén, estilo pantalla de cocina (KDS): tres columnas fijas, sin
 * interacción, pensado para leerse de lejos. Ruta propia /tablero (ver
 * App.jsx), fuera del shell de pestañas — esta pantalla no lleva sidebar
 * ni topbar de la app.
 *
 * La clasificación en columnas vive en lib/tablero.js (clasificar) y usa
 * tal cual lineas_total/lineas_resueltas / estado de venta que ya traen las
 * vistas — no se reinventa acá qué es una línea "resuelta" ni cuándo una
 * VTD está lista.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader, PackageSearch, Volume2, Zap } from "lucide-react";
import { fetchTablero, fetchVentasDirectas, clasificar, suscribirTablero } from "./lib/tablero";
import { anunciar } from "./lib/vozTablero";

const REFRESCO_RESPALDO_MS = 30000;
const RESALTE_NUEVA_MS = 15000;

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

function Tarjeta({ item, esListo, esNueva }) {
  const esVtd = item.tipo === "vtd";
  const desde = esListo ? (item.ultimo_movimiento_en || item.completado_en || item.creado_en) : item.creado_en;
  return (
    <div className={`glass-kds-card rounded-2xl border-2 bg-slate-900 p-6 shadow-lg transition-colors duration-700 ${
      esNueva ? "border-cyan-400" : "border-slate-700"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-4xl font-bold tracking-tight text-white">
          {item.numero || `#${item.id}`}
        </span>
        {esVtd ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-orange-800 bg-orange-950 px-3 py-1.5 text-base font-bold uppercase tracking-wide text-orange-200">
            <Zap size={17} /> Venta directa
          </span>
        ) : (
          <span className={`shrink-0 rounded-full px-3 py-1.5 text-base font-bold uppercase tracking-wide ${badgeCategoria(item.categoria).cls}`}>
            {badgeCategoria(item.categoria).label}
          </span>
        )}
      </div>
      {!esVtd && <p className="mt-3 truncate text-2xl text-slate-200">{item.titulo || "—"}</p>}
      <p className="mt-3 text-xl font-medium text-slate-400">{tiempoRelativo(desde)}</p>
      {!esListo && !esVtd && (
        <p className="mt-1 text-lg text-slate-500">
          {item.lineas_resueltas}/{item.lineas_total} líneas
        </p>
      )}
    </div>
  );
}

function Columna({ config, items, idsNuevos }) {
  return (
    <div className={`glass-kds-column flex min-h-0 flex-col rounded-2xl border-t-8 bg-slate-950 ${config.acento}`}>
      <div className="flex items-center gap-3 px-6 py-5">
        <span className={`h-5 w-5 rounded-full ${config.puntito}`} />
        <h2 className="text-3xl font-extrabold uppercase tracking-wide text-white">{config.titulo}</h2>
        <span className="ml-auto text-3xl font-bold text-slate-500">{items.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6">
        {items.length === 0 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-slate-700 text-center">
            <p className="text-2xl font-medium text-slate-600">Sin pedidos en {config.titulo.toLowerCase()}</p>
          </div>
        ) : (
          items.map((it) => (
            <Tarjeta
              key={`${it.tipo}-${it.id}`}
              item={it}
              esListo={config.id === "listo"}
              esNueva={idsNuevos[it.tipo]?.has(it.id) ?? false}
            />
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
  const [sonidoActivado, setSonidoActivado] = useState(false);
  const [horaActual, setHoraActual] = useState(() => new Date());
  // { pedidos: Set<id>, vtd: Set<id> } — ids de items en Pendiente que
  // acaban de aparecer, para el borde de acento de ~15s.
  const [idsNuevos, setIdsNuevos] = useState({ pedidos: new Set(), vtd: new Set() });

  // null hasta la primera carga — no se anuncia nada en el fetch inicial,
  // solo en altas reales detectadas contra la carga anterior.
  const idsPendientesPrev = useRef(null);
  // Timeouts de resalte "recién aparecida" pendientes, para poder
  // limpiarlos si el componente se desmonta antes de que disparen.
  const timeoutsResalte = useRef([]);

  const detectarNuevos = useCallback((cols) => {
    const idsPedidosPendientes = new Set(
      cols.pendiente.filter((i) => i.tipo === "pedido").map((i) => i.id)
    );
    const idsVtdPendientes = new Set(
      cols.pendiente.filter((i) => i.tipo === "vtd").map((i) => i.id)
    );

    if (idsPendientesPrev.current) {
      const { pedidos: prevPedidos, vtd: prevVtd } = idsPendientesPrev.current;
      const nuevosPedidos = [];
      const nuevosVtd = [];
      for (const id of idsPedidosPendientes) {
        if (!prevPedidos.has(id)) { anunciar("Pedido nuevo"); nuevosPedidos.push(id); }
      }
      for (const id of idsVtdPendientes) {
        if (!prevVtd.has(id)) { anunciar("Nueva venta directa"); nuevosVtd.push(id); }
      }

      if (nuevosPedidos.length > 0 || nuevosVtd.length > 0) {
        setIdsNuevos((prev) => ({
          pedidos: new Set([...prev.pedidos, ...nuevosPedidos]),
          vtd: new Set([...prev.vtd, ...nuevosVtd]),
        }));
        const t = setTimeout(() => {
          setIdsNuevos((prev) => ({
            pedidos: new Set([...prev.pedidos].filter((id) => !nuevosPedidos.includes(id))),
            vtd: new Set([...prev.vtd].filter((id) => !nuevosVtd.includes(id))),
          }));
        }, RESALTE_NUEVA_MS);
        timeoutsResalte.current.push(t);
      }
    }

    idsPendientesPrev.current = { pedidos: idsPedidosPendientes, vtd: idsVtdPendientes };
  }, []);

  const cargar = useCallback(async () => {
    try {
      const [pedidos, ventasDirectas] = await Promise.all([fetchTablero(), fetchVentasDirectas()]);
      const cols = clasificar(pedidos, ventasDirectas);
      setColumnas(cols);
      detectarNuevos(cols);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, [detectarNuevos]);

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
      timeoutsResalte.current.forEach(clearTimeout);
      timeoutsResalte.current = [];
    };
  }, [cargar]);

  // Reloj de la barra superior — con su propio intervalo, no depende del
  // refetch de datos (que puede tardar o fallar sin que la hora se congele).
  useEffect(() => {
    const id = setInterval(() => setHoraActual(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  function activarSonido() {
    // Un solo anuncio disparado por el gesto del usuario — Chrome bloquea
    // audio hasta el primer click en la pestaña; esto lo desbloquea para
    // el resto de la sesión de esta pestaña (no se persiste, ver brief).
    anunciar("Sonido activado");
    setSonidoActivado(true);
  }

  return (
    <div className="glass-kds flex h-screen w-full flex-col overflow-hidden bg-slate-950 p-6">
      {!sonidoActivado && (
        <button
          onClick={activarSonido}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/95"
        >
          <Volume2 size={72} className="text-white" />
          <span className="text-4xl font-extrabold text-white">Activar sonido</span>
          <span className="text-lg text-slate-400">Tocá la pantalla para habilitar los anuncios de voz</span>
        </button>
      )}

      <header className="mb-5 flex items-center gap-3">
        <PackageSearch size={36} className="text-slate-400" />
        <h1 className="text-4xl font-extrabold text-white">Tablero de Almacén</h1>
        {cargando && <Loader size={24} className="ml-2 animate-spin text-slate-500" />}
        <div className="ml-auto flex items-center gap-5">
          {error && (
            <span className="rounded-lg bg-red-950 px-3 py-1.5 text-sm font-medium text-red-300">
              Error actualizando: {error}
            </span>
          )}
          {/* Indicador estático por ahora — suscribirTablero no reporta
              todavía el estado del canal (conectado/reconectando). Cablear
              eso es una mejora pendiente, no bloquea esta pantalla porque
              el respaldo de 30s ya cubre una desconexión silenciosa. */}
          <span className="flex items-center gap-2 text-lg font-semibold text-emerald-400">
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
            En vivo
          </span>
          <span className="text-3xl font-bold tabular-nums text-white">
            {horaActual.toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-6">
        {COLUMNAS.map((c) => (
          <Columna key={c.id} config={c} items={columnas[c.id]} idsNuevos={idsNuevos} />
        ))}
      </div>
    </div>
  );
}
