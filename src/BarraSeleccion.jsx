import { X } from "lucide-react";

/**
 * BarraSeleccion — barra de acción para selección múltiple, compartida
 * entre SurtidoApp (brief W3) y Pedidos (brief W5, despacho por lote).
 * `fixed` la pone fija abajo (patrón pedido explícitamente por W5); sin
 * ella queda inline donde el padre la ubique (uso original de Surtido).
 */
export default function BarraSeleccion({ texto, children, onCerrar, fixed = false }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800
        ${fixed ? "fixed inset-x-4 bottom-4 z-40 mx-auto max-w-lg shadow-lg sm:inset-x-0" : "mb-3"}`}
    >
      <span>{texto}</span>
      <div className="ml-auto flex items-center gap-2">
        {children}
      </div>
      {onCerrar && (
        <button onClick={onCerrar} className="text-blue-400 hover:text-blue-600">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
