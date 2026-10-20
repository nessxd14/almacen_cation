const LINE_SELECT = '*, producto:producto_id(id, nombre, sku_interno, unidad_base, marca), presentacion:presentacion_id(nombre, factor_unidad_base)';

export function validarCantidadTraslado(cantidad, solicitada) {
  const n = Number(cantidad);
  return Number.isFinite(n) && n > 0 && n <= Number(solicitada);
}

export async function cargarLineasTraslado(cliente, ids) {
  const result = [];
  for (let start = 0; start < ids.length; start += 100) {
    let after = 0;
    for (;;) {
      const { data, error } = await cliente.from('solicitud_traslado_linea').select(LINE_SELECT)
        .in('solicitud_id', ids.slice(start, start + 100)).gt('id', after).order('id').limit(500);
      if (error) throw error;
      if (!data?.length) break;
      result.push(...data); after = data[data.length - 1].id;
    }
  }
  return result;
}

export async function cargarSolicitudesTraslado(cliente, sucursalId, estado) {
  const result = [];
  let after = 0;
  for (;;) {
    let query = cliente.from('solicitud_traslado').select('*')
      .or(`sucursal_origen_id.eq.${sucursalId},sucursal_destino_id.eq.${sucursalId}`)
      .gt('id', after).order('id');
    query = estado === 'CERRADOS' ? query.in('estado', ['RECIBIDO', 'RECHAZADO', 'CANCELADO']) : query.eq('estado', estado);
    const { data, error } = await query.limit(200);
    if (error) throw error;
    if (!data?.length) break;
    result.push(...data); after = data[data.length - 1].id;
  }
  return result.sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)));
}
