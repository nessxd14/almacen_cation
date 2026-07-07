// shopify-webhook — Edge Function (Deno)
// Sincroniza el stock del Kardex con Shopify:
//   • orders/fulfilled  -> registrar_salida_online  por cada línea despachada
//   • refunds/create    -> registrar_entrada_online por cada línea con restock
// Garantías: HMAC-SHA256 sobre el body crudo (constant-time); responde 200 ya
// (EdgeRuntime.waitUntil); idempotencia anclada a orden/línea vía p_idempotencia.
//
// Fix 2026-07-07: la venta/refund online ya no descuenta la sucursal virtual
// Shopify (nunca recibía stock -> quedaba negativa y distorsionaba el conteo).
// Ahora descuenta ubicación(es) físicas online-visibles por mayor stock
// (mismo criterio que el despacho de pedidos), y el faltante cae como
// sobregiro explícito sobre WMS_UBICACION_ONLINE_DEFAULT (física real), no
// escondido en una virtual. Ver db/migrations/2026-07-07_venta_online_ubicacion_real.sql.
//
// Env: SHOPIFY_WEBHOOK_SECRET, WMS_UBICACION_ONLINE_DEFAULT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const SHOPIFY_WEBHOOK_SECRET = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") ?? "";
const UBICACION_DEFAULT = Number(Deno.env.get("WMS_UBICACION_ONLINE_DEFAULT") ?? "0");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const enc = new TextEncoder();

async function firmaValida(rawBody: string, hmacHeader: string | null): Promise<boolean> {
  if (!hmacHeader || !SHOPIFY_WEBHOOK_SECRET) return false;
  let firmaBytes: Uint8Array;
  try {
    firmaBytes = Uint8Array.from(atob(hmacHeader), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(SHOPIFY_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  return await crypto.subtle.verify("HMAC", key, firmaBytes, enc.encode(rawBody));
}

// Cascada de resolución: 1) shopify_variant_id  2) sku.
// shopify_presentacion_base ya existe en la BD (migración 2026-06-29) y hace
// exactamente esta cascada, devolviendo la presentación BASE (es_base = TRUE)
// del producto. Si ninguno de los dos matchea, la función lanza EXCEPTION en
// Postgres -> supabase-js lo entrega como `error`, no como throw en JS. Toda
// línea sin variant_id y sin sku (custom line item genuino) cae por este
// camino y se omite silenciosamente, igual que antes.
async function resolverPresentacion(
  supabase: ReturnType<typeof createClient>,
  variantId: string | null,
  sku: string | null,
): Promise<number | null> {
  if (!variantId && !sku) return null; // ni evita el roundtrip para custom line items obvios
  const { data, error } = await supabase.rpc("shopify_presentacion_base", {
    p_variant_id: variantId,
    p_sku: sku,
  });
  if (error || data == null) return null;
  return Number(data); // la función devuelve BIGINT escalar, no una fila
}

async function procesarFulfilled(supabase: ReturnType<typeof createClient>, order: any) {
  const orderId = order?.id;
  const referencia = `Shopify ${order?.name ?? `#${orderId}`}`;
  const lineas: any[] = order?.line_items ?? [];
  for (const li of lineas) {
    const cantidad = Number(li?.quantity ?? 0);
    if (cantidad <= 0) continue;
    const variantId = li?.variant_id != null ? String(li.variant_id) : null;
    const sku = li?.sku ? String(li.sku) : null;
    const presentacionId = await resolverPresentacion(supabase, variantId, sku);
    if (presentacionId == null) {
      console.warn("Linea sin mapeo (custom line item o variante no vinculada), omitida", { orderId, lineId: li?.id, variantId, sku });
      continue;
    }
    const { data, error } = await supabase.rpc("registrar_salida_online", {
      p_presentacion_id: presentacionId,
      p_cantidad_pres: cantidad,
      p_referencia: referencia,
      p_idempotencia: `shopify:fulfill:${orderId}:${li?.id}`,
      p_ubicacion_default: UBICACION_DEFAULT,
    });
    if (error) console.error("registrar_salida_online fallo", { orderId, lineId: li?.id, error: error.message });
    else console.log("registrar_salida_online ok", { orderId, lineId: li?.id, asignaciones: data });
  }
}

async function procesarRefund(supabase: ReturnType<typeof createClient>, refund: any) {
  const refundId = refund?.id;
  const orderId = refund?.order_id;
  const referencia = `Shopify refund #${refundId} (order ${orderId})`;
  const lineas: any[] = refund?.refund_line_items ?? [];
  for (const rli of lineas) {
    const cantidad = Number(rli?.quantity ?? 0);
    const restock = rli?.restock_type === "return" || rli?.restock_type === "cancel";
    if (cantidad <= 0 || !restock) continue;
    const variantId = rli?.line_item?.variant_id != null ? String(rli.line_item.variant_id) : null;
    const sku = rli?.line_item?.sku ? String(rli.line_item.sku) : null;
    const presentacionId = await resolverPresentacion(supabase, variantId, sku);
    if (presentacionId == null) {
      console.warn("Linea de refund sin mapeo, omitida", { refundId, lineId: rli?.line_item_id, variantId, sku });
      continue;
    }
    const { error } = await supabase.rpc("registrar_entrada_online", {
      p_presentacion_id: presentacionId,
      p_cantidad_pres: cantidad,
      p_referencia: referencia,
      p_idempotencia: `shopify:refund:${refundId}:${rli?.id}`,
      p_ubicacion_default: UBICACION_DEFAULT,
    });
    if (error) console.error("registrar_entrada_online fallo", { refundId, lineId: rli?.line_item_id, error: error.message });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const rawBody = await req.text();
  const topic = req.headers.get("X-Shopify-Topic") ?? "";
  const hmac = req.headers.get("X-Shopify-Hmac-Sha256");
  if (!(await firmaValida(rawBody, hmac))) return new Response("Firma HMAC invalida", { status: 401 });
  if (!UBICACION_DEFAULT) { console.error("WMS_UBICACION_ONLINE_DEFAULT no configurada"); return new Response("Config incompleta", { status: 500 }); }
  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return new Response("JSON invalido", { status: 400 }); }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const trabajo = (async () => {
    try {
      if (topic === "orders/fulfilled") await procesarFulfilled(supabase, payload);
      else if (topic === "refunds/create") await procesarRefund(supabase, payload);
      else console.log("Topic ignorado", { topic });
    } catch (e) { console.error("Error procesando webhook", { topic, error: String(e) }); }
  })();
  // @ts-ignore EdgeRuntime existe en el runtime de Supabase.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(trabajo); else await trabajo;
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
