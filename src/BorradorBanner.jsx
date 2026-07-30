// Brief H: informativo, no un error — sin colores de alarma (mismos tonos
// slate neutros que el resto de la app, no rojo/amarillo).
function tiempoRelativo(guardadoEn) {
  const minutos = Math.max(1, Math.round((Date.now() - guardadoEn) / 60_000));
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  return `hace ${horas} h`;
}

export default function BorradorBanner({ guardadoEn, onRetomar, onDescartar }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">
      <span>Recuperamos un borrador de {tiempoRelativo(guardadoEn)}</span>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={onRetomar} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50">
          Retomar
        </button>
        <button type="button" onClick={onDescartar} className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-500 hover:bg-slate-50">
          Descartar
        </button>
      </div>
    </div>
  );
}
