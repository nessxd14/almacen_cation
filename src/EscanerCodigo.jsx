import { useRef, useEffect, useState } from "react";

// Escáner de códigos reutilizable.
// BarcodeDetector nativo (Android/Chrome) con fallback a @zxing/browser (iOS/Safari).
// Extraído de ConteoApp para compartir el mismo comportamiento en todo el WMS.
export default function EscanerCodigo({ onDetect, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stopped = false;
    let stream = null;
    let controles = null;
    let leido = false;
    const detectar = (valor) => {
      if (stopped || leido) return;
      leido = true;
      controles?.stop();
      onDetect(valor);
    };

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) videoRef.current.srcObject = stream;

        if (typeof BarcodeDetector !== "undefined") {
          const bd = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "qr_code", "upc_a"] });
          const tick = async () => {
            if (stopped) return;
            if (videoRef.current?.readyState === 4) {
              const results = await bd.detect(videoRef.current).catch(() => []);
              if (results.length) { detectar(results[0].rawValue); return; }
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          controles = await reader.decodeFromVideoElement(videoRef.current, (result) => {
            if (result) detectar(result.getText());
          });
          if (stopped || leido) controles.stop();
        }
      } catch {
        if (!stopped) setError("No se pudo acceder a la cámara. Verifica el permiso y abre Almacén con HTTPS en el celular.");
      }
    }
    start();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      controles?.stop();
    };
  }, [onDetect]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80">
      {error
        ? <p className="px-6 text-center text-sm text-white">{error}</p>
        : <video ref={videoRef} autoPlay playsInline className="w-full max-w-sm rounded-lg" />}
      <button onClick={onClose} className="rounded-full bg-white px-6 py-2 text-sm font-medium">
        Cerrar
      </button>
    </div>
  );
}
