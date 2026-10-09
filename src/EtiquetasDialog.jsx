import { X } from 'lucide-react';
import CatalogDialog from './CatalogDialog';
import FichasEtiquetasApp from './FichasEtiquetasApp';

export default function EtiquetasDialog({ productoId, sucursalId, onClose }) {
  return <CatalogDialog label="Ficha y etiqueta del producto" onClose={onClose} className="product-dialog etiquetas-dialog">
    <header className="product-dialog-header"><h2>Ficha y etiqueta</h2><button className="product-icon-button" onClick={onClose} aria-label="Cerrar ficha y etiqueta"><X size={20} /></button></header>
    <div className="product-dialog-scroll"><FichasEtiquetasApp productoId={productoId} sucursalId={sucursalId} /></div>
  </CatalogDialog>;
}
