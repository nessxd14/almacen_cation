import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { rutaDocumentoMovil } from './lib/operacionesMovil';

export default function CodigoDocumentoQr({ tipo, documentoId, titulo }) {
  const ruta = rutaDocumentoMovil(tipo, documentoId, true);
  const origen = import.meta.env.VITE_PUBLIC_APP_URL || 'https://almacen-cation.vercel.app';
  const enlace = new URL(ruta, origen).href;
  const [resultado, setResultado] = useState(null);
  useEffect(() => {
    let vigente = true;
    QRCode.toDataURL(enlace, { width: 280, margin: 4, errorCorrectionLevel: 'M' }).then(src => {
      if (vigente) setResultado({ enlace, src });
    }, () => { if (vigente) setResultado({ enlace, error: 'No se pudo generar el QR. Actualiza para reintentar.' }); });
    return () => { vigente = false; };
  }, [enlace]);
  const actual = resultado?.enlace === enlace ? resultado : null;
  return <section className="om-documento-qr" aria-label="QR de la solicitud">
    <h3>{titulo || 'Presenta este QR al almacenero'}</h3>
    {!actual ? <p role="status">Generando QR…</p> : actual.error ? <p role="alert">{actual.error}</p> : <img src={actual.src} width="230" height="230" alt={`QR del ${tipo === 'traslado_virtual' ? 'traslado virtual' : tipo} ${documentoId}`} />}
    <a href={enlace}>Abrir esta solicitud</a>
  </section>;
}
