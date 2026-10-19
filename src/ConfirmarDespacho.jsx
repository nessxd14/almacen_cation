import { useState } from 'react';
import { Truck, X, AlertTriangle, Check } from 'lucide-react';
import CatalogDialog from './CatalogDialog';
import { cantidadTexto } from './lib/operacionesMovil';
import './despacho-ui.css';

export default function ConfirmarDespacho({ plan, pedidoId, ocupado, error, onConfirmar, onClose }) {
  const [comprobado, setComprobado] = useState(false);
  return <CatalogDialog label="Revisar despacho" className="dispatch-dialog" onClose={() => { if (!ocupado) onClose(); }}>
    <header className="dispatch-dialog-header"><span className="dispatch-dialog-icon"><Truck size={23} /></span><div><small>ÚLTIMO PASO · PEDIDO #{pedidoId}</small><h2>Revisa lo que va a salir</h2></div><button aria-label="Cerrar revisión de despacho" disabled={ocupado} onClick={onClose}><X size={20} /></button></header>
    <div className="dispatch-dialog-body"><p>Comprueba estas cantidades contra el material físico antes de registrar la salida.</p>
      {plan.parciales > 0 && <div className="dispatch-notice"><AlertTriangle size={18} /><span>{plan.parciales} {plan.parciales === 1 ? 'producto saldrá parcialmente' : 'productos saldrán parcialmente'}. El resto continuará pendiente en este pedido.</span></div>}
      <ul className="dispatch-review-list">{plan.lineas.map(l => <li key={l.id}><div><strong>{l.linea?.producto?.nombre || l.linea?.nombre_manual || `Línea #${l.id}`}</strong><small>{l.linea?.producto?.sku_interno || `Línea #${l.id}`}</small></div>{l.error ? <p role="alert" className="dispatch-line-error">{l.error}</p> : <><div className="dispatch-review-qty"><span>Sale<strong>{cantidadTexto(l.total)} {l.linea?.producto?.unidad_base}</strong></span><span className={l.restante > 0 ? 'is-missing' : ''}>Queda pendiente<strong>{cantidadTexto(l.restante)} {l.linea?.producto?.unidad_base}</strong></span></div><small>{l.asignaciones.filter(a => Number(a.cantidad_base) > 0).map(a => `${a.ubicacion_label || `Ubicación #${a.ubicacion_id}`}: ${cantidadTexto(a.cantidad_base)}`).join(' · ')}</small></>}</li>)}</ul>
      <label className="dispatch-physical-check"><input type="checkbox" checked={comprobado} disabled={ocupado || !plan.listo} onChange={e => setComprobado(e.target.checked)} /><span>Comprobé los productos, las cantidades y las ubicaciones de salida.</span></label>
      {error && <p className="dispatch-line-error" role="alert">{error}</p>}
    </div><footer className="dispatch-dialog-footer"><button disabled={ocupado} onClick={onClose}>Volver a editar</button><button className="dispatch-confirm" disabled={ocupado || !comprobado || !plan.listo} onClick={onConfirmar}><Check size={17} />{ocupado ? 'Registrando salida…' : `Confirmar salida de ${plan.lineas.length} ${plan.lineas.length === 1 ? 'producto' : 'productos'}`}</button><small>La confirmación registra el despacho y descuenta las existencias.</small></footer>
  </CatalogDialog>;
}
