import { useState } from "react";
import { ClipboardList, Scale, ArrowUpFromLine, Boxes, Settings, BookOpen, Warehouse, History, ShoppingBag, Images, Loader, LogOut } from "lucide-react";

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
import LoginScreen        from "./LoginScreen";
import { useAuth } from "./lib/useAuth";

const TABS = [
  { id: "catalogo",   label: "Catálogo",     icon: BookOpen,        Comp: CatalogoApp },
  { id: "inventario", label: "Inventario",   icon: Warehouse,       Comp: InventarioApp },
  { id: "pedidos",    label: "Pedidos",      icon: ShoppingBag,     Comp: PedidosApp },
  { id: "historial",  label: "Historial",    icon: History,         Comp: HistorialApp },
  { id: "conteo",     label: "Conteo",       icon: ClipboardList,   Comp: ConteoApp },
  { id: "concilia",   label: "Conciliación", icon: Scale,           Comp: ReconciliacionApp },
  { id: "huerfanos",  label: "Huérfanos",    icon: ArrowUpFromLine, Comp: PromocionHuerfanos },
  { id: "revision",   label: "Revisión",     icon: Images,          Comp: RevisionCapturas },
  { id: "oper",       label: "Operaciones",  icon: Boxes,           Comp: OperacionesApp },
  { id: "admin",      label: "Admin",        icon: Settings,        Comp: AdminApp },
];

// Tabs administrativos, ocultos para rol 'operario' — confirmado por Ness,
// no ampliar esta lista sin volver a confirmar. ("revision" agregado por
// brief_formulario_revision_capturas.md, que pide admin-only explícito.)
const TABS_SOLO_ADMIN = new Set(["admin", "concilia", "huerfanos", "revision"]);

export default function App() {
  const { cargando, usuario, signOut } = useAuth();
  const [tab, setTab] = useState("catalogo");

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!usuario) return <LoginScreen />;

  const tabsVisibles = usuario.rol === "admin"
    ? TABS
    : TABS.filter((t) => !TABS_SOLO_ADMIN.has(t.id));

  const tabActivo = tabsVisibles.find((t) => t.id === tab) || tabsVisibles[0];
  const Active = tabActivo.Comp;

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="flex items-center gap-1 border-b bg-white px-3 py-2 flex-wrap">
        {tabsVisibles.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors
              ${tabActivo.id === id
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"}`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pl-2 text-sm text-slate-500">
          <span className="hidden sm:inline">{usuario.nombre}</span>
          <button onClick={signOut}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            title="Cerrar sesión">
            <LogOut size={16} />
          </button>
        </div>
      </nav>
      <main className="p-4">
        <Active />
      </main>
    </div>
  );
}
