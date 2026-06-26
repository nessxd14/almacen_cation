// fotoConteo.js
// Helper de Storage para las fotos de conteo físico.
// Path determinístico anclado a cliente_uuid (no a presentacion_id, que es NULL
// en huérfanos) => cero colisión entre Marcos y Lucía contando en paralelo,
// y reintento idempotente: el mismo cliente_uuid sobreescribe el mismo objeto.
import { supabase } from "./supabaseClient";

const BUCKET = "conteos";

// Lo que se guarda en conteo_fisico_inicial.foto_ref (el PATH, no la URL).
export function pathFotoConteo(sesionId, clienteUuid) {
  return `sesion_${sesionId}/${clienteUuid}.jpg`;
}

// Sube la foto y devuelve el path para meter en foto_ref.
// `archivo` puede ser un File (input capture) o un Blob (canvas.toBlob).
export async function subirFotoConteo({ sesionId, clienteUuid, archivo }) {
  if (!sesionId || !clienteUuid || !archivo) {
    throw new Error("subirFotoConteo: faltan sesionId, clienteUuid o archivo");
  }
  const path = pathFotoConteo(sesionId, clienteUuid);
  const { error } = await supabase.storage.from(BUCKET).upload(path, archivo, {
    contentType: archivo.type || "image/jpeg",
    upsert: true, // reintento de la misma línea (mismo uuid) reescribe, no falla
  });
  if (error) throw error;
  return path;
}

// Genera una signed URL para mostrar la foto (bucket privado).
export async function urlFirmadaConteo(path, expiraSeg = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiraSeg);
  if (error) return null;
  return data?.signedUrl ?? null;
}
