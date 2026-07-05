import { useState } from "react";
import { ClipboardList, Scale, ArrowUpFromLine, Boxes, Settings, BookOpen, Warehouse, History, ShoppingBag } from "lucide-react";

import ConteoApp          from "./ConteoApp";
import ReconciliacionApp  from "./ReconciliacionApp";
import PromocionHuerfanos from "./PromocionHuerfanos";
import OperacionesApp     from "./OperacionesApp";
import CatalogoApp        from "./CatalogoApp";
import InventarioApp      from "./InventarioApp";
import HistorialApp       from "./HistorialApp";
import AdminApp           from "./AdminApp";
import PedidosApp         from "./PedidosApp";

const TABS = [
  { id: "catalogo",   label: "Catálogo",     icon: BookOpen,        Comp: CatalogoApp },
  { id: "inventario", label: "Inventario",   icon: Warehouse,       Comp: InventarioApp },
  { id: "pedidos",    label: "Pedidos",      icon: ShoppingBag,     Comp: PedidosApp },
  { id: "historial",  label: "Historial",    icon: History,         Comp: HistorialApp },
  { id: "conteo",     label: "Conteo",       icon: ClipboardList,   Comp: ConteoApp },
  { id: "concilia",   label: "Conciliación", icon: Scale,           Comp: ReconciliacionApp },
  { id: "huerfanos",  label: "Huérfanos",    icon: ArrowUpFromLine, Comp: PromocionHuerfanos },
  { id: "oper",       label: "Operaciones",  icon: Boxes,           Comp: OperacionesApp },
  { id: "admin",      label: "Admin",        icon: Settings,        Comp: AdminApp },
];

export default function App() {
  const [tab, setTab] = useState("catalogo");
  const Active = TABS.find((t) => t.id === tab).Comp;

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="flex gap-1 border-b bg-white px-3 py-2 flex-wrap">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors
              ${tab === id
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"}`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>
      <main className="p-4">
        <Active />
      </main>
    </div>
  );
}
