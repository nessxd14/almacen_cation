import { supabase } from '../supabaseClient';
import { peticionAcotada } from './peticionAcotada';

export async function operarAuditoria(accion, sucursal, datos) {
  const { data, error } = await peticionAcotada(supabase.rpc('operar_auditoria_almacen', {
    p_accion: accion, p_sucursal_id: sucursal, p_datos: datos,
  }), { incierta: accion === 'contar' });
  if (error) {
    const fallo = new Error(error.message || 'No se pudo consultar Auditoría diaria.');
    fallo.code = error.code;
    throw fallo;
  }
  if (!data) throw new Error('No se recibió la jornada de auditoría.');
  return data;
}

export async function cargarPendientesAuditoria(sucursal, signal) {
  const items = new Map();
  const cursores = new Set();
  let fecha;
  let cursor = null;
  do {
    signal?.throwIfAborted();
    const datos = { filtro: 'abiertos', incluir_movimiento: true };
    if (cursor != null) datos.cursor = cursor;
    const pagina = await operarAuditoria('listar', sucursal, datos);
    signal?.throwIfAborted();
    if (fecha && fecha !== pagina.fecha) throw new Error('Comenzó otra jornada. Actualiza para ver los pendientes de hoy.');
    fecha = pagina.fecha;
    for (const item of pagina.items) items.set(item.id, item);
    cursor = pagina.siguiente;
    if (cursores.has(cursor)) throw new Error('La lista de Auditoría cambió durante la carga. Vuelve a intentar.');
    if (cursor != null) cursores.add(cursor);
  } while (cursor != null);

  return { fecha, items: [...items.values()] };
}
