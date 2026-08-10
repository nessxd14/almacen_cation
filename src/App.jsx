import { useState } from "react";
import {
  ClipboardList, Scale, ArrowUpFromLine, Boxes, Settings, BookOpen, Warehouse,
  History, ShoppingBag, Images, Loader, LogOut, Truck, DollarSign, Building2, Tags,
} from "lucide-react";

import ConteoApp          from "./ConteoApp";
import ReconciliacionApp  from "./ReconciliacionApp";
import PromocionHuerfanos from "./PromocionHuerfanos";
import RevisionCapturas   from "./RevisionCapturas";
import OperacionesApp     from "./OperacionesApp";
import CatalogoApp        from "./CatalogoApp";
import InventarioApp      from "./InventarioApp";
import HistorialApp       from "./HistorialApp";
import AdminApp           from "./AdminApp";
import PedidosApp         from "./PedidosApp";
import TrasladosApp       from "./TrasladosApp";
import PreciosApp         from "./PreciosApp";
import SurtidoApp         from "./SurtidoApp";
import LoginScreen        from "./LoginScreen";
import { useAuth } from "./lib/useAuth";
import { useSucursal } from "./lib/useSucursal";
import { AppNavContext } from "./lib/appNavContext";

const TABS = [
  { id: "inventario", label: "Estado",        icon: Warehouse,       Comp: InventarioApp },
  { id: "conteo",     label: "Conteo",        icon: ClipboardList,   Comp: ConteoApp },
  { id: "surtido",    label: "Surtido",       icon: Tags,            Comp: SurtidoApp },
  { id: "concilia",   label: "Conciliación",  icon: Scale,           Comp: ReconciliacionApp },
  { id: "huerfanos",  label: "Huérfanos",     icon: ArrowUpFromLine, Comp: PromocionHuerfanos },

  { id: "catalogo",   label: "Productos",     icon: BookOpen,        Comp: CatalogoApp },
  { id: "precios",    label: "Precios",       icon: DollarSign,      Comp: PreciosApp },
  { id: "revision",   label: "Revisión",      icon: Images,          Comp: RevisionCapturas },

  { id: "pedidos",    label: "Pedidos",       icon: ShoppingBag,     Comp: PedidosApp },
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
  { id: "existencias",  label: "Existencias",  icon: Warehouse,  tabs: ["inventario", "conteo", "surtido", "concilia", "huerfanos"] },
  { id: "catalogo-grp", label: "Catálogo",     icon: BookOpen,   tabs: ["catalogo", "precios", "revision"] },
  { id: "movimientos",  label: "Movimientos",  icon: Truck,      tabs: ["pedidos", "traslados", "historial", "oper"] },
  { id: "admin-grp",    label: "Admin",        icon: Settings,   tabs: ["admin"] },
];

// Tabs administrativos, ocultos para rol 'operario' — confirmado por Ness,
// no ampliar esta lista sin volver a confirmar. ("revision" agregado por
// brief_formulario_revision_capturas.md, que pide admin-only explícito.)
const TABS_SOLO_ADMIN = new Set(["admin", "concilia", "huerfanos", "revision"]);

export default function App() {
  const { cargando, usuario, signOut } = useAuth();
  const { sucursales, sucursalActivaId, setSucursalActiva, puedeElegir, nombreSucursal } = useSucursal();
  const [tab, setTab] = useState("inventario");
  const [conteoPrefill, setConteoPrefill] = useState(null);

  const irAConteo = (prefill) => { setConteoPrefill(prefill); setTab("conteo"); };

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!usuario) return <LoginScreen />;

  if (usuario.activo === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
        <p className="text-lg font-medium text-slate-700">Usuario inactivo — contactá a un administrador</p>
        <button onClick={signOut}
          className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
          <LogOut size={16} /> Cerrar sesión
        </button>
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

  return (
    <AppNavContext.Provider value={{ tab, setTab, conteoPrefill, setConteoPrefill, irAConteo }}>
      <div className="min-h-screen bg-slate-50">
        <nav className="print:hidden border-b bg-white">
          <div className="flex items-center gap-1 px-3 py-2 flex-wrap">
            {gruposVisibles.map((g) => (
              <button
                key={g.id}
                onClick={() => setTab(g.tabs[0])}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors
                  ${grupoActivo.id === g.id
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"}`}
              >
                <g.icon size={16} /> {g.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 pl-2 text-sm text-slate-500">
              {puedeElegir && sucursales.length > 0 && (
                <label className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5">
                  <Building2 size={14} className="text-slate-400" />
                  <select
                    value={sucursalActivaId ?? ""}
                    onChange={(e) => setSucursalActiva(Number(e.target.value))}
                    className="bg-transparent text-sm text-slate-700 focus:outline-none"
                  >
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </label>
              )}
              {!puedeElegir && sucursalActivaId != null && (
                <span className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1.5 text-slate-600">
                  <Building2 size={14} className="text-slate-400" />
                  {nombreSucursal(sucursalActivaId)}
                </span>
              )}
              <span className="hidden sm:inline">{usuario.nombre}</span>
              <button onClick={signOut}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                title="Cerrar sesión">
                <LogOut size={16} />
              </button>
            </div>
          </div>
          {grupoActivo.tabs.length > 1 && (
            <div className="flex items-center gap-1 border-t border-slate-100 bg-slate-50 px-3 py-1.5 flex-wrap">
              {grupoActivo.tabs.map((id) => {
                const t = tabsVisibles.find((tt) => tt.id === id);
                return (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors
                      ${tabActivo.id === id
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:bg-white/60"}`}
                  >
                    <t.icon size={13} /> {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </nav>
        <main className="p-4">
          <Active />
        </main>
      </div>
    </AppNavContext.Provider>
  );
}
