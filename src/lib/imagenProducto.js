/**
 * imagenProducto.js — Brief S4 parte B: subir una foto desde el formulario
 * de producto y que quede DIRECTAMENTE como imagen_url, sin pasar por la
 * revisión de OpenClaw (producto_captura_sesion / foto / promover-imagen-
 * principal — ese circuito no se toca, sigue exactamente igual).
 *
 * Path determinístico por producto (mismo criterio que fotoConteo.js): subir
 * de nuevo pisa el objeto anterior (upsert), no acumula basura en el bucket.
 *
 * Storage: producto_imagenes acepta INSERT/UPDATE de `authenticated` sin
 * condiciones (políticas producto_imagenes_insert_temp/update_temp,
 * verificado por Ness) — no hace falta migración para subir. No hay
 * política de DELETE: por eso este módulo no ofrece borrar la foto, solo
 * subir/reemplazar (upsert). El bucket tiene un límite real de 2 MB —
 * comprimimos del lado del cliente para entrar ahí, igual criterio de
 * <canvas> que ya usa capturaFoto.js.
 */
import { supabase } from "../supabaseClient";

const BUCKET = "producto_imagenes";
const TIPOS_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024; // límite real del bucket, confirmado por Ness

export function tipoImagenValido(file) {
  return TIPOS_PERMITIDOS.has(file.type);
}

// Reencoda a JPEG con <canvas> (igual que capturaFoto.js) y reintenta bajando
// calidad y después ancho hasta entrar en maxBytes. Devuelve null si ni así
// entra — el llamador lo traduce en un mensaje claro, no en un error crudo
// de Storage sobre "el objeto excede el tamaño máximo".
async function comprimirParaSubida(file, maxBytes) {
  const bitmap = await createImageBitmap(file);
  let anchoObjetivo = Math.min(bitmap.width, 1600);
  const calidades = [0.85, 0.7, 0.55, 0.4];

  for (let intento = 0; intento < 7; intento++) {
    const escala = Math.min(1, anchoObjetivo / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const calidad = calidades[Math.min(intento, calidades.length - 1)];
    // Cada intento depende del tamaño del anterior — no se puede paralelizar.
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", calidad));
    if (blob && blob.size <= maxBytes) return blob;
    if (intento >= calidades.length - 1) anchoObjetivo = Math.round(anchoObjetivo * 0.7);
  }
  return null;
}

// Sube la foto (comprimida bajo el límite del bucket), la deja como
// imagen_url del producto y devuelve la URL resultante. Lanza si el tipo no
// es válido, si no se pudo comprimir bajo el límite, o si falla el
// storage/la escritura en `producto` (permiso de admin lo exige el trigger
// trg_precio_solo_admin — el llamador debe gatear el botón con esAdmin,
// esto no lo vuelve a chequear).
export async function subirImagenProducto(productoId, file) {
  if (!tipoImagenValido(file)) throw new Error("Formato no soportado — usá JPEG, PNG o WebP");

  const comprimido = await comprimirParaSubida(file, MAX_BYTES);
  if (!comprimido) {
    throw new Error(`La foto pesa demasiado incluso comprimida (máx ${MAX_BYTES / (1024 * 1024)} MB) — probá con otra foto.`);
  }

  // Siempre .jpg: comprimirParaSubida reencoda a JPEG sin importar el
  // formato de entrada, así el path (y su cache-busting) es predecible.
  const path = `producto/${productoId}.jpg`;
  const { error: errSubida } = await supabase.storage.from(BUCKET).upload(path, comprimido, {
    contentType: "image/jpeg",
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
