/**
 * vozTablero.js — anuncios de voz del Tablero de almacén, vía Web Speech API
 * (SpeechSynthesis). Una sola voz fija en español, sin selector de voz/
 * volumen configurable (iteración futura si hace falta).
 */
function elegirVoz() {
  const voces = window.speechSynthesis?.getVoices() || [];
  return voces.find((v) => v.lang?.toLowerCase().startsWith("es")) || null;
}

export function anunciar(texto) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(texto);
  const voz = elegirVoz();
  if (voz) u.voice = voz;
  u.lang = voz?.lang || "es-ES";
  u.rate = 1;
  window.speechSynthesis.speak(u);
}
