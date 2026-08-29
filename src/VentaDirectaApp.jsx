/**
 * VentaDirectaApp.jsx — Bandeja de preparación de Venta Directa de Almacén (VTD).
 *
 * Ver brief_v1_venta_directa_almacen.md, sección 3 (WMS). Un VTD es una fila
 * de `venta` con estado ABIERTA — el POS la abrió sin tocar Kardex y acá el
 * almacenero la busca, prepara los bultos y la despacha físicamente.
 *
 * B1 resuelto (brief V2, 2026-08-18): `venta.numero` ya existe en producción
 * (serie VTD-2026-NNNNN, asignada por `abrir_venta`) y es lo que imprime el
 * POS en el ticket y codifica en el Code128. `numero` es nullable — las
 * ventas anteriores al cambio lo tienen en NULL — así que el fallback es
 * `#<id>`. El escaneo/búsqueda acepta ambos formatos por si circula algún
 * ticket viejo con el id crudo.
 *
 * 3.3 del brief, actualizado: el WMS SÍ puede ejecutar completar_venta desde
 * acá (descuenta Kardex, no toca caja/pagos — el cobro ya quedó resuelto al
 * abrir la venta en Seller) cuando el almacenero marcó todas las líneas como
 * entregadas. El check de "lo que entregué" sigue siendo puramente local
 * (no persiste) hasta que se aprieta "Completar".
 *
 * Rechazo/ajuste de líneas (pausa siguiente, mismo criterio que Pedidos):
 * el WMS también puede ejecutar ajustar_venta_abierta desde "Ajustar /
 * rechazar" en el detalle — reduce o anula (cantidad_presentacion=0)
 * líneas puntuales de un ticket ABIERTA con motivo obligatorio, siempre
 * con p_sesion_caja_id=null (Venta Directa es postcobrada en la práctica,
 * no hay devolución que gestionar desde acá). Rechazar TODAS las líneas de
 * una venta lo bloquea el server — ese caso es una anulación completa y
 * sigue siendo exclusivo de caja (anular_venta). No se persiste ningún
 * estado nuevo en venta_linea: una línea rechazada se borra, una cambiada
 * solo actualiza su cantidad — el badge "Rechazada"/"Cambiada" que se ve acá
 * es local a la sesión de ajuste (no sobrevive un F5), la fuente de verdad
 * queda en venta_evento.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import { labelUbicacion, registrarDespachoRapido, historialDespachoRapido, completarVentaDirecta, ajustarVentaDirecta } from "./lib/operaciones";
import { useSucursal } from "./lib/useSucursal";
import { useUsuarioActual } from "./lib/useAuth";
import { resolverAutores, nombreAutor } from "./lib/autoria";
import {
  PackageCheck, ScanLine, Search, Loader, RefreshCw, ArrowLeft, MapPin, Clock, User, CheckSquare, Square, Barcode,
  Zap, History, X, Filter, SlidersHorizontal, Ban,
} from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────────────── */
function cantidadFmt(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
// El almacenero cuenta bultos, no unidades base — mostrar siempre la
// presentación cuando exista (mismo criterio que PedidosApp).
function textoCantidadLinea(l) {
  const unidad = l.producto?.unidad_base || "";
  if (l.presentacion_id && l.presentacion) {
    return `${cantidadFmt(l.cantidad_presentacion)} ${l.presentacion.nombre}`;
  }
  return `${cantidadFmt(l.cantidad)} ${unidad}`;
}
function fechaFmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function identificadorVenta(v) {
  return v.numero || `#${v.id}`;
}
// "modo" no se persiste en `venta` (lo resuelve abrir_venta en el momento y
// no vuelve). Se infiere acá por la presencia de pagos asociados.
function modoVenta(v) {
  return (v.venta_pago?.length || 0) > 0 ? "PAGADO" : "POR COBRAR";
}
function antiguedadMin(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}
// Acepta el número de serie (VTD-2026-00008, con o sin mayúsculas/espacios)
// o el id crudo (65) — circulan ambos: el ticket nuevo imprime el número,
// pero puede aparecer alguno viejo, de antes de V2, con el id a secas.
function buscarVentaPorIdentificador(ventas, texto) {
  const q = (texto || "").trim();
  if (!q) return null;
  const porNumero = ventas.find((v) => v.numero && v.numero.toLowerCase() === q.toLowerCase());
  if (porNumero) return porNumero;
  const soloDigitos = q.replace(/\D/g, "");
  if (!soloDigitos) return null;
  const id = Number(soloDigitos);
  return ventas.find((v) => v.id === id) || null;
}

const SELECT_VENTA = `
  id, numero, estado, total, creado_en, ubicacion_id,
  ubicacion:ubicacion_id!inner ( id, codigo_zona, estante, nivel, compartimiento, sucursal_id ),
  cliente:cliente_id ( nombre ),
  venta_pago ( id ),
  venta_linea (
    id, producto_id, presentacion_id, cantidad, cantidad_presentacion,
    producto:producto_id ( nombre, unidad_base ),
    presentacion:presentacion_id ( nombre )
  )
`;

function BadgeModo({ modo }) {
  const cls = modo === "PAGADO" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{modo}</span>;
}

// Mismo lenguaje visual que ESTADOS_LINEA en PedidosApp para líneas
// RECHAZADO/CAMBIADA — acá es local (ajustar_venta_abierta no persiste un
// estado en venta_linea: la rechazada se borra, la cambiada solo baja de
// cantidad) así que el badge sale de `aplicados`, no de la fila en sí.
function BadgeAjusteLinea({ estado }) {
  const cfg = estado === "RECHAZADA"
    ? { label: "Rechazada", cls: "bg-red-100 text-red-600" }
    : { label: "Cambiada", cls: "bg-slate-200 text-slate-500" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>;
}

export default function VentaDirectaApp() {
  const { sucursalActivaId, nombreSucursal } = useSucursal();
  const [ventas, setVentas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [seleccion, setSeleccion] = useState(null); // venta_id activa en detalle
  const [showScanner, setShowScanner] = useState(false);
  const [flash, setFlash] = useState(null);
  const [entregado, setEntregado] = useState({}); // { [linea_id]: boolean } — local, no persiste
  // Escaneo por producto (lector físico USB/Bluetooth, emula teclado): cuenta
  // cuántas veces se escaneó cada línea. Con cantidad_presentacion=1 el
  // primer escaneo ya la completa; con más de 1, hace falta un escaneo por
  // bulto. Igual que `entregado`, es local — no persiste, no se manda a
  // ningún lado (ver comentario de cabecera del archivo).
  const [escaneos, setEscaneos] = useState({}); // { [linea_id]: number }
  const [busqueda, setBusqueda] = useState("");
  // Modo despacho rápido: escanear el ticket entero lo marca como entregado
  // de un tirón, sin entrar al detalle — a propósito separado del buscador
  // de arriba, para no confundir "encontrar una venta" con "descargarla".
  const [modoRapido, setModoRapido] = useState(false);

  const cargar = useCallback(async () => {
    if (!sucursalActivaId) return;
    setCargando(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("venta")
      .select(SELECT_VENTA)
      .eq("estado", "ABIERTA")
      .eq("ubicacion.sucursal_id", sucursalActivaId)
      .order("creado_en", { ascending: true });
    if (err) {
      setError(err.message);
      setVentas([]);
    } else {
      setVentas(data || []);
    }
    setCargando(false);
  }, [sucursalActivaId]);

  useEffect(() => { cargar(); }, [cargar]);

  const showFlash = (msg) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 3000);
  };

  const buscar = useCallback((texto) => {
    const venta = buscarVentaPorIdentificador(ventas, texto);
    if (!venta) { showFlash(`No se encontró "${texto}" en la bandeja de esta sucursal`); return; }
    setSeleccion(venta.id);
    setBusqueda("");
  }, [ventas]);

  const handleScan = useCallback((codigo) => {
    setShowScanner(false);
    buscar(codigo);
  }, [buscar]);

  const ventaSeleccionada = useMemo(
    () => ventas.find((v) => v.id === seleccion) || null,
    [ventas, seleccion],
  );

  if (!sucursalActivaId) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader size={16} className="animate-spin" /> Cargando sucursal…
      </div>
    );
  }

  if (ventaSeleccionada) {
    return (
      <DetalleVenta
        venta={ventaSeleccionada}
        nombreSucursal={nombreSucursal}
        entregado={entregado}
        setEntregado={setEntregado}
        escaneos={escaneos}
        setEscaneos={setEscaneos}
        onVolver={() => setSeleccion(null)}
        onCompletado={(msg) => { showFlash(msg); setSeleccion(null); cargar(); }}
        onAjustado={(msg) => { showFlash(msg); cargar(); }}
      />
    );
  }

  if (modoRapido) {
    return (
      <ModoDespachoRapido
        ventas={ventas}
        onSalir={() => setModoRapido(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
          <PackageCheck size={20} /> Venta directa de almacén
        </h1>
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => { e.preventDefault(); if (busqueda.trim()) buscar(busqueda); }}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1.5"
          >
            <Search size={14} className="text-slate-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="VTD-2026-00008 o id"
              className="w-36 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
            />
          </form>
          <button
            onClick={() => setShowScanner(true)}
            className="flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <ScanLine size={16} /> Escanear ticket
          </button>
          <button
            onClick={() => setModoRapido(true)}
            title="Escanear varios tickets seguidos para descargarlos, sin abrir cada uno"
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Zap size={16} /> Despacho rápido
          </button>
          <button
            onClick={cargar}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            title="Actualizar"
          >
            <RefreshCw size={16} className={cargando ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {flash && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">{flash}</div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader size={16} className="animate-spin" /> Cargando…
        </div>
      ) : ventas.length === 0 ? (
        <p className="text-sm text-slate-500">No hay ventas directas abiertas en esta sucursal.</p>
      ) : (
        <div className="space-y-2">
          {ventas.map((v) => {
            const min = antiguedadMin(v.creado_en);
            const vieja = min >= 30;
            return (
              <button
                key={v.id}
                onClick={() => setSeleccion(v.id)}
                className={`w-full rounded-xl border bg-white p-4 text-left shadow-sm transition-colors hover:bg-slate-50
                  ${vieja ? "border-amber-300" : "border-slate-200"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">{identificadorVenta(v)}</span>
                    <BadgeModo modo={modoVenta(v)} />
                    {vieja && (
                      <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        <Clock size={12} /> {min} min
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-slate-500">{v.venta_linea?.length || 0} líneas</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <MapPin size={12} /> {labelUbicacion(v.ubicacion)}
                  </span>
                  {v.cliente?.nombre && (
                    <span className="flex items-center gap-1"><User size={12} /> {v.cliente.nombre}</span>
                  )}
                  <span>{fechaFmt(v.creado_en)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showScanner && <EscanerCodigo onDetect={handleScan} onClose={() => setShowScanner(false)} />}
    </div>
  );
}

function DetalleVenta({ venta, nombreSucursal, entregado, setEntregado, escaneos, setEscaneos, onVolver, onCompletado, onAjustado }) {
  const toggle = (lineaId) => {
    setEntregado((prev) => ({ ...prev, [lineaId]: !prev[lineaId] }));
  };

  // ── Ajustar / rechazar líneas desde Almacén ─────────────────────────────
  // `snapshot` fija el orden y los datos originales de las líneas al entrar
  // a este ticket — así una línea rechazada (borrada de venta_linea por el
  // server) sigue teniendo de dónde sacar nombre/cantidad para mostrarse
  // tachada. `aplicados` guarda el resultado de cada ajuste confirmado
  // (persiste aunque el padre refetchee y la línea ya no esté en venta_linea).
  const usuarioActual = useUsuarioActual();
  const [ventaIdSnapshot, setVentaIdSnapshot] = useState(venta.id);
  const [snapshot, setSnapshot] = useState(() => venta.venta_linea || []);
  const [aplicados, setAplicados] = useState({}); // { [lineaId]: { estado, cantidadAnterior, cantidadNueva } }
  const [modoAjuste, setModoAjuste] = useState(false);
  const [valoresAjuste, setValoresAjuste] = useState({}); // { [lineaId]: string }
  const [motivoAjuste, setMotivoAjuste] = useState("");
  const [ajustando, setAjustando] = useState(false);
  const [avisoAjuste, setAvisoAjuste] = useState(null);

  // Reset al cambiar de ticket — ajuste de estado durante el render (patrón
  // recomendado por React para "resetear al cambiar una prop"), no en un
  // efecto, para no disparar un render en cascada.
  if (venta.id !== ventaIdSnapshot) {
    setVentaIdSnapshot(venta.id);
    setSnapshot(venta.venta_linea || []);
    setAplicados({});
    setModoAjuste(false);
    setValoresAjuste({});
    setMotivoAjuste("");
    setAvisoAjuste(null);
  }

  function abrirAjuste() {
    setValoresAjuste(Object.fromEntries(
      (venta.venta_linea || []).map((l) => [l.id, String(l.cantidad_presentacion ?? l.cantidad ?? 0)]),
    ));
    setMotivoAjuste("");
    setAvisoAjuste(null);
    setModoAjuste(true);
  }

  async function confirmarAjuste() {
    if (!motivoAjuste.trim()) { setAvisoAjuste("El motivo es obligatorio para ajustar o rechazar líneas."); return; }

    const cambios = (venta.venta_linea || [])
      .map((l) => {
        const actual = Number(l.cantidad_presentacion ?? l.cantidad ?? 0);
        const nueva = Number(valoresAjuste[l.id]);
        return { linea: l, actual, nueva };
      })
      .filter(({ actual, nueva }) => Number.isFinite(nueva) && nueva >= 0 && nueva < actual);

    if (cambios.length === 0) { setAvisoAjuste("No hay cambios de cantidad para confirmar."); return; }

    setAjustando(true);
    setAvisoAjuste(null);
    const { error } = await ajustarVentaDirecta({
      ventaId: venta.id,
      ajustes: cambios.map(({ linea, nueva }) => ({ lineaId: linea.id, cantidadPresentacion: nueva })),
      motivo: motivoAjuste.trim(),
      usuario: usuarioActual?.nombre,
    });
    setAjustando(false);

    if (error) {
      if (error.message?.includes("sin ninguna unidad")) {
        setAvisoAjuste("Eso deja el ticket sin ninguna línea — eso ya es anular la venta, y Almacén no puede hacerlo desde acá. Pedile a Caja que anule la venta.");
      } else {
        setAvisoAjuste(error.message);
      }
      return;
    }

    setAplicados((prev) => {
      const next = { ...prev };
      for (const { linea, actual, nueva } of cambios) {
        next[linea.id] = { estado: nueva === 0 ? "RECHAZADA" : "CAMBIADA", cantidadAnterior: actual, cantidadNueva: nueva };
      }
      return next;
    });
    // Las líneas rechazadas ya no están en la venta — no tiene sentido
    // seguir mostrándolas como "entregado"/escaneadas pendientes.
    setEntregado((prev) => {
      const next = { ...prev };
      for (const { linea, nueva } of cambios) if (nueva === 0) delete next[linea.id];
      return next;
    });
    setModoAjuste(false);
    onAjustado(`${identificadorVenta(venta)} — ${cambios.length} línea(s) ajustada(s)`);
  }

  // ── Completar VTD desde Almacén ─────────────────────────────────────────
  // completar_venta descuenta Kardex y no admite entrega parcial: solo se
  // habilita cuando el almacenero ya marcó todas las líneas como entregadas.
  // No toca venta_pago/caja (el cobro ya quedó resuelto al abrir la venta).
  const [completando, setCompletando] = useState(false);
  const [avisoCompletar, setAvisoCompletar] = useState(null);
  const lineas = venta.venta_linea || [];
  const todoEntregado = lineas.length > 0 && lineas.every((l) => entregado[l.id]);

  async function completar() {
    if (!window.confirm(`¿Confirmar descargo de ${identificadorVenta(venta)}? Esto baja el stock de Almacén y no se puede deshacer desde acá.`)) return;
    setCompletando(true);
    setAvisoCompletar(null);
    const { error } = await completarVentaDirecta({ ventaId: venta.id, usuario: usuarioActual?.nombre });
    setCompletando(false);
    if (error) { setAvisoCompletar(error.message); return; }
    onCompletado(`${identificadorVenta(venta)} completada — stock descontado`);
  }

  // ── Escaneo por producto (lector físico USB/Bluetooth) ─────────────────
  // El lector emula un teclado: tipea el código y manda Enter. Este input
  // siempre está enfocado; on Enter busca el código contra identificador.valor
  // (tipo='barra' o 'fabrica', el que sea — no filtramos por tipo porque el
  // almacenero no elige, escanea lo que el producto tenga pegado) y, si
  // corresponde a un producto de ESTA venta, cuenta un bulto entregado.
  const [codigo, setCodigo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [avisoEscaneo, setAvisoEscaneo] = useState(null); // { tipo: 'ok'|'error', msg }
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [venta.id]);

  useEffect(() => {
    if (!avisoEscaneo) return;
    const t = setTimeout(() => setAvisoEscaneo(null), 2500);
    return () => clearTimeout(t);
  }, [avisoEscaneo]);

  async function procesarEscaneo(valorEscaneado) {
    const valor = valorEscaneado.trim();
    if (!valor) return;
    setBuscando(true);

    const { data: ident, error } = await supabase
      .from("identificador")
      .select("presentacion:presentacion_id ( producto_id )")
      .eq("valor", valor)
      .eq("activo", true)
      .limit(1)
      .maybeSingle();

    setBuscando(false);

    if (error || !ident?.presentacion?.producto_id) {
      setAvisoEscaneo({ tipo: "error", msg: `Código "${valor}" no reconocido.` });
      return;
    }

    const productoId = ident.presentacion.producto_id;
    const lineas = venta.venta_linea || [];
    // primera línea de ese producto que todavía no llegó a su cantidad
    let linea = lineas.find((l) => l.producto_id === productoId && !entregado[l.id]);
    // si ya están todas completas, igual apunta a la primera para avisar "ya completo"
    if (!linea) linea = lineas.find((l) => l.producto_id === productoId);

    if (!linea) {
      setAvisoEscaneo({ tipo: "error", msg: `"${valor}" no corresponde a ningún producto de esta venta.` });
      return;
    }

    const objetivo = Number(linea.cantidad_presentacion) || 1;
    const actual = (escaneos[linea.id] || 0) + 1;

    if (entregado[linea.id]) {
      setAvisoEscaneo({ tipo: "ok", msg: `${linea.producto?.nombre} — ya estaba completo.` });
      return;
    }

    setEscaneos((prev) => ({ ...prev, [linea.id]: actual }));

    if (actual >= objetivo) {
      setEntregado((prev) => ({ ...prev, [linea.id]: true }));
      setAvisoEscaneo({ tipo: "ok", msg: `${linea.producto?.nombre} — completo (${actual}/${objetivo}).` });
    } else {
      setAvisoEscaneo({ tipo: "ok", msg: `${linea.producto?.nombre} — ${actual}/${objetivo} escaneado.` });
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onVolver} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={16} /> Volver a la bandeja
      </button>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
            <PackageCheck size={18} /> {identificadorVenta(venta)}
          </h2>
          <div className="flex items-center gap-2">
            <BadgeModo modo={modoVenta(venta)} />
            {!modoAjuste && (venta.venta_linea || []).length > 0 && (
              <button
                onClick={abrirAjuste}
                className="flex items-center gap-1.5 rounded-md border border-amber-200 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50"
              >
                <SlidersHorizontal size={13} /> Ajustar / rechazar
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span className="flex items-center gap-1">
            <MapPin size={14} /> {labelUbicacion(venta.ubicacion, { nombreSucursal })}
          </span>
          {venta.cliente?.nombre && (
            <span className="flex items-center gap-1"><User size={14} /> {venta.cliente.nombre}</span>
          )}
          <span>{fechaFmt(venta.creado_en)}</span>
        </div>
      </div>

      {modoAjuste && (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
              <Ban size={15} /> Ajustar o rechazar líneas
            </h3>
            <button onClick={() => setModoAjuste(false)} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
          <p className="text-xs text-amber-700">
            Reducí la cantidad de lo que no se va a despachar. Llevarla a 0 rechaza la línea entera.
          </p>
          <div className="space-y-2">
            {(venta.venta_linea || []).map((l) => {
              const objetivo = Number(l.cantidad_presentacion ?? l.cantidad ?? 0);
              return (
                <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
                  <span className="text-sm text-slate-700">{l.producto?.nombre || `Producto ${l.producto_id}`}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" max={objetivo} step="any"
                      value={valoresAjuste[l.id] ?? ""}
                      onChange={(e) => setValoresAjuste((prev) => ({ ...prev, [l.id]: e.target.value }))}
                      className="w-20 rounded-lg border px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-300"
                    />
                    <span className="text-xs text-slate-400">de {cantidadFmt(objetivo)} {l.presentacion?.nombre || l.producto?.unidad_base}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <input
            value={motivoAjuste}
            onChange={(e) => setMotivoAjuste(e.target.value)}
            placeholder="Motivo (obligatorio) — ej. sin stock, dañado, no se encontró"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-400 focus:outline-none"
          />
          {avisoAjuste && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{avisoAjuste}</p>
          )}
          <button
            onClick={confirmarAjuste}
            disabled={ajustando}
            className="w-full rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {ajustando ? "Guardando…" : "Confirmar ajuste"}
          </button>
        </div>
      )}

      <div className="relative">
        <Barcode size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="text"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const v = codigo;
            setCodigo("");
            void procesarEscaneo(v);
          }}
          onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
          placeholder="Escaneá el código del producto…"
          className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-10 text-sm shadow-sm focus:border-slate-400 focus:outline-none"
        />
        {buscando && <Loader size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>
      {avisoEscaneo && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
          avisoEscaneo.tipo === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
        }`}>
          {avisoEscaneo.msg}
        </div>
      )}

      <div className="space-y-2">
        {snapshot.map((s) => {
          const l = (venta.venta_linea || []).find((x) => x.id === s.id);
          const aplicado = aplicados[s.id];

          // Rechazada: ya no está en venta_linea (el server la borró). Se
          // muestra con los datos de `snapshot` — es lo único que queda.
          if (!l) {
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/50 p-3 opacity-60">
                <div className="flex items-center gap-3">
                  <Ban size={18} className="text-red-400" />
                  <span className="font-medium text-red-800 line-through">
                    {s.producto?.nombre || `Producto ${s.producto_id}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <BadgeAjusteLinea estado="RECHAZADA" />
                  <span className="text-sm text-slate-400 line-through">{textoCantidadLinea(s)}</span>
                </div>
              </div>
            );
          }

          const marcada = !!entregado[l.id];
          const objetivo = Number(l.cantidad_presentacion) || 1;
          const escaneadas = escaneos[l.id] || 0;
          return (
            <button
              key={l.id}
              onClick={() => toggle(l.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border bg-white p-3 text-left shadow-sm
                ${marcada ? "border-emerald-300 bg-emerald-50" : "border-slate-200"}`}
            >
              <div className="flex items-center gap-3">
                {marcada ? <CheckSquare size={18} className="text-emerald-600" /> : <Square size={18} className="text-slate-300" />}
                <span className={`font-medium ${marcada ? "text-emerald-800 line-through" : "text-slate-800"}`}>
                  {l.producto?.nombre || `Producto ${l.producto_id}`}
                </span>
              </div>
              <span className="flex items-center gap-2">
                {aplicado?.estado === "CAMBIADA" && <BadgeAjusteLinea estado="CAMBIADA" />}
                {!marcada && objetivo > 1 && escaneadas > 0 && (
                  <span className="text-xs font-medium text-amber-600">{escaneadas}/{objetivo} escaneado</span>
                )}
                <span className="font-semibold text-slate-700">{textoCantidadLinea(l)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {todoEntregado ? (
        <>
          <button
            onClick={completar}
            disabled={completando}
            className="w-full rounded-xl bg-emerald-600 py-3 text-center font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {completando ? "Descargando…" : "Completar y descontar stock"}
          </button>
          {avisoCompletar && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{avisoCompletar}</p>
          )}
        </>
      ) : (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Marcá todos los ítems como entregados para poder descontar el stock. Si falta algo, usá "Ajustar / rechazar" arriba — la anulación completa del ticket se hace desde caja.
        </p>
      )}
    </div>
  );
}

/*
 * Modo despacho rápido — escanear el ticket entero (venta.numero) lo marca
 * como "ya entregado" de una, vía despacho_rapido_venta_directa: el primero
 * en llegar (Almacén escaneando o Caja completando) es el que descuenta
 * Kardex — si la venta sigue ABIERTA cuando Almacén escanea, ese mismo
 * escaneo dispara completar_venta (misma transacción, sin carrera posible
 * con un "Completar" simultáneo de Caja); si Caja ya la completó, el
 * escaneo posterior solo queda como registro de seguimiento. Pensado para
 * escanear varios tickets seguidos sin interrupción — el aviso dura ~1.5s y
 * el campo nunca pierde el foco.
 */
function ModoDespachoRapido({ ventas, onSalir }) {
  const usuarioActual = useUsuarioActual();
  const [codigo, setCodigo] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [aviso, setAviso] = useState(null); // { tipo: 'ok'|'repetido'|'error', msg }
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 1500);
    return () => clearTimeout(t);
  }, [aviso]);

  async function procesar(valor) {
    const texto = valor.trim();
    if (!texto) return;
    setProcesando(true);

    const venta = buscarVentaPorIdentificador(ventas, texto);
    if (!venta) {
      setProcesando(false);
      setAviso({ tipo: "error", msg: `No se encontró "${texto}" en esta sucursal.` });
      return;
    }

    const { yaDescargado, disparoCompletado, error } = await registrarDespachoRapido({ ventaId: venta.id, usuario: usuarioActual.nombre });
    setProcesando(false);

    if (error) {
      setAviso({ tipo: "error", msg: `Error al descargar ${identificadorVenta(venta)}: ${error.message}` });
      return;
    }
    if (yaDescargado) {
      setAviso({ tipo: "repetido", msg: `${identificadorVenta(venta)} ya estaba descargado.` });
      return;
    }
    if (disparoCompletado) {
      setAviso({ tipo: "ok", msg: `${identificadorVenta(venta)} — stock descontado ✓ (Caja no necesita completarla)` });
      return;
    }
    setAviso({ tipo: "ok", msg: `${identificadorVenta(venta)} descargado ✓` });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onSalir} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={16} /> Salir del modo rápido
        </button>
        <button
          onClick={() => setHistorialAbierto((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          <History size={15} /> Historial
        </button>
      </div>

      <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/40 p-6 text-center">
        <Zap size={28} className="mx-auto mb-2 text-emerald-600" />
        <p className="mb-3 text-sm text-emerald-800">
          Escaneá los tickets uno tras otro — no hace falta tocar nada entre uno y otro.
        </p>
        <div className="relative mx-auto max-w-sm">
          <Barcode size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const v = codigo;
              setCodigo("");
              void procesar(v);
            }}
            onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
            placeholder="Escaneá el ticket…"
            className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-10 text-center text-sm shadow-sm focus:border-emerald-500 focus:outline-none"
          />
          {procesando && <Loader size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
        </div>
      </div>

      {aviso && (
        <div className={`rounded-lg px-4 py-3 text-center text-sm font-medium ${
          aviso.tipo === "ok" ? "bg-emerald-100 text-emerald-800"
          : aviso.tipo === "repetido" ? "bg-amber-100 text-amber-800"
          : "bg-red-100 text-red-700"
        }`}>
          {aviso.msg}
        </div>
      )}

      {historialAbierto && (
        <HistorialDespachoRapido onCerrar={() => setHistorialAbierto(false)} />
      )}
    </div>
  );
}

function HistorialDespachoRapido({ onCerrar }) {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [autores, setAutores] = useState(new Map());
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [filtroCreador, setFiltroCreador] = useState("");
  // Las opciones del desplegable de vendedor salen de una consulta propia,
  // sin desde/hasta/creadoPor — si salieran de `items` (ya filtrado), elegir
  // un vendedor podaba al resto de las opciones y un rango de fechas sin
  // ventas de alguien lo hacía desaparecer sin aviso. Se calcula una sola
  // vez al abrir el panel, no en cada cambio de filtro.
  const [vendedoresUnicos, setVendedoresUnicos] = useState([]);

  useEffect(() => {
    historialDespachoRapido({ desde: null, hasta: null, creadoPor: null }).then(async ({ data }) => {
      const emails = [...new Set(data.map((it) => it.venta?.creado_por).filter(Boolean))];
      setVendedoresUnicos(emails);
      const resueltos = await resolverAutores(emails);
      setAutores((prev) => new Map([...prev, ...resueltos]));
    });
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data } = await historialDespachoRapido({
      desde: desde ? `${desde}T00:00:00` : null,
      hasta: hasta ? `${hasta}T23:59:59` : null,
      creadoPor: filtroCreador || null,
    });
    setItems(data);
    const resueltos = await resolverAutores(data.map((it) => it.venta?.creado_por));
    setAutores((prev) => new Map([...prev, ...resueltos]));
    setCargando(false);
  }, [desde, hasta, filtroCreador]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <History size={15} /> Historial de descargados
        </h3>
        <button onClick={onCerrar} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Filter size={12} className="text-slate-400" />
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1" />
        <span className="text-slate-400">a</span>
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1" />
        <select value={filtroCreador} onChange={(e) => setFiltroCreador(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1">
          <option value="">Todos los vendedores</option>
          {vendedoresUnicos.map((email) => (
            <option key={email} value={email}>{nombreAutor(email, autores)}</option>
          ))}
        </select>
      </div>

      {cargando ? (
        <div className="py-6 text-center text-slate-400"><Loader size={16} className="mx-auto animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Sin descargas registradas todavía.</p>
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-slate-800">{it.venta?.numero || `#${it.venta_id}`}</p>
                <p className="text-xs text-slate-500">
                  {it.venta?.cliente?.nombre && <>{it.venta.cliente.nombre} — </>}
                  vendió: {nombreAutor(it.venta?.creado_por, autores)}
                </p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>{fechaFmt(it.escaneado_en)}</p>
                <p>descargó: {it.escaneado_por}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
