import { supabase } from '../supabaseClient';
import { resolverAutores } from './autoria';

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
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  const ids = [...new Set(items.map(m => m.creado_por).filter(x => uuid.test(x || '')))];
  const [emails, perfiles] = await Promise.all([
    resolverAutores(items.map(m => m.creado_por).filter(x => !uuid.test(x || ''))),
    ids.length ? supabase.from('perfil').select('id,nombre').in('id', ids) : Promise.resolve({ data: [] }),
  ]);
  const autores = new Map([...(perfiles.data || []).map(p => [p.id, p.nombre]), ...emails]);
  return { items: items.map(m => ({ ...m, autor: autores.get(m.creado_por) || m.creado_por || 'Sin autor registrado' })), total: count, incompleto: count == null || count > items.length };
}
