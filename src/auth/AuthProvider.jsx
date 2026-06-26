import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [cargando, setCargando] = useState(true);

  // Carga el perfil de aplicación (nombre, rol) del usuario autenticado.
  const cargarPerfil = useCallback(async (uid) => {
    if (!uid) { setPerfil(null); return; }
    const { data } = await supabase
      .from("perfil")
      .select("id, nombre, rol, activo")
      .eq("id", uid)
      .maybeSingle();
    setPerfil(data || null);
  }, []);

  useEffect(() => {
    let activo = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!activo) return;
      setSession(data.session);
      await cargarPerfil(data.session?.user?.id);
      setCargando(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      cargarPerfil(sess?.user?.id);
    });

    return () => { activo = false; sub.subscription.unsubscribe(); };
  }, [cargarPerfil]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = {
    session,
    perfil,
    cargando,
    usuario: perfil?.nombre || session?.user?.email || null,
    esAdmin: perfil?.rol === "admin",
    signIn,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
