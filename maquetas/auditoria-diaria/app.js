const glyphs = {
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 21v-7h4v7"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4m-9 4v10m-4-16 9 4"/>',
  chart: '<path d="M4 3v17h17M9 15v-4m5 4V6m5 9V9"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 1 5.5-3.6l-2.5 2.5 2.1 2.1 2.5-2.5a4 4 0 0 1-5 5.5l-9.8 9.8a2.1 2.1 0 0 1-3-3l9.8-9.8a4 4 0 0 1-.1-1Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-9 4v2m0 2h.01"/>',
  arrows: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  redo: '<path d="M20 11a8 8 0 1 0-2.7 6m2.7-10v4h-4M12 8v4l3 2"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3M8 9v6m4-6v6m4-6v6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="m10.3 4-8 14A1.7 1.7 0 0 0 3.8 21h16.4a1.7 1.7 0 0 0 1.5-2.5l-8-14a2 2 0 0 0-3.4-.5zM12 9v4m0 4h.01"/>',
  camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="M20 12H5m6 6-6-6 6-6"/>',
  location: '<path d="M20 10c0 5-8 10-8 10S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  message: '<path d="M20 11a7 7 0 0 1-7 7H9l-5 3v-5a7 7 0 0 1-1-5 7 7 0 0 1 7-7h3a7 7 0 0 1 7 7Z"/><path d="M8 11h.01m3.5 0h.01m3.5 0h.01"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

const cases = [
  { id: 'tajador', name: 'Tajador metálico', sku: 'TAJ-012', where: 'Planta baja · A-03', expected: 90, age: 1, art: 'sharpener', former: 100, movement: 10, state: 'recount' },
  { id: 'papel', name: 'Papel bond carta', sku: 'PAP-001', where: 'Planta baja · B-02', expected: 13000, age: 1, art: 'paper', state: 'pending' },
  { id: 'borrador', name: 'Borrador blanco', sku: 'BOR-003', where: 'Planta baja · A-03', expected: 100, age: 1, art: 'eraser', state: 'pending' },
  { id: 'cinta', name: 'Cinta transparente', sku: 'CIN-022', where: 'Hueco · H-01', expected: 250, state: 'camera', counted: 180 },
  { id: 'archivo', name: 'Archivador de palanca', sku: 'ARC-007', where: 'Garaje · G-04', expected: 58, state: 'pending' },
  { id: 'sobre', name: 'Sobre kraft oficio', sku: 'SOB-041', where: 'Hueco · H-02', expected: 1000, state: 'pending' },
  { id: 'regla', name: 'Regla transparente', sku: 'REG-019', where: 'Planta baja · A-04', expected: 40, state: 'pending' },
].map((item, index) => ({
  ...item,
  origin: index === 6 ? 'periodic' : index < 3 ? 'late' : 'movement',
}));

const catalog = ['Bolígrafo azul', 'Marcador pizarra', 'Cuaderno rayado', 'Carpeta plástica', 'Grapas 26/6', 'Cartulina blanca', 'Tijera escolar', 'Papel de color', 'Resaltador amarillo', 'Lápiz HB', 'Etiquetas adhesivas', 'Engrapadora', 'Perforadora', 'Portaminas', 'Corrector líquido', 'Cinta de embalaje', 'Silicona líquida', 'Bloc cuadriculado', 'Notas adhesivas'];
const inventory = [...cases, ...Array.from({ length: 38 }, (_, index) => ({
  id: `inventario-${index + 1}`,
  name: `${catalog[index % catalog.length]}${index >= catalog.length ? ' · reserva' : ''}`,
  sku: `MAT-${String(index + 1).padStart(3, '0')}`,
  where: index % 2 === 0 ? 'Hueco · H-02' : 'Garaje · G-01',
  expected: 130 + index * 10,
  origin: index < 4 ? 'late' : index < 31 ? 'movement' : 'periodic',
  state: index < 33 ? 'verified' : 'adjusted',
  counted: 130 + index * 10 - (index < 33 ? 0 : 1),
}))];

const status = {
  pending: ['Pendiente', 'red'],
  recount: ['Reconteo pendiente', 'amber'],
  verified: ['Verificado', 'green'],
  adjusted: ['Ajustado', 'green'],
  minor: ['Diferencia', 'amber'],
  major: ['Importante', 'red'],
  camera: ['En cámaras', 'purple'],
  warehouse: ['Por confirmar', 'amber'],
  review: ['En administración', 'red'],
};

const navigation = document.querySelector('#navigation');
const main = document.querySelector('main');
const screenTitle = document.querySelector('#screen-title');
const back = document.querySelector('#back');
const dialog = document.querySelector('#dialog');
const announcement = document.querySelector('#announcement');
const quantityFormat = new Intl.NumberFormat('de-DE');
const drafts = new Map();
let currentItem;
let closedSummary;
let warehouseRole = false;

const fmt = value => quantityFormat.format(value);
const percent = (amount, total) => `${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 1 }).format(amount * 100 / total)} %`;
const byId = id => inventory.find(item => item.id === id);
const isResolved = item => item.state === 'verified' || item.state === 'adjusted';
const isCase = item => ['minor', 'major', 'camera', 'review', 'warehouse'].includes(item.state);
const destination = item => `#/${isCase(item) ? 'diferencia' : 'conteo'}/${item.id}`;

function summary() {
  const total = inventory.length;
  const verified = inventory.filter(item => item.state === 'verified').length;
  const adjusted = inventory.filter(item => item.state === 'adjusted').length;
  return {
    total,
    verified,
    adjusted,
    pending: total - verified - adjusted,
    cameras: inventory.filter(item => item.state === 'camera').length,
    recounts: inventory.filter(item => item.state === 'recount').length,
  };
}

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[name]}</svg>`;
}

function photo(item) {
  return `<span class="picture ${item.art || ''}" aria-hidden="true">${item.art ? '' : icon('box')}</span>`;
}

function badge(item) {
  const [label, tone] = status[item.state];
  return `<span class="badge ${tone}">${label}</span>`;
}

function progress(label, count, total) {
  return `<div class="progress-block"><div class="progress-head"><span>${label}</span><strong>${count} de ${total} <small>(${percent(count, total)})</small></strong></div><div class="progress-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${count}"><div class="progress-bar" style="--progress:${count * 100 / total}%"></div></div></div>`;
}

function stat(label, value, tone, glyph) {
  return `<div class="stat ${tone}"><span class="stat-icon">${icon(glyph)}</span><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong></div>`;
}

function banner(tone, glyph, title, copy) {
  return `<div class="banner ${tone}">${icon(glyph)}<div><strong>${title}</strong><p>${copy}</p></div></div>`;
}

function productId(item) {
  return `<div class="product-id"><span>${item.sku}</span><span>${icon('location')} ${item.where}</span></div>`;
}

function row(item) {
  const meta = item.age ? `${item.where} · ${item.age} día de atraso` : item.where;
  return `<li data-product="${item.id}"><a class="product-row" href="${destination(item)}">${photo(item)}<span><strong class="product-title">${item.name}</strong><small class="product-meta">${meta}</small></span><span class="product-tail">${badge(item)}${icon('chevron')}</span></a></li>`;
}

function dashboard() {
  const counts = summary();
  const carried = inventory.filter(item => item.origin === 'late');
  const late = carried.filter(item => !isResolved(item));
  const movements = inventory.filter(item => item.origin === 'movement').length;
  const periodic = inventory.filter(item => item.origin === 'periodic').length;
  const next = inventory.find(item => item.state === 'recount' || item.state === 'pending');
  return `<div class="stack">
      <section class="card inline-stack"><div class="section-head"><h2>Resumen de la jornada</h2><span class="date">${icon('calendar')} 27 de noviembre</span></div>
      <div class="stat-grid">
        ${stat('Arrastrados al día', carried.length, 'amber', 'calendar')}
        ${stat('Con movimientos', movements, 'blue', 'arrows')}
        ${stat('Conteos periódicos', periodic, 'neutral', 'redo')}
        ${stat('Total programado', counts.total, 'neutral', 'box')}
      </div>
      ${progress('Avance de resolución', counts.verified + counts.adjusted, counts.total)}
      <a class="action" href="${next ? destination(next) : '#/lista'}">${icon('scan')} Ir al conteo ${icon('arrow')}</a>
      </section>
      <section><div class="section-head"><h2>Pendientes atrasados <span class="badge amber">${late.length}</span></h2><a href="#/lista" class="text-button">Ver lista ${icon('chevron')}</a></div>
        ${late.length ? `<ul class="item-list tasks">${late.map(row).join('')}</ul>` : '<p class="subtitle">No hay pendientes atrasados en esta jornada.</p>'}
      </section>
      <p class="subtitle">El recorrido incluye los movimientos desde el cierre anterior, durante el almuerzo y fuera de turno.</p>
    </div>`;
}

function list() {
  return `<div class="stack"><section class="card inline-stack" aria-label="Buscar productos">
      <label class="field">Nombre, SKU o ubicación<input id="product-search" type="search" placeholder="Buscar producto"></label>
      <div class="actions two"><label class="field"><span class="sr-only">Estado de conteo</span><select id="product-filter"><option value="pending">Pendientes</option><option value="all">Todos</option><option value="resolved">Resueltos</option></select></label>
      <button type="button" class="action secondary" data-action="scan">${icon('scan')} Escanear SKU</button></div>
    </section>
      <p class="subtitle" id="empty-products" hidden>No hay productos con estos filtros.</p>
      <ul class="item-list tasks" id="products">${inventory.map(row).join('')}</ul>
    </div>`;
}

function comparison(item) {
  const delta = item.counted - item.expected;
  const values = [['Esperado', item.expected], ['Contado', item.counted], ['Diferencia', delta]];
  return `<div class="compare">${values.map(([label, value], index) => `<div class="comparison ${index === 2 ? (delta === 0 ? 'green' : 'red') : ''}"><small>${label}</small><strong>${index === 2 && value > 0 ? '+' : ''}${fmt(value)}</strong></div>`).join('')}</div>`;
}

function count(item) {
  const counts = summary();
  const next = inventory.find(other => other.id !== item.id && ['recount', 'pending'].includes(other.state));
  const verifiable = !isResolved(item);
  return `<div class="stack">
    ${progress('Resueltos en la lista', counts.verified + counts.adjusted, counts.total)}
    <section class="card inline-stack"><div class="case-header">${photo(item)}<div><h2>${item.name}</h2>${productId(item)}</div></div>
      ${verifiable ? `
        ${item.state === 'recount' ? banner('amber', 'redo', 'Reconteo pendiente', item.former !== undefined ? `Conteo anterior de ${fmt(item.former)} unidades. Se registró una salida posterior de ${fmt(item.movement)}.` : 'Registra un nuevo conteo físico antes de resolver la diferencia.') : ''}
        <form class="inline-stack" id="count-form">
          <div class="count-inputs"><label class="field">Unidades contadas<input id="units" type="number" min="0" step="1" inputmode="numeric" autocomplete="off" aria-describedby="count-help" required placeholder="Cantidad" value="${drafts.get(item.id) || ''}"></label>
          <button class="action secondary" type="button" data-action="step" data-step="-1" aria-label="Restar una unidad">${icon('minus')}</button><button class="action secondary" type="button" data-action="step" data-step="1" aria-label="Sumar una unidad">${icon('plus')}</button></div>
          <p class="subtitle" id="count-help">Ingresa 0 si verificaste que no hay unidades. El saldo esperado aparece al guardar.</p>
          <button class="action" type="submit">${icon('check')} Guardar y comparar</button>
        </form>` : `
        ${comparison(item)}
        ${banner('green', 'check', item.state === 'adjusted' ? 'Ajuste registrado' : 'Verificado correctamente', `Conteo guardado · ${item.time || '16:25'}`)}
        ${next ? `<a class="action" href="${destination(next)}">Seguir con el siguiente ${icon('arrow')}</a>` : '<a class="action" href="#/cierre">Ver resumen</a>'}`}
    </section>
    ${verifiable ? `<button type="button" class="action secondary" data-action="scan">${icon('scan')} Escanear SKU</button>` : item.expected >= 10 ? `<button type="button" class="action secondary" data-action="movement" data-id="${item.id}">${icon('arrows')} Simular salida de 10</button>` : ''}
    </div>`;
}

function discrepancy(item) {
  const delta = item.counted - item.expected;
  const major = ['major', 'camera', 'review'].includes(item.state);
  const open = ['minor', 'major'].includes(item.state);
  const canJustify = open && item.recounted;
  const difference = delta < 0 ? `Faltan ${fmt(Math.abs(delta))} unidades` : `Sobran ${fmt(delta)} unidades`;
  const variation = item.expected > 0 ? ` (${percent(Math.abs(delta), item.expected)} del saldo)` : '';
  const detail = document.createElement('span');
  detail.textContent = item.note || '';
  return `<div class="stack"><section class="card inline-stack"><div class="case-header">${photo(item)}<div><h2>${item.name}</h2>${productId(item)}</div></div>
      ${comparison(item)}${banner(major ? 'red' : 'amber', 'alert', difference + variation, 'El almacenero puede ajustar el saldo después de verificar y justificar la diferencia.')}
      ${open && !item.recounted ? `<button type="button" class="action secondary" data-action="recount">${icon('redo')} Volver a contar</button>` : ''}
      ${item.state === 'camera' ? banner('blue', 'camera', 'Revisión de cámaras solicitada', 'La solicitud llega a administración y queda abierta hasta su resolución.') : ''}
      ${item.state === 'review' ? banner('red', 'clock', 'En revisión de administración', 'El caso queda pendiente de una decisión de administración.') : ''}
      ${item.state === 'warehouse' ? banner('amber', 'clock', 'Justificación enviada', 'El almacenero puede confirmar el ajuste.') : ''}
    </section>
      ${major && open ? `<button type="button" class="action secondary" data-action="camera">${icon('camera')} Solicitar revisión de cámaras</button>` : ''}
      ${canJustify ? `<form class="card inline-stack" id="case-form"><h2>Justificar diferencia</h2>
        <label class="field">Motivo<select name="reason" required><option value="">Selecciona un motivo</option><option>Merma</option><option>Error de conteo</option><option>Movimiento no registrado</option><option>Otro motivo</option></select></label>
        <label class="field">Detalle obligatorio<textarea name="detail" rows="3" maxlength="300" required placeholder="Describe qué se comprobó en el almacén"></textarea><span class="help" id="char-count">0 / 300</span></label>
        <button class="action" type="submit">${icon('tool')} ${warehouseRole ? 'Confirmar ajuste' : 'Guardar justificación'}</button>
        ${major ? `<button class="action secondary" type="submit" value="revision">${icon('arrow')} Enviar a administración</button>` : ''}
        ${!warehouseRole ? '<p class="section-note">Ivar registra la diferencia. El almacenero confirma el ajuste.</p>' : ''}
      </form>` : (item.note ? `<section class="card inline-stack"><h2>Justificación registrada</h2><p class="subtitle">${detail.innerHTML}</p>${item.state === 'warehouse' ? `<button class="action" type="button" data-action="warehouse">${icon('tool')} ${warehouseRole ? 'Confirmar ajuste' : 'Cambiar a rol almacenero de ejemplo'}</button>` : ''}</section>` : '')}
    </div>`;
}

function adjustmentList() {
  const adjusted = inventory.filter(item => ['adjusted', 'minor', 'major', 'camera', 'review', 'warehouse'].includes(item.state));
  return `<div class="stack"><p class="subtitle">Ajustes aplicados y diferencias en revisión.</p><ul class="item-list tasks">${adjusted.map(row).join('')}</ul></div>`;
}

function report() {
  const counts = closedSummary || summary();
  const lines = [
    ['Productos programados', counts.total, 'box', 'blue'],
    ['Verificados sin diferencia', counts.verified, 'check', 'green'],
    ['Ajustados con justificación', counts.adjusted, 'tool', 'amber'],
    ['Pendientes para el siguiente día', counts.pending, 'clock', 'red'],
    ['Solicitudes de cámaras', counts.cameras, 'camera', 'blue'],
  ];
  return `<div class="stack"><section class="card"><div class="section-head"><h2>Resultado del día</h2><span class="date">${icon('clock')} Corte · 00:00</span></div><ul class="summary-list">${lines.map(([label, value, glyph, tone]) => `<li class="${tone}">${icon(glyph)}<span>${label}</span><strong>${value}</strong></li>`).join('')}</ul><p class="section-note">Las solicitudes de cámaras abiertas están incluidas en los pendientes.</p></section>
      <section class="card inline-stack"><h2>Cumplimiento de auditoría</h2>${progress('Ítems resueltos', counts.verified + counts.adjusted, counts.total)}</section>
      ${banner('amber', 'redo', 'Pendientes del siguiente día', `Se trasladan ${counts.pending} ítems abiertos${counts.recounts ? `, incluyendo ${counts.recounts} por reconteo` : ''}. Los productos que se movieron después de contarse quedan pendientes de un nuevo conteo.`)}
      ${banner('blue', 'message', 'Reporte por Discord', closedSummary ? `Envío simulado a las 00:00. ${counts.verified} verificados, ${counts.adjusted} ajustados y ${counts.pending} pendientes.` : 'Vista previa. El reporte incluye verificados, ajustes, pendientes y solicitudes de cámaras.')}
      ${closedSummary ? '<p class="section-note">El resumen de cierre quedó registrado en la maqueta.</p>' : `<button type="button" class="action" data-action="close-day">${icon('clock')} Simular cierre de las 00:00</button>`}
    </div>`;
}

function showDialog(title, content) {
  dialog.innerHTML = `<div class="inline-stack"><header class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="Cerrar">${icon('close')}</button></header>${content}</div>`;
  dialog.showModal();
}

function examples() {
  const entries = [
    ['inicio', 'Inicio de auditoría', 'home'],
    ['conteo', 'Reconteo por movimiento posterior', 'redo'],
    ['menor', 'Justificación y ajuste', 'tool'],
    ['mayor', 'Discrepancia importante', 'alert'],
    ['cierre', 'Cierre y reporte', 'chart'],
  ];
  showDialog('Ejemplos de la maqueta', `<div class="actions">${entries.map(([key, label, glyph]) => `<button type="button" class="action secondary dialog-link" data-action="example" data-example="${key}">${icon(glyph)} ${label} ${icon('chevron')}</button>`).join('')}</div>`);
}

function openExample(example) {
  dialog.close();
  if (example === 'inicio' || example === 'cierre') {
    go(`#/${example}`);
    return;
  }
  if (example === 'conteo') {
    const item = byId('tajador');
    Object.assign(item, { state: 'recount', expected: 90, former: 100, movement: 10, counted: undefined, recounted: false });
    drafts.delete(item.id);
    go(destination(item));
    return;
  }
  const item = byId(example === 'menor' ? 'borrador' : 'papel');
  item.state = example === 'menor' ? 'minor' : 'major';
  item.counted = example === 'menor' ? 98 : 12500;
  item.recounted = true;
  go(destination(item));
}

function setRole() {
  warehouseRole = true;
  document.querySelector('.account-name').textContent = 'Alex · Almacenero';
  render();
  announce('Rol almacenero de ejemplo activo.');
}

function applyAdjustment(item) {
  item.state = 'adjusted';
  item.time = '17:45';
  go(destination(item));
  announce('Ajuste simulado. El ítem quedó resuelto.');
}

function announce(message) {
  announcement.textContent = message;
}

function go(hash) {
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

function activeSection(route) {
  if (['lista', 'conteo', 'diferencia'].includes(route)) return 'lista';
  if (['ajustes', 'cierre'].includes(route)) return route;
  return 'inicio';
}

function render() {
  let [route = 'inicio', itemId] = window.location.hash.slice(2).split('/').filter(Boolean);
  currentItem = byId(itemId);
  if (route === 'conteo' && !currentItem) route = 'lista';
  if (route === 'diferencia' && (!currentItem || !isCase(currentItem))) route = 'inicio';
  const productDetail = route === 'conteo' || route === 'diferencia';
  const active = activeSection(route);
  const titles = {
    inicio: 'Auditoría diaria',
    lista: 'Lista del día',
    conteo: 'Conteo diario',
    diferencia: ['major', 'camera', 'review'].includes(currentItem?.state) ? 'Discrepancia importante' : 'Diferencia de conteo',
    ajustes: 'Ajustes del día',
    cierre: 'Cierre de almacén',
  };
  screenTitle.textContent = titles[route] || titles.inicio;
  back.hidden = !productDetail;
  navigation.hidden = productDetail;
  const links = [['inicio', 'Inicio', 'home'], ['lista', 'Conteo', 'box'], ['ajustes', 'Ajustes', 'tool'], ['cierre', 'Cierre', 'chart']];
  navigation.innerHTML = links.map(([id, label, glyph]) => `<a class="nav-link" href="#/${id}"${active === id ? ' aria-current="page"' : ''}>${icon(glyph)} ${label}</a>`).join('');
  switch (route) {
    case 'lista': main.innerHTML = list(); filterList(); break;
    case 'conteo': main.innerHTML = count(currentItem); break;
    case 'diferencia': main.innerHTML = discrepancy(currentItem); break;
    case 'ajustes': main.innerHTML = adjustmentList(); break;
    case 'cierre': main.innerHTML = report(); break;
    default: main.innerHTML = dashboard();
  }
}

function filterList() {
  const input = document.querySelector('#product-search');
  if (!input) return;
  const filter = document.querySelector('#product-filter').value;
  const term = input.value.toLocaleLowerCase('es').trim();
  let visible = 0;
  for (const rowElement of document.querySelectorAll('#products [data-product]')) {
    const item = byId(rowElement.dataset.product);
    const matches = `${item.name} ${item.sku} ${item.where}`.toLocaleLowerCase('es').includes(term);
    rowElement.hidden = !matches || (filter !== 'all' && (filter === 'resolved') !== isResolved(item));
    if (!rowElement.hidden) visible += 1;
  }
  document.querySelector('#empty-products').hidden = visible !== 0;
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  switch (button.dataset.action) {
    case 'examples': examples(); break;
    case 'example': openExample(button.dataset.example); break;
    case 'close-dialog': dialog.close(); break;
    case 'scan':
      showDialog('Escanear SKU de ejemplo', `<form id="scan-form" class="inline-stack"><p class="subtitle">Ingresa un SKU de la maqueta, como TAJ-012, BOR-003 o PAP-001.</p><label class="field">Código del producto<input name="sku" type="text" autocomplete="off" required></label><p id="scan-error" class="subtitle" role="alert" hidden>Ese código no está en la lista del día.</p><button type="submit" class="action">${icon('scan')} Buscar SKU</button></form>`);
      break;
    case 'step': {
      const input = document.querySelector('#units');
      input.value = Math.max(0, Number(input.value) + Number(button.dataset.step));
      drafts.set(currentItem.id, input.value);
      break;
    }
    case 'movement': {
      const item = byId(button.dataset.id);
      const movement = Math.min(item.expected, 10);
      item.former = item.counted;
      item.movement = movement;
      item.expected -= movement;
      item.state = 'recount';
      render();
      announce('Movimiento simulado. El ítem volvió a pendiente.');
      break;
    }
    case 'recount':
      currentItem.state = 'recount';
      go(destination(currentItem));
      break;
    case 'camera':
      currentItem.state = 'camera';
      render();
      announce('Solicitud de revisión de cámaras registrada en la maqueta.');
      break;
    case 'warehouse':
      if (warehouseRole) applyAdjustment(currentItem);
      else setRole();
      break;
    case 'close-day':
      closedSummary = summary();
      render();
      announce('Cierre registrado y reporte simulado.');
      break;
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'product-search') filterList();
  if (event.target.id === 'units') drafts.set(currentItem.id, event.target.value);
  if (event.target.name === 'detail') document.querySelector('#char-count').textContent = `${event.target.value.length} / 300`;
});

document.addEventListener('change', event => {
  if (event.target.id === 'product-filter') filterList();
});

document.addEventListener('submit', event => {
  event.preventDefault();
  const values = new FormData(event.target);
  if (event.target.id === 'count-form') {
    const field = document.querySelector('#units');
    const amount = field.valueAsNumber;
    if (!Number.isSafeInteger(amount) || amount < 0) return;
    const item = currentItem;
    item.counted = amount;
    item.recounted = item.state === 'recount';
    item.time = '17:42';
    drafts.delete(item.id);
    const difference = amount - item.expected;
    if (difference === 0) item.state = 'verified';
    else item.state = item.id === 'papel' || item.id === 'cinta' ? 'major' : 'minor';
    go(destination(item));
    announce(difference === 0 ? 'Conteo verificado.' : 'El conteo presenta una diferencia.');
  }
  if (event.target.id === 'case-form') {
    const field = event.target.elements.detail;
    const note = values.get('detail').trim();
    if (!note) {
      field.setCustomValidity('Escribe una justificación antes de guardar.');
      field.reportValidity();
      field.setCustomValidity('');
      return;
    }
    const item = currentItem;
    item.note = `${values.get('reason')} · ${note}`;
    if (event.submitter?.value === 'revision') item.state = 'review';
    else if (warehouseRole) { applyAdjustment(item); return; }
    else item.state = 'warehouse';
    render();
    announce('Justificación registrada en la maqueta.');
  }
  if (event.target.id === 'scan-form') {
    const code = values.get('sku').trim().toUpperCase();
    const item = inventory.find(product => product.sku === code);
    if (item) {
      dialog.close();
      go(destination(item));
    } else dialog.querySelector('#scan-error').hidden = false;
  }
});

window.addEventListener('hashchange', () => {
  if (window.location.hash === '#contenido') return;
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});

back.innerHTML = icon('back');
render();
