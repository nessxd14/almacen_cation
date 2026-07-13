import { createContext } from "react";

// Objeto de contexto puro (sin JSX) — separado de AuthContext.jsx/useAuth.js
// para que ninguno de los dos mezcle un export de componente con un export
// de función/objeto plano (rompe react-refresh/only-export-components).
export const AuthContext = createContext(null);
