// lib/reintentoPerfil.js — política de reintentos para la consulta de
// `perfil` en AuthContext, lógica pura separada para poder testearla sin
// React ni Supabase — mismo patrón que src/lib/control.js y
// src/lib/despacho.js.
//
// El caso realista no es el usuario dado de baja: es un 429 de Supabase
// (ver comentario de signOut en AuthContext.jsx). Sin reintentos, una
// ráfaga de rate limit bloquea a todo el equipo hasta que alguien recarga.
// Distinción central: se reintenta solo cuando la consulta FALLÓ (error).
// Cuando la consulta respondió que la fila no existe (data: null, error:
// null de maybeSingle()), es una respuesta definitiva — no reintentar.

const BACKOFF_MS = [400, 1200];

// La decisión es 100% sobre `error`. Cuando maybeSingle() devuelve
// data: null, error: null, la fila no existe: es una respuesta definitiva
// y cae en la misma rama que el éxito (no reintentar). `data` no entra
// como parámetro justamente porque no participa del cálculo — si algún
// día lo hiciera, la distinción de arriba se rompe.
// -> { reintentar: boolean, esperaMs: number|null }
export function decidirReintento({ error, intento, maxIntentos = 3, jitterMs = 0 }) {
  if (!error) return { reintentar: false, esperaMs: null }; // éxito o "no existe" (data: null)
  if (intento >= maxIntentos) return { reintentar: false, esperaMs: null };
  const base = BACKOFF_MS[intento - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  return { reintentar: true, esperaMs: base + jitterMs };
}

// Jitter ±150ms inyectable (rnd: () => número en [0,1)) para que el test
// sea determinista y para no encender veinte terminales en el mismo
// milisegundo — que es precisamente cómo se genera el 429.
export function jitter(rnd = Math.random, amplitudMs = 150) {
  return Math.round((rnd() * 2 - 1) * amplitudMs);
}
