// fotoCaptura.js
// Helper de Storage para las fotos de producto_captura_foto (bucket privado
// 'capturas_producto', subidas por la Edge Function ingest-foto-producto).
// Mismo patrón que fotoConteo.js: solo lectura acá, la subida la hace la
// Edge Function, no el cliente.
import { supabase } from "./supabaseClient";

const BUCKET = "capturas_producto";

// Genera una signed URL para mostrar la foto en la pantalla de revisión.
// Expiración corta (1h por defecto): la URL es solo para esta pantalla.
export async function urlFirmadaCaptura(path, expiraSeg = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiraSeg);
  if (error) return null;
  return data?.signedUrl ?? null;
}
