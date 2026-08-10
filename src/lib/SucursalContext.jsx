import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { SucursalContext } from "./sucursalContext";
import { sucursalActivaSegunPerfil } from "./control";
import { useAuth } from "./useAuth";

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
 *
 * Brief W3 #6: un encargado (perfil.sucursal_id con valor) no elige — ve
 * fija su sucursal y el selector ni se muestra. Ness/Rony (sucursal_id
 * null) siguen eligiendo como en W2.
 */
export function SucursalProvider({ children }) {
  const { usuario } = useAuth();
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [sucursalElegidaId, setSucursalElegidaIdState] = useState(() => {
    if (typeof localStorage === "undefined") return null;
    const guardada = Number(localStorage.getItem(STORAGE_KEY));
    return guardada > 0 ? guardada : null;
  });

  const { sucursalActivaId, puedeElegir } = sucursalActivaSegunPerfil(
    usuario?.sucursalId ?? null,
    sucursalElegidaId
  );

  const setSucursalActiva = useCallback((id) => {
    setSucursalElegidaIdState(id);
    try { localStorage.setItem(STORAGE_KEY, String(id)); } catch { /* localStorage no disponible */ }
  }, []);

  useEffect(() => {
    supabase
      .from("sucursal")
      .select("id, nombre, tipo, control_stock_default")
      .neq("tipo", "virtual")
      .order("id")
      .then(({ data, error }) => {
        if (error) console.error("cargar sucursales falló:", error);
        setSucursales(data || []);
        setCargando(false);
      });
  }, []);

  // Si la elección persistida ya no es una sucursal física válida (o no
  // hay ninguna todavía), cae a la primera disponible. Solo aplica cuando
  // la persona puede elegir — un encargado no necesita este fallback.
  useEffect(() => {
    if (cargando || sucursales.length === 0 || !puedeElegir) return;
    if (!sucursales.some((s) => s.id === sucursalElegidaId)) {
      // Sincroniza con localStorage (fuente externa), no deriva estado de React.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSucursalActiva(sucursales[0].id);
    }
  }, [cargando, sucursales, sucursalElegidaId, puedeElegir, setSucursalActiva]);

  const nombreSucursal = useCallback(
    (id) => (id != null ? sucursales.find((s) => s.id === id)?.nombre || `Sucursal ${id}` : null),
    [sucursales]
  );

  const sucursalActiva = sucursales.find((s) => s.id === sucursalActivaId) || null;

  const value = {
    sucursales,
    cargando,
    sucursalActivaId,
    sucursalActiva,
    puedeElegir,
    setSucursalActiva,
    nombreSucursal,
  };

  return <SucursalContext.Provider value={value}>{children}</SucursalContext.Provider>;
}
