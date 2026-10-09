import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { SucursalContext } from "./sucursalContext";
import { sucursalActivaSegunPerfil } from "./control";
import { useAuth } from "./useAuth";
import { elegirSucursalDisponible, estadoCargaSucursales } from "./cargaSucursales";

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
  const { usuario, cargando: cargandoAuth } = useAuth();
  const usuarioId = !cargandoAuth && usuario?.activo !== false ? usuario?.id ?? null : null;
  const [consulta, setConsulta] = useState(null);
  const [intento, setIntento] = useState(0);
  const { sucursales, cargando, error } = estadoCargaSucursales(usuarioId, intento, consulta);
  const [sucursalElegidaId, setSucursalElegidaIdState] = useState(() => {
    if (typeof localStorage === "undefined") return null;
    const guardada = Number(localStorage.getItem(STORAGE_KEY));
    return guardada > 0 ? guardada : null;
  });

  const { sucursalActivaId, puedeElegir } = sucursalActivaSegunPerfil(
    usuario?.sucursalId ?? null,
    elegirSucursalDisponible(sucursales, sucursalElegidaId)
  );

  const setSucursalActiva = useCallback((id) => {
    setSucursalElegidaIdState(id);
    try { localStorage.setItem(STORAGE_KEY, String(id)); } catch { /* localStorage no disponible */ }
  }, [setSucursalElegidaIdState]);

  useEffect(() => {
    // El provider se monta también en el login. Consultar antes de tener
    // sesión devuelve una lista vacía con RLS y dejaba el selector sin opciones.
    if (!usuarioId) return;
    let vigente = true;
    supabase
      .from("sucursal")
      .select("id, nombre, tipo, control_stock_default")
      .neq("tipo", "virtual")
      .order("id")
      .then(({ data, error }) => {
        if (!vigente) return;
        if (error) console.error("cargar sucursales falló:", error);
        setConsulta({ usuarioId, intento, data, error });
      }, (error) => {
        if (vigente) setConsulta({ usuarioId, intento, data: null, error });
      });
    return () => { vigente = false; };
  }, [usuarioId, intento]);

  const reintentarSucursales = useCallback(() => setIntento(n => n + 1), []);

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
    error,
    reintentarSucursales,
    sucursalActivaId,
    sucursalActiva,
    puedeElegir,
    setSucursalActiva,
    nombreSucursal,
  };

  return <SucursalContext.Provider value={value}>{children}</SucursalContext.Provider>;
}
