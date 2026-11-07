import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cantidadTexto } from './lib/operacionesMovil';
import { numero, redondear, separarEmpaque, unirEmpaque } from './lib/empaque';

// Contador de cantidades por empaque: cajas (o la presentación) + sueltas.
// Trabaja siempre en unidades base: recibe `valor` y emite `onValor` como texto
// en unidades base ('' si no se escribió nada). Así nadie convierte de cabeza
// ni elige una unidad equivocada en un selector.
export default function CantidadEmpaque({ valor, onValor, factor = 1, presentacion, unidadBase = 'unidades', etiqueta, ariaLabel, objetivo, disabled = false, autoFocus = false }) {
  const f = Number(factor) > 0 ? Number(factor) : 1;
  const conEmpaque = f > 1;
  const [inicialCajas, inicialSueltas] = separarEmpaque(valor, f);
  const [cajas, setCajas] = useState(inicialCajas);
  const [sueltas, setSueltas] = useState(inicialSueltas);
  const [previo, setPrevio] = useState(valor);
  // Si el formulario cambia la cantidad desde afuera (Cancelar, Completo,
  // No se alistó), se vuelve a repartir en cajas y sueltas.
  if (valor !== previo) {
    setPrevio(valor);
    if (valor !== unirEmpaque(cajas, sueltas, f)) {
      const [c, s] = separarEmpaque(valor, f);
      setCajas(c); setSueltas(s);
    }
  }
  const nombreEmpaque = !conEmpaque ? unidadBase : /x\s*\d/i.test(presentacion || '') ? presentacion : `${presentacion || 'Caja'} x${cantidadTexto(f)}`;
  function emitir(c, s) { setCajas(c); setSueltas(s); onValor(unirEmpaque(c, s, f)); }
  function paso(campo, delta) {
    const actual = campo === 'cajas' ? cajas : sueltas;
    const n = String(actual).trim() === '' ? 0 : numero(actual);
    const siguiente = String(Math.max(0, redondear((Number.isFinite(n) ? n : 0) + delta)));
    if (campo === 'cajas') emitir(siguiente, sueltas); else emitir(cajas, siguiente);
  }
  const total = unirEmpaque(cajas, sueltas, f);
  const base = total === '' ? null : Number(total);
  const meta = objetivo == null ? null : Number(objetivo);
  const estado = base == null || !Number.isFinite(base) || meta == null ? null
    : Math.abs(base - meta) < 1e-9 ? ['ok', 'Coincide con lo pedido']
    : base < meta ? ['falta', `Faltan ${cantidadTexto(meta - base)} ${unidadBase}`]
    : ['sobra', `Sobran ${cantidadTexto(base - meta)} ${unidadBase}`];
  const fila = (campo, texto, valorCampo, cambiar, aria, foco) => <div className="om-empaque-fila">
    <label>{texto}<input aria-label={aria} type="text" inputMode="decimal" enterKeyHint="done" autoComplete="off" value={valorCampo} disabled={disabled} autoFocus={foco}
      onFocus={e => e.target.select()} onChange={e => cambiar(e.target.value)} /></label>
    <div className="om-empaque-pasos">
      <button type="button" className="om-empaque-paso" aria-label={`Quitar 1 ${campo === 'cajas' ? nombreEmpaque : unidadBase}`} disabled={disabled} onClick={() => paso(campo, -1)}><Minus size={18} aria-hidden="true" /></button>
      <button type="button" className="om-empaque-paso" aria-label={`Sumar 1 ${campo === 'cajas' ? nombreEmpaque : unidadBase}`} disabled={disabled} onClick={() => paso(campo, 1)}><Plus size={18} aria-hidden="true" /></button>
    </div>
  </div>;
  return <div className="om-empaque" role="group" aria-label={String(etiqueta).replace(/\s*·\s*$/, '')}>
    {fila('cajas', `${etiqueta} ${nombreEmpaque}`, cajas, c => emitir(c, sueltas), ariaLabel, autoFocus)}
    {conEmpaque && fila('sueltas', `Sueltas · ${unidadBase}`, sueltas, s => emitir(cajas, s), `Sueltas de ${ariaLabel || etiqueta}`, false)}
    {base != null && Number.isFinite(base) && (conEmpaque || estado) && <p className="om-empaque-total" aria-live="polite">
      <span>Total: <strong>{cantidadTexto(base)} {unidadBase}</strong>{conEmpaque && <small> ({cantidadTexto(numero(cajas || 0))} {presentacion || 'Caja'} + {cantidadTexto(numero(sueltas || 0))})</small>}</span>
      {estado && <em className={`om-empaque-${estado[0]}`}>{estado[1]}</em>}
    </p>}
  </div>;
}
