import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { SucursalContext } from "./sucursalContext";

const STORAGE_KEY = "wms_sucursal_activa";

/**
 * SucursalProvider — sucursales físicas + cuál está activa, mismo patrón
 * que AuthContext. La sucursal activa es contexto de toda la app (qué
 * ubicaciones/stock/movimientos se ven), no un filtro local de una
 * pantalla — por eso vive acá y no en cada componente.
 *
 * Reemplaza los mapas de nombres de sucursal hardcodeados que había en
 * PedidosApp, TrasladosApp y PreciosApp (no coincidían entre sí y ninguno
 * contemplaba la sucursal 3 — que además es virtual y no debe aparecer acá).
 */
export function SucursalProvider({ children }) {
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sucursalActivaId, setSucursalActivaIdState] = useState(() => {
    if (typeof localStorage === "undefined") return null;
    const guardada = Number(localStorage.getItem(STORAGE_KEY));
    return guardada > 0 ? guardada : null;
  });

  const setSucursalActiva = useCallback((id) => {
    setSucursalActivaIdState(id);
    try { localStorage.setItem(STORAGE_KEY, String(id)); } catch { /* localStorage no disponible */ }
  }, []);

  useEffect(() => {
    supabase
      .from("sucursal")
      .select("id, nombre, tipo")
      .neq("tipo", "virtual")
      .order("id")
      .then(({ data, error }) => {
        if (error) console.error("cargar sucursales falló:", error);
        setSucursales(data || []);
        setCargando(false);
      });
  }, []);

  // Si la elección persistida ya no es una sucursal física válida (o no
  // hay ninguna todavía), cae a la primera disponible.
  useEffect(() => {
    if (cargando || sucursales.length === 0) return;
    if (!sucursales.some((s) => s.id === sucursalActivaId)) {
      // Sincroniza con localStorage (fuente externa), no deriva estado de React.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSucursalActiva(sucursales[0].id);
    }
  }, [cargando, sucursales, sucursalActivaId, setSucursalActiva]);

  const nombreSucursal = useCallback(
    (id) => (id != null ? sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}` : null),
    [sucursales]
  );

  const value = { sucursales, cargando, sucursalActivaId, setSucursalActiva, nombreSucursal };

  return <SucursalContext.Provider value={value}>{children}</SucursalContext.Provider>;
}
