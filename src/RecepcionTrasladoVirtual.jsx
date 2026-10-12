import { useState } from 'react';
import { cantidadOperacion, cantidadTexto } from './lib/operacionesMovil';

export default function RecepcionTrasladoVirtual({ lineas, ocupado, onRecibir }) {
  const [cantidades, setCantidades] = useState({});
  const [observacion, setObservacion] = useState('');
  const [error, setError] = useState('');
  async function recibir(e) {
    e.preventDefault(); setError('');
    try {
      const datos = lineas.map(l => ({ linea_id: l.id, cantidad_base: cantidadOperacion(cantidades[l.id]) }));
      for (const item of datos) {
        const original = lineas.find(l => l.id === item.linea_id);
        if (item.cantidad_base > Number(original.cantidad_base)) throw new Error('La cantidad recibida supera lo despachado.');
      }
      if (datos.some((l, i) => l.cantidad_base < Number(lineas[i].cantidad_base)) && !observacion.trim()) throw new Error('Indica el motivo de la diferencia de recepción.');
      await onRecibir({ lineas: datos, observacion: observacion.trim() });
    } catch (e) { setError(e.message); }
  }
  return <form className="om-recepcion" onSubmit={recibir}>
    <h3>Recepción en Tienda</h3><p className="om-muted">Cuenta lo recibido. La salida ya fue registrada; recibir confirma las cantidades y registra las diferencias.</p>
    {lineas.map(l => <label key={l.id}>{l.nombre} · salieron {cantidadTexto(l.cantidad_base)} {l.unidad_base}<input inputMode="decimal" value={cantidades[l.id] ?? ''} onChange={e => setCantidades(c => ({ ...c, [l.id]: e.target.value }))} placeholder="Cantidad recibida" required disabled={ocupado} /></label>)}
    <label>Observación<textarea value={observacion} maxLength={1000} onChange={e => setObservacion(e.target.value)} disabled={ocupado} /></label>
    {error && <p className="om-error-text" role="alert">{error}</p>}
    <button className="om-primary om-wide" disabled={ocupado || !lineas.length}>Confirmar recepción</button>
  </form>;
}
