// lib/fechas.js — fechas en horario local, nunca UTC.
//
// new Date().toISOString().slice(0,10) usa UTC: entre medianoche y la hora
// de corte UTC (21:00 en Bolivia, UTC-4) devuelve el día siguiente al que
// está viviendo quien mira la pantalla. hoyLocal() usa los getters locales
// de Date, que sí respetan el huso horario del navegador.

export function hoyLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Días transcurridos desde una fecha/timestamp ISO hasta ahora, redondeado
// hacia abajo (0 = hoy). null/inválido -> null.
export function diasDesde(iso) {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  const ms = Date.now() - fecha.getTime();
  return Math.max(Math.floor(ms / 86400000), 0);
}
