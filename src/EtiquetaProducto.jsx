import { useLayoutEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { textoUbicacion } from './lib/fichaProducto';

export default function EtiquetaProducto({ datos, formato, enlace, ubicacion, codigoBarras, sucursalNombre, onEstado }) {
  const root = useRef(null);
  const barcode = useRef(null);
  const stage = useRef(null);
  const barcodeError = useRef(null);
  const [escala, setEscala] = useState(1);
  const { producto } = datos;
  let qr, falloQr;
  try { qr = QRCode.create(enlace, { errorCorrectionLevel: 'M' }); } catch { falloQr = true; }
  const size = (qr?.modules.size || 0) + 8;
  let path = '';
  if (qr) for (let y = 0; y < qr.modules.size; y++) for (let x = 0; x < qr.modules.size; x++) if (qr.modules.get(y, x)) path += `M${x + 4},${y + 4}h1v1h-1z`;

  useLayoutEffect(() => {
    barcodeError.current = null;
    if (!formato.barras || !codigoBarras) return;
    try {
      JsBarcode(barcode.current, codigoBarras.valor, { format: 'CODE128', displayValue: false, margin: 10, height: 35, width: 2 });
    } catch { barcodeError.current = 'El código de barras seleccionado no se puede generar.'; }
  }, [formato.barras, codigoBarras, onEstado, producto.id]);

  useLayoutEffect(() => {
    const label = root.current;
    let activo = true;
    const medir = () => {
      if (!activo || !stage.current) return;
      const desborde = label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1;
      const moduloPequeno = Number(formato.qr) / size < 0.3;
      let error = falloQr ? 'No se pudo generar el QR.' : desborde ? 'El contenido no cabe. Amplía el formato, reduce la fuente o desactiva campos.' : moduloPequeno ? 'Aumenta el tamaño del QR para mantenerlo legible.' : null;
      if (formato.barras && codigoBarras && (!barcode.current?.hasChildNodes())) error = 'El código de barras no se pudo generar.';
      if (barcodeError.current) error = barcodeError.current;
      if (formato.barras && codigoBarras && barcode.current?.viewBox.baseVal.width > label.clientWidth * 4) error = 'El código de barras es demasiado largo para este ancho de etiqueta.';
      onEstado(producto.id, { error, nodo: label });
      setEscala(Math.min(1, stage.current.clientWidth / label.offsetWidth));
    };
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(label); observer.observe(stage.current);
    document.fonts.ready.then(medir);
    label.querySelectorAll('img').forEach(img => { img.addEventListener('load', medir); img.addEventListener('error', medir); });
    return () => { activo = false; observer.disconnect(); label.querySelectorAll('img').forEach(img => { img.removeEventListener('load', medir); img.removeEventListener('error', medir); }); };
  }, [formato, datos, ubicacion, codigoBarras, onEstado, producto.id, falloQr, size]);

  return <div className="label-stage" ref={stage} style={{ height: `${Number(formato.alto) * 3.779527559 * escala}px` }}>
    <div className="label-scale" style={{ transform: `scale(${escala})` }}>
      <div className="warehouse-label" ref={root} style={{ '--label-width': `${formato.ancho}mm`, '--label-height': `${formato.alto}mm`, '--label-padding': `${formato.relleno}mm`, '--label-font': `${formato.fuente}pt`, '--label-qr': `${formato.qr}mm` }}>
        <div className="label-row"><div className="label-main">
          <h3 className="label-name">{producto.nombre}</h3>
          {formato.marca && producto.marca && <p className="label-detail">{producto.marca}</p>}
          {formato.codigo && <p className="label-detail">{producto.sku_interno || `Producto ${producto.id}`}</p>}
          {formato.unidad && <p className="label-detail">Unidad: {producto.unidad_base}</p>}
          {formato.atributos && datos.atributos.map((a, i) => <p className="label-detail" key={i}>{a.atributo_valor?.atributo?.nombre}: {a.atributo_valor?.valor}</p>)}
          {formato.ubicacion && <p className="label-detail label-location">{sucursalNombre}<br />{textoUbicacion(ubicacion)}</p>}
          {formato.foto && producto.imagen_url && <img className="label-photo" src={producto.imagen_url} alt={producto.nombre} />}
        </div><div className="label-qr">
          {qr && <svg viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`QR de ${producto.nombre}`} shapeRendering="crispEdges"><rect width={size} height={size} fill="#fff" /><path d={path} fill="#000" /></svg>}
          <span className="label-qr-caption">Ficha digital</span>
        </div></div>
        {formato.barras && codigoBarras && <div className="label-barcode"><svg ref={barcode} role="img" aria-label={`Código de barras ${codigoBarras.valor}`} /><span>{codigoBarras.valor} · {codigoBarras.presentacion}</span></div>}
      </div>
    </div>
  </div>;
}
