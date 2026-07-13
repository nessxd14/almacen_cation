import { useState } from "react";
import { Warehouse, Loader, AlertTriangle } from "lucide-react";
import { useAuth } from "./lib/useAuth";

// Sin registro público — los usuarios se crean desde el Dashboard de
// Supabase (o, a futuro, un panel de Admin). Esta pantalla solo loguea.
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [entrando, setEntrando] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password) { setError("Completa email y contraseña"); return; }
    setEntrando(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    setEntrando(false);
    if (error) setError("Email o contraseña incorrectos");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900">
            <Warehouse size={22} className="text-white" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">Almacén</h1>
          <p className="text-sm text-slate-500">Iniciá sesión para continuar</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
            <input
              type="email" autoComplete="username" value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              placeholder="tu@email.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Contraseña</label>
            <input
              type="password" autoComplete="current-password" value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              placeholder="••••••••"
            />
          </div>
          <button type="submit" disabled={entrando}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {entrando && <Loader size={14} className="animate-spin" />}
            {entrando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
