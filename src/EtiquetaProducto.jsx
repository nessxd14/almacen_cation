import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { textoUbicacion } from './lib/fichaProducto';
import { textoPresentacion, textoContenidoPresentacion, tieneContenidoRegistrado } from './lib/presentacionEtiqueta';
import { FORMATOS_ETIQUETA, esEtiquetaDeEmpaque, esEtiquetaDeUbicacion } from './lib/formatosEtiqueta';
import { resolverSimbologia, tieneDesbordeEtiqueta } from './lib/codigoEtiqueta';
import { codigoUbicacion as codigoCorto, nombreMueble } from './lib/ubicacionTexto';

const DISENOS = new Set(FORMATOS_ETIQUETA.map(formato => formato.id));

function Campo({ titulo, children }) {
  return <div className="label-meta" data-label-field><span className="label-meta-title">{titulo}</span><strong>{children}</strong></div>;
}

export default function EtiquetaProducto({ datos, formato, enlace, ubicacion, codigoBarras, sucursalNombre, presentacion, lote = '', fechaIngreso = '', etiquetaId, onEstado }) {
  const root = useRef(null);
  const barcode = useRef(null);
  const stage = useRef(null);
  const barcodeError = useRef(null);
  const [escala, setEscala] = useState(1);
  const { producto } = datos;
  const identidad = etiquetaId ?? producto.id;
  const diseno = DISENOS.has(formato.diseno) ? formato.diseno : (DISENOS.has(formato.id) ? formato.id : 'estandar');
  const estilo = ['corporativo', 'industrial', 'minimalista'].includes(formato.estilo) ? formato.estilo : 'corporativo';
  const esUbicacion = esEtiquetaDeUbicacion(diseno);
  const usaQr = diseno !== 'ubicacion_tira';
  const imprimeBarras = formato.barras && !esUbicacion;
  const altoBarras = Number(formato.altoBarras ?? 8);
  const { qr, falloQr, size, path } = useMemo(() => {
    if (!usaQr) return { qr: null, size: 8, path: '', falloQr: false };
    try {
      const qr = QRCode.create(enlace, { errorCorrectionLevel: 'M' });
      let path = '';
      for (let y = 0; y < qr.modules.size; y++) for (let x = 0; x < qr.modules.size; x++) if (qr.modules.get(y, x)) path += `M${x + 4},${y + 4}h1v1h-1z`;
      return { qr, size: qr.modules.size + 8, path, falloQr: false };
    } catch { return { qr: null, size: 8, path: '', falloQr: true }; }
  }, [enlace, usaQr]);

  useLayoutEffect(() => {
    barcodeError.current = null;
    if (!imprimeBarras || !codigoBarras || !barcode.current) return;
    try {
      JsBarcode(barcode.current, codigoBarras.valor, {
        format: resolverSimbologia(codigoBarras.valor, formato.simbologia ?? 'automatico'),
        displayValue: false, margin: 10, height: altoBarras * 3.779527559, width: 1,
      });
      barcode.current.setAttribute('preserveAspectRatio', 'none');
    } catch (error) {
      barcode.current.replaceChildren();
      barcodeError.current = error instanceof Error ? error.message : 'El código de barras seleccionado no se puede generar.';
    }
  }, [imprimeBarras, codigoBarras, formato.simbologia, altoBarras, diseno]);

  useLayoutEffect(() => {
    const label = root.current;
    let activo = true;
    const medir = () => {
      if (!activo || !stage.current) return;
      const desborde = tieneDesbordeEtiqueta(label);
      const moduloPequeno = usaQr && Number(formato.qr) / size < 0.3;
      let error = falloQr ? 'No se pudo generar el QR.'
        : desborde ? 'El contenido no cabe completo. Amplía el formato, reduce la fuente o desactiva campos.'
          : moduloPequeno ? `Aumenta el QR a por lo menos ${Math.ceil(size * 0.3)} mm para que este enlace se pueda escanear.` : null;
      if (esEtiquetaDeEmpaque(diseno) && !tieneContenidoRegistrado(presentacion, producto.unidad_base)) error = 'Selecciona una presentación con nombre, equivalencia y unidad base registrados para etiquetar el empaque.';
      if (imprimeBarras && codigoBarras && !barcode.current?.hasChildNodes()) error = 'El código de barras no se pudo generar.';
      if (barcodeError.current) error = barcodeError.current;
      if (imprimeBarras && barcode.current?.viewBox.baseVal.width > 0) {
        const anchoMm = barcode.current.getBoundingClientRect().width / (label.getBoundingClientRect().width / label.offsetWidth || 1) / 3.779527559;
        if (anchoMm / barcode.current.viewBox.baseVal.width < 0.19) error = 'El código de barras es demasiado largo para este ancho de etiqueta. Amplía el formato.';
      }
      onEstado(identidad, { error, nodo: label });
      setEscala(Math.min(1, stage.current.clientWidth / label.offsetWidth));
    };
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(label); observer.observe(stage.current);
    label.querySelectorAll('[data-label-field]').forEach(campo => observer.observe(campo));
    document.fonts.ready.then(medir);
    const imagenes = [...label.querySelectorAll('img')];
    imagenes.forEach(img => { img.addEventListener('load', medir); img.addEventListener('error', medir); });
    return () => { activo = false; observer.disconnect(); imagenes.forEach(img => { img.removeEventListener('load', medir); img.removeEventListener('error', medir); }); };
  }, [formato, datos, ubicacion, codigoBarras, onEstado, identidad, falloQr, size, imprimeBarras, diseno, presentacion, lote, fechaIngreso, producto.unidad_base, usaQr]);

  const nombre = <h3 className="label-name" data-label-field>{producto.nombre}</h3>;
  const sku = producto.sku_interno || `Producto ${producto.id}`;
  const foto = formato.foto && producto.imagen_url && <img className="label-photo" data-label-field src={producto.imagen_url} alt={producto.nombre} />;
  const atributos = formato.atributos && datos.atributos?.length > 0 && <div className="label-attributes">
    {datos.atributos.map((a, i) => <p className="label-detail" data-label-field key={a.id ?? i}>{a.atributo_valor?.atributo?.nombre}: {a.atributo_valor?.valor}</p>)}
  </div>;
  const presentacionImprimir = (formato.presentacion || esEtiquetaDeEmpaque(diseno)) && !esUbicacion && <div className="label-presentation" data-label-field>
    <span className="label-presentation-title">Presentación</span>
    <strong className="label-presentation-value">{textoPresentacion(presentacion, producto.unidad_base)}</strong>
  </div>;
  const identidadProducto = <div className="label-identity" data-label-field>
    {formato.codigo && <span>SKU {sku}</span>}{formato.marca && producto.marca && <span>{producto.marca}</span>}
    {formato.unidad && <span>Unidad base: {producto.unidad_base || 'Sin registrar'}</span>}
  </div>;
  const metadatos = <div className="label-meta-grid">
    {formato.marca && producto.marca && <Campo titulo="Marca">{producto.marca}</Campo>}
    {formato.codigo && <Campo titulo="SKU">{sku}</Campo>}
    {formato.unidad && <Campo titulo="Unidad base">{producto.unidad_base || 'Sin registrar'}</Campo>}
  </div>;
  const ubicacionImprimir = formato.ubicacion && <div className="label-location" data-label-field>
    <span className="label-location-title">Ubicación · {sucursalNombre}</span>
    <strong className="label-location-value">{textoUbicacion(ubicacion)}</strong>
  </div>;
  const bloqueQR = (caption = true) => <div className="label-qr">
    {qr && <svg viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`QR de ${esUbicacion ? textoUbicacion(ubicacion) : producto.nombre}`} shapeRendering="crispEdges"><rect width={size} height={size} fill="#fff" /><path d={path} fill="#000" /></svg>}
    {caption && <span className="label-qr-caption" data-label-field>{esUbicacion ? 'Ver productos aquí' : 'Ficha digital'}</span>}
  </div>;
  const barras = imprimeBarras && codigoBarras && <div className="label-barcode">
    <svg ref={barcode} role="img" aria-label={`Código de barras ${codigoBarras.valor}`} />
    <span className="label-barcode-caption" data-label-field>{codigoBarras.valor}</span>
  </div>;
  const cabecera = (titulo, secundaria) => <div className="label-header"><span data-label-field>{titulo}</span>{secundaria && <span className="label-header-sub" data-label-field>{secundaria}</span>}</div>;
  const fila = (contenido, caption = true) => <div className="label-row"><div className="label-main">{contenido}</div>{bloqueQR(caption)}</div>;
  let contenido;
  switch (diseno) {
    case 'compacto':
      contenido = <>{cabecera('Identificación de producto')}{fila(<>{nombre}{identidadProducto}{foto}{atributos}</>)}{presentacionImprimir}{ubicacionImprimir}{barras}</>;
      break;
    case 'ficha_grande':
      contenido = <>{cabecera('Producto / ficha de inventario')}{fila(<>{nombre}{foto}{metadatos}{atributos}{presentacionImprimir}</>)}{ubicacionImprimir}{barras}</>;
      break;
    case 'a6':
      contenido = <>{cabecera('Ficha de producto', sucursalNombre)}<span className="label-eyebrow" data-label-field>01 · Identificación</span>{nombre}
        <div className="label-row label-identification-row"><div className="label-main">{metadatos}{atributos}{presentacionImprimir}</div>{foto}</div>
        {formato.ubicacion && <div className="label-section"><span className="label-eyebrow" data-label-field>02 · Ubicación</span>{ubicacionImprimir}</div>}
        <div className="label-section"><span className="label-eyebrow" data-label-field>03 · Consulta digital</span><div className="label-row label-digital-row">{bloqueQR()}{barras}</div></div></>;
      break;
    case 'mini':
      contenido = <>{cabecera('Producto', formato.codigo ? sku : null)}{fila(<>{nombre}{formato.marca && producto.marca && <p className="label-detail" data-label-field>{producto.marca}</p>}{presentacionImprimir}{ubicacionImprimir}{foto}{atributos}</>, false)}{barras}</>;
      break;
    case 'estanteria':
      contenido = <>{cabecera('Etiqueta de estantería')}{fila(<>{nombre}{presentacionImprimir}{foto}{atributos}</>, false)}{ubicacionImprimir}{identidadProducto}{barras}</>;
      break;
    case 'caja_bulto':
      contenido = <>{cabecera('Caja / bulto')}{fila(<>{nombre}{identidadProducto}{foto}{atributos}</>, false)}{presentacionImprimir}{ubicacionImprimir}{barras}</>;
      break;
    case 'caja_grande':
    case 'lectura_distancia': {
      // Las casillas proceden del catálogo, sin inferir características del nombre
      // ni convertir el contenido fijo del empaque en existencias actuales.
      const caracteristicas = formato.atributos ? (datos.atributos || []).filter(a =>
        String(a.atributo_valor?.atributo?.nombre ?? '').trim() && String(a.atributo_valor?.valor ?? '').trim()) : [];
      const skuRegistrado = String(producto.sku_interno ?? '').trim();
      const codigo = formato.codigo && <div className="label-pack-code" data-label-field><span>{skuRegistrado ? 'SKU' : 'ID'}</span> {skuRegistrado || producto.id}</div>;
      contenido = <>{cabecera('Identificación de empaque', sucursalNombre)}
        {diseno === 'lectura_distancia' ? <>{nombre}{codigo}</> : <>{codigo}{nombre}</>}
        {fila(<>{foto}{caracteristicas.length > 0 && <div className="label-pack-specs">{caracteristicas.map((a, i) =>
          <Campo key={a.id ?? i} titulo={a.atributo_valor.atributo.nombre}>{a.atributo_valor.valor}</Campo>)}</div>}
          <div className="label-pack-content" data-label-field><span className="label-pack-title">Contenido por presentación</span>
            <strong>{textoContenidoPresentacion(presentacion, producto.unidad_base)}</strong>
            <span className="label-pack-presentation">Presentación: {presentacion?.nombre || 'Sin seleccionar'}</span>
          </div></>)}
        {formato.marca && producto.marca && <div className="label-pack-brand" data-label-field>Marca: {producto.marca}</div>}
        {formato.unidad && <div className="label-detail" data-label-field>Unidad base: {producto.unidad_base || 'Sin registrar'}</div>}
        {ubicacionImprimir}{barras}<div className="label-pack-footer" data-label-field>Existencias actuales en la ficha digital</div></>;
      break;
    }
    case 'ubicacion_tira': {
      const codigo = codigoCorto(ubicacion);
      const titulos = ['Zona', 'Mueble', 'Compartimiento'];
      contenido = codigo ? <div className="label-location-strip" role="group" aria-label={codigo}>
        {codigo.split('-').map((valor, i) => <div className="label-strip-segment" key={titulos[i]}>
          {i > 0 && <span className="label-strip-dash" aria-hidden="true">-</span>}
          <div className={`label-strip-part${i === 2 ? ' label-strip-compartment' : ''}`}>
            <strong className="label-strip-value" data-label-field>{valor}</strong>
            <span className="label-strip-title" data-label-field>{titulos[i]}</span>
          </div>
        </div>)}
      </div> : <strong data-label-field>Sin ubicación registrada</strong>;
      break;
    }
    case 'ubicacion': {
      // En la casilla se imprime el código corto en grande (PB-EA-3) y abajo el desglose.
      const codigoUbicacion = ubicacion ? codigoCorto(ubicacion) : '';
      contenido = <>{cabecera('Ubicación de almacén', sucursalNombre)}{fila(<><span className="label-eyebrow" data-label-field>Código de ubicación</span><strong className="label-location-code" data-label-field>{codigoUbicacion || 'Sin ubicación registrada'}</strong><dl className="label-location-parts">
          {[['Zona', ubicacion?.codigo_zona], ['Mueble', nombreMueble(ubicacion)], ['Compartimiento', ubicacion?.compartimiento]].filter(([, valor]) => valor != null && String(valor).trim()).map(([titulo, valor]) => <div key={titulo} data-label-field><dt>{titulo}</dt><dd>{valor}</dd></div>)}
        </dl></>)}</>;
      break;
    }
    case 'qr_rapido':
      contenido = <>{cabecera('Ficha digital')}{bloqueQR(false)}{formato.codigo && <div className="label-identity" data-label-field>SKU {sku}</div>}{presentacionImprimir}{barras}</>;
      break;
    case 'control_lote':
      contenido = <>{cabecera('Control de lote / ingreso')}{fila(<>{nombre}{identidadProducto}{presentacionImprimir}{foto}{atributos}</>, false)}
        <div className="label-tracking"><div className="label-tracking-field" data-label-field><strong>Lote</strong>{lote ? <span>{lote}</span> : <span className="label-write-in" aria-label="Lote por completar" />}</div>
          <div className="label-tracking-field" data-label-field><strong>Ingreso</strong>{fechaIngreso ? <span>{/^\d{4}-\d{2}-\d{2}$/.test(fechaIngreso) ? fechaIngreso.split('-').reverse().join('/') : fechaIngreso}</span> : <span className="label-write-in" aria-label="Fecha de ingreso por completar" />}</div></div>
        {ubicacionImprimir}{barras}</>;
      break;
    default:
      contenido = <>{cabecera('Ficha de producto', sucursalNombre)}{fila(<>{nombre}{foto}{metadatos}{atributos}{presentacionImprimir}</>)}{ubicacionImprimir}{barras}</>;
  }

  return <div className="label-stage" ref={stage} style={{ height: `${Number(formato.alto) * 3.779527559 * escala}px` }}>
    <div className="label-scale" style={{ transform: `scale(${escala})` }}>
      <div className={`warehouse-label label-design-${diseno} label-style-${estilo}`} ref={root}
        style={{ '--label-width': `${Number(formato.ancho)}mm`, '--label-height': `${Number(formato.alto)}mm`, '--label-padding': `${Number(formato.relleno)}mm`, '--label-font': `${Number(formato.fuente)}pt`, '--label-qr': `${Number(formato.qr)}mm`, '--label-barcode-height': `${altoBarras}mm` }}>
        {contenido}
      </div>
    </div>
  </div>;
}
