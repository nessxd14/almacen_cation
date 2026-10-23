// Solo las referencias emitidas por las operaciones identifican un documento.
// Un motivo libre repetido (o vacío) no identifica un comprobante compartido.
export function referenciaComprobante(m) {
  const ref = (m.referencia || '').trim();
  const venta = /^(?:Venta|Envío Caja VTD) #(\d+)\b/i.exec(ref);
  if (venta) return { tabla: 'venta', id: venta[1], tipo: /^Envío/.test(ref) ? 'VTD' : 'VENTA', numero: ref.replace(/ ·.*$/, '') };
  const pedido = /^(?:Reversión pedido|Pedido) #(\d+)\b/i.exec(ref);
  if (pedido) return { tabla: 'pedido', id: pedido[1], tipo: 'PEDIDO', numero: `Pedido #${pedido[1]}` };
  const traslado = /^(?:Reversión traslado|Traslado) #(\d+)\b/i.exec(ref);
  if (traslado) return { tabla: 'solicitud_traslado', id: traslado[1], tipo: 'TRASLADO', numero: `Traslado #${traslado[1]}` };
  const folio = /\b(VTD|VTA|PED|TRA)-\d{4}-\d+\b/i.exec(ref);
  if (folio) return { clave: folio[0].toUpperCase(), tipo: ({ PED: 'PEDIDO', TRA: 'TRASLADO' })[folio[1].toUpperCase()] || folio[1].toUpperCase(), numero: folio[0].toUpperCase() };
  return { clave: m.origen_sesion_id ? `conteo:${m.origen_sesion_id}` : m.traslado_grupo_id ? `traslado:${m.traslado_grupo_id}` : `movimiento:${m.id}`, tipo: m.tipo_movimiento || 'OTRO', numero: ref || 'Sin referencia' };
}

export function periodoMovimiento(m) {
  const hora = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(m.creado_en));
  return hora >= '07:30' && hora < '12:30' ? 'MANANA' : hora >= '14:30' && hora < '21:30' ? 'TARDE' : 'fuera';
}

export const TIPOS_COMPROBANTE = { TRASLADO: 'Traslados', VTD: 'VTD', VTA: 'Ventas de mostrador', VENTA: 'Ventas', PEDIDO: 'Pedidos', ENTRADA: 'Entradas', SALIDA: 'Salidas', AJUSTE: 'Ajustes', INV_INICIAL: 'Inventario inicial', OTRO: 'Otros' };

export function agruparComprobantes(items, { periodo = 'dia', tipo = '', busqueda = '' } = {}) {
  const grupos = new Map();
  for (const m of items) {
    if (periodo !== 'dia' && periodoMovimiento(m) !== periodo) continue;
    const doc = m.comprobante || referenciaComprobante(m);
    const clave = doc.clave || `${doc.tabla}:${doc.id}`;
    if (!grupos.has(clave)) grupos.set(clave, { ...doc, clave, items: [], creado_en: m.creado_en });
    const grupo = grupos.get(clave);
    grupo.items.push(m);
    if (m.creado_en > grupo.creado_en) grupo.creado_en = m.creado_en;
  }
  const query = busqueda.trim().toLocaleLowerCase('es');
  return [...grupos.values()].filter(g => (!tipo || g.tipo === tipo) && (!query || `${g.numero} ${g.items.map(m => `${m.referencia || ''} ${m.nombre} ${m.sku || ''} ${m.ubicacion} ${m.autor} ${m.motivo || ''}`).join(' ')}`.toLocaleLowerCase('es').includes(query)))
    .sort((a, b) => b.creado_en.localeCompare(a.creado_en) || a.clave.localeCompare(b.clave));
}
