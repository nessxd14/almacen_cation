// ───────────────────────────────────────────────────────────────────────────
// shopify-webhook — Edge Function (Deno)
//
// Sincroniza el stock del Kardex con Shopify:
//   • orders/fulfilled  -> registrar_salida  por cada línea despachada
//   • refunds/create    -> registrar_entrada por cada línea con restock
//
// Garantías:
//   • Verificación HMAC-SHA256 sobre el BODY CRUDO (constant-time).
//   • Responde 200 de inmediato; el Kardex se procesa en segundo plano
//     (EdgeRuntime.waitUntil) para no agotar el timeout de Shopify (~5 s).
//   • Idempotencia anclada a orden/línea (no al X-Shopify-Webhook-Id): la clave
//     se pasa como p_idempotencia y el índice único uq_kardex_idem deduplica
//     reintentos del webhook sin volver a mover stock.
//
// Variables de entorno requeridas (supabase secrets set ...):
//   SHOPIFY_WEBHOOK_SECRET   secreto del webhook de Shopify (firma HMAC)
//   SHOPIFY_UBICACION_ID     id de la ubicación de salida/entrada para ventas online
//   SUPABASE_URL             (inyectada por Supabase)
//   SUPABASE_SERVICE_ROLE_KEY(inyectada por Supabase)
// ───────────────────────────────────────────────────────────────────────────

import { createClient } from "npm:@supabase/supabase-js@2";

const SHOPIFY_WEBHOOK_SECRET = Deno.env.get("SHOPIFY_WEBHOOK_SECRET") ?? "";
const UBICACION_ID = Number(Deno.env.get("SHOPIFY_UBICACION_ID") ?? "0");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const enc = new TextEncoder();

// Verifica la firma HMAC del webhook contra el cuerpo crudo (base64, constant-time).
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

// Resuelve un SKU/código a su presentación. Devuelve null si no está en catálogo.
async function resolverSku(supabase: ReturnType<typeof createClient>, sku: string) {
  if (!sku) return null;
  const { data, error } = await supabase.rpc("resolver_identificador", { p_codigo: sku });
  if (error || !data || data.length === 0) return null;
  return data[0] as { presentacion_id: number };
}

// orders/fulfilled: descuenta cada línea despachada.
async function procesarFulfilled(supabase: ReturnType<typeof createClient>, order: any) {
  const orderId = order?.id;
  const referencia = `Shopify ${order?.name ?? `#${orderId}`}`;
  const lineas: any[] = order?.line_items ?? [];

  for (const li of lineas) {
    const cantidad = Number(li?.quantity ?? 0);
    if (cantidad <= 0) continue;
    const pres = await resolverSku(supabase, String(li?.sku ?? ""));
    if (!pres) {
      console.warn(`SKU sin mapeo, línea omitida`, { orderId, lineId: li?.id, sku: li?.sku });
      continue;
    }
    const { error } = await supabase.rpc("registrar_salida", {
      p_presentacion_id: pres.presentacion_id,
      p_ubicacion_id: UBICACION_ID,
      p_cantidad_pres: cantidad,
      p_referencia: referencia,
      p_usuario: "shopify",
      // Venta ya consumada: nunca bloqueamos. El sobregiro queda visible para conciliación.
      p_permitir_sobregiro: true,
      p_idempotencia: `shopify:fulfill:${orderId}:${li?.id}`,
    });
    if (error) console.error("registrar_salida falló", { orderId, lineId: li?.id, error: error.message });
  }
}

// refunds/create: reingresa cada línea devuelta que Shopify marca para restock.
async function procesarRefund(supabase: ReturnType<typeof createClient>, refund: any) {
  const refundId = refund?.id;
  const orderId = refund?.order_id;
  const referencia = `Shopify refund #${refundId} (order ${orderId})`;
  const lineas: any[] = refund?.refund_line_items ?? [];

  for (const rli of lineas) {
    const cantidad = Number(rli?.quantity ?? 0);
    // restock_type: 'return' o 'cancel' implican reingreso físico; 'no_restock'/'legacy' no.
    const restock = rli?.restock_type === "return" || rli?.restock_type === "cancel";
    if (cantidad <= 0 || !restock) continue;
    const pres = await resolverSku(supabase, String(rli?.line_item?.sku ?? ""));
    if (!pres) {
      console.warn(`SKU sin mapeo en refund, línea omitida`, { refundId, lineId: rli?.line_item_id });
      continue;
    }
    const { error } = await supabase.rpc("registrar_entrada", {
      p_presentacion_id: pres.presentacion_id,
      p_ubicacion_id: UBICACION_ID,
      p_cantidad_pres: cantidad,
      p_referencia: referencia,
      p_usuario: "shopify",
      p_idempotencia: `shopify:refund:${refundId}:${rli?.id}`,
    });
    if (error) console.error("registrar_entrada falló", { refundId, lineId: rli?.line_item_id, error: error.message });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const rawBody = await req.text();
  const topic = req.headers.get("X-Shopify-Topic") ?? "";
  const hmac = req.headers.get("X-Shopify-Hmac-Sha256");

  // 1) Autenticidad: sin firma válida no se procesa nada.
  if (!(await firmaValida(rawBody, hmac))) {
    return new Response("Firma HMAC inválida", { status: 401 });
  }

  if (!UBICACION_ID) {
    console.error("SHOPIFY_UBICACION_ID no configurada; no se puede mover stock.");
    return new Response("Config incompleta", { status: 500 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }

  // 2) Procesamiento en segundo plano: respondemos 200 ya mismo. La idempotencia
  //    en DB hace seguro cualquier reintento de Shopify.
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const trabajo = (async () => {
    try {
      if (topic === "orders/fulfilled") await procesarFulfilled(supabase, payload);
      else if (topic === "refunds/create") await procesarRefund(supabase, payload);
      else console.log("Topic ignorado", { topic });
    } catch (e) {
      console.error("Error procesando webhook", { topic, error: String(e) });
    }
  })();

  // @ts-ignore EdgeRuntime existe en el runtime de Supabase.
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(trabajo);
  else await trabajo;

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
