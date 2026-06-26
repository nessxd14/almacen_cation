// ───────────────────────────────────────────────────────────────────────────
// shopify-stock-push — Edge Function (Deno)
//
// Drena la cola public.shopify_sync_outbox y publica el stock total de cada
// producto en Shopify (Inventory → available) vía Admin GraphQL.
// El variant de Shopify se asume en la unidad base del producto.
//
// Disparada por pg_cron cada minuto (solo si la cola no está vacía).
// Protegida con un secreto compartido en el header X-Sync-Secret.
//
// Env (supabase secrets set ...):
//   SYNC_SECRET            secreto compartido con el job de pg_cron
//   SHOPIFY_ADMIN_TOKEN    Admin API access token (scope write_inventory)
//   SHOPIFY_STORE          mi-tienda.myshopify.com
//   SHOPIFY_LOCATION_ID    id numérico de la location de Shopify
//   SHOPIFY_API_VERSION    (opcional, default 2026-01)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (inyectadas)
// ───────────────────────────────────────────────────────────────────────────

import { createClient } from "npm:@supabase/supabase-js@2";

const SYNC_SECRET = Deno.env.get("SYNC_SECRET") ?? "";
const SHOP = Deno.env.get("SHOPIFY_STORE") ?? "";
const TOKEN = Deno.env.get("SHOPIFY_ADMIN_TOKEN") ?? "";
const LOCATION_ID = Deno.env.get("SHOPIFY_LOCATION_ID") ?? "";
const API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2026-01";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH = 50;          // productos por corrida
const MAX_INTENTOS = 5;    // tras esto se deja de reintentar (queda el error)

const gid = (tipo: string, id: string | number) => `gid://shopify/${tipo}/${id}`;

// Fija el stock disponible de un inventory item en la location configurada.
async function setInventory(inventoryItemId: string, available: number) {
  const query = `mutation Set($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { createdAt }
      userErrors { field message }
    }
  }`;
  const input = {
    name: "available",
    reason: "correction",
    ignoreCompareQuantity: true,
    quantities: [{
      inventoryItemId: gid("InventoryItem", inventoryItemId),
      locationId: gid("Location", LOCATION_ID),
      quantity: available,
    }],
  };
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
    body: JSON.stringify({ query, variables: { input } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  const errs = json?.data?.inventorySetQuantities?.userErrors ?? [];
  if (errs.length) throw new Error(`userErrors: ${JSON.stringify(errs)}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!SYNC_SECRET || req.headers.get("X-Sync-Secret") !== SYNC_SECRET) {
    return new Response("No autorizado", { status: 401 });
  }
  if (!SHOP || !TOKEN || !LOCATION_ID) {
    console.error("Faltan envs de Shopify (STORE/TOKEN/LOCATION_ID).");
    return new Response("Config incompleta", { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: pendientes, error } = await supabase
    .from("shopify_sync_outbox")
    .select("producto_id")
    .lt("intentos", MAX_INTENTOS)
    .order("encolado_en", { ascending: true })
    .limit(BATCH);
  if (error) return new Response(error.message, { status: 500 });

  let ok = 0, fail = 0;
  for (const row of pendientes ?? []) {
    const pid = row.producto_id as number;
    try {
      const { data: prod } = await supabase
        .from("producto").select("shopify_inventory_item_id").eq("id", pid).maybeSingle();
      const invItem = prod?.shopify_inventory_item_id;
      if (!invItem) throw new Error("producto sin shopify_inventory_item_id");

      const { data: stockRows } = await supabase
        .from("stock_actual").select("cantidad_base").eq("producto_id", pid);
      const total = (stockRows ?? []).reduce((s, r) => s + Number(r.cantidad_base || 0), 0);
      const available = Math.max(0, Math.floor(total));

      await setInventory(String(invItem), available);
      await supabase.from("shopify_sync_outbox").delete().eq("producto_id", pid);
      ok++;
    } catch (e) {
      await supabase.rpc("f_sync_outbox_fallo", { p_producto_id: pid, p_error: String(e) });
      console.error("push falló", { producto_id: pid, error: String(e) });
      fail++;
    }
  }

  return new Response(JSON.stringify({ procesados: pendientes?.length ?? 0, ok, fail }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
