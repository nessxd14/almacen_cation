/**
 * imagenProducto.js — Brief S4 parte B: subir una foto desde el formulario
 * de producto y que quede DIRECTAMENTE como imagen_url, sin pasar por la
 * revisión de OpenClaw (producto_captura_sesion / foto / promover-imagen-
 * principal — ese circuito no se toca, sigue exactamente igual).
 *
 * Path determinístico por producto (mismo criterio que fotoConteo.js): subir
 * de nuevo pisa el objeto anterior (upsert), no acumula basura en el bucket.
 */
import { supabase } from "../supabaseClient";

const BUCKET = "producto_imagenes";
const TIPOS_PERMITIDOS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export function validarImagenProducto(file) {
  if (!TIPOS_PERMITIDOS[file.type]) return "Formato no soportado — usá JPEG, PNG o WebP";
  if (file.size > MAX_BYTES) return "La foto pesa más de 8 MB";
  return null;
}

export function pathImagenProducto(productoId, file) {
  return `producto/${productoId}.${TIPOS_PERMITIDOS[file.type] || "jpg"}`;
}

// Sube la foto, la deja como imagen_url del producto y devuelve la URL
// resultante. Lanza si el archivo no pasa la validación o si falla el
// storage/la escritura en `producto` (permiso de admin lo exige el trigger
// trg_precio_solo_admin — el llamador debe gatear el botón con esAdmin,
// esto no lo vuelve a chequear).
export async function subirImagenProducto(productoId, file) {
  const motivoInvalido = validarImagenProducto(file);
  if (motivoInvalido) throw new Error(motivoInvalido);

  const path = pathImagenProducto(productoId, file);
  const { error: errSubida } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (errSubida) throw errSubida;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // El path es siempre el mismo objeto (upsert lo pisa) — sin un parámetro
  // de versión el navegador seguiría mostrando la foto vieja cacheada.
  const url = `${data.publicUrl}?v=${Date.now()}`;

  const { error: errUpdate } = await supabase.from("producto").update({ imagen_url: url }).eq("id", productoId);
  if (errUpdate) throw errUpdate;

  return url;
}
