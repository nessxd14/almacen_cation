import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { AuthContext } from "./authContext";

// Brief W4 #4: si el token se renueva más de N veces en una ventana corta,
// algo está mal (bucle) y hoy solo se ve en el mostrador, no en desarrollo.
const REFRESHES_SOSPECHOSOS = 3;
const VENTANA_MS = 60_000;

/**
 * AuthProvider — sesión de Supabase Auth + fila de `perfil` del usuario
 * logueado. `perfil` ya existe en la base (trigger handle_new_user() la
 * autopobla al crear el usuario en auth.users) — acá solo se lee.
 *
 * Los hooks (useAuth/useUsuarioActual) viven en ./useAuth.js — separados
 * de este archivo para no mezclar un export de componente con exports de
 * función plana en el mismo módulo (rompe el fast-refresh de Vite).
 *
 * Brief W4: única suscripción a onAuthStateChange de toda la app — ver
 * "regla" del brief, `SucursalContext` consume este contexto, no llama a
 * auth por su cuenta. `getSession()` (memoria/localStorage), nunca
 * `getUser()` (red) para leer la sesión ya conocida.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = todavía no se sabe, null = sin sesión
  // Se guarda junto al user_id al que corresponde el fetch — evitar el
  // patrón "resetear con setState dentro del efecto" cuando cambia de
  // usuario: el valor mostrado se deriva más abajo, no se fuerza a null acá.
  const [perfilCargado, setPerfilCargado] = useState(null); // { userId, perfil } | null
  const [cargandoPerfil, setCargandoPerfil] = useState(false);
  const refreshesRecientes = useRef([]);

  useEffect(() => {
    // Verificación del brief W4 (tarea 1 / criterio de aceptación): tiene
    // que marcar 1 por montaje. Si sube más de una vez, hay una segunda
    // suscripción viva en algún lado.
    console.count("auth-listener");

    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "TOKEN_REFRESHED") {
        const ahora = Date.now();
        const recientes = [...refreshesRecientes.current, ahora].filter((t) => ahora - t < VENTANA_MS);
        refreshesRecientes.current = recientes;
        if (recientes.length > REFRESHES_SOSPECHOSOS) {
          console.warn(
            `auth: ${recientes.length} renovaciones de token en menos de un minuto — posible bucle de autenticación (brief W4).`
          );
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Depende del user_id, no del objeto `session` completo: `session` es una
  // referencia NUEVA en cada TOKEN_REFRESHED aunque sea el mismo usuario, así
  // que depender de `session` entero reconsultaba `perfil` en cada
  // renovación de token — presión de fondo extra sobre exactamente el
  // recurso que el brief describe como saturado.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId) return; // nada que buscar; no hay setState de "reseteo" acá
    let activo = true;
    // Arranca el estado de carga antes del fetch — patrón estándar de
    // efecto de datos, no una derivación de estado de React.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCargandoPerfil(true);
    supabase
      .from("perfil")
      .select("id, nombre, email, rol, activo, sucursal_id")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!activo) return;
        if (error) console.error("perfil: no se pudo consultar", error);
        setPerfilCargado({ userId, perfil: data || null, error: error || null });
        setCargandoPerfil(false);
      });
    return () => { activo = false; };
  }, [userId]);

  // Perfil "válido" solo si corresponde al usuario actual — así un logout o
  // un cambio de usuario no necesita un setState explícito de reseteo: el
  // valor derivado ya deja de coincidir en cuanto userId cambia.
  const perfilVigente = perfilCargado?.userId === userId ? perfilCargado : null;
  const perfil = perfilVigente?.perfil ?? null;
  // Si la consulta de perfil falló (red/RLS/429), no hay forma de saber si
  // el usuario está activo — no se puede caer a "activo: true" por defecto.
  const errorPerfil = perfilVigente?.error ?? null;

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });

  // Brief W4 tarea 3: cerrar sesión tiene que funcionar incluso si Supabase
  // está devolviendo 429/errores de red — si no, la persona queda sin forma
  // de salir de un estado roto y termina recargando o volviendo a loguearse
  // una y otra vez (exactamente el patrón de ráfaga de sesiones del brief).
  // auth-js ignora 401/403/404 del lado del servidor pero NO un 429; sin
  // este fallback, un signOut() rate-limited no limpia nada localmente.
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.warn("signOut: no se pudo cerrar la sesión en el servidor, se limpia localmente igual:", error);
      setSession(null);
      setPerfilCargado(null);
    }
  };

  // nombre como principal (así se lee "Rony", "Cristian" en el Kardex, no
  // un email largo); si por lo que sea el perfil no cargó, cae a email.
  const usuario = session?.user
    ? {
        id: session.user.id,
        email: session.user.email,
        nombre: perfil?.nombre || session.user.email,
        rol: perfil?.rol || "operario",
        // Si el fetch de perfil falló no se puede asumir "activo": un usuario
        // dado de baja cuyo fetch falla por rate-limit no puede colarse como
        // operario activo por defecto.
        activo: errorPerfil ? false : perfil?.activo !== false,
        bloqueadoPor: errorPerfil ? "error_perfil" : perfil?.activo === false ? "inactivo" : null,
        // Encargado de una sucursal fija (null = ve todas, elige en el header).
        sucursalId: perfil?.sucursal_id ?? null,
      }
    : null;

  const value = {
    // cargando: todavía no sabemos si hay sesión, o hay sesión pero su
    // perfil aún no llegó (evita un parpadeo mostrando rol "operario" por
    // defecto antes de tiempo).
    cargando: session === undefined || (!!session?.user && cargandoPerfil && !perfil),
    usuario,
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
