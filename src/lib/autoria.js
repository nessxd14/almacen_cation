/**
 * autoria.js — Brief S3 parte B: `creado_por` es texto (el email), hay que
 * resolverlo contra `perfil` para mostrar un nombre legible, con el email
 * como respaldo si no hay perfil (usuario borrado, cuenta externa, etc).
 *
 * OJO: `pedido.solicitado_por` y `venta.vendedor_id` están vacíos en
 * producción (0/341 y 0/24) — no usarlos, ver brief. La autoría es siempre
 * `creado_por`.
 */
import { supabase } from "../supabaseClient";

// Batch: resuelve varios emails de una — evita una consulta por fila en
// listas. Devuelve Map<email, nombre>; un email sin perfil simplemente no
// aparece en el mapa (el llamador cae al email como respaldo).
export async function resolverAutores(emails) {
  const unicos = [...new Set((emails || []).filter(Boolean))];
  if (unicos.length === 0) return new Map();
  const { data } = await supabase.from("perfil").select("nombre, email").in("email", unicos);
  return new Map((data || []).map((p) => [p.email, p.nombre]));
}

export async function resolverAutor(email) {
  if (!email) return null;
  const mapa = await resolverAutores([email]);
  return mapa.get(email) || null;
}

// nombre si hay perfil, si no el email tal cual, si no hay ninguno "—".
export function nombreAutor(email, mapa) {
  if (!email) return "—";
  return mapa?.get(email) || email;
}
