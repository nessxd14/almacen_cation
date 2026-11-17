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

// Miniaturas (listas del Seller): lado mayor 320 px, WebP 0.72 (JPEG 0.75 si el
// navegador no codifica WebP). Nombre nuevo en cada generación → cache largo.
export const MINIATURA_LADO = 320;
const MINIATURA_CALIDAD_WEBP = 0.72;
const MINIATURA_CALIDAD_JPEG = 0.75;
const CACHE_ORIGINAL = "2592000"; // 30 días: la URL ya lleva ?v=…
const CACHE_MINIATURA = "31536000"; // 1 año: el nombre es único

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

// Escala para que el lado mayor sea `lado` (sin agrandar nunca).
export function dimensionesMiniatura(ancho, alto, lado = MINIATURA_LADO) {
  const escala = Math.min(1, lado / Math.max(ancho, alto));
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  };
}

export function rutaMiniatura(productoId, ext = "webp", ahora = Date.now()) {
  return `miniatura/${productoId}-${ahora.toString(36)}.${ext}`;
}

// Intenta WebP; si el navegador no lo codifica, toBlob devuelve otro tipo (PNG)
// o null — en ese caso reencoda a JPEG.
async function codificarMiniatura(canvas) {
  const aBlob = (tipo, calidad) => new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad));
  const webp = await aBlob("image/webp", MINIATURA_CALIDAD_WEBP);
  if (webp && webp.type === "image/webp") return { blob: webp, tipo: "image/webp", ext: "webp" };
  const jpeg = await aBlob("image/jpeg", MINIATURA_CALIDAD_JPEG);
  if (!jpeg) throw new Error("No se pudo codificar la miniatura");
  return { blob: jpeg, tipo: "image/jpeg", ext: "jpg" };
}

// Genera la miniatura (≤ 320 px), la sube a Storage, la guarda en
// producto.imagen_miniatura_url y devuelve su URL pública. `origen` es un Blob
// o la URL pública de la imagen (el bucket es público y con CORS). Lanza ante
// cualquier fallo: los llamadores deciden si es fatal (no lo es).
export async function generarMiniatura(productoId, origen) {
  let blobOrigen = origen;
  if (typeof origen === "string") {
    const res = await fetch(origen);
    if (!res.ok) throw new Error(`No se pudo bajar la imagen (HTTP ${res.status})`);
    blobOrigen = await res.blob();
  }

  const bitmap = await createImageBitmap(blobOrigen);
  const { ancho, alto } = dimensionesMiniatura(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close?.();

  const { blob, tipo, ext } = await codificarMiniatura(canvas);
  const path = rutaMiniatura(productoId, ext);
  const { error: errSubida } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: tipo,
    cacheControl: CACHE_MINIATURA,
    upsert: false,
  });
  if (errSubida) throw errSubida;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = data.publicUrl;
  const { error: errUpdate } = await supabase.from("producto").update({ imagen_miniatura_url: url }).eq("id", productoId);
  if (errUpdate) throw errUpdate;
  return url;
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
    cacheControl: CACHE_ORIGINAL,
    upsert: true,
  });
  if (errSubida) {
    // Un bucket mal escrito (ej. guion en vez de guion bajo) da exactamente
    // el mismo error de RLS que una política faltante — Supabase no dice en
    // ningún lado contra qué bucket intentó escribir. Loguearlo acá ahorra
    // tener que repetir el diagnóstico manual la próxima vez que falle.
    console.error(`subirImagenProducto: falló el upload al bucket "${BUCKET}" (path "${path}"):`, errSubida);
    throw new Error(`${errSubida.message} (bucket "${BUCKET}")`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // El path es siempre el mismo objeto (upsert lo pisa) — sin un parámetro
  // de versión el navegador seguiría mostrando la foto vieja cacheada.
  const url = `${data.publicUrl}?v=${Date.now()}`;

  const { error: errUpdate } = await supabase.from("producto").update({ imagen_url: url }).eq("id", productoId);
  if (errUpdate) throw errUpdate;

  // La miniatura es accesoria: si falla, la foto ya quedó y el Seller cae a
  // imagen_url (el trigger dejó imagen_miniatura_url en NULL).
  try {
    await generarMiniatura(productoId, comprimido);
  } catch (e) {
    console.error(`subirImagenProducto: no se pudo generar la miniatura del producto ${productoId}:`, e);
  }

  return url;
}
