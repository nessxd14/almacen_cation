import { useState } from "react";
import { Warehouse, Loader, AlertTriangle, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useAuth } from "./lib/useAuth";

// Sin registro público — los usuarios se crean desde el Dashboard de
// Supabase (o, a futuro, un panel de Admin). Esta pantalla solo loguea.
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [entrando, setEntrando] = useState(false);
  const [mostrarPassword, setMostrarPassword] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) { setError("Completa email y contraseña"); return; }
    setEntrando(true);
    setError(null);
    try {
      const { error: signInError } = await signIn(email.trim(), password);
      if (signInError) setError("Email o contraseña incorrectos");
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div className="glass-login">
      <div className="glass-login-story">
        <div className="glass-login-logo"><span className="glass-brand-icon"><Warehouse size={27} /></span><span>CATION</span></div>
        <div>
          <h1>Tu almacén, todo en su lugar.</h1>
          <p>Inventario, pedidos y movimientos en un espacio claro para que tu equipo avance con confianza.</p>
        </div>
        <small>Almacén Cation · Espacio de trabajo</small>
      </div>
      <div className="glass-login-side">
        <div className="glass-login-card">
          <h2>Bienvenido</h2>
          <p className="glass-login-intro">Inicia sesión para continuar con tu operación.</p>
          <form onSubmit={onSubmit} aria-busy={entrando}>
            {error && (
              <div className="glass-error" role="alert" id="login-error">
                <AlertTriangle size={16} aria-hidden="true" /> {error}
              </div>
            )}
            <div className="glass-field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email" autoComplete="username" value={email}
                onChange={e => { setEmail(e.target.value); setError(null); }}
                aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined}
                placeholder="tu@email.com"
              />
            </div>
            <div className="glass-field">
              <label htmlFor="login-password">Contraseña</label>
              <div className="glass-password">
                <input
                  id="login-password"
                  type={mostrarPassword ? "text" : "password"} autoComplete="current-password" value={password}
                  onChange={e => { setPassword(e.target.value); setError(null); }}
                  aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined}
                  placeholder="••••••••"
                />
                <button type="button" className="glass-password-toggle"
                  onClick={() => setMostrarPassword(v => !v)}
                  aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={mostrarPassword}>
                  {mostrarPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={entrando} className="glass-submit">
              {entrando ? <Loader size={16} className="animate-spin" /> : <ArrowRight size={17} />}
              {entrando ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
