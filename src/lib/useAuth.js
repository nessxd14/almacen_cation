import { useContext } from "react";
import { AuthContext } from "./authContext";

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}

// { id, nombre, email, rol } del usuario logueado, o null si no hay sesión.
export function useUsuarioActual() {
  return useAuth().usuario;
}
