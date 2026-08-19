/**
 * borradores.js — CRUD contra `borrador_operacion` (Brief S1-M, ya aplicada
 * y verificada en producción — no tocar el esquema desde acá).
 *
 * La tabla ya resuelve, por trigger/RLS, lo que el cliente NO debe
 * recalcular ni reimplementar:
 *   - cada UPDATE renueva `expira_en` a 24 h — no calcular expiración acá.
 *   - RLS (`usuario_id = auth.uid()`) ya aísla los borradores por dueño —
 *     no hace falta (ni sirve) filtrar por usuario en el cliente.
 *   - el barrido que borra de verdad corre a los 7 días — un borrador
 *     "vencido" (expira_en pasado) sigue existiendo y hay que mostrarlo
 *     como tal, no ocultarlo ni borrarlo al leer.
 */
import { supabase } from "../supabaseClient";

export async function listarBorradores({ tipo } = {}) {
  let q = supabase.from("borrador_operacion").select("*").order("actualizado_en", { ascending: false });
  if (tipo) q = q.eq("tipo", tipo);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function obtenerBorrador(id) {
  const { data, error } = await supabase.from("borrador_operacion").select("*").eq("id", id).maybeSingle();
  return { data, error };
}

// Upsert simple: sin `id` inserta, con `id` actualiza (dispara el trigger
// que renueva expira_en). `usuarioId` es obligatorio en el insert porque la
// política RLS exige que coincida con auth.uid() — no hay valor por defecto
// del lado del servidor.
export async function guardarBorrador({ id, tipo, sucursalId, titulo, contenido, usuarioId }) {
  if (id) {
    const { data, error } = await supabase
      .from("borrador_operacion")
      .update({ titulo: titulo ?? null, contenido, sucursal_id: sucursalId ?? null })
      .eq("id", id)
      .select()
      .single();
    return { data, error };
  }
  const { data, error } = await supabase
    .from("borrador_operacion")
    .insert({ usuario_id: usuarioId, tipo, sucursal_id: sucursalId ?? null, titulo: titulo ?? null, contenido })
    .select()
    .single();
  return { data, error };
}

export async function eliminarBorrador(id) {
  const { error } = await supabase.from("borrador_operacion").delete().eq("id", id);
  return { error };
}

export function estaVencido(borrador) {
  return new Date(borrador.expira_en).getTime() < Date.now();
}

// Minutos restantes hasta expirar (negativo si ya venció) — solo para
// mostrar "vence en 3h", nunca para decidir si el borrador existe.
export function minutosParaExpirar(borrador) {
  return Math.round((new Date(borrador.expira_en).getTime() - Date.now()) / 60000);
}

export function antiguedadTexto(iso) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h`;
}

export function vencimientoTexto(borrador) {
  const min = minutosParaExpirar(borrador);
  if (min <= 0) return "vencido";
  if (min < 60) return `vence en ${min} min`;
  return `vence en ${Math.floor(min / 60)} h`;
}
