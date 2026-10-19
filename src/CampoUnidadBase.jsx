import { useId } from "react";
import { UNIDADES_RAPIDAS } from "./lib/presentaciones";

// "¿Qué es 1 unidad?" — nombre de la presentación base, con atajos.
export default function CampoUnidadBase({ value, onChange }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">¿Qué es 1 unidad?</label>
      <p className="mb-1 text-xs text-slate-400">Lo más chico que se cuenta y se vende suelto</p>
      <input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder="Unidad"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {UNIDADES_RAPIDAS.map(u => (
          <button key={u} type="button" onClick={() => onChange(u)} aria-pressed={value === u}
            className={`rounded-full border px-2 py-0.5 text-xs ${value === u ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-100"}`}>
            {u}
          </button>
        ))}
      </div>
    </div>
  );
}
