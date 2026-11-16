// Las pruebas nunca deben llegar a un Supabase real: cualquier fetch a
// *.supabase.co / *.supabase.in falla de forma explícita.
const HOSTS_PROHIBIDOS = ['.supabase.co', '.supabase.in'];

function urlDe(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input.url === 'string') return input.url; // Request
  return String(input);
}

function esSupabaseReal(url) {
  try {
    const host = new URL(url, 'http://localhost').hostname.toLowerCase();
    return HOSTS_PROHIBIDOS.some((sufijo) => host.endsWith(sufijo));
  } catch {
    return false;
  }
}

const fetchOriginal = globalThis.fetch;

globalThis.fetch = async function fetchSinProduccion(input, init) {
  const url = urlDe(input);
  if (esSupabaseReal(url)) {
    throw new Error('Test intentó llamar a Supabase real: ' + url);
  }
  return fetchOriginal.call(globalThis, input, init);
};
