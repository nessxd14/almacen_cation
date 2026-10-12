import { useEffect, useRef, useState } from "react";
import { Routes, Route } from "react-router-dom";
import {
  ClipboardList, Scale, ArrowUpFromLine, Boxes, Settings, BookOpen, Warehouse,
  History, ShoppingBag, ShoppingCart, Images, Loader, LogOut, Truck, DollarSign, Building2, Tags,
  AlertTriangle, PackageCheck, Smartphone,
  Menu, X, ChevronRight,
} from "lucide-react";

import ConteoApp          from "./ConteoApp";
import FaltantesApp       from "./FaltantesApp";
import ReconciliacionApp  from "./ReconciliacionApp";
import PromocionHuerfanos from "./PromocionHuerfanos";
import RevisionCapturas   from "./RevisionCapturas";
import OperacionesApp     from "./OperacionesApp";
import OperacionesMovilApp from "./OperacionesMovilApp";
import CatalogoApp        from "./CatalogoApp";
import InventarioApp      from "./InventarioApp";
import HistorialApp       from "./HistorialApp";
import AdminApp           from "./AdminApp";
import PedidosApp         from "./PedidosApp";
import ComprasApp         from "./ComprasApp";
import PedidoDetallePage  from "./PedidoDetallePage";
import TableroAlmacenApp  from "./TableroAlmacenApp";
import VentaDirectaApp    from "./VentaDirectaApp";
import TrasladosApp       from "./TrasladosApp";
import PreciosApp         from "./PreciosApp";
import SurtidoApp         from "./SurtidoApp";
import FichasEtiquetasApp from "./FichasEtiquetasApp";
import FichaProductoPage  from "./FichaProductoPage";
import FichaUbicacionPage from "./FichaUbicacionPage";
import LoginScreen        from "./LoginScreen";
import { useAuth } from "./lib/useAuth";
import { useSucursal } from "./lib/useSucursal";
import { AppNavContext } from "./lib/appNavContext";
import "./ux.css";

const TABS = [
  { id: "inventario", label: "Estado",        icon: Warehouse,       Comp: InventarioApp },
  { id: "conteo",     label: "Conteo",        icon: ClipboardList,   Comp: ConteoApp },
  { id: "surtido",    label: "Surtido",       icon: Tags,            Comp: SurtidoApp },
  { id: "faltantes",  label: "Faltantes",     icon: AlertTriangle,   Comp: FaltantesApp },
  { id: "concilia",   label: "Conciliación",  icon: Scale,           Comp: ReconciliacionApp },
  { id: "huerfanos",  label: "Huérfanos",     icon: ArrowUpFromLine, Comp: PromocionHuerfanos },

  { id: "catalogo",   label: "Productos",     icon: BookOpen,        Comp: CatalogoApp },
  { id: "fichas",     label: "Fichas y etiquetas", icon: Tags,        Comp: FichasEtiquetasApp },
  { id: "precios",    label: "Precios",       icon: DollarSign,      Comp: PreciosApp },
  { id: "revision",   label: "Revisión",      icon: Images,          Comp: RevisionCapturas },

  { id: "pedidos",    label: "Pedidos",       icon: ShoppingBag,     Comp: PedidosApp },
  { id: "movil",      label: "Operaciones móvil", icon: Smartphone,   Comp: OperacionesMovilApp },
  { id: "compras",    label: "Compras",       icon: ShoppingCart,    Comp: ComprasApp },
  { id: "ventadirecta", label: "Venta directa", icon: PackageCheck,  Comp: VentaDirectaApp },
  { id: "traslados",  label: "Traslados",     icon: Truck,           Comp: TrasladosApp },
  { id: "historial",  label: "Historial",     icon: History,         Comp: HistorialApp },
  { id: "oper",       label: "Operaciones",   icon: Boxes,           Comp: OperacionesApp },

  { id: "admin",      label: "Admin",         icon: Settings,        Comp: AdminApp },
];

// Brief W3 #7: 12 pestañas planas no comunicaban que Conciliación y
// Huérfanos son consecuencias de Conteo. Agrupado en 4 grupos; el selector
// de sucursal se queda fuera de todos ellos porque es contexto global, no
// pertenece a ningún grupo.
const GRUPOS = [
  { id: "existencias",  label: "Existencias",  icon: Warehouse,  tabs: ["inventario", "conteo", "surtido", "faltantes", "concilia", "huerfanos"] },
  { id: "catalogo-grp", label: "Catálogo",     icon: BookOpen,   tabs: ["catalogo", "fichas", "precios", "revision"] },
  { id: "movimientos",  label: "Movimientos",  icon: Truck,      tabs: ["pedidos", "movil", "compras", "ventadirecta", "traslados", "historial", "oper"] },
  { id: "admin-grp",    label: "Admin",        icon: Settings,   tabs: ["admin"] },
];

// Tabs administrativos, ocultos para rol 'operario' — confirmado por Ness,
// no ampliar esta lista sin volver a confirmar. ("revision" agregado por
// brief_formulario_revision_capturas.md, que pide admin-only explícito.)
const TABS_SOLO_ADMIN = new Set(["admin", "concilia", "huerfanos", "revision"]);
const ACCESOS_MOVILES = ["inventario", "conteo", "movil", "pedidos"];

export default function App() {
  const { cargando, usuario, signOut, reintentarPerfil, cargandoPerfil } = useAuth();
  const { sucursales, sucursalActivaId, setSucursalActiva, puedeElegir, nombreSucursal } = useSucursal();
  const [tab, setTab] = useState(() => {
    const solicitada = new URLSearchParams(window.location.search).get("tab");
    return TABS.some(t => t.id === solicitada) ? solicitada : "inventario";
  });
  const [conteoPrefill, setConteoPrefill] = useState(null);

  const irAConteo = (prefill) => { setConteoPrefill(prefill); setTab("conteo"); };

  if (cargando) {
    return (
      <div className="glass-app glass-loading">
        <Loader size={25} className="animate-spin text-blue-600" />
      </div>
    );
  }

  if (!usuario) return <LoginScreen />;

  if (usuario.activo === false) {
    const esErrorPerfil = usuario.bloqueadoPor === "error_perfil";
    return (
      <div className="glass-app glass-loading flex-col gap-4 px-4 text-center">
        <p className="text-lg font-medium text-slate-700">
          {esErrorPerfil
            ? "No se pudo verificar tu perfil — reintentá en un momento"
            : "Usuario inactivo — contactá a un administrador"}
        </p>
        <div className="flex gap-2">
          {esErrorPerfil && (
            <button onClick={reintentarPerfil} disabled={cargandoPerfil}
              className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              {cargandoPerfil ? <Loader size={14} className="animate-spin" /> : null}
              {cargandoPerfil ? "Reintentando…" : "Reintentar"}
            </button>
          )}
          <button onClick={signOut}
            className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  const tabsVisibles = usuario.rol === "admin"
    ? TABS
    : TABS.filter((t) => !TABS_SOLO_ADMIN.has(t.id));
  const idsVisibles = new Set(tabsVisibles.map((t) => t.id));

  const tabActivo = tabsVisibles.find((t) => t.id === tab) || tabsVisibles[0];
  const Active = tabActivo.Comp;

  const gruposVisibles = GRUPOS
    .map((g) => ({ ...g, tabs: g.tabs.filter((id) => idsVisibles.has(id)) }))
    .filter((g) => g.tabs.length > 0);
  const grupoActivo = gruposVisibles.find((g) => g.tabs.includes(tabActivo.id)) || gruposVisibles[0];

  // Alcance mínimo del brief S3 parte A: una sola ruta real (/pedidos/:id),
  // fuera del shell de pestañas de abajo (que sigue siendo estado local, sin
  // URL — no se migró el resto de la app, no lo pidió el brief).
  return (
    <Routes>
      <Route path="/productos/:id/ficha" element={<FichaProductoPage />} />
      <Route path="/ubicaciones/:id/ficha" element={<FichaUbicacionPage />} />
      <Route path="/pedidos/:id" element={<PedidoDetallePage />} />
      <Route path="/operaciones" element={<OperacionesMovilApp />} />
      <Route path="/operaciones/pedidos/:id" element={<OperacionesMovilApp />} />
      <Route path="/tablero" element={<TableroAlmacenApp />} />
      <Route path="*" element={
        <AppShell
          tab={tab} setTab={setTab} conteoPrefill={conteoPrefill} setConteoPrefill={setConteoPrefill} irAConteo={irAConteo}
          usuario={usuario} signOut={signOut}
          sucursales={sucursales} sucursalActivaId={sucursalActivaId} setSucursalActiva={setSucursalActiva}
          puedeElegir={puedeElegir} nombreSucursal={nombreSucursal}
          tabsVisibles={tabsVisibles} gruposVisibles={gruposVisibles} grupoActivo={grupoActivo} tabActivo={tabActivo} Active={Active}
        />
      } />
    </Routes>
  );
}

function AppShell({
  tab, setTab, conteoPrefill, setConteoPrefill, irAConteo,
  usuario, signOut,
  sucursales, sucursalActivaId, setSucursalActiva, puedeElegir, nombreSucursal,
  tabsVisibles, gruposVisibles, grupoActivo, tabActivo, Active,
}) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const menuButtonRef = useRef(null);
  const sidebarRef = useRef(null);
  const mainRef = useRef(null);
  const previousTabRef = useRef(tab);
  const navigationRef = useRef(false);
  useEffect(() => {
    if (previousTabRef.current === tab) return;
    previousTabRef.current = tab;
    window.scrollTo({ top: 0, behavior: "instant" });
    mainRef.current?.focus({ preventScroll: true });
  }, [tab]);
  useEffect(() => {
    if (!menuAbierto) return undefined;
    const sidebar = sidebarRef.current;
    const menuButton = menuButtonRef.current;
    const main = mainRef.current;
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => [...sidebar.querySelectorAll('button:not(:disabled), a[href], select')]
      .filter(element => element.getClientRects().length > 0);
    focusables()[0]?.focus();
    const cerrarConEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuAbierto(false);
      }
      if (event.key === "Tab") {
        const items = focusables();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    const cerrarEnEscritorio = () => {
      if (window.innerWidth > 760) setMenuAbierto(false);
    };
    document.addEventListener("keydown", cerrarConEscape);
    window.addEventListener("resize", cerrarEnEscritorio);
    return () => {
      document.body.style.overflow = previo;
      document.removeEventListener("keydown", cerrarConEscape);
      window.removeEventListener("resize", cerrarEnEscritorio);
      requestAnimationFrame(() => {
        if (navigationRef.current) { navigationRef.current = false; main?.focus({ preventScroll: true }); return; }
        if (window.innerWidth <= 760) menuButton?.focus();
        else sidebar?.querySelector('[aria-current="page"]')?.focus();
      });
    };
  }, [menuAbierto]);
  const seleccionarTab = (id) => {
    navigationRef.current = menuAbierto && tab !== id;
    setTab(id);
    setMenuAbierto(false);
  };

  return (
    <AppNavContext.Provider value={{ tab, setTab, conteoPrefill, setConteoPrefill, irAConteo }}>
      <div className="glass-app">
        <a className="glass-skip" href="#contenido-principal">Saltar al contenido</a>
        {menuAbierto && <button type="button" tabIndex={-1} className="glass-backdrop print:hidden" aria-label="Cerrar menú" onClick={() => setMenuAbierto(false)} />}
        <aside ref={sidebarRef} role={menuAbierto ? "dialog" : undefined} aria-modal={menuAbierto ? true : undefined} aria-label="Navegación principal" className={`glass-sidebar print:hidden ${menuAbierto ? "is-open" : ""}`}>
          <div className="glass-brand">
            <span className="glass-brand-icon"><Warehouse size={25} strokeWidth={1.8} /></span>
            <span><strong>CATION</strong><small>Almacén</small></span>
            <button type="button" className="glass-close-menu" aria-label="Cerrar menú" onClick={() => setMenuAbierto(false)}><X size={20} /></button>
          </div>

          <nav className="glass-navigation" id="glass-primary-nav" aria-label="Navegación principal">
            {gruposVisibles.map((grupo) => (
              <div className="glass-nav-group" key={grupo.id}>
                <div className="glass-nav-heading"><grupo.icon size={16} /><span>{grupo.label}</span></div>
                <div className="glass-nav-items">
                  {grupo.tabs.map((id) => {
                    const item = tabsVisibles.find((t) => t.id === id);
                    return (
                      <button key={id} type="button" onClick={() => seleccionarTab(id)}
                        aria-current={tabActivo.id === id ? "page" : undefined}
                        className={`glass-nav-item ${tabActivo.id === id ? "is-active" : ""}`}>
                        <item.icon size={17} strokeWidth={1.8} />
                        <span>{item.label}</span>
                        {tabActivo.id === id && <ChevronRight size={15} className="glass-nav-chevron" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="glass-sidebar-footer">
            <div className="glass-avatar" aria-hidden="true">{usuario.nombre?.trim().charAt(0).toUpperCase() || "U"}</div>
            <div className="glass-user"><strong>{usuario.nombre}</strong><small>{usuario.rol === "admin" ? "Administrador" : "Operaciones"}</small></div>
            <button type="button" onClick={signOut} className="glass-signout" title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={18} /></button>
          </div>
        </aside>

        <div className="glass-workspace" inert={menuAbierto ? true : undefined}>
          <header className="glass-topbar print:hidden">
            <button type="button" ref={menuButtonRef} className="glass-menu-button" aria-label="Abrir menú" aria-controls="glass-primary-nav" aria-expanded={menuAbierto} onClick={() => setMenuAbierto(true)}><Menu size={21} /></button>
            <div className="glass-page-title">
              <div className="glass-breadcrumb">Almacén <ChevronRight size={13} /> {grupoActivo.label}</div>
              <h1>{tabActivo.label}</h1>
            </div>
            <div className="glass-topbar-actions">
              {puedeElegir && sucursales.length > 0 && (
                <label className="glass-branch"><Building2 size={17} /><span className="sr-only">Sucursal activa</span>
                  <select aria-label="Sucursal activa" value={sucursalActivaId ?? ""} onChange={(e) => setSucursalActiva(Number(e.target.value))}>
                    {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </label>
              )}
              {!puedeElegir && sucursalActivaId != null && <div className="glass-branch"><Building2 size={17} /><span>{nombreSucursal(sucursalActivaId)}</span></div>}
              <div className="glass-topbar-user"><span className="glass-avatar" aria-hidden="true">{usuario.nombre?.trim().charAt(0).toUpperCase() || "U"}</span><span>{usuario.nombre}</span></div>
            </div>
            <nav className="glass-mobile-shortcuts" aria-label="Accesos rápidos">
              {tabsVisibles.filter(item => ACCESOS_MOVILES.includes(item.id)).map(item => (
                <button key={item.id} type="button" onClick={() => seleccionarTab(item.id)}
                  aria-current={tabActivo.id === item.id ? "page" : undefined}>
                  <item.icon size={18} /><span>{item.label}</span>
                </button>
              ))}
            </nav>
          </header>
          <main ref={mainRef} className="glass-content" id="contenido-principal" tabIndex={-1}><Active /></main>
        </div>
      </div>
    </AppNavContext.Provider>
  );
}
