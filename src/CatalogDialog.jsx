import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// The top layer keeps dialogs above sticky headers and glass surfaces.
export default function CatalogDialog({ children, onClose, label, className = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog ref={ref} className={`catalog-dialog ${className}`} aria-label={label}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onClick={event => {
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.target === event.currentTarget && (
          event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom
        )) onClose();
      }}>
      {children}
    </dialog>, document.body,
  );
}
