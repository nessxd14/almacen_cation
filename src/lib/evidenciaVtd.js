export const BUCKET_EVIDENCIA_VTD = 'evidencias_vtd';
export const MAX_FOTOS_VTD = 10;
const MAX_BYTES = 1024 * 1024;

export async function operarEvidenciaVtd(supabase, accion, ventaId, datos = {}) {
  const { data, error } = await supabase.rpc('operar_evidencia_vtd', { p_accion: accion, p_venta_id: Number(ventaId), p_datos: datos });
  if (error) throw new Error(error.message || 'No se pudo consultar la evidencia.');
  return data;
}

export async function comprimirFotoVtd(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * MAX_BYTES) {
    throw new Error('Selecciona fotos JPEG, PNG o WebP de hasta 20 MB.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const calidad of [0.82, 0.65, 0.45]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', calidad));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error('La foto sigue pesando demasiado. Prueba con otra toma.');
  } finally { bitmap.close(); }
}

// El identificador se conserva al reintentar: nunca se reemplazan objetos ya subidos.
export async function subirEvidenciaVtd(supabase, ventaId, version, loteId, fotos) {
  if (!fotos.length || fotos.length > MAX_FOTOS_VTD) throw new Error('Adjunta entre 1 y 10 fotos de la salida.');
  const lote = await operarEvidenciaVtd(supabase, 'crear', ventaId, { id: loteId, version, cantidad: fotos.length });
  for (let i = 0; i < fotos.length; i++) {
    if (lote.subidas.includes(lote.rutas[i])) continue;
    const blob = await comprimirFotoVtd(fotos[i]);
    const { error } = await supabase.storage.from(BUCKET_EVIDENCIA_VTD).upload(lote.rutas[i], blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error('No se pudo subir una foto. Conserva esta pantalla y vuelve a confirmar para reintentar.');
  }
  return lote.id;
}
