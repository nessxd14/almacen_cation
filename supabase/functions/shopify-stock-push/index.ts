// shopify-stock-push — Edge Function (Deno)
// Drena la cola public.shopify_sync_outbox y publica el stock disponible de
// cada producto en Shopify (Inventory available) vía Admin GraphQL. La fuente
// de la cantidad es v_disponible_shopify, que ya excluye el stock de
// sucursales con visible_online = FALSE (p.ej. Tienda) — antes se sumaba
// stock_actual de TODAS las ubicaciones, lo cual reportaba como disponible
// online unidades que ya estaban en piso de tienda. Variant = unidad base.
// Auth: OAuth client_credentials (igual que bootstrap_catalogo.mjs); token
// cacheado y refrescado al expirar o ante 401. Disparada por pg_cron;
// protegida con X-Sync-Secret.
//
// Dry-run: invocar con ?dry_run=true en la URL. Compara, para TODOS los
// productos activos con shopify_inventory_item_id (no solo los pendientes en
// la cola), la cantidad vieja (stock_actual sin filtrar) contra la nueva
// (v_disponible_shopify); no llama a Shopify ni toca shopify_sync_outbox.
// Sin el parámetro, comportamiento normal (default = false).
//
// Env: SYNC_SECRET, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN,
//      SHOPIFY_LOCATION_ID, SHOPIFY_API_VERSION (default 2026-01), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2";

const SYNC_SECRET = Deno.env.get("SYNC_SECRET") ?? "";
const CLIENT_ID = Deno.env.get("SHOPIFY_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("SHOPIFY_CLIENT_SECRET") ?? "";
const STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") ?? "";
const LOCATION_ID = Deno.env.get("SHOPIFY_LOCATION_ID") ?? "";
const API_VERSION = Deno.env.get("SHOPIFY_API_VERSION") ?? "2026-01";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BATCH = 50;
const MAX_INTENTOS = 5;

// Extrae el id numérico final (tolera que se pegue la URL completa de la location,
// p.ej. ".../settings/locations/66151317571"), igual que idNumerico() del bootstrap.
function soloId(v: string | number): string {
  const m = String(v).match(/(\d+)\s*$/);
  return m ? m[1] : String(v);
}
const gid = (tipo: string, id: string | number) => `gid://shopify/${tipo}/${soloId(id)}`;

let tokenCache: { token: string; exp: number } | null = null;

async function obtenerToken(forzar = false): Promise<string> {
  const ahora = Date.now();
  if (!forzar && tokenCache && tokenCache.exp > ahora + 60_000) return tokenCache.token;
  const res = await fetch(`https://${STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`OAuth fallo: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("OAuth: sin access_token en la respuesta");
  const ttlMs = Number(json.expires_in ?? 3600) * 1000;
  tokenCache = { token: json.access_token, exp: ahora + ttlMs };
  return tokenCache.token;
}

function mutationSet(inventoryItemId: string, available: number) {
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
  return JSON.stringify({ query, variables: { input } });
}

function callGraphQL(token: string, body: string) {
  return fetch(`https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body,
  });
}

async function setInventory(inventoryItemId: string, available: number) {
  const body = mutationSet(inventoryItemId, available);
  let token = await obtenerToken();
  let res = await callGraphQL(token, body);
  if (res.status === 401) {
    token = await obtenerToken(true);
    res = await callGraphQL(token, body);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  const errs = json?.data?.inventorySetQuantities?.userErrors ?? [];
  if (errs.length) throw new Error(`userErrors: ${JSON.stringify(errs)}`);
}

// Compara, para todo el catálogo mapeado a Shopify, la cantidad que se
// hubiera enviado con la lógica vieja (stock_actual sin filtrar) contra la
// nueva (v_disponible_shopify). No llama a Shopify ni toca la cola.
async function correrDryRun(supabase: ReturnType<typeof createClient>) {
  const { data: disponibles, error: errDisp } = await supabase
    .from("v_disponible_shopify")
    .select("producto_id, shopify_inventory_item_id, disponible_variante")
    .limit(5000);
  if (errDisp) throw new Error(`v_disponible_shopify: ${errDisp.message}`);

  const { data: stockRows, error: errStock } = await supabase
    .from("stock_actual")
    .select("producto_id, ubicacion_id, cantidad_base")
    .limit(5000);
  if (errStock) throw new Error(`stock_actual: ${errStock.message}`);

  // Ubicaciones de sucursales ocultas del canal online (p.ej. PISO de Tienda),
  // para remarcar qué variantes cambian por tener stock ahí.
  const { data: ubicacionesOcultas, error: errUbic } = await supabase
    .from("ubicacion")
    .select("id, sucursal:sucursal_id!inner(visible_online)")
    .eq("sucursal.visible_online", false);
  if (errUbic) throw new Error(`ubicacion/sucursal: ${errUbic.message}`);
  const idsOcultos = new Set((ubicacionesOcultas ?? []).map((u: any) => u.id));

  const viejoPorProducto = new Map<number, number>();
  const ocultoPorProducto = new Map<number, number>();
  for (const r of stockRows ?? []) {
    const pid = r.producto_id as number;
    const cant = Number(r.cantidad_base || 0);
    viejoPorProducto.set(pid, (viejoPorProducto.get(pid) ?? 0) + cant);
    if (idsOcultos.has(r.ubicacion_id)) {
      ocultoPorProducto.set(pid, (ocultoPorProducto.get(pid) ?? 0) + cant);
    }
  }

  const comparaciones = (disponibles ?? []).map((d: any) => {
    const pid = d.producto_id as number;
    const qtyVieja = Math.max(0, Math.floor(viejoPorProducto.get(pid) ?? 0));
    const qtyNueva = Math.max(0, Math.floor(Number(d.disponible_variante ?? 0)));
    return {
      producto_id: pid,
      inventoryItemId: d.shopify_inventory_item_id as string | null,
      quantity_vieja: qtyVieja,
      quantity_nueva: qtyNueva,
      delta: qtyNueva - qtyVieja,
      stock_en_ubicacion_oculta: Math.max(0, Math.floor(ocultoPorProducto.get(pid) ?? 0)),
    };
  });

  const conDelta = comparaciones.filter((c) => c.delta !== 0);
  const resumen = {
    dry_run: true,
    total_variantes: comparaciones.length,
    variantes_con_delta: conDelta.length,
    delta_total: conDelta.reduce((s, c) => s + c.delta, 0),
    variantes_con_delta_detalle: conDelta,
  };
  console.log("DRY RUN shopify-stock-push", JSON.stringify(resumen));
  return resumen;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!SYNC_SECRET || req.headers.get("X-Sync-Secret") !== SYNC_SECRET) {
    return new Response("No autorizado", { status: 401 });
  }
  if (!STORE_DOMAIN || !CLIENT_ID || !CLIENT_SECRET || !LOCATION_ID) {
    console.error("Faltan envs de Shopify (STORE_DOMAIN/CLIENT_ID/CLIENT_SECRET/LOCATION_ID).");
    return new Response("Config incompleta", { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const dryRun = new URL(req.url).searchParams.get("dry_run") === "true";
  if (dryRun) {
    try {
      const resumen = await correrDryRun(supabase);
      return new Response(JSON.stringify(resumen, null, 2), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(String(e), { status: 500 });
    }
  }

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
      const { data: disp } = await supabase
        .from("v_disponible_shopify")
        .select("shopify_inventory_item_id, disponible_variante")
        .eq("producto_id", pid)
        .maybeSingle();
      const invItem = disp?.shopify_inventory_item_id;
      if (!invItem) throw new Error("producto sin shopify_inventory_item_id (o fuera de v_disponible_shopify)");

      const available = Math.max(0, Math.floor(Number(disp?.disponible_variante ?? 0)));

      await setInventory(String(invItem), available);
      await supabase.from("shopify_sync_outbox").delete().eq("producto_id", pid);
      ok++;
    } catch (e) {
      await supabase.rpc("f_sync_outbox_fallo", { p_producto_id: pid, p_error: String(e) });
      console.error("push fallo", { producto_id: pid, error: String(e) });
      fail++;
    }
  }

  return new Response(JSON.stringify({ procesados: pendientes?.length ?? 0, ok, fail }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
