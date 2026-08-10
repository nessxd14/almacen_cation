import { useContext } from "react";
import { AppNavContext } from "./appNavContext";

export function useAppNav() {
  const ctx = useContext(AppNavContext);
  if (!ctx) throw new Error("useAppNav debe usarse dentro de <App>");
  return ctx;
}
