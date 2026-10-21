export const TURNOS_ALMACEN = { MANANA: { nombre: 'Mañana', inicio: '07:30', fin: '12:30' }, TARDE: { nombre: 'Tarde', inicio: '14:30', fin: '21:30' } };
export const fmtReporte = valor => valor == null ? '—' : Number(valor).toLocaleString('es-BO', { maximumFractionDigits: 4 });
export const fechaReporte = (valor = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(valor));
export function horaFormulario(valor) {
  if (!valor) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/La_Paz', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(valor)).replace(' ', 'T');
}
export function fechaHoraReporte(valor) {
  return valor ? new Date(valor).toLocaleString('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'short', timeStyle: 'short' }) : 'Sin contar';
}
export function equivalenciaReporte(valor, linea) {
  if (valor == null) return 'Sin contar';
  const factor = Number(linea.factor);
  if (factor <= 1 || Number(valor) < 0) return `${fmtReporte(valor)} ${linea.unidad}`;
  const empaques = Math.floor(Number(valor) / factor);
  const sueltas = Math.round((Number(valor) - empaques * factor) * 10000) / 10000;
  return `${fmtReporte(empaques)} ${linea.empaque} + ${fmtReporte(sueltas)} ${linea.unidad}`;
}
export function convertirConteo({ empaques, sueltas, contado_en }, linea) {
  const vacio = v => v == null || String(v).trim() === '';
  if (vacio(empaques) && vacio(sueltas) && vacio(contado_en)) return { empaques: null, sueltas: null, contado_en: null, total: null };
  const factor = Number(linea.factor), packs = factor === 1 ? 0 : Number(empaques), resto = Number(sueltas);
  if ((factor !== 1 && vacio(empaques)) || vacio(sueltas) || vacio(contado_en)) throw new Error('Completa las cantidades y la hora del conteo. Escribe 0 si comprobaste que no hay.');
  if (![packs, resto].every(n => Number.isFinite(n) && n >= 0 && n < 1e12) || !Number.isInteger(packs)) throw new Error('Usa empaques enteros y cantidades positivas o cero.');
  if (Math.abs(resto * 10000 - Math.round(resto * 10000)) > 0.00001) throw new Error('Usa hasta cuatro decimales en la cantidad suelta.');
  if (factor > 1 && resto >= factor) throw new Error('Convierte las unidades sueltas en empaques completos.');
  const fecha = new Date(`${contado_en}-04:00`);
  if (Number.isNaN(fecha.getTime())) throw new Error('La fecha y hora del conteo no son válidas.');
  const total = Math.round((packs * factor + resto) * 10000) / 10000;
  if (!Number.isFinite(total) || total >= 1e12) throw new Error('La cantidad total es demasiado grande.');
  return { empaques: packs, sueltas: resto, contado_en: fecha.toISOString(), total };
}
export function formularioLinea(linea, verificacion = false) {
  const prefix = verificacion ? 'ver_' : '';
  return { empaques: linea[`${prefix}empaques`] ?? '', sueltas: linea[`${prefix}sueltas`] ?? '', contado_en: horaFormulario(linea[verificacion ? 'ver_en' : 'contado_en']), observacion: linea[verificacion ? 'ver_nota' : 'observacion'] || '' };
}

const escapar = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function documentoHojaConteo(detalle, { recepcion = false } = {}) {
  const { reporte, lineas } = detalle;
  const items = recepcion ? lineas.filter(l => l.pendiente) : lineas;
  if (!items.length) throw new Error('No hay renglones para imprimir.');
  const turno = TURNOS_ALMACEN[reporte.turno];
  const paginas = [];
  let pagina = [], alto = 0;
  for (const item of items) {
    // Reserva espacio de escritura y permite nombres largos sin cortar filas
    // ni producir páginas extra con un pie numerado incorrectamente.
    const altoFila = Math.max(41, Math.ceil(String(item.nombre).length / 42) * 12 + (item.sku ? 14 : 0) + 12,
      Math.ceil(String(item.ubicacion).length / 26) * 12 + 12,
      Math.ceil(`1 ${item.empaque} = ${item.factor} ${item.unidad}`.length / 30) * 12 + 12);
    if (pagina.length && (pagina.length >= 8 || alto + altoFila > 368)) { paginas.push(pagina); pagina = []; alto = 0; }
    pagina.push(item); alto += altoFila;
  }
  if (pagina.length) paginas.push(pagina);
  const filas = rows => rows.map(l => `<tr><td>${l.numero}</td><td>${escapar(l.ubicacion)}</td><td><strong>${escapar(l.nombre)}</strong><small>${escapar(l.sku)}</small></td><td>1 ${escapar(l.empaque)} = ${fmtReporte(l.factor)} ${escapar(l.unidad)}</td><td>${Number(l.factor)===1?'—':''}</td><td></td><td></td><td></td><td></td></tr>`).join('');
  const html = paginas.map((rows, indice) => `<section class="hoja"><header><div><b>CATION</b><h1>${recepcion ? 'VERIFICACIÓN DE RECEPCIÓN' : 'HOJA DE CONTEO FÍSICO'}</h1></div><p>Folio: <strong>${escapar(reporte.folio)}</strong><br>Revisión de hoja: ${reporte.version}</p></header>
    <div class="datos"><span>Almacén: ${escapar(reporte.sucursal)}</span><span>Fecha: ${escapar(reporte.fecha)}</span><span>Turno de origen: ${escapar(turno.nombre)} ${turno.inicio} - ${turno.fin}</span></div>
    <div class="datos"><span>Responsable: ${recepcion ? '________________________' : escapar(reporte.responsable)}</span><span>Recorrido: ____:____ a ____:____</span><span>${recepcion ? 'Fecha de verificación: ____ / ____ / ________' : 'Corte previsto: '+turno.fin}</span></div>
    <aside><strong>CONTEO CIEGO</strong> · Anota la existencia física. El sistema compara después de ingresar la hoja.<br>0 = contado y vacío. Casilla vacía = pendiente. Escribe la hora real en cada renglón.</aside>
    <table><colgroup><col style="width:4%"><col style="width:14%"><col style="width:20%"><col style="width:15%"><col style="width:8%"><col style="width:8%"><col style="width:8%"><col style="width:7%"><col style="width:16%"></colgroup><thead><tr><th>N.º</th><th>Ubicación</th><th>Ítem / presentación</th><th>Equivalencia</th><th>Empaques completos</th><th>Sueltas en base</th><th>Total en base</th><th>Hora del conteo</th><th>Observación / respaldo</th></tr></thead><tbody>${filas(rows)}</tbody></table>
    <p class="regla">Total por ítem = empaques × factor + sueltas. Si el factor es 1, anota toda la cantidad en sueltas.</p><p>Observación general: ________________________________________________________________________________________</p>
    <div class="datos"><span>Contó / firma: __________________________</span><span>Ingresó al sistema: __________________________</span><span>Fecha y hora de ingreso: __________________</span></div>
    <footer><span>${escapar(reporte.folio)} · Hoja ${recepcion ? 'de recepción' : 'de cierre'} · Conservar como respaldo de la captura.</span><span>Página ${indice + 1} / ${paginas.length}</span></footer></section>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>${escapar(reporte.folio)} - Conteo físico</title><style>
    @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{margin:0;color:#17212a;background:#fff;font:10px Arial,sans-serif}.hoja{break-after:page}.hoja:last-child{break-after:auto}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #66717c;margin-bottom:12px;padding-bottom:8px}header div{display:flex;align-items:center;gap:22px}header b{font-size:20px}h1{font-size:19px;margin:0}header p{font-size:11px;line-height:1.5;margin:0}.datos{display:flex;justify-content:space-between;gap:16px;margin:10px 0}aside{padding:8px;background:#eee;line-height:1.7;margin:12px 0}table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{border:1px solid #8a949d;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#eee;font-size:9px}td{height:41px;vertical-align:top;font-size:10px}td small{display:block;font-size:9px;margin-top:4px}.regla{font-weight:bold}footer{display:flex;justify-content:space-between;border-top:1px solid #aaa;padding-top:6px;margin-top:18px;font-size:9px}@media screen{body{padding:20px}.hoja{max-width:1050px;margin:0 auto 30px}}@media print{aside,th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body>${html}</body></html>`;
}
export async function imprimirHojaConteo(detalle, opciones) {
  const frame = document.createElement('iframe');
  frame.title = 'Imprimir hoja de conteo o guardar como PDF';
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', width: '1px', height: '1px', right: '0', bottom: '0', border: '0' });
  const listo = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No se pudo preparar la hoja para imprimir.')), 15000);
    frame.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
  frame.srcdoc = documentoHojaConteo(detalle, opciones);
  document.body.append(frame);
  try {
    await listo; await frame.contentDocument.fonts.ready;
    frame.contentWindow.addEventListener('afterprint', () => frame.remove(), { once: true });
    frame.contentWindow.focus(); frame.contentWindow.print();
    setTimeout(() => frame.remove(), 120000);
  } catch (error) { frame.remove(); throw error; }
}
