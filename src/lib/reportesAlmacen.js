import { supabase } from '../supabaseClient';
import { resolverAutores } from './autoria';
import { referenciaComprobante } from './comprobantesAlmacen';
import { etiquetaUbicacion } from './ubicacionTexto';

export async function operarReporte(accion, reporteId = null, datos = {}) {
  const { data, error } = await supabase.rpc('operar_reporte_almacen', { p_accion: accion, p_reporte_id: reporteId, p_datos: datos });
  if (error) {
    const faltaModulo = error.code === 'PGRST202' || error.code === '42883';
    throw new Error(faltaModulo ? 'El módulo de reportes todavía no está habilitado en esta base de datos.' : error.message || 'No se pudo completar la operación del reporte.');
  }
  return data;
}

export async function movimientosProductoDia({ productoId, ubicacionId, sucursalId, fecha, hasta }) {
  // Conserva el mismo corte del resumen y la autorización RLS del Kardex.
  // El count permite advertir límites del servidor inferiores a 1000.
  const { data, error, count } = await supabase.from('kardex_transacciones')
    .select('id,cantidad,tipo_movimiento,referencia,motivo,creado_por,creado_en,ubicacion:ubicacion_id!inner(sucursal_id)', { count: 'exact' })
    .eq('producto_id', productoId).eq('ubicacion_id', ubicacionId).eq('ubicacion.sucursal_id', sucursalId)
    .gte('creado_en', `${fecha}T00:00:00-04:00`).lt('creado_en', hasta)
    .order('creado_en', { ascending: true }).order('id', { ascending: true }).limit(1000);
  if (error) throw new Error(error.message || 'No se pudieron consultar los movimientos.');
  const items = data || [];
  return { items: await conAutores(items), total: count, incompleto: count == null || count > items.length };
}

async function conAutores(items) {
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  const ids = [...new Set(items.map(m => m.creado_por).filter(x => uuid.test(x || '')))];
  const [emails, perfiles] = await Promise.all([
    resolverAutores(items.map(m => m.creado_por).filter(x => !uuid.test(x || ''))),
    ids.length ? supabase.from('perfil').select('id,nombre').in('id', ids) : Promise.resolve({ data: [] }),
  ]);
  const autores = new Map([...(perfiles.data || []).map(p => [p.id, p.nombre]), ...emails]);
  return items.map(m => ({ ...m, autor: autores.get(m.creado_por) || m.creado_por || 'Sin autor registrado' }));
}

export async function movimientosComprobantesDia({ sucursalId, fecha, hasta }) {
  const items = [];
  const limite = 10000;
  let total = null;
  // Paginación estable: incluso con un límite del servidor menor al solicitado,
  // avanzar por las filas recibidas hasta completar el count o advertir el corte.
  while (items.length < limite) {
    const { data, error, count } = await supabase.from('kardex_transacciones')
      .select('id,producto_id,ubicacion_id,cantidad,tipo_movimiento,referencia,motivo,creado_por,creado_en,origen_sesion_id,traslado_grupo_id,producto:producto_id(nombre,sku_interno,unidad_base),ubicacion:ubicacion_id!inner(sucursal_id,excluye_disponible,codigo_zona,estante,nivel,compartimiento)', { count: 'exact' })
      .eq('ubicacion.sucursal_id', sucursalId).eq('ubicacion.excluye_disponible', false)
      .gte('creado_en', `${fecha}T00:00:00-04:00`).lt('creado_en', hasta)
      .order('creado_en', { ascending: true }).order('id', { ascending: true })
      .range(items.length, Math.min(items.length + 499, limite - 1));
    if (error) throw new Error(error.message || 'No se pudieron consultar los comprobantes.');
    total = count;
    const pagina = data || [];
    items.push(...pagina);
    if (!pagina.length || total != null && items.length >= total) break;
  }
  const documentos = new Map();
  for (const tabla of ['venta', 'pedido', 'solicitud_traslado']) {
    const ids = [...new Set(items.map(referenciaComprobante).filter(d => d.tabla === tabla).map(d => d.id))];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await supabase.from(tabla).select('id,numero').in('id', ids.slice(offset, offset + 100));
      if (error) throw new Error(error.message || 'No se pudieron identificar los comprobantes.');
      for (const doc of data || []) documentos.set(`${tabla}:${doc.id}`, doc.numero);
    }
  }
  const completos = items.map(m => {
    const doc = referenciaComprobante(m);
    const numero = documentos.get(`${doc.tabla}:${doc.id}`) || doc.numero;
    const clave = /^(VTD|VTA|PED|TRA)-\d{4}-\d+$/i.test(numero) ? numero.toUpperCase() : doc.clave || `${doc.tabla}:${doc.id}`;
    return { ...m, nombre: m.producto?.nombre || `Producto #${m.producto_id}`, sku: m.producto?.sku_interno, unidad: m.producto?.unidad_base || 'base', ubicacion: etiquetaUbicacion(m.ubicacion), comprobante: { ...doc, clave, numero, tipo: doc.tabla === 'venta' && /^(VTD|VTA)-/.test(numero) ? numero.split('-')[0] : doc.tipo } };
  });
  return { items: await conAutores(completos), total, incompleto: total == null || total > items.length };
}
