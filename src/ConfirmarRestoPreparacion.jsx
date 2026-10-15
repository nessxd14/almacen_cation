import { useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { cantidadTexto, planPreparacionCompleta } from './lib/operacionesMovil';

function cantidadLinea(linea) {
  const s = linea.snapshot;
  const base = Number(s.pendiente_base);
  const factor = Number(s.factor);
  const cajas = base / factor;
  return cantidadTexto(base) + ' ' + s.unidad_base
    + (factor > 1 && Number.isInteger(cajas) ? ' · ' + cantidadTexto(cajas) + ' ' + s.presentacion : '');
}

export default function ConfirmarRestoPreparacion({ lineas, ocupado, onConfirmar }) {
  const [mostrar, setMostrar] = useState(false);
  const plan = planPreparacionCompleta(lineas);
  const n = plan.completar.length;
  if (!n) return null;
  async function confirmar() {
    if (!ocupado && await onConfirmar()) setMostrar(false);
  }
  return <section className="om-preparacion-rapida" aria-label="Confirmación rápida de preparación">
    {!mostrar ? <>
      <button className="om-primary om-wide" disabled={ocupado} onClick={() => setMostrar(true)}><CheckCheck size={19} /> Confirmar el resto completo</button>
      <p className="om-muted">Registra primero las líneas con faltantes. Luego confirma juntas las demás.</p>
    </> : <>
      <h3>Confirmar {n} {n === 1 ? 'línea completa' : 'líneas completas'}</h3>
      <p>Declaras que alistaste toda la cantidad indicada en estas líneas.</p>
      {plan.preservadas.length > 0 && <p>{plan.preservadas.length === 1 ? 'Se conserva 1 línea ya guardada' : 'Se conservan ' + plan.preservadas.length + ' líneas ya guardadas'}{plan.faltantes.length ? ' (' + plan.faltantes.length + ' con faltantes)' : ''}, con sus cantidades y observaciones.</p>}
      {plan.porResolver.length > 0 && <p className="om-error-text" role="alert">{plan.porResolver.length} líneas requieren resolver su estado o registrar el faltante. Quedarán pendientes.</p>}
      <details><summary>Ver cantidades que se confirmarán</summary><ul>{plan.completar.map(l => <li key={l.pedido_linea_id}><span>{l.snapshot.nombre}</span><strong>{cantidadLinea(l)}</strong></li>)}</ul></details>
      <div className="om-input-row"><button className="om-primary" disabled={ocupado} onClick={confirmar}>{ocupado ? 'Guardando…' : 'Confirmar ' + n + (n === 1 ? ' línea' : ' líneas')}</button><button className="om-secondary" disabled={ocupado} onClick={() => setMostrar(false)}>Cancelar</button></div>
      <p className="om-muted">Después podrás corregir una línea o terminar la preparación. La revisión de otra persona se realiza por separado.</p>
    </>}
  </section>;
}
