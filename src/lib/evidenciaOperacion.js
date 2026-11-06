import { comprimirFotoVtd } from './evidenciaVtd';
import {peticionAcotada} from './peticionAcotada';

export const BUCKET_EVIDENCIA_OPERACION = 'evidencias_operaciones';
export async function operarEvidenciaOperacion(cliente, { tipo, documentoId, entregaId, accion = 'consultar', datos = {} }) {
  const { data, error } = await peticionAcotada(cliente.rpc('operar_evidencia_operacion', {
    p_tipo: tipo.toUpperCase(), p_documento_id: Number(documentoId), p_entrega_id: Number(entregaId), p_accion: accion, p_datos: datos,
  }),{incierta:accion!=='consultar'});
  if (error) { const fallo = new Error(error.message || 'No se pudo consultar la evidencia.'); fallo.code = error.code; throw fallo; }
  if (!data || (accion === 'consultar' && (typeof data.activo !== 'boolean' || !Array.isArray(data.envios)))) throw new Error('No se recibió confirmación de la entrega. Actualiza antes de continuar.');
  return data;
}
export async function subirEvidenciaOperacion(cliente, { tipo, documentoId, entregaId, version, loteId, fotos }) {
  if (!fotos.length || fotos.length > 10) throw new Error('Adjunta entre 1 y 10 fotos.');
  const lote = await operarEvidenciaOperacion(cliente, { tipo, documentoId, entregaId, accion: 'crear', datos: { id: loteId, version, cantidad: fotos.length } });
  for (let i = 0; i < fotos.length; i++) {
    if (lote.subidas.includes(lote.rutas[i])) continue;
    const foto = await comprimirFotoVtd(fotos[i]);
    const { error } = await peticionAcotada(cliente.storage.from(BUCKET_EVIDENCIA_OPERACION).upload(lote.rutas[i], foto, { contentType: 'image/jpeg', upsert: false }),{ms:30000,incierta:true,mensaje:'La subida de la foto tardó demasiado. Conservamos las fotos; reintenta desde esta pantalla.'});
    if (error) throw new Error('No se pudo subir una foto. Conserva esta pantalla y reintenta.');
  }
  return lote.id;
}
