import { useContext } from "react";
import { SucursalContext } from "./sucursalContext";

export function useSucursal() {
  const ctx = useContext(SucursalContext);
  if (!ctx) throw new Error("useSucursal debe usarse dentro de <SucursalProvider>");
  return ctx;
}
