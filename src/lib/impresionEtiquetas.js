import { distribucionEtiquetas, validarFormato } from './formatosEtiqueta';

// Se reutiliza el mismo CSS en vista previa e impresión, en milímetros.
export const CSS_ETIQUETA = `
.warehouse-label { box-sizing:border-box; width:var(--label-width); height:var(--label-height); padding:var(--label-padding); font:var(--label-font)/1.22 Arial,sans-serif; color:#000; background:#fff; overflow:visible; }
.warehouse-label * { box-sizing:border-box; }
.warehouse-label .label-row { display:flex; align-items:flex-start; gap:2mm; }
.warehouse-label .label-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:1mm; }
.warehouse-label .label-name { display:block; margin:0; color:#000; font-size:1.25em; font-weight:700; overflow-wrap:anywhere; }
.warehouse-label .label-detail { margin:0; overflow-wrap:anywhere; }
.warehouse-label .label-location { font-weight:700; font-size:1.05em; }
.warehouse-label .label-qr { flex:none; width:var(--label-qr); }
.warehouse-label .label-qr svg { display:block; width:100%; height:auto; }
.warehouse-label .label-qr-caption { display:block; text-align:center; font-size:.8em; overflow-wrap:anywhere; }
.warehouse-label .label-photo { height:14mm; max-width:100%; object-fit:contain; align-self:flex-start; }
.warehouse-label .label-barcode { margin-top:1mm; }
.warehouse-label .label-barcode svg { display:block; width:100%; height:9mm; }
.warehouse-label .label-barcode span { display:block; font-size:.8em; overflow-wrap:anywhere; }
`;

export function documentoImpresion(etiquetas, formato) {
  if (validarFormato(formato).length) throw new Error('Revisa las dimensiones del formato.');
  const layout = distribucionEtiquetas(formato);
  const paginas = [];
  for (let i = 0; i < etiquetas.length; i += layout.porPagina) paginas.push(`<section class="print-page">${etiquetas.slice(i, i + layout.porPagina).join('')}</section>`);
  const margen = formato.papel === 'rollo' ? 0 : Number(formato.margen);
  const gap = formato.papel === 'rollo' ? 0 : Number(formato.separacion);
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>Etiquetas de almacén</title><style>
${CSS_ETIQUETA}
@page { size:${layout.anchoPagina}mm ${layout.altoPagina}mm; margin:0; }
html,body { margin:0; padding:0; background:#fff; }
.print-page { box-sizing:border-box; width:${layout.anchoPagina}mm; height:${layout.altoPagina}mm; padding:${margen}mm; display:grid; grid-template-columns:repeat(${layout.columnas},${Number(formato.ancho)}mm); grid-auto-rows:${Number(formato.alto)}mm; gap:${gap}mm; align-content:start; break-after:page; }
.print-page:last-child { break-after:auto; }
.warehouse-label { break-inside:avoid; }
</style></head><body>${paginas.join('')}</body></html>`;
}

export async function imprimirEtiquetas(etiquetas, formato) {
  const frame = document.createElement('iframe');
  frame.title = 'Impresión de etiquetas';
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', width: '1px', height: '1px', right: '0', bottom: '0', border: '0' });
  const listo = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
  frame.srcdoc = documentoImpresion(etiquetas, formato);
  document.body.append(frame);
  try {
    await listo;
    await frame.contentDocument.fonts.ready;
    await Promise.all([...frame.contentDocument.images].map(img => new Promise((resolve, reject) => {
      if (img.complete) { if (img.naturalWidth) resolve(); else reject(new Error('No se pudo cargar una foto para imprimir.')); return; }
      const timeout = setTimeout(() => reject(new Error('La foto tardó demasiado en cargar. Intenta sin foto.')), 10000);
      img.onload = () => { clearTimeout(timeout); resolve(); };
      img.onerror = () => { clearTimeout(timeout); reject(new Error('No se pudo cargar una foto para imprimir.')); };
    })));
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    frame.contentWindow.focus();
    frame.contentWindow.print();
    // Algunos navegadores no emiten afterprint al cancelar.
    setTimeout(() => frame.remove(), 120000);
  } catch (error) { frame.remove(); throw error; }
}
