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
 * 3.3 del brief: el WMS NO ejecuta completar_venta / ajustar_venta_abierta /
 * anular_venta — esas mueven caja y las corre la tienda. El check de "lo que
 * entregué" de esta pantalla es puramente local (no persiste, no se manda a
 * ningún lado): diseñar esa comunicación con caja queda fuera de alcance.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "./supabaseClient";
import EscanerCodigo from "./EscanerCodigo";
import { labelUbicacion } from "./lib/operaciones";
import { useSucursal } from "./lib/useSucursal";
import {
  PackageCheck, ScanLine, Search, Loader, RefreshCw, ArrowLeft, MapPin, Clock, User, CheckSquare, Square, Barcode,
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

function DetalleVenta({ venta, nombreSucursal, entregado, setEntregado, escaneos, setEscaneos, onVolver }) {
  const toggle = (lineaId) => {
    setEntregado((prev) => ({ ...prev, [lineaId]: !prev[lineaId] }));
  };

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
          <BadgeModo modo={modoVenta(venta)} />
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
        {(venta.venta_linea || []).map((l) => {
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
                {!marcada && objetivo > 1 && escaneadas > 0 && (
                  <span className="text-xs font-medium text-amber-600">{escaneadas}/{objetivo} escaneado</span>
                )}
                <span className="font-semibold text-slate-700">{textoCantidadLinea(l)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Esta marca es solo una ayuda visual mientras preparás el pedido — no completa ni anula la venta.
        El cobro, el ajuste de cantidades y la anulación se hacen desde caja.
      </p>
    </div>
  );
}
