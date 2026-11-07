import { cantidadTexto } from './operacionesMovil';

// Conversión entre unidades base y empaque (cajas + sueltas).
export const redondear = n => Math.round(n * 1e6) / 1e6;
export const numero = texto => Number(String(texto).trim().replace(',', '.'));

export function separarEmpaque(valor, factor) {
  if (valor === '' || valor == null) return ['', ''];
  const base = Number(valor);
  if (!Number.isFinite(base)) return [String(valor), ''];
  if (factor <= 1) return [String(redondear(base)), ''];
  const cajas = Math.floor(base / factor + 1e-9);
  const sueltas = redondear(base - cajas * factor);
  return [String(cajas), sueltas ? String(sueltas) : ''];
}

export function textoEmpaque(base, { factor, presentacion, unidad_base: unidadBase = 'unidades' } = {}) {
  const f = Number(factor) > 0 ? Number(factor) : 1;
  const b = Number(base) || 0;
  if (f <= 1) return `${cantidadTexto(b)} ${unidadBase}`;
  const [c, r] = separarEmpaque(b, f);
  const cajas = Number(c), sueltas = Number(r || 0);
  if (!cajas) return `${cantidadTexto(sueltas)} ${unidadBase}`;
  return `${cantidadTexto(cajas)} ${presentacion || 'Caja'}${sueltas ? ` + ${cantidadTexto(sueltas)} ${unidadBase}` : ''}`;
}

export function unirEmpaque(cajas, sueltas, factor) {
  if (String(cajas).trim() === '' && String(sueltas).trim() === '') return '';
  const c = String(cajas).trim() === '' ? 0 : numero(cajas);
  const s = String(sueltas).trim() === '' ? 0 : numero(sueltas);
  if (!Number.isFinite(c) || !Number.isFinite(s) || c < 0 || s < 0) return `${cajas}|${sueltas}`;
  return String(redondear(c * (factor > 1 ? factor : 1) + s));
}
