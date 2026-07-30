import { createClient } from '@supabase/supabase-js';

console.log('URL:', import.meta.env.VITE_SUPABASE_URL);
console.log('KEY:', import.meta.env.VITE_SUPABASE_ANON_KEY);

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }
);

// Brief I: los navegadores móviles congelan los temporizadores de pestañas en
// segundo plano — autoRefreshToken no dispara mientras la pestaña está oculta, y
// al volver el token ya venció (la primera consulta rebota con 401). El formulario
// de traslados es el más lento del sistema, así que es el que más lo sufre.
// Registrado una sola vez, a nivel de módulo — nunca por componente.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}