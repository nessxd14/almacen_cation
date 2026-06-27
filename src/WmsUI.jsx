import React, { useState, useMemo } from "react";
import {
  LayoutDashboard, Package, ClipboardList, ScrollText, ShoppingCart,
  Settings, Search, Bell, ChevronDown, Plus, X, RotateCcw, Check,
  ArrowDownLeft, ArrowUpRight, SlidersHorizontal,
  TrendingDown, TrendingUp, Boxes, AlertTriangle, Activity, Store,
  ChevronRight,
} from "lucide-react";

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
  xs:    "0 1px 2px rgba(0,0,0,0.05)",
  sm:    "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
  md:    "0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.05)",
  modal: "0 25px 50px -12px rgba(0,0,0,0.35)",
};

/* ══════════════════════════════════════════════════════════════════
   Static data
══════════════════════════════════════════════════════════════════ */
const PRODUCTOS = [
  { id: 1, nombre: "Caja plástica grande",  sku: "BX-104", familia: "Embalaje",   stock: 15,  min: 20,  presentacion: "Unidad",  precio: 42.0 },
  { id: 2, nombre: "Film stretch 50cm",     sku: "FS-220", familia: "Embalaje",   stock: 84,  min: 30,  presentacion: "Rollo",   precio: 18.5 },
  { id: 3, nombre: "Cinta embalaje 48mm",   sku: "CT-011", familia: "Embalaje",   stock: 6,   min: 24,  presentacion: "Unidad",  precio: 3.2  },
  { id: 4, nombre: "Bolsa burbuja A4",      sku: "BB-310", familia: "Protección", stock: 240, min: 100, presentacion: "Paquete", precio: 9.9  },
  { id: 5, nombre: "Etiqueta térmica 4x6",  sku: "ET-460", familia: "Etiquetado", stock: 12,  min: 15,  presentacion: "Rollo",   precio: 14.0 },
  { id: 6, nombre: "Pallet madera 1.2m",    sku: "PL-120", familia: "Logística",  stock: 33,  min: 10,  presentacion: "Unidad",  precio: 28.0 },
];

const KARDEX = [
  { id: "K-0421", prod: "Caja plástica grande",  sku: "BX-104", tipo: "SALIDA",  cant: -3,  origen: "Shopify #ORD-5842", usuario: "Sistema", hora: "11:45" },
  { id: "K-0420", prod: "Film stretch 50cm",     sku: "FS-220", tipo: "ENTRADA", cant: 24,  origen: "Recepción",         usuario: "Marcos",  hora: "10:18" },
  { id: "K-0419", prod: "Cinta embalaje 48mm",   sku: "CT-011", tipo: "AJUSTE",  cant: -2,  origen: "Conteo físico",     usuario: "Lucía",   hora: "09:52" },
  { id: "K-0418", prod: "Bolsa burbuja A4",      sku: "BB-310", tipo: "SALIDA",  cant: -12, origen: "Shopify #ORD-5839", usuario: "Sistema", hora: "09:30" },
  { id: "K-0417", prod: "Etiqueta térmica 4x6",  sku: "ET-460", tipo: "ENTRADA", cant: 10,  origen: "Recepción",         usuario: "Marcos",  hora: "08:47" },
];

const NAV = [
  { id: "dashboard",  label: "Dashboard",       icon: LayoutDashboard },
  { id: "inventario", label: "Inventario",      icon: Package },
  { id: "conteos",    label: "Conteos",         icon: ClipboardList },
  { id: "kardex",     label: "Kardex",          icon: ScrollText },
  { id: "salidas",    label: "Salidas Shopify", icon: ShoppingCart },
  { id: "ajustes",    label: "Ajustes",         icon: Settings },
];

const TIPO_META = {
  ENTRADA: { bg: C.greenSoft,  fg: C.greenText,  border: "#BBF7D0", Icon: ArrowDownLeft },
  SALIDA:  { bg: C.coralSoft,  fg: C.coralDeep,  border: C.coralMid, Icon: ArrowUpRight },
  AJUSTE:  { bg: C.indigoSoft, fg: C.indigoText, border: "#C7D2FE", Icon: SlidersHorizontal },
};

/* ══════════════════════════════════════════════════════════════════
   Atoms
══════════════════════════════════════════════════════════════════ */

function Badge({ children, bg, fg, border }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ background: bg, color: fg, border: `1px solid ${border || "transparent"}` }}
    >
      {children}
    </span>
  );
}

function StockBar({ stock, min }) {
  const pct = Math.min((stock / min) * 100, 100);
  const low = stock < min;
  return (
    <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: C.lineInner, width: 52 }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: low ? C.red : C.green }}
      />
    </div>
  );
}

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

function Field({ label, value, onChange, readOnly, hint, tone = "neutral" }) {
  const color = tone === "green" ? C.greenText : tone === "red" ? C.redText : C.ink;
  return (
    <div>
      <label
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wide"
        style={{ color: C.faint }}
      >
        {label}
      </label>
      <div
        className="flex items-center gap-1.5 rounded-lg border px-3 py-2.5"
        style={{ borderColor: C.line, background: readOnly ? C.bg : C.card }}
      >
        <input
          type={onChange ? "number" : "text"}
          value={value}
          readOnly={readOnly}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
          style={{ color }}
        />
        <span className="text-xs shrink-0" style={{ color: C.faint }}>{hint || "u."}</span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Modal: Ajustar Stock
══════════════════════════════════════════════════════════════════ */
function AjustarStockModal({ producto, onClose }) {
  const [tipo, setTipo]     = useState("AJUSTE");
  const [conteo, setConteo] = useState(producto.stock);
  const [motivo, setMotivo] = useState("");
  const [nota, setNota]     = useState("");

  const discrepancia = useMemo(() => Number(conteo) - producto.stock, [conteo, producto.stock]);
  const tipos = ["ENTRADA", "SALIDA", "AJUSTE"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: C.card, boxShadow: sh.modal }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-6 pt-6 pb-5 border-b"
          style={{ borderColor: C.lineInner }}
        >
          <div>
            <h2 className="text-base font-bold tracking-tight" style={{ color: C.ink }}>
              Ajustar stock
            </h2>
            <p className="mt-0.5 text-sm" style={{ color: C.sub }}>
              El movimiento queda registrado en el Kardex de forma permanente.
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg transition-colors hover:bg-gray-100"
            style={{ color: C.faint }}
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Producto card */}
          <div
            className="flex gap-3 rounded-xl p-3.5"
            style={{ background: C.bg, border: `1px solid ${C.line}` }}
          >
            <div
              className="grid h-11 w-11 place-items-center rounded-lg shrink-0"
              style={{ background: C.card, color: C.ghost, boxShadow: sh.xs }}
            >
              <Boxes size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: C.ink }}>
                {producto.nombre}
              </p>
              <p className="text-xs mt-0.5" style={{ color: C.sub }}>
                SKU {producto.sku} · {producto.familia}
              </p>
              <p className="text-xs" style={{ color: C.faint }}>{producto.presentacion}</p>
            </div>
          </div>

          {/* Tipo — segmented control */}
          <div>
            <p
              className="mb-2 text-xs font-semibold uppercase tracking-wide"
              style={{ color: C.faint }}
            >
              Tipo de movimiento
            </p>
            <div
              className="grid grid-cols-3 rounded-lg overflow-hidden"
              style={{ border: `1px solid ${C.line}` }}
            >
              {tipos.map((t, i) => {
                const active = tipo === t;
                const meta = TIPO_META[t];
                return (
                  <button
                    key={t}
                    onClick={() => setTipo(t)}
                    className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors"
                    style={{
                      background: active ? meta.bg : C.card,
                      color: active ? meta.fg : C.sub,
                      borderRight: i < tipos.length - 1 ? `1px solid ${C.line}` : "none",
                    }}
                  >
                    <meta.Icon size={13} />
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Campos */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Stock actual" readOnly value={producto.stock} hint="u." />
            <Field label="Conteo físico" value={conteo} onChange={setConteo} hint="u." />
            <Field
              label="Diferencia"
              readOnly
              value={discrepancia > 0 ? `+${discrepancia}` : discrepancia}
              hint="u."
              tone={discrepancia === 0 ? "neutral" : discrepancia > 0 ? "green" : "red"}
            />
          </div>

          {/* Motivo */}
          <div>
            <p
              className="mb-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: C.faint }}
            >
              Motivo
            </p>
            <div className="relative">
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="w-full appearance-none rounded-lg border px-3.5 py-2.5 text-sm outline-none"
                style={{
                  borderColor: C.line,
                  color: motivo ? C.ink : C.faint,
                  background: C.card,
                }}
              >
                <option value="">Elegí un motivo</option>
                <option>Conteo cíclico</option>
                <option>Merma / rotura</option>
                <option>Recepción de mercadería</option>
                <option>Corrección de error</option>
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3.5 top-3"
                style={{ color: C.faint }}
              />
            </div>
          </div>

          {/* Nota */}
          <div>
            <p
              className="mb-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{ color: C.faint }}
            >
              Nota opcional
            </p>
            <textarea
              rows={2}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Detalle adicional del movimiento…"
              className="w-full resize-none rounded-lg border px-3.5 py-2.5 text-sm outline-none"
              style={{ borderColor: C.line, color: C.ink, background: C.card }}
            />
            <p className="mt-1 text-xs" style={{ color: C.faint }}>
              Append-only · no se puede editar después de registrar.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-6 py-4 border-t"
          style={{ borderColor: C.lineInner, background: C.bg }}
        >
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition-colors hover:bg-gray-100"
            style={{ color: C.sub }}
          >
            Cancelar
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setConteo(producto.stock); setMotivo(""); setNota(""); }}
              className="flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-white"
              style={{ borderColor: C.line, color: C.sub, background: C.bg }}
            >
              <RotateCcw size={13} />
              Reiniciar
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: C.coral }}
            >
              <Check size={14} />
              Registrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Views
══════════════════════════════════════════════════════════════════ */

function Dashboard() {
  const bajos = PRODUCTOS.filter((p) => p.stock < p.min);

  const familias = [
    { f: "Embalaje",   v: 82, color: C.green  },
    { f: "Protección", v: 95, color: C.indigo },
    { f: "Etiquetado", v: 41, color: C.amber  },
    { f: "Logística",  v: 68, color: C.coral  },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: C.ink }}>
            Resumen de operación
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: C.sub }}>
            Estado del almacén · actualizado en tiempo real
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: C.coral }}
        >
          <Plus size={15} strokeWidth={2.5} />
          Nuevo movimiento
        </button>
      </div>

      {/* KPI grid */}
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
          value={bajos.length}
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

      {/* Content row */}
      <div className="grid grid-cols-3 gap-5">
        {/* Activity feed */}
        <div
          className="col-span-2 rounded-xl overflow-hidden"
          style={{ background: C.card, boxShadow: sh.sm, border: `1px solid ${C.line}` }}
        >
          <div
            className="flex items-center justify-between px-5 py-4 border-b"
            style={{ borderColor: C.lineInner }}
          >
            <h3 className="text-sm font-bold" style={{ color: C.ink }}>Movimientos recientes</h3>
            <button
              className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-70"
              style={{ color: C.coral }}
            >
              Ver Kardex <ChevronRight size={13} />
            </button>
          </div>
          <div>
            {KARDEX.map((m, i) => {
              const meta = TIPO_META[m.tipo];
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-gray-50"
                  style={{
                    borderBottom: i < KARDEX.length - 1 ? `1px solid ${C.lineInner}` : "none",
                  }}
                >
                  <div
                    className="grid h-8 w-8 place-items-center rounded-lg shrink-0"
                    style={{ background: meta.bg, color: meta.fg }}
                  >
                    <meta.Icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" style={{ color: C.ink }}>
                      {m.prod}
                    </p>
                    <p className="text-xs" style={{ color: C.faint }}>
                      {m.origen} · {m.usuario}
                    </p>
                  </div>
                  <span
                    className="text-sm font-bold tabular-nums"
                    style={{ color: m.cant < 0 ? C.red : C.green }}
                  >
                    {m.cant > 0 ? `+${m.cant}` : m.cant}
                  </span>
                  <span
                    className="tabular-nums text-xs w-10 text-right"
                    style={{ color: C.faint }}
                  >
                    {m.hora}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Inventory health */}
        <div
          className="rounded-xl p-5"
          style={{ background: C.card, boxShadow: sh.sm, border: `1px solid ${C.line}` }}
        >
          <h3 className="text-sm font-bold" style={{ color: C.ink }}>Salud del inventario</h3>
          <p className="mt-0.5 text-xs" style={{ color: C.sub }}>Cobertura vs. mínimo por familia</p>

          <div className="mt-5 space-y-4">
            {familias.map(({ f, v, color }) => (
              <div key={f}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium" style={{ color: C.sub }}>{f}</span>
                  <span
                    className="text-xs font-bold tabular-nums"
                    style={{ color: v < 50 ? C.amber : C.ink }}
                  >
                    {v}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.lineInner }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${v}%`, background: v < 50 ? C.amber : color }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div
            className="mt-5 rounded-lg p-3 text-xs leading-relaxed"
            style={{
              background: C.amberSoft,
              color: C.amberText,
              border: "1px solid #FCD34D",
            }}
          >
            <AlertTriangle size={12} className="inline mr-1 align-[-1px]" />
            <strong>Etiquetado al 41%.</strong> Considerá generar una orden de reposición antes del viernes.
          </div>
        </div>
      </div>
    </div>
  );
}

function Inventario({ onAjustar }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: C.ink }}>Inventario</h1>
          <p className="mt-0.5 text-sm" style={{ color: C.sub }}>
            Stock derivado del Kardex · nunca se edita a mano
          </p>
        </div>
        <button
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: C.coral }}
        >
          <Plus size={15} strokeWidth={2.5} />
          Alta de producto
        </button>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{ background: C.card, boxShadow: sh.sm, border: `1px solid ${C.line}` }}
      >
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.lineInner}` }}>
              {["Producto", "SKU", "Familia", "Stock", "Mínimo", "Estado", ""].map((h) => (
                <th
                  key={h}
                  className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: C.faint }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRODUCTOS.map((p, i) => {
              const bajo = p.stock < p.min;
              return (
                <tr
                  key={p.id}
                  className="group transition-colors hover:bg-gray-50"
                  style={{
                    borderBottom: i < PRODUCTOS.length - 1 ? `1px solid ${C.lineInner}` : "none",
                  }}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className="grid h-8 w-8 place-items-center rounded-lg shrink-0"
                        style={{ background: C.bg, color: C.ghost }}
                      >
                        <Boxes size={15} />
                      </div>
                      <div>
                        <p className="font-semibold" style={{ color: C.ink }}>{p.nombre}</p>
                        <p className="text-xs" style={{ color: C.faint }}>{p.presentacion}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className="font-mono text-xs rounded px-1.5 py-0.5"
                      style={{ background: C.bg, color: C.sub }}
                    >
                      {p.sku}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm" style={{ color: C.sub }}>{p.familia}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className="text-sm font-bold tabular-nums"
                      style={{ color: bajo ? C.red : C.ink }}
                    >
                      {p.stock}
                    </span>
                    <StockBar stock={p.stock} min={p.min} />
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="text-sm tabular-nums" style={{ color: C.faint }}>{p.min}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    {bajo
                      ? (
                        <Badge bg={C.redSoft} fg={C.redText} border="#FECACA">
                          <AlertTriangle size={11} /> Bajo
                        </Badge>
                      )
                      : (
                        <Badge bg={C.greenSoft} fg={C.greenText} border={C.greenMid}>
                          <Check size={11} /> Normal
                        </Badge>
                      )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => onAjustar(p)}
                      className="rounded-lg border px-3 py-1.5 text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ borderColor: C.line, color: C.coral }}
                    >
                      Ajustar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KardexView() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold tracking-tight" style={{ color: C.ink }}>Kardex</h1>
        <p className="mt-0.5 text-sm" style={{ color: C.sub }}>
          Libro de movimientos append-only · cada entrada es inmutable
        </p>
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{ background: C.card, boxShadow: sh.sm, border: `1px solid ${C.line}` }}
      >
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.lineInner}` }}>
              {["ID", "Producto", "Tipo", "Cantidad", "Origen", "Usuario", "Hora"].map((h) => (
                <th
                  key={h}
                  className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: C.faint }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KARDEX.map((m, i) => {
              const meta = TIPO_META[m.tipo];
              return (
                <tr
                  key={m.id}
                  className="transition-colors hover:bg-gray-50"
                  style={{
                    borderBottom: i < KARDEX.length - 1 ? `1px solid ${C.lineInner}` : "none",
                  }}
                >
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-xs" style={{ color: C.faint }}>{m.id}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="font-semibold" style={{ color: C.ink }}>{m.prod}</span>
                    <span className="ml-2 font-mono text-xs" style={{ color: C.ghost }}>{m.sku}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge bg={meta.bg} fg={meta.fg} border={meta.border}>
                      <meta.Icon size={11} /> {m.tipo}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className="font-bold tabular-nums"
                      style={{ color: m.cant < 0 ? C.red : C.green }}
                    >
                      {m.cant > 0 ? `+${m.cant}` : m.cant}
                    </span>
                  </td>
                  <td className="px-5 py-3.5" style={{ color: C.sub }}>{m.origen}</td>
                  <td className="px-5 py-3.5" style={{ color: C.sub }}>{m.usuario}</td>
                  <td className="px-5 py-3.5 tabular-nums text-xs" style={{ color: C.faint }}>
                    {m.hora}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Placeholder({ label }) {
  return (
    <div
      className="grid place-items-center rounded-xl"
      style={{
        minHeight: 320,
        background: C.card,
        border: `1px dashed ${C.line}`,
        boxShadow: sh.xs,
      }}
    >
      <div className="text-center">
        <div
          className="grid h-11 w-11 place-items-center rounded-xl mx-auto mb-3"
          style={{ background: C.bg, color: C.ghost }}
        >
          <Boxes size={20} />
        </div>
        <p className="text-sm font-semibold" style={{ color: C.ink }}>{label}</p>
        <p className="mt-1 text-xs" style={{ color: C.sub }}>Vista en construcción.</p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Root shell
══════════════════════════════════════════════════════════════════ */
export default function WmsUI() {
  const [vista, setVista]       = useState("dashboard");
  const [ajustando, setAjustando] = useState(null);

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
          <div
            className="flex items-center gap-2.5 rounded-lg p-2 cursor-pointer transition-colors hover:bg-gray-100"
          >
            <div
              className="grid h-8 w-8 place-items-center rounded-full text-xs font-bold text-white shrink-0"
              style={{ background: C.indigo }}
            >
              M
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate" style={{ color: C.ink }}>Marcos</p>
              <p className="text-xs truncate" style={{ color: C.faint }}>Operario</p>
            </div>
            <ChevronDown size={13} style={{ color: C.ghost }} />
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header
          className="sticky top-0 z-10 flex items-center justify-between px-7 py-3.5 border-b"
          style={{ background: C.card, borderColor: C.line, boxShadow: sh.xs }}
        >
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

          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
              style={{ background: C.redSoft, color: C.redText }}
            >
              <AlertTriangle size={12} strokeWidth={2.5} />
              3 bajo mínimo
            </div>

            <button
              className="relative grid h-9 w-9 place-items-center rounded-lg border transition-colors hover:bg-gray-50"
              style={{ borderColor: C.line, color: C.sub }}
            >
              <Bell size={16} />
              <span
                className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full"
                style={{ background: C.coral }}
              />
            </button>

            <button
              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors hover:bg-gray-50"
              style={{ borderColor: C.line }}
            >
              <div
                className="grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-white"
                style={{ background: C.indigo }}
              >
                M
              </div>
              <span className="text-sm font-semibold" style={{ color: C.ink }}>Marcos</span>
              <ChevronDown size={13} style={{ color: C.faint }} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto px-7 py-7">
          {vista === "dashboard"  && <Dashboard />}
          {vista === "inventario" && <Inventario onAjustar={setAjustando} />}
          {vista === "kardex"     && <KardexView />}
          {vista === "conteos"    && <Placeholder label="Conteos (offline-first)" />}
          {vista === "salidas"    && <Placeholder label="Salidas Shopify" />}
          {vista === "ajustes"    && <Placeholder label="Ajustes" />}
        </main>
      </div>

      {ajustando && (
        <AjustarStockModal producto={ajustando} onClose={() => setAjustando(null)} />
      )}
    </div>
  );
}
