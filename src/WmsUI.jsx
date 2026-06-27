import React, { useState, useRef, useEffect } from "react";
import {
  LayoutDashboard, Package, ClipboardList, ScrollText, ShoppingCart,
  Settings, Search, Bell, ChevronDown, Plus, Check, X,
  ArrowDownLeft, ArrowUpRight, SlidersHorizontal,
  TrendingDown, TrendingUp, Boxes, AlertTriangle, Activity, Store,
  ChevronRight, BookOpen, Warehouse, History, Scale, ArrowUpFromLine,
  LogOut, User, HelpCircle, Shield,
} from "lucide-react";

import CatalogoApp         from "./CatalogoApp";
import InventarioApp       from "./InventarioApp";
import HistorialApp        from "./HistorialApp";
import ConteoApp           from "./ConteoApp";
import ReconciliacionApp   from "./ReconciliacionApp";
import PromocionHuerfanos  from "./PromocionHuerfanos";
import OperacionesApp      from "./OperacionesApp";
import AdminApp            from "./AdminApp";

/* ══════════════════════════════════════════════════════════════════
   Design System
══════════════════════════════════════════════════════════════════ */
const C = {
  bg:         "#F4F4F7",
  card:       "#FFFFFF",
  sidebar:    "#FAFAFA",

  line:       "#E4E4E7",
  lineInner:  "#F0F0F3",

  ink:        "#09090B",
  body:       "#3F3F46",
  sub:        "#71717A",
  faint:      "#A1A1AA",
  ghost:      "#D4D4D8",

  coral:      "#F54F1F",
  coralDeep:  "#C43E17",
  coralSoft:  "#FFF2EE",
  coralMid:   "#FDDCCE",

  green:      "#059669",
  greenSoft:  "#ECFDF5",
  greenMid:   "#A7F3D0",
  greenText:  "#065F46",

  red:        "#DC2626",
  redSoft:    "#FEF2F2",
  redText:    "#991B1B",

  amber:      "#D97706",
  amberSoft:  "#FFFBEB",
  amberText:  "#92400E",

  indigo:     "#4F46E5",
  indigoSoft: "#EEF2FF",
  indigoText: "#3730A3",
};

const sh = {
  xs:      "0 1px 2px rgba(0,0,0,0.05)",
  sm:      "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
  dropdown:"0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)",
};

/* ══════════════════════════════════════════════════════════════════
   Navigation
══════════════════════════════════════════════════════════════════ */
const NAV = [
  { id: "dashboard",  label: "Dashboard",     icon: LayoutDashboard },
  { id: "catalogo",   label: "Catálogo",      icon: BookOpen },
  { id: "inventario", label: "Inventario",    icon: Warehouse },
  { id: "historial",  label: "Historial",     icon: History },
  { id: "conteo",     label: "Conteo",        icon: ClipboardList },
  { id: "concilia",   label: "Conciliación",  icon: Scale },
  { id: "huerfanos",  label: "Huérfanos",     icon: ArrowUpFromLine },
  { id: "oper",       label: "Operaciones",   icon: Boxes },
  { id: "admin",      label: "Admin",         icon: Settings },
];

/* ══════════════════════════════════════════════════════════════════
   Mock data — Dashboard & Notificaciones
══════════════════════════════════════════════════════════════════ */
const KARDEX_MOCK = [
  { id: "K-0421", prod: "Caja plástica grande",  tipo: "SALIDA",  cant: -3,  origen: "Shopify #ORD-5842", usuario: "Sistema", hora: "11:45" },
  { id: "K-0420", prod: "Film stretch 50cm",     tipo: "ENTRADA", cant: 24,  origen: "Recepción",         usuario: "Marcos",  hora: "10:18" },
  { id: "K-0419", prod: "Cinta embalaje 48mm",   tipo: "AJUSTE",  cant: -2,  origen: "Conteo físico",     usuario: "Lucía",   hora: "09:52" },
  { id: "K-0418", prod: "Bolsa burbuja A4",      tipo: "SALIDA",  cant: -12, origen: "Shopify #ORD-5839", usuario: "Sistema", hora: "09:30" },
  { id: "K-0417", prod: "Etiqueta térmica 4x6",  tipo: "ENTRADA", cant: 10,  origen: "Recepción",         usuario: "Marcos",  hora: "08:47" },
];

const TIPO_META = {
  ENTRADA: { bg: C.greenSoft,  fg: C.greenText,  Icon: ArrowDownLeft },
  SALIDA:  { bg: C.coralSoft,  fg: C.coralDeep,  Icon: ArrowUpRight },
  AJUSTE:  { bg: C.indigoSoft, fg: C.indigoText, Icon: SlidersHorizontal },
};

const FAMILIAS = [
  { f: "Embalaje",   v: 82, color: C.green  },
  { f: "Protección", v: 95, color: C.indigo },
  { f: "Etiquetado", v: 41, color: C.amber  },
  { f: "Logística",  v: 68, color: C.coral  },
];

const NOTIFS_MOCK = [
  {
    id: 1, leida: false, tipo: "warn",
    titulo: "Stock bajo mínimo",
    texto: "Caja plástica grande — 15 u. (mín. 20)",
    hora: "hace 2 min",
  },
  {
    id: 2, leida: false, tipo: "warn",
    titulo: "Stock crítico",
    texto: "Cinta embalaje 48mm — 6 u. (mín. 24)",
    hora: "hace 5 min",
  },
  {
    id: 3, leida: false, tipo: "warn",
    titulo: "Stock bajo mínimo",
    texto: "Etiqueta térmica 4x6 — 12 u. (mín. 15)",
    hora: "hace 12 min",
  },
  {
    id: 4, leida: true, tipo: "ok",
    titulo: "Movimiento registrado",
    texto: "Film stretch 50cm +24 u. — Recepción",
    hora: "hace 32 min",
  },
  {
    id: 5, leida: true, tipo: "info",
    titulo: "Conciliación cerrada",
    texto: "Sesión #CS-042 completada por Lucía",
    hora: "hace 1 h",
  },
];

/* ══════════════════════════════════════════════════════════════════
   Hook: cierra panel al hacer click fuera
══════════════════════════════════════════════════════════════════ */
function useClickOutside(ref, onClose) {
  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onClose]);
}

/* ══════════════════════════════════════════════════════════════════
   Panel: Notificaciones
══════════════════════════════════════════════════════════════════ */
function NotifsPanel({ notifs, onMarkAll, onClose }) {
  const noLeidas = notifs.filter((n) => !n.leida).length;

  const typeStyle = {
    warn: { dot: C.amber,  bg: C.amberSoft },
    ok:   { dot: C.green,  bg: C.greenSoft },
    info: { dot: C.indigo, bg: C.indigoSoft },
  };

  return (
    <div
      className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden z-50"
      style={{ background: C.card, boxShadow: sh.dropdown }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3.5 border-b"
        style={{ borderColor: C.lineInner }}
      >
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold" style={{ color: C.ink }}>Notificaciones</p>
          {noLeidas > 0 && (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold text-white"
              style={{ background: C.coral }}
            >
              {noLeidas}
            </span>
          )}
        </div>
        <button
          onClick={onMarkAll}
          className="text-xs font-semibold transition-opacity hover:opacity-70"
          style={{ color: C.coral }}
        >
          Marcar todo leído
        </button>
      </div>

      {/* Items */}
      <div className="divide-y" style={{ borderColor: C.lineInner }}>
        {notifs.map((n) => {
          const s = typeStyle[n.tipo] || typeStyle.info;
          return (
            <div
              key={n.id}
              className="flex gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
              style={{ background: n.leida ? "transparent" : `${s.bg}50` }}
            >
              <div className="mt-0.5 shrink-0">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: n.leida ? C.ghost : s.dot }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold" style={{ color: n.leida ? C.sub : C.ink }}>
                  {n.titulo}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: C.faint }}>{n.texto}</p>
                <p className="mt-1 text-xs" style={{ color: C.ghost }}>{n.hora}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-center border-t px-4 py-3"
        style={{ borderColor: C.lineInner }}
      >
        <button
          className="text-xs font-semibold transition-opacity hover:opacity-70"
          style={{ color: C.coral }}
        >
          Ver todas las notificaciones
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Dropdown: Usuario
══════════════════════════════════════════════════════════════════ */
function UserDropdown({ onClose }) {
  const items = [
    { icon: User,       label: "Mi perfil",     sub: "Ver y editar datos" },
    { icon: Shield,     label: "Seguridad",      sub: "Contraseña y acceso" },
    { icon: HelpCircle, label: "Soporte",        sub: "Centro de ayuda" },
  ];

  return (
    <div
      className="absolute right-0 top-full mt-2 w-60 rounded-xl overflow-hidden z-50"
      style={{ background: C.card, boxShadow: sh.dropdown }}
    >
      {/* Perfil */}
      <div className="px-4 py-4 border-b" style={{ borderColor: C.lineInner }}>
        <div className="flex items-center gap-3">
          <div
            className="grid h-10 w-10 place-items-center rounded-full text-sm font-bold text-white shrink-0"
            style={{ background: C.indigo }}
          >
            M
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: C.ink }}>Marcos López</p>
            <p className="text-xs truncate" style={{ color: C.sub }}>marcos@almacen.com</p>
            <span
              className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ background: C.indigoSoft, color: C.indigoText }}
            >
              Operario
            </span>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="py-1.5">
        {items.map(({ icon: Icon, label, sub }) => (
          <button
            key={label}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gray-50"
          >
            <div
              className="grid h-7 w-7 place-items-center rounded-lg shrink-0"
              style={{ background: C.bg, color: C.sub }}
            >
              <Icon size={14} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: C.ink }}>{label}</p>
              <p className="text-xs" style={{ color: C.faint }}>{sub}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Cerrar sesión */}
      <div className="border-t py-1.5" style={{ borderColor: C.lineInner }}>
        <button className="flex w-full items-center gap-3 px-4 py-2.5 transition-colors hover:bg-red-50">
          <div
            className="grid h-7 w-7 place-items-center rounded-lg shrink-0"
            style={{ background: C.redSoft, color: C.red }}
          >
            <LogOut size={14} />
          </div>
          <p className="text-sm font-medium" style={{ color: C.red }}>Cerrar sesión</p>
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Atom: KPI Tile (solo Dashboard)
══════════════════════════════════════════════════════════════════ */
function KpiTile({ icon: Icon, label, value, sub, trend, accent }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{ background: C.card, boxShadow: sh.sm, border: `1px solid ${C.line}` }}
    >
      <div className="flex items-start justify-between mb-3">
        <span
          className="grid h-9 w-9 place-items-center rounded-lg"
          style={{ background: accent.soft, color: accent.fg }}
        >
          <Icon size={18} strokeWidth={2} />
        </span>
        {trend && (
          <span
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{
              background: trend.up ? C.greenSoft : C.redSoft,
              color: trend.up ? C.greenText : C.redText,
            }}
          >
            {trend.up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {trend.value}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold tracking-tight" style={{ color: C.ink }}>{value}</p>
      <p className="mt-0.5 text-sm" style={{ color: C.sub }}>{label}</p>
      {sub && <p className="mt-0.5 text-xs" style={{ color: C.faint }}>{sub}</p>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Vista: Dashboard
══════════════════════════════════════════════════════════════════ */
function Dashboard({ onNavigate }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: C.ink }}>
            Resumen de operación
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: C.sub }}>
            Estado del almacén · accesos rápidos a cada módulo
          </p>
        </div>
        <button
          onClick={() => onNavigate("oper")}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: C.coral }}
        >
          <Plus size={15} strokeWidth={2.5} />
          Nuevo movimiento
        </button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-4">
        <KpiTile
          icon={Boxes}
          label="Productos activos"
          value="312"
          trend={{ up: true, value: "+4" }}
          accent={{ soft: C.indigoSoft, fg: C.indigo }}
        />
        <KpiTile
          icon={AlertTriangle}
          label="Bajo mínimo"
          value="3"
          sub="requieren reposición"
          accent={{ soft: C.redSoft, fg: C.red }}
        />
        <KpiTile
          icon={Activity}
          label="Movimientos hoy"
          value="142"
          trend={{ up: true, value: "+18%" }}
          accent={{ soft: C.greenSoft, fg: C.green }}
        />
        <KpiTile
          icon={Store}
          label="Ventas Shopify"
          value="24"
          sub="sincronizadas al Kardex"
          accent={{ soft: C.coralSoft, fg: C.coral }}
        />
      </div>

      {/* Accesos rápidos */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide" style={{ color: C.faint }}>
          Acceso rápido
        </p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { id: "catalogo",   label: "Catálogo",     icon: BookOpen,        sub: "Productos y precios" },
            { id: "inventario", label: "Inventario",   icon: Warehouse,       sub: "Stock en tiempo real" },
            { id: "conteo",     label: "Conteo",       icon: ClipboardList,   sub: "Conteo físico" },
            { id: "concilia",   label: "Conciliación", icon: Scale,           sub: "Diferencias de stock" },
            { id: "historial",  label: "Historial",    icon: History,         sub: "Movimientos pasados" },
            { id: "huerfanos",  label: "Huérfanos",    icon: ArrowUpFromLine, sub: "Sin referencia Shopify" },
            { id: "oper",       label: "Operaciones",  icon: Boxes,           sub: "Entradas y salidas" },
            { id: "admin",      label: "Admin",        icon: Settings,        sub: "Configuración" },
          ].map(({ id, label, icon: Icon, sub }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className="flex items-center gap-3 rounded-xl p-4 text-left transition-all hover:shadow-md"
              style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: sh.xs }}
            >
              <div
                className="grid h-9 w-9 place-items-center rounded-lg shrink-0"
                style={{ background: C.bg, color: C.sub }}
              >
                <Icon size={17} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: C.ink }}>{label}</p>
                <p className="text-xs truncate" style={{ color: C.faint }}>{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Actividad + Salud */}
      <div className="grid grid-cols-3 gap-5">
        <div
          className="col-span-2 rounded-xl overflow-hidden"
          style={{ background: C.card, boxShadow: sh.sm, border: `1px solid ${C.line}` }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: C.lineInner }}>
            <h3 className="text-sm font-bold" style={{ color: C.ink }}>Actividad reciente</h3>
            <button
              onClick={() => onNavigate("historial")}
              className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-70"
              style={{ color: C.coral }}
            >
              Ver historial <ChevronRight size={13} />
            </button>
          </div>
          <div>
            {KARDEX_MOCK.map((m, i) => {
              const meta = TIPO_META[m.tipo];
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50"
                  style={{ borderBottom: i < KARDEX_MOCK.length - 1 ? `1px solid ${C.lineInner}` : "none" }}
                >
                  <div
                    className="grid h-8 w-8 place-items-center rounded-lg shrink-0"
                    style={{ background: meta.bg, color: meta.fg }}
                  >
                    <meta.Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" style={{ color: C.ink }}>{m.prod}</p>
                    <p className="text-xs" style={{ color: C.faint }}>{m.origen} · {m.usuario}</p>
                  </div>
                  <span className="text-sm font-bold tabular-nums" style={{ color: m.cant < 0 ? C.red : C.green }}>
                    {m.cant > 0 ? `+${m.cant}` : m.cant}
                  </span>
                  <span className="tabular-nums text-xs w-10 text-right" style={{ color: C.faint }}>
                    {m.hora}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="rounded-xl p-5"
          style={{ background: C.card, boxShadow: sh.sm, border: `1px solid ${C.line}` }}
        >
          <h3 className="text-sm font-bold" style={{ color: C.ink }}>Salud del inventario</h3>
          <p className="mt-0.5 text-xs" style={{ color: C.sub }}>Cobertura vs. mínimo por familia</p>
          <div className="mt-5 space-y-4">
            {FAMILIAS.map(({ f, v, color }) => (
              <div key={f}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium" style={{ color: C.sub }}>{f}</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color: v < 50 ? C.amber : C.ink }}>
                    {v}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.lineInner }}>
                  <div className="h-full rounded-full" style={{ width: `${v}%`, background: v < 50 ? C.amber : color }} />
                </div>
              </div>
            ))}
          </div>
          <div
            className="mt-5 rounded-lg p-3 text-xs leading-relaxed"
            style={{ background: C.amberSoft, color: C.amberText, border: "1px solid #FCD34D" }}
          >
            <AlertTriangle size={12} className="inline mr-1 align-[-1px]" />
            <strong>Etiquetado al 41%.</strong> Generá una orden de reposición antes del viernes.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Root shell
══════════════════════════════════════════════════════════════════ */
export default function WmsUI() {
  const [vista, setVista]         = useState("dashboard");
  const [notifsOpen, setNotifsOpen] = useState(false);
  const [userOpen, setUserOpen]   = useState(false);
  const [notifs, setNotifs]       = useState(NOTIFS_MOCK);

  const notifsRef = useRef(null);
  const userRef   = useRef(null);

  useClickOutside(notifsRef, () => setNotifsOpen(false));
  useClickOutside(userRef,   () => setUserOpen(false));

  const unread = notifs.filter((n) => !n.leida).length;

  function markAllRead() {
    setNotifs((prev) => prev.map((n) => ({ ...n, leida: true })));
  }

  function toggleNotifs() {
    setNotifsOpen((v) => !v);
    setUserOpen(false);
  }

  function toggleUser() {
    setUserOpen((v) => !v);
    setNotifsOpen(false);
  }

  return (
    <div
      className="flex min-h-screen"
      style={{
        background: C.bg,
        fontFamily: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        className="flex w-56 shrink-0 flex-col py-4 sticky top-0 h-screen overflow-y-auto"
        style={{ background: C.sidebar, borderRight: `1px solid ${C.line}` }}
      >
        {/* Logo */}
        <div className="px-4 pb-5 flex items-center gap-2.5">
          <div
            className="grid h-8 w-8 place-items-center rounded-lg shrink-0 font-bold text-sm text-white"
            style={{ background: C.coral }}
          >
            R
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight" style={{ color: C.ink }}>Roari WMS</p>
            <p className="text-xs" style={{ color: C.faint }}>Almacén Cation</p>
          </div>
        </div>

        {/* CTA */}
        <div className="px-3 mb-4">
          <button
            onClick={() => setVista("oper")}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80"
            style={{ background: C.coral }}
          >
            <Plus size={15} strokeWidth={2.5} />
            Nuevo movimiento
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 space-y-0.5">
          {NAV.map((item) => {
            const active = vista === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setVista(item.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                style={{
                  background: active ? C.coralSoft : "transparent",
                  color: active ? C.coralDeep : C.sub,
                }}
              >
                <item.icon
                  size={16}
                  strokeWidth={active ? 2.3 : 1.8}
                  style={{ color: active ? C.coral : C.faint }}
                />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* User card */}
        <div className="mx-3 mt-4 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
          <button
            onClick={toggleUser}
            className="flex w-full items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-gray-100"
          >
            <div
              className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white shrink-0"
              style={{ background: C.indigo }}
            >
              M
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-semibold truncate" style={{ color: C.ink }}>Marcos</p>
              <p className="text-xs truncate" style={{ color: C.faint }}>Operario</p>
            </div>
            <ChevronDown size={13} style={{ color: C.ghost }} />
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header
          className="sticky top-0 z-10 flex items-center justify-between px-7 py-3.5 border-b"
          style={{ background: C.card, borderColor: C.line, boxShadow: sh.xs }}
        >
          {/* Search */}
          <div
            className="flex items-center gap-2 rounded-lg border px-3.5 py-2"
            style={{ borderColor: C.line, background: C.bg, width: 340 }}
          >
            <Search size={14} style={{ color: C.faint }} />
            <input
              placeholder="Buscar producto, SKU o movimiento…"
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: C.ink }}
            />
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2.5">
            {/* Stock alert badge */}
            {unread > 0 && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                style={{ background: C.redSoft, color: C.redText }}
              >
                <AlertTriangle size={12} strokeWidth={2.5} />
                {unread} alertas
              </div>
            )}

            {/* Notifications bell */}
            <div className="relative" ref={notifsRef}>
              <button
                onClick={toggleNotifs}
                className="relative grid h-9 w-9 place-items-center rounded-lg border transition-colors hover:bg-gray-50"
                style={{
                  borderColor: notifsOpen ? C.coral : C.line,
                  color: notifsOpen ? C.coral : C.sub,
                  background: notifsOpen ? C.coralSoft : "transparent",
                }}
              >
                <Bell size={16} />
                {unread > 0 && (
                  <span
                    className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-white"
                    style={{ background: C.coral }}
                  />
                )}
              </button>

              {notifsOpen && (
                <NotifsPanel
                  notifs={notifs}
                  onMarkAll={markAllRead}
                  onClose={() => setNotifsOpen(false)}
                />
              )}
            </div>

            {/* User menu */}
            <div className="relative" ref={userRef}>
              <button
                onClick={toggleUser}
                className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors hover:bg-gray-50"
                style={{
                  borderColor: userOpen ? C.coral : C.line,
                  background: userOpen ? C.coralSoft : "transparent",
                }}
              >
                <div
                  className="grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-white"
                  style={{ background: C.indigo }}
                >
                  M
                </div>
                <span className="text-sm font-semibold" style={{ color: C.ink }}>Marcos</span>
                <ChevronDown
                  size={13}
                  className="transition-transform"
                  style={{ color: C.faint, transform: userOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                />
              </button>

              {userOpen && (
                <UserDropdown onClose={() => setUserOpen(false)} />
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className={`flex-1 overflow-auto ${vista === "dashboard" ? "px-7 py-7" : "p-4"}`}>
          {vista === "dashboard"  && <Dashboard onNavigate={setVista} />}
          {vista === "catalogo"   && <CatalogoApp />}
          {vista === "inventario" && <InventarioApp />}
          {vista === "historial"  && <HistorialApp />}
          {vista === "conteo"     && <ConteoApp />}
          {vista === "concilia"   && <ReconciliacionApp />}
          {vista === "huerfanos"  && <PromocionHuerfanos />}
          {vista === "oper"       && <OperacionesApp />}
          {vista === "admin"      && <AdminApp />}
        </main>
      </div>
    </div>
  );
}
