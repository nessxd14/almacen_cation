import { useState } from "react";
import { ImageOff, Maximize2, X, LoaderCircle } from "lucide-react";
import CatalogDialog from "./CatalogDialog";

export default function ImagenProducto({ url, nombre, className = "", ampliable = false }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const [abierta, setAbierta] = useState(false);
  const disponible = Boolean(url) && failedUrl !== url;
  const picture = disponible ? (
    <img src={url} alt={nombre} onError={() => setFailedUrl(url)}
      className={`object-cover ${className}`} loading="lazy" decoding="async" />
  ) : (
    <div className={`product-image-placeholder flex items-center justify-center bg-slate-100 ${className}`}
      role="img" aria-label={`Sin imagen: ${nombre}`}>
      <ImageOff size={22} aria-hidden="true" />
    </div>
  );

  if (!ampliable) return picture;
  return (
    <div className="product-image">
      {picture}
      {disponible && <button type="button" className="product-image-expand"
        aria-label={`Ampliar imagen de ${nombre}`} title="Ampliar imagen"
        onClick={event => { event.stopPropagation(); setAbierta(true); }}>
        <Maximize2 size={15} strokeWidth={1.7} aria-hidden="true" />
      </button>}
      {abierta && <VisorImagen key={url} url={url} nombre={nombre} onClose={() => setAbierta(false)} />}
    </div>
  );
}

function VisorImagen({ url, nombre, onClose }) {
  const [estado, setEstado] = useState("cargando");
  return (
    <CatalogDialog onClose={onClose} label={`Imagen de ${nombre}`} className="product-image-dialog">
      <header className="product-image-dialog-header">
        <div><span>VISTA DE PRODUCTO</span><h2>{nombre}</h2></div>
        <button type="button" className="product-image-close" aria-label="Cerrar imagen" title="Cerrar (Esc)" onClick={onClose}>
          <X size={21} aria-hidden="true" />
        </button>
      </header>
      <div className="product-image-stage" aria-busy={estado === "cargando"}>
        {estado === "cargando" && <span className="product-image-status" role="status"><LoaderCircle size={24} className="animate-spin" />Cargando imagen…</span>}
        {estado === "error" ? <span className="product-image-status" role="status"><ImageOff size={32} />No se pudo cargar la imagen.</span> :
          <img src={url} alt={nombre} onLoad={() => setEstado("lista")} onError={() => setEstado("error")}
            style={{ opacity: estado === "lista" ? 1 : 0 }} />}
      </div>
      <footer className="product-image-dialog-footer">Imagen completa<span><kbd>Esc</kbd> para cerrar</span></footer>
    </CatalogDialog>
  );
}
