import { peticionAcotada } from './peticionAcotada';

// Lee los traslados de la sucursal del reponedor (RPC traslados_piso).
export async function listarTrasladosPiso(cliente, dias = 14) {
  const { data, error } = await peticionAcotada(cliente.rpc('traslados_piso', { p_dias: dias }));
  if (error) throw new Error(error.message || 'No se pudieron cargar los traslados.');
  return { sucursalId: data?.sucursal_id ?? null, traslados: Array.isArray(data?.traslados) ? data.traslados : [] };
}

// Reparte la lista en las dos secciones del inicio del reponedor.
// - listo: PREPARADO, o REVISANDO que él mismo empezó a comprobar.
// - todavia: PREPARANDO, o SOLICITADO sin tarea de alistado.
// El resto (RECIBIDO, REVISANDO de otra persona, anulados…) no se muestra.
export function seccionesTrasladosPiso(traslados = []) {
  const listo = [];
  const todavia = [];
  for (const t of traslados) {
    const tarea = t.tarea_estado || null;
    if (tarea === 'PREPARADO') listo.push({ ...t, continuar: false });
    else if (tarea === 'REVISANDO' && t.retiro_mio) listo.push({ ...t, continuar: true });
    else if (tarea === 'PREPARANDO') todavia.push({ ...t, etiqueta: 'En alistado' });
    else if (!tarea && t.estado === 'SOLICITADO') todavia.push({ ...t, etiqueta: 'Pedido' });
  }
  return { listo, todavia };
}

export const horaCorta = valor => {
  const fecha = valor ? new Date(valor) : null;
  return fecha && !Number.isNaN(fecha.getTime()) ? fecha.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
};

export const MENSAJE_NO_TRASLADO = 'Ese código no es un traslado. Las ventas de almacén (VTD) las alista y entrega el almacenero.';
