/**
 * TableroAlmacenApp.jsx — Tablero de Almacén v2 para la TV, estilo pantalla de
 * salidas de aeropuerto. Ruta propia /tablero (ver App.jsx), sin sidebar.
 *
 *   /tablero                  vista A: una sola lista + completados de hoy
 *   /tablero?vista=carriles   vista B: carril VTD, carril pedidos, carril traslados
 *   ?sucursal=<id>            solo lo de esa sucursal (por defecto, todas)
 *
 * Datos: public.tablero_almacen (una llamada cada 20 s; se pausa con la
 * pestaña oculta). La etapa la decide la base; orden, demoras, páginas y
 * textos viven en lib/tablero.js.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Volume2 } from "lucide-react";
import "./tablero.css";
import {
  fetchTablero, preparar, paginar, avisos, detectarNuevos, textoVoz,
  vtdParaRepetir, clave, numeroCorto, detalle,
} from "./lib/tablero";
import { anunciar } from "./lib/vozTablero";

const REFRESCO_MS = 20000;
const ROTAR_MS = 12000;
const REPETIR_VOZ_MS = 120000;
const AVISO_VTD_MS = 8000;
const AVISO_TOP_MS = 5000;
const CAIDO_MS = 90000;
const FILAS_LISTA = 11;
const HECHOS_VISIBLES = 9;
const FILAS_PED = 6;
const FILAS_TRA = 2;
const TILES_VTD = 4;
const FUENTES = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700;800&family=Space+Grotesk:wght@500;700&display=swap";
const ZONA = "America/La_Paz";

function horaLocal(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ZONA });
}
function diaLocal(fecha) {
  return new Date(fecha).toLocaleDateString("en-CA", { timeZone: ZONA });
}
function fechaCorta(iso, ahora) {
  if (!iso) return "";
  if (diaLocal(iso) === diaLocal(ahora)) return "HOY";
  return new Date(iso).toLocaleDateString("es-BO", { day: "2-digit", month: "short", timeZone: ZONA }).replace(/[.-]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}
function fechaCabecera(ahora) {
  return ahora.toLocaleDateString("es-BO", { weekday: "short", day: "2-digit", month: "short", timeZone: ZONA }).replace(/\./g, "").toUpperCase();
}
function mmss(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useFuentes() {
  useEffect(() => {
    if (document.querySelector(`link[data-tablero-fuentes]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FUENTES;
    link.dataset.tableroFuentes = "1";
    document.head.appendChild(link);
  }, []);
}

// ── Piezas ────────────────────────────────────────────────────────────────
function TipoChip({ tipo, grande = false }) {
  return <span className={`tab-mono tab-tipo tab-tipo-${tipo}${grande ? " grande" : ""}`}>{tipo}</span>;
}

function Etapa({ fila }) {
  return (
    <span key={`${fila.clave}-${fila.etapa}`} className={`tab-mono tab-etapa tab-cambia ${fila.etapaClase}`}>
      {fila.etapaLabel}
    </span>
  );
}

function Demora({ fila }) {
  if (!fila.demorado) return null;
  return <span className="tab-mono tab-demora tab-pulso">● DEMORADO {fila.demoraTexto.toUpperCase()}</span>;
}

function Encabezado({ vista, resumen, ahora, caido, ultimaOk }) {
  return (
    <header className="tab-head">
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span className="tab-mono tab-sub">ALMACÉN · ROARI</span>
        <h1 className="tab-h1">SALIDAS DE ALMACÉN</h1>
      </div>
      {vista === "carriles" ? (
        <div className="tab-mono tab-resumen">
          <span>EN CURSO <span style={{ color: "var(--ambar)" }}>{resumen.enCurso}</span></span>
          <span style={{ color: "var(--rojo)" }}>DEMORADOS {resumen.demorados}</span>
          <span style={{ color: "var(--verde)" }}>HOY LISTOS {resumen.hoy}</span>
        </div>
      ) : (
        <div className="tab-leyenda">
          <span className="tab-mono tab-tipo grande tab-tipo-PED">PED · Pedido</span>
          <span className="tab-mono tab-tipo grande tab-tipo-VTD">VTD · Venta directa</span>
          <span className="tab-mono tab-tipo grande tab-tipo-TRA">TRA · Traslado</span>
        </div>
      )}
      <div className="tab-reloj">
        {caido ? (
          <span className="tab-vivo caido"><span className="tab-punto" />Sin conexión{ultimaOk ? ` · datos de ${horaLocal(ultimaOk)}` : ""}</span>
        ) : (
          <span className="tab-vivo"><span className="tab-punto tab-pulso" />En vivo</span>
        )}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span className="tab-mono tab-hora">{horaLocal(ahora)}</span>
          <span className="tab-mono tab-fecha">{fechaCabecera(ahora)}</span>
        </div>
      </div>
    </header>
  );
}

function FilaLista({ fila, ahora }) {
  const clases = ["tab-cols", "tab-fila"];
  if (fila.vtdActiva) clases.push("vtd");
  if (fila.demorado) clases.push("demorada");
  return (
    <div className={clases.join(" ")}>
      <div className="tab-col">
        <span className="tab-mono tab-hh">{horaLocal(fila.entro_en)}</span>
        <span className="tab-mono tab-dd">{fechaCorta(fila.entro_en, ahora)}</span>
      </div>
      <div className="tab-col" style={{ gap: "calc(4 * var(--u))" }}>
        <span className="tab-mono tab-flap tab-num">{fila.corto}</span>
        <TipoChip tipo={fila.tipo} />
      </div>
      <div className="tab-col">
        <span className="tab-cliente">{fila.titulo}</span>
        <span className="tab-det">{fila.detalle}</span>
      </div>
      <span className="tab-mono tab-flap tab-puerta">{fila.puerta}</span>
      <div className="tab-col">
        <span className="tab-mono tab-av">{fila.avance.texto}</span>
        <div className="tab-barra"><div style={{ width: `${fila.avance.pct}%` }} /></div>
      </div>
      <div className="tab-col" style={{ alignItems: "flex-start", gap: "calc(5 * var(--u))" }}>
        <Etapa fila={fila} />
        <Demora fila={fila} />
      </div>
    </div>
  );
}

function VistaLista({ filas, completados, resumen, ahora, pagina }) {
  const fijas = filas.filter((f) => f.vtdActiva).slice(0, FILAS_LISTA);
  const resto = filas.filter((f) => !f.vtdActiva);
  const pag = paginar(resto, Math.max(1, FILAS_LISTA - fijas.length), pagina);
  const visibles = [...fijas, ...pag.items];
  return (
    <div className="tab-cuerpo">
      <section className="tab-lista">
        <div className="tab-mono tab-cols cab">
          <span>ENTRÓ</span><span>Nº</span><span>CLIENTE / DESTINO</span><span>PUERTA</span><span>AVANCE</span><span>ESTADO</span>
        </div>
        {visibles.length === 0 ? (
          <div className="tab-mono tab-vacio">SIN SALIDAS PENDIENTES</div>
        ) : (
          visibles.map((f) => <FilaLista key={f.clave} fila={f} ahora={ahora} />)
        )}
        <div className="tab-mono tab-pie" style={{ marginTop: "auto" }}>
          <span>VTD ARRIBA · LUEGO LO MÁS CERCA DE SALIR · LO MÁS ANTIGUO PRIMERO</span>
          {pag.paginas > 1 && <span>PÁGINA {pag.pagina + 1} / {pag.paginas}</span>}
        </div>
      </section>
      <aside className="tab-aside">
        <div className="tab-kpis">
          <div className="tab-kpi"><span className="tab-mono tab-kpi-l">EN CURSO</span><span className="tab-mono tab-kpi-n">{resumen.enCurso}</span></div>
          <div className="tab-kpi rojo"><span className="tab-mono tab-kpi-l">DEMORADOS</span><span className="tab-mono tab-kpi-n">{resumen.demorados}</span></div>
          <div className="tab-kpi verde"><span className="tab-mono tab-kpi-l">HOY LISTOS</span><span className="tab-mono tab-kpi-n">{resumen.hoy}</span></div>
        </div>
        <div className="tab-hechos">
          <div className="tab-hechos-h">
            <h2 className="tab-h2">COMPLETADOS HOY</h2>
            <span className="tab-mono" style={{ fontSize: "calc(15 * var(--u))", color: "var(--suave)", letterSpacing: "calc(2 * var(--u))" }}>LLEGADAS</span>
          </div>
          {completados.length === 0 ? (
            <div className="tab-mono tab-vacio" style={{ fontSize: "calc(20 * var(--u))" }}>NADA TODAVÍA</div>
          ) : (
            completados.slice(0, HECHOS_VISIBLES).map((c) => (
              <div key={c.clave} className="tab-hecho">
                <span className="tab-mono tab-hecho-h">{horaLocal(c.hora)}</span>
                <span className="tab-mono tab-hecho-n">{c.corto}</span>
                <div className="tab-col">
                  <span className="tab-hecho-d">{c.titulo}</span>
                  <span className="tab-mono tab-hecho-e">✓ {c.texto}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

function TileVtd({ fila, ahora }) {
  if (fila.etapa === "RETORNO") {
    return (
      <div className="tab-tile retorno">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span className="tab-mono tab-flap tab-num" style={{ fontSize: "calc(30 * var(--u))" }}>{fila.corto}</span>
          <Etapa fila={fila} />
        </div>
        <span className="tab-tile-t">Anulada en caja → a su estante</span>
        <span className="tab-mono" style={{ marginTop: "auto", fontSize: "calc(18 * var(--u))", color: "#cdbbff" }}>Sin apuro: recibir y guardar</span>
      </div>
    );
  }
  const espera = new Date(ahora).getTime() - new Date(fila.entro_en).getTime();
  return (
    <div className={`tab-tile${fila.demorado ? " demorada" : ""}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="tab-mono tab-flap tab-num" style={{ fontSize: "calc(30 * var(--u))" }}>{fila.corto}</span>
        <Etapa fila={fila} />
      </div>
      <span className="tab-tile-t">→ {fila.puerta} · {fila.detalle}</span>
      {fila.etapa === "EN_CAJA" ? (
        <span className="tab-mono" style={{ marginTop: "auto", fontSize: "calc(20 * var(--u))", color: "#ffb98a" }}>Ya en caja · falta cobrar o entregar</span>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: "auto" }}>
          <span className="tab-mono tab-tile-reloj">{mmss(espera)}</span>
          <span className="tab-mono" style={{ fontSize: "calc(18 * var(--u))", color: fila.demorado ? "var(--rojo)" : "#ffb98a" }}>
            {fila.demorado ? "DEMORADA" : "min esperando"}
          </span>
        </div>
      )}
    </div>
  );
}

function FilaCarril({ fila, ahora }) {
  return (
    <div className="tab-cols-b tab-fila-b">
      <span className="tab-mono tab-flap tab-num" style={{ fontSize: "calc(26 * var(--u))" }}>{fila.corto}</span>
      <div className="tab-col">
        <span className="tab-cliente" style={{ fontSize: "calc(25 * var(--u))" }}>{fila.titulo}</span>
        <span className="tab-det" style={{ fontSize: "calc(16 * var(--u))" }}>{fila.detalle}</span>
      </div>
      <span style={{ fontSize: "calc(21 * var(--u))", color: "#c7d0dc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {fila.encargado || "— sin encargado"}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "calc(10 * var(--u))" }}>
        <span className="tab-mono tab-av" style={{ fontSize: "calc(21 * var(--u))", minWidth: "calc(70 * var(--u))" }}>{fila.avance.texto}</span>
        <div className="tab-barra" style={{ flex: 1, marginTop: 0 }}><div style={{ width: `${fila.avance.pct}%` }} /></div>
      </div>
      <div style={{ justifySelf: "start" }}><Etapa fila={fila} /></div>
      <div className="tab-col">
        <span className="tab-mono" style={{ fontSize: "calc(19 * var(--u))", fontWeight: 700 }}>
          {fechaCorta(fila.entro_en, ahora)} {horaLocal(fila.entro_en)}
        </span>
        <Demora fila={fila} />
      </div>
    </div>
  );
}

function VistaCarriles({ filas, ahora, pagina }) {
  const vtd = filas.filter((f) => f.tipo === "VTD");
  const tiles = vtd.slice(0, TILES_VTD);
  const extraVtd = vtd.length - tiles.length;
  const ped = paginar(filas.filter((f) => f.tipo === "PED"), FILAS_PED, pagina);
  const tra = paginar(filas.filter((f) => f.tipo === "TRA"), FILAS_TRA, pagina);
  const cab = (
    <div className="tab-mono tab-cols-b cab">
      <span>Nº</span><span>CLIENTE</span><span>ENCARGADO</span><span>AVANCE</span><span>ESTADO</span><span>ENTRÓ</span>
    </div>
  );
  return (
    <>
      <section className="tab-carril vtd">
        <div className="tab-carril-h">
          <TipoChip tipo="VTD" grande />
          <h2 className="tab-h2" style={{ fontSize: "calc(30 * var(--u))" }}>CAJA ESPERANDO · VENTA DIRECTA</h2>
          <span className="tab-mono tab-carril-meta" style={{ color: "#ffb98a" }}>
            {extraVtd > 0 ? `+${extraVtd} MÁS · ` : ""}META: EN CAJA ANTES DE 5 min
          </span>
        </div>
        <div className="tab-tiles">
          {tiles.map((f) => <TileVtd key={f.clave} fila={f} ahora={ahora} />)}
          {Array.from({ length: TILES_VTD - tiles.length }, (_, i) => (
            <div key={`libre-${i}`} className="tab-tile libre tab-mono">SIN VTD EN ESPERA</div>
          ))}
        </div>
      </section>
      <section className="tab-carril ped">
        <div className="tab-carril-h">
          <TipoChip tipo="PED" grande />
          <h2 className="tab-h2" style={{ fontSize: "calc(30 * var(--u))" }}>PEDIDOS · SALEN POR DESPACHO</h2>
          {ped.paginas > 1 && <span className="tab-mono tab-carril-meta">PÁGINA {ped.pagina + 1} / {ped.paginas}</span>}
        </div>
        {cab}
        {ped.items.length === 0
          ? <div className="tab-mono tab-vacio" style={{ height: `calc(${FILAS_PED * 56} * var(--u))`, flex: "none" }}>SIN PEDIDOS EN CURSO</div>
          : ped.items.map((f) => <FilaCarril key={f.clave} fila={f} ahora={ahora} />)}
        {ped.items.length > 0 && Array.from({ length: FILAS_PED - ped.items.length }, (_, i) => (
          <div key={`hueco-${i}`} className="tab-fila-b" />
        ))}
      </section>
      <section className="tab-carril tra">
        <div className="tab-carril-h">
          <TipoChip tipo="TRA" grande />
          <h2 className="tab-h2" style={{ fontSize: "calc(30 * var(--u))" }}>TRASLADOS</h2>
          {tra.paginas > 1 && <span className="tab-mono tab-carril-meta">PÁGINA {tra.pagina + 1} / {tra.paginas}</span>}
        </div>
        {tra.items.length === 0
          ? <div className="tab-mono tab-vacio" style={{ height: `calc(${FILAS_TRA * 56} * var(--u))`, flex: "none", fontSize: "calc(22 * var(--u))" }}>SIN TRASLADOS EN CURSO</div>
          : tra.items.map((f) => <FilaCarril key={f.clave} fila={f} ahora={ahora} />)}
        {tra.items.length > 0 && Array.from({ length: FILAS_TRA - tra.items.length }, (_, i) => (
          <div key={`hueco-t-${i}`} className="tab-fila-b" />
        ))}
      </section>
    </>
  );
}

function FranjaAvisos({ items, completados, vista }) {
  if (vista === "carriles") {
    return (
      <footer className="tab-franja verde">
        <span className="tab-mono tab-franja-l">ÚLTIMAS SALIDAS</span>
        {completados.length === 0
          ? <span className="tab-mono tab-franja-t">NADA TODAVÍA HOY</span>
          : completados.slice(0, 6).map((c) => (
            <span key={c.clave} className="tab-mono tab-franja-t">{horaLocal(c.hora)} {c.corto} {c.titulo.toUpperCase()} ✓</span>
          ))}
      </footer>
    );
  }
  if (items.length === 0) {
    return (
      <footer className="tab-franja verde">
        <span className="tab-mono tab-franja-l">AVISOS</span>
        <span className="tab-mono tab-franja-t">SIN AVISOS · TODO AL DÍA</span>
      </footer>
    );
  }
  return (
    <footer className="tab-franja">
      <span className="tab-mono tab-franja-l">AVISOS</span>
      {items.map((a) => <span key={a.clave} className="tab-mono tab-franja-t">{a.texto}</span>)}
    </footer>
  );
}

function AvisoNuevo({ fila }) {
  if (fila.tipo === "VTD") {
    return (
      <div className="tab-overlay">
        <div className="tab-aviso-vtd">
          <div style={{ display: "flex", alignItems: "center", gap: "calc(18 * var(--u))" }}>
            <Volume2 size={48} aria-hidden="true" />
            <span className="tab-mono" style={{ fontSize: "calc(34 * var(--u))", fontWeight: 800, letterSpacing: "calc(6 * var(--u))" }}>NUEVA VENTA DIRECTA</span>
            <span className="tab-mono" style={{ marginLeft: "auto", fontSize: "calc(24 * var(--u))", fontWeight: 700 }}>{horaLocal(fila.entro_en)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "calc(40 * var(--u))" }}>
            <span className="tab-mono tab-flap" style={{ fontSize: "calc(150 * var(--u))", fontWeight: 800, lineHeight: 1.1, color: "var(--ambar)", padding: "calc(6 * var(--u)) calc(28 * var(--u))" }}>
              {numeroCorto(fila.numero)}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="tab-mono" style={{ fontSize: "calc(28 * var(--u))", fontWeight: 700, letterSpacing: "calc(4 * var(--u))" }}>LLEVAR A</span>
              <span style={{ fontSize: "calc(110 * var(--u))", fontWeight: 700, lineHeight: 1 }}>{fila.puerta}</span>
            </div>
          </div>
          {fila.productos?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "calc(8 * var(--u))", background: "#ffa766", borderRadius: "calc(16 * var(--u))", padding: "calc(18 * var(--u)) calc(26 * var(--u))" }}>
              {fila.productos.map((p, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 24, fontSize: "calc(34 * var(--u))", fontWeight: 700 }}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.nombre}</span>
                  <span className="tab-mono" style={{ whiteSpace: "nowrap" }}>{Number(p.cantidad)} {p.presentacion}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "calc(20 * var(--u))" }}>
            <span className="tab-mono" style={{ fontSize: "calc(22 * var(--u))", fontWeight: 700 }}>
              Cliente esperando{fila.cajero ? ` · cobra ${fila.cajero}` : ""}
            </span>
            <div className="tab-cuenta" style={{ marginLeft: "auto" }}>
              <div style={{ animationDuration: `${AVISO_VTD_MS}ms` }} />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`tab-aviso-top ${fila.tipo}`}>
      <TipoChip tipo={fila.tipo} grande />
      <span className="tab-mono" style={{ fontSize: "calc(26 * var(--u))", fontWeight: 800, letterSpacing: "calc(3 * var(--u))" }}>
        {fila.tipo === "TRA" ? "TRASLADO NUEVO" : "PEDIDO NUEVO"}
      </span>
      <span className="tab-mono" style={{ fontSize: "calc(40 * var(--u))", fontWeight: 800 }}>{numeroCorto(fila.numero)}</span>
      <span style={{ fontSize: "calc(34 * var(--u))", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fila.titulo}</span>
      <span style={{ marginLeft: "auto", fontSize: "calc(20 * var(--u))", whiteSpace: "nowrap" }}>{detalle(fila)}</span>
    </div>
  );
}

// ── Pantalla ──────────────────────────────────────────────────────────────
export default function TableroAlmacenApp() {
  useFuentes();
  const [params] = useSearchParams();
  const vista = params.get("vista") === "carriles" ? "carriles" : "lista";
  const sucursalParam = Number(params.get("sucursal"));
  const sucursalId = Number.isInteger(sucursalParam) && sucursalParam > 0 ? sucursalParam : null;

  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [ultimaOk, setUltimaOk] = useState(null);
  const [ahora, setAhora] = useState(() => new Date());
  const [pagina, setPagina] = useState(0);
  const [sonido, setSonido] = useState(false);
  const [cola, setCola] = useState([]);

  const prevClaves = useRef(null);
  const ultimaVoz = useRef(new Map());
  const sonidoRef = useRef(false);
  useEffect(() => { sonidoRef.current = sonido; }, [sonido]);

  // Carga: una llamada cada 20 s; con la pestaña oculta no se pide nada.
  useEffect(() => {
    let vivo = true;
    let timer;
    async function tick() {
      if (!document.hidden) {
        try {
          const d = await fetchTablero(sucursalId);
          if (!vivo) return;
          setDatos(d);
          setUltimaOk(new Date());
          setError(null);
        } catch (e) {
          if (vivo) setError(e.message || String(e));
        }
      }
      if (vivo) timer = setTimeout(tick, REFRESCO_MS);
    }
    tick();
    return () => { vivo = false; clearTimeout(timer); };
  }, [sucursalId]);

  // Reloj y rotación de páginas.
  useEffect(() => {
    const reloj = setInterval(() => setAhora(new Date()), 1000);
    const rota = setInterval(() => setPagina((p) => p + 1), ROTAR_MS);
    return () => { clearInterval(reloj); clearInterval(rota); };
  }, []);

  // Documentos nuevos -> cola de avisos. La primera carga no anuncia nada.
  useEffect(() => {
    if (!datos) return;
    const nuevos = detectarNuevos(prevClaves.current, datos.filas);
    prevClaves.current = new Set((datos.filas || []).map(clave));
    if (nuevos.length) {
      // VTD primero: hay un cliente esperando.
      nuevos.sort((a, b) => (a.tipo === "VTD" ? 0 : 1) - (b.tipo === "VTD" ? 0 : 1));
      setCola((c) => [...c, ...nuevos]);
    }
  }, [datos]);

  // Muestra el primero de la cola y lo saca al terminar su tiempo.
  const actual = cola[0] || null;
  useEffect(() => {
    if (!actual) return undefined;
    if (sonidoRef.current) anunciar(textoVoz(actual));
    const t = setTimeout(() => setCola((c) => c.slice(1)), actual.tipo === "VTD" ? AVISO_VTD_MS : AVISO_TOP_MS);
    return () => clearTimeout(t);
  }, [actual]);

  // Recalcula demoras cada 30 s (no hace falta cada segundo).
  const ahoraLento = Math.floor(ahora.getTime() / 30000);
  const preparado = useMemo(
    () => preparar(datos, new Date(ahoraLento * 30000)),
    [datos, ahoraLento]
  );

  // VTD demoradas: la voz repite cada 2 min mientras sigan esperando.
  useEffect(() => {
    if (!sonidoRef.current || actual) return;
    for (const f of vtdParaRepetir(preparado.filas, ultimaVoz.current, Date.now(), REPETIR_VOZ_MS)) {
      anunciar(`Venta directa ${String(f.numero).replace(/^.*-0*/, "")} demorada, cliente esperando en caja`);
    }
  }, [preparado, actual]);

  function activarSonido() {
    // Chrome bloquea el audio hasta el primer toque en la pestaña.
    anunciar("Sonido activado");
    setSonido(true);
  }

  const caido = Boolean(error) || (ultimaOk && ahora.getTime() - ultimaOk.getTime() > CAIDO_MS);

  return (
    <div className="tab-root">
      <div className="tab-lienzo">
        {!sonido && (
          <button type="button" onClick={activarSonido} className="tab-activar">
            <Volume2 size={72} aria-hidden="true" />
            <span style={{ fontSize: "calc(40 * var(--u))", fontWeight: 800 }}>Activar sonido</span>
            <span style={{ fontSize: "calc(20 * var(--u))", color: "var(--suave)" }}>Tocá la pantalla para habilitar los anuncios de voz</span>
          </button>
        )}
        <Encabezado vista={vista} resumen={preparado.resumen} ahora={ahora} caido={caido} ultimaOk={ultimaOk} />
        {datos == null && !error ? (
          <div className="tab-mono tab-vacio">CARGANDO…</div>
        ) : error && datos == null ? (
          <div className="tab-mono tab-vacio" style={{ color: "var(--rojo)", fontSize: "calc(24 * var(--u))", textAlign: "center", padding: "0 10%" }}>
            NO SE PUDO LEER EL TABLERO · {error}
          </div>
        ) : vista === "carriles" ? (
          <VistaCarriles filas={preparado.filas} ahora={ahora} pagina={pagina} />
        ) : (
          <VistaLista filas={preparado.filas} completados={preparado.completados} resumen={preparado.resumen} ahora={ahora} pagina={pagina} />
        )}
        <FranjaAvisos items={avisos(preparado.filas)} completados={preparado.completados} vista={vista} />
        {actual && <AvisoNuevo key={clave(actual)} fila={actual} />}
      </div>
    </div>
  );
}
