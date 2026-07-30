import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { AuthContext } from "./authContext";

/**
 * AuthProvider — sesión de Supabase Auth + fila de `perfil` del usuario
 * logueado. `perfil` ya existe en la base (trigger handle_new_user() la
 * autopobla al crear el usuario en auth.users) — acá solo se lee.
 *
 * Los hooks (useAuth/useUsuarioActual) viven en ./useAuth.js — separados
 * de este archivo para no mezclar un export de componente con exports de
 * función plana en el mismo módulo (rompe el fast-refresh de Vite).
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = todavía no se sabe, null = sin sesión
  const [perfil, setPerfil] = useState(null);
  const [cargandoPerfil, setCargandoPerfil] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    // Brief I: antes esto ponía `session` a lo que viniera en CUALQUIER evento,
    // incluido null — un 401 de una consulta (JWT vencido, red caída) no pasa por
    // acá directamente, pero si GoTrueClient emitía cualquier evento con sesión
    // null que no fuera un logout real, esto igual expulsaba al login. Ahora solo
    // se limpia la sesión en un SIGNED_OUT real (logout explícito, o refresco de
    // token fallado de verdad — GoTrueClient también lo emite como SIGNED_OUT) o
    // en INITIAL_SESSION sin sesión previa (arranque en frío, nunca hubo login:
    // legítimo, no es una expulsión).
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT") { setSession(null); return; }
      if (!s) { if (event === "INITIAL_SESSION") setSession(null); return; }
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setPerfil(null); return; }
    let activo = true;
    setCargandoPerfil(true);
    supabase
      .from("perfil")
      .select("id, nombre, email, rol, activo")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!activo) return;
        setPerfil(data || null);
        setCargandoPerfil(false);
      });
    return () => { activo = false; };
  }, [session]);

  const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });
  const signOut = () => supabase.auth.signOut();

  // nombre como principal (así se lee "Rony", "Cristian" en el Kardex, no
  // un email largo); si por lo que sea el perfil no cargó, cae a email.
  const usuario = session?.user
    ? {
        id: session.user.id,
        email: session.user.email,
        nombre: perfil?.nombre || session.user.email,
        rol: perfil?.rol || "operario",
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
