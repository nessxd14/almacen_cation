import { useState } from "react";
import {
  ClipboardList, Scale, ArrowUpFromLine, Boxes, Settings, BookOpen,
  Warehouse, History, LogOut, Loader2, ShieldCheck, User,
} from "lucide-react";

import ConteoApp          from "./ConteoApp";
import ReconciliacionApp  from "./ReconciliacionApp";
import PromocionHuerfanos from "./PromocionHuerfanos";
import OperacionesApp     from "./OperacionesApp";
import CatalogoApp        from "./CatalogoApp";
import InventarioApp      from "./InventarioApp";
import HistorialApp       from "./HistorialApp";
import AdminApp           from "./AdminApp";
import Login              from "./auth/Login";
import { useAuth }        from "./auth/AuthProvider";

const TABS = [
  { id: "catalogo",   label: "Catálogo",     icon: BookOpen,        Comp: CatalogoApp },
  { id: "inventario", label: "Inventario",   icon: Warehouse,       Comp: InventarioApp },
  { id: "historial",  label: "Historial",    icon: History,         Comp: HistorialApp },
  { id: "conteo",     label: "Conteo",       icon: ClipboardList,   Comp: ConteoApp },
  { id: "concilia",   label: "Conciliación", icon: Scale,           Comp: ReconciliacionApp },
  { id: "huerfanos",  label: "Huérfanos",    icon: ArrowUpFromLine, Comp: PromocionHuerfanos },
  { id: "oper",       label: "Operaciones",  icon: Boxes,           Comp: OperacionesApp },
  // El tab de admin solo se muestra a usuarios con rol admin.
  { id: "admin",      label: "Admin",        icon: Settings,        Comp: AdminApp, soloAdmin: true },
];

export default function App() {
  const { session, cargando, usuario, esAdmin, signOut } = useAuth();
  const [tab, setTab] = useState("catalogo");

  // Mientras se resuelve la sesión inicial, evita el parpadeo de login.
  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  if (!session) return <Login />;

  const tabsVisibles = TABS.filter((t) => !t.soloAdmin || esAdmin);
  const actual = tabsVisibles.find((t) => t.id === tab) || tabsVisibles[0];
  const Active = actual.Comp;

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="flex flex-wrap items-center gap-1 border-b bg-white px-3 py-2">
        {tabsVisibles.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors
              ${actual.id === id
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"}`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}

        {/* Identidad + logout */}
        <div className="ml-auto flex items-center gap-3 pl-3">
          <span className="flex items-center gap-1.5 text-sm text-slate-600">
            {esAdmin ? <ShieldCheck size={14} className="text-emerald-600" /> : <User size={14} className="text-slate-400" />}
            {usuario}
          </span>
          <button
            onClick={signOut}
            title="Cerrar sesión"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <LogOut size={15} /> Salir
          </button>
        </div>
      </nav>
      <main className="p-4">
        <Active />
      </main>
    </div>
  );
}
