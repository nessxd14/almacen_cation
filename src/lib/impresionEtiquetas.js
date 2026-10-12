import { distribucionEtiquetas, validarFormato } from './formatosEtiqueta';
import { CSS_ETIQUETA } from './estilosEtiqueta';
export { CSS_ETIQUETA } from './estilosEtiqueta';

export function documentoImpresion(etiquetas, formato) {
  if (validarFormato(formato).length) throw new Error('Revisa las dimensiones del formato.');
  if (!Array.isArray(etiquetas) || !etiquetas.length) throw new Error('Selecciona al menos una etiqueta para imprimir.');
  const layout = distribucionEtiquetas(formato);
  const paginas = [];
  const envolver = etiqueta => `<div class="print-label-cell"><div class="print-label-turn">${etiqueta}</div></div>`;
  for (let i = 0; i < etiquetas.length; i += layout.porPagina) paginas.push(`<section class="print-page">${etiquetas.slice(i, i + layout.porPagina).map(envolver).join('')}</section>`);
  const margen = formato.papel === 'rollo' ? 0 : Number(formato.margen);
  const gap = formato.papel === 'rollo' ? 0 : Number(formato.separacion);
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>Etiquetas de almacén</title><style>
${CSS_ETIQUETA}
@page { size:${layout.anchoPagina}mm ${layout.altoPagina}mm; margin:0; }
html,body { margin:0; padding:0; background:#fff; }
.print-page { box-sizing:border-box; width:${layout.anchoPagina}mm; height:${layout.altoPagina}mm; padding:${margen}mm; display:grid; grid-template-columns:repeat(${layout.columnas},${layout.anchoCelda}mm); grid-auto-rows:${layout.altoCelda}mm; gap:${gap}mm; align-content:start; break-after:page; }
.print-page:last-child { break-after:auto; }
.print-label-cell { width:${layout.anchoCelda}mm; height:${layout.altoCelda}mm; break-inside:avoid; }
.print-label-turn { width:${Number(formato.ancho)}mm; height:${Number(formato.alto)}mm; transform-origin:0 0; transform:${layout.girada ? `translateX(${Number(formato.alto)}mm) rotate(90deg)` : 'none'}; }
.warehouse-label { break-inside:avoid; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
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
