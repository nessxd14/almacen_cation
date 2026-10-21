import { supabase } from '../supabaseClient';

export async function operarReporte(accion, reporteId = null, datos = {}) {
  const { data, error } = await supabase.rpc('operar_reporte_almacen', { p_accion: accion, p_reporte_id: reporteId, p_datos: datos });
  if (error) {
    const faltaModulo = error.code === 'PGRST202' || error.code === '42883';
    throw new Error(faltaModulo ? 'El módulo de reportes todavía no está habilitado en esta base de datos.' : error.message || 'No se pudo completar la operación del reporte.');
  }
  return data;
}
