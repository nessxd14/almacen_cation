// Vista previa e impresión comparten estas medidas físicas. Ningún campo se recorta.
export const CSS_ETIQUETA = `
.warehouse-label { --label-ink:#152330; --label-accent:#11748a; --label-soft:#f0f4f7; --label-rule:#c9d5df; --label-gap:.9mm; box-sizing:border-box; display:flex; flex-direction:column; gap:var(--label-gap); width:var(--label-width); height:var(--label-height); padding:var(--label-padding); font:var(--label-font)/1.15 Arial,sans-serif; color:var(--label-ink); background:#fff; overflow:visible; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
.warehouse-label * { box-sizing:border-box; }
.warehouse-label p,.warehouse-label h3,.warehouse-label dl,.warehouse-label dd { margin:0; }
.warehouse-label > *, .warehouse-label .label-main > * { flex-shrink:0; }
.warehouse-label [data-label-field] { overflow-wrap:anywhere; white-space:normal; min-width:0; }
.warehouse-label .label-header { display:flex; align-items:center; justify-content:space-between; gap:2mm; background:var(--label-ink); color:#fff; padding:1.1mm 1.5mm; font-size:.8em; line-height:1.15; font-weight:700; text-transform:uppercase; }
.warehouse-label .label-header-sub { font-size:.75em; font-weight:400; text-align:right; }
.warehouse-label .label-eyebrow { color:var(--label-accent); font-size:.72em; line-height:1.1; font-weight:700; text-transform:uppercase; }
.warehouse-label .label-row { display:flex; align-items:flex-start; gap:1.5mm; min-width:0; flex-shrink:0; }
.warehouse-label .label-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:var(--label-gap); }
.warehouse-label .label-name { display:block; color:var(--label-ink); font-size:1.2em; line-height:1.12; font-weight:750; overflow-wrap:anywhere; }
.warehouse-label .label-detail { color:inherit; font-size:.82em; line-height:1.15; overflow-wrap:anywhere; }
.warehouse-label .label-identity { display:flex; flex-wrap:wrap; gap:.6mm 2mm; font-size:.8em; font-weight:600; }
.warehouse-label .label-meta-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1mm; font-size:.8em; }
.warehouse-label .label-meta { display:flex; flex-direction:column; gap:.5mm; padding:1mm 1.5mm; background:var(--label-soft); }
.warehouse-label .label-meta-title { font-size:.7em; text-transform:uppercase; font-weight:700; color:var(--label-accent); }
.warehouse-label .label-presentation { padding:1mm 1.5mm; background:var(--label-soft); border-left:.6mm solid var(--label-accent); display:flex; flex-direction:column; gap:.5mm; }
.warehouse-label .label-presentation-title { font-size:.67em; line-height:1; font-weight:700; text-transform:uppercase; color:var(--label-accent); }
.warehouse-label .label-presentation-value { font-size:.86em; font-weight:700; line-height:1.15; }
.warehouse-label .label-location { border-top:.2mm solid var(--label-rule); padding-top:1mm; display:flex; flex-direction:column; gap:.5mm; font-size:.8em; }
.warehouse-label .label-location-title { font-size:.7em; text-transform:uppercase; color:var(--label-accent); font-weight:700; }
.warehouse-label .label-location-value { font-weight:700; }
.warehouse-label .label-qr { flex:none; width:var(--label-qr); }
.warehouse-label .label-qr svg { display:block; width:var(--label-qr); height:var(--label-qr); background:#fff; }
.warehouse-label .label-qr-caption { display:block; margin-top:.3mm; text-align:center; font-size:.63em; line-height:1.1; color:var(--label-ink); }
.warehouse-label .label-photo { height:13mm; max-width:100%; object-fit:contain; align-self:flex-start; }
.warehouse-label .label-barcode { padding-top:.5mm; margin-top:auto; color:#000; }
.warehouse-label .label-barcode svg { display:block; width:100%; height:var(--label-barcode-height); background:#fff; }
.warehouse-label .label-barcode-caption { display:block; font-size:.65em; line-height:1.15; text-align:center; margin-top:.3mm; color:#000; }
.warehouse-label .label-attributes { display:flex; flex-direction:column; gap:.4mm; }
.warehouse-label .label-tracking { display:grid; grid-template-columns:1fr 1fr; gap:2mm; border-top:.2mm solid var(--label-rule); padding-top:1mm; }
.warehouse-label .label-tracking-field { display:flex; flex-direction:column; gap:.8mm; font-size:.76em; }
.warehouse-label .label-write-in { min-height:2.7mm; border-bottom:.2mm solid var(--label-ink); display:block; }
.warehouse-label .label-location-code { display:block; font-size:1.8em; line-height:1.25; font-weight:800; }
.warehouse-label .label-location-parts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1mm 2mm; font-size:.85em; }
.warehouse-label .label-location-parts dt { font-size:.65em; color:var(--label-accent); text-transform:uppercase; }
.warehouse-label .label-location-parts dd { font-weight:700; }
.warehouse-label .label-section { display:flex; flex-direction:column; gap:2mm; border-top:.2mm solid var(--label-rule); padding-top:2mm; }
.warehouse-label.label-design-compacto { border-left:1.2mm solid var(--label-accent); }
.warehouse-label.label-design-compacto .label-header,.warehouse-label.label-design-ficha_grande .label-header { background:#fff; color:var(--label-accent); padding:0; }
.warehouse-label.label-design-ficha_grande { border-top:1.3mm solid var(--label-accent); }
.warehouse-label.label-design-ficha_grande .label-meta-grid { padding:1mm; background:var(--label-soft); }
.warehouse-label.label-design-a6 { --label-gap:1.5mm; }
.warehouse-label.label-design-a6 .label-header { padding:2.5mm; font-size:1em; }
.warehouse-label.label-design-a6 .label-name { font-size:1.6em; }
.warehouse-label.label-design-a6 .label-photo { height:24mm; }
.warehouse-label.label-design-a6 .label-identification-row .label-photo { max-width:30mm; flex:none; }
.warehouse-label.label-design-a6 .label-presentation { padding:2mm; }
.warehouse-label.label-design-a6 .label-digital-row { margin-top:auto; align-items:flex-end; }
.warehouse-label.label-design-a6 .label-digital-row .label-barcode { flex:1; min-width:0; margin:0; }
.warehouse-label.label-design-mini { --label-gap:.65mm; }
.warehouse-label.label-design-mini .label-header { font-size:.75em; padding:.6mm 1mm; }
.warehouse-label.label-design-mini .label-name { font-size:1.06em; }
.warehouse-label.label-design-mini .label-presentation,.warehouse-label.label-design-estanteria .label-presentation,.warehouse-label.label-design-control_lote .label-presentation { padding:.6mm .8mm; gap:.4mm; }
.warehouse-label.label-design-mini .label-presentation-title { font-size:.62em; }
.warehouse-label.label-design-mini .label-location { padding-top:.6mm; font-size:.8em; }
.warehouse-label.label-design-mini .label-photo { height:8mm; }
.warehouse-label.label-design-estanteria .label-header,.warehouse-label.label-design-ubicacion .label-header { background:var(--label-accent); }
.warehouse-label.label-design-estanteria .label-location-value { font-size:1.25em; }
.warehouse-label.label-design-caja_bulto .label-presentation-value { font-size:1.02em; }
.warehouse-label:is(.label-design-caja_grande,.label-design-lectura_distancia) { --label-gap:2mm; border:.7mm solid var(--label-ink); border-radius:3.5mm; }
.warehouse-label:is(.label-design-caja_grande,.label-design-lectura_distancia) .label-header { background:#fff; color:var(--label-ink); border:0; border-bottom:.4mm solid var(--label-ink); padding:0 0 2mm; font-size:.8em; letter-spacing:.05em; }
.warehouse-label:is(.label-design-caja_grande,.label-design-lectura_distancia) .label-name { font-size:2.4em; line-height:1.25; padding-bottom:1mm; font-weight:900; text-transform:uppercase; }
.warehouse-label.label-design-caja_grande .label-name { color:var(--label-accent); }
.warehouse-label .label-pack-code { font-size:3.4em; line-height:1.25; padding-bottom:2mm; font-weight:900; }
.warehouse-label .label-pack-code > span { font-size:.5em; }
.warehouse-label.label-design-lectura_distancia .label-pack-code { background:var(--label-ink); color:#fff; font-size:2.5em; padding:1.6mm 2mm; border-radius:1.5mm; }
.warehouse-label:is(.label-design-caja_grande,.label-design-lectura_distancia) .label-row { gap:4mm; align-items:center; }
.warehouse-label .label-pack-specs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1.5mm; }
.warehouse-label .label-pack-specs .label-meta { padding:2mm; gap:1mm; }
.warehouse-label .label-pack-specs .label-meta-title { color:var(--label-ink); font-size:.75em; }
.warehouse-label .label-pack-specs strong { font-size:1.3em; line-height:1.1; }
.warehouse-label .label-pack-content { display:flex; flex-direction:column; gap:1mm; border-top:.4mm solid var(--label-ink); padding-top:2mm; margin-top:1mm; }
.warehouse-label .label-pack-title { font-size:.75em; text-transform:uppercase; font-weight:700; }
.warehouse-label .label-pack-content > strong { font-size:1.85em; line-height:1.1; font-weight:900; }
.warehouse-label .label-pack-presentation { font-size:.9em; }
.warehouse-label .label-pack-brand { font-size:.8em; }
.warehouse-label .label-pack-footer { margin-top:auto; border-top:.2mm solid var(--label-rule); padding-top:1.5mm; font-size:.7em; }
.warehouse-label.label-design-ubicacion .label-location { font-size:1.05em; }
.warehouse-label.label-design-qr_rapido { align-items:center; --label-gap:.5mm; }
.warehouse-label.label-design-qr_rapido .label-header { width:100%; justify-content:center; font-size:.85em; padding:.6mm 1mm; }
.warehouse-label.label-design-qr_rapido .label-identity { font-size:.83em; justify-content:center; text-align:center; }
.warehouse-label.label-design-qr_rapido .label-presentation { width:100%; padding:.4mm .7mm; text-align:center; align-items:center; gap:.2mm; }
.warehouse-label.label-design-qr_rapido .label-presentation-title { font-size:.55em; }
.warehouse-label.label-design-qr_rapido .label-presentation-value { font-size:.68em; }
.warehouse-label.label-design-control_lote .label-header { font-size:.72em; }
.warehouse-label.label-style-industrial { --label-ink:#000; --label-accent:#000; --label-soft:#f1f1f1; --label-rule:#000; font-family:'Arial Narrow',Arial,sans-serif; }
.warehouse-label.label-style-industrial .label-header { border:.35mm solid #000; letter-spacing:.025em; }
.warehouse-label.label-style-minimalista { --label-ink:#111; --label-accent:#111; --label-soft:#fff; --label-rule:#bbb; font-family:Arial,sans-serif; }
.warehouse-label.label-style-minimalista .label-header { background:#fff; color:#111; border-bottom:.25mm solid #111; padding:.5mm 0 1mm; }
.warehouse-label.label-style-minimalista .label-presentation { border-left:0; padding:.6mm 0; }
.warehouse-label.label-design-ubicacion_tira { --label-ink:#000; --label-accent:#000; border:.25mm solid #888; justify-content:center; font-family:Arial,sans-serif; }
.warehouse-label .label-location-strip { display:flex; align-items:center; gap:2mm; width:100%; }
.warehouse-label .label-strip-segment { display:contents; }
.warehouse-label .label-strip-part { display:flex; flex:1; min-width:0; flex-direction:column; align-items:center; gap:1mm; }
.warehouse-label .label-strip-compartment { flex:1.45; }
.warehouse-label .label-strip-value { font-size:3em; font-weight:800; line-height:1.2; padding-bottom:1.5mm; white-space:nowrap; }
.warehouse-label .label-strip-title { font-size:.65em; line-height:1.2; text-transform:uppercase; white-space:nowrap; }
.warehouse-label .label-strip-dash { flex:none; font-size:2em; font-weight:700; line-height:1.2; margin-bottom:3.2mm; }
`;
