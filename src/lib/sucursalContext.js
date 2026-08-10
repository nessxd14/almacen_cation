import { createContext } from "react";

// Objeto de contexto puro (sin JSX) — separado de SucursalContext.jsx/useSucursal.js
// por la misma razón que authContext.js: no mezclar un export de componente
// con un export de función/objeto plano (rompe react-refresh/only-export-components).
export const SucursalContext = createContext(null);
