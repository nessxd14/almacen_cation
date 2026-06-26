#!/usr/bin/env node
// =====================================================================
//  WMS — SINCRONIZAR IMÁGENES DESDE SHOPIFY
//
//  Recorre el catálogo activo de Shopify y llena producto.imagen_url
//  con la URL de la imagen de cada variante.
//
//  Lógica de imagen por variante:
//    1. Si la variante tiene su propia imagen -> esa.
//    2. Si no, usa la imagen destacada del producto (featuredImage).
//  Así cada `producto` del WMS (que es una variante) queda con la
//  imagen más específica disponible.
//
//  Match: por shopify_variant_id (que ya cargamos en el bootstrap).
//  Idempotente: re-correr solo actualiza la URL.
//
//  Requisitos: Node 18+, npm i pg, migracion_imagen_url.sql aplicada.
//  Uso:
//    node --env-file=.env sync_imagenes.mjs
//    node --env-file=.env sync_imagenes.mjs --dry-run
// =====================================================================

import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');

const {
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_API_VERSION = '2026-01',
  DATABASE_URL,
} = process.env;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function idNumerico(gid) {
  if (!gid) return null;
  const m = String(gid).match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

async function obtenerToken() {
  const url = `https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SHOPIFY_CLIENT_ID,
    client_secret: SHOPIFY_CLIENT_SECRET,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`OAuth falló: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('OAuth: sin access_token');
  return json.access_token;
}

const QUERY = `
query($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        featuredImage { url }
        variants(first: 100) {
          edges {
            node {
              id
              image { url }
            }
          }
        }
      }
    }
  }
}`;

async function pullImagenes(token) {
  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const mapa = new Map(); // shopify_variant_id (numérico) -> url
  let cursor = null;
  let pagina = 0;

  while (true) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
    });
    const json = await res.json();
    if (json.errors) {
      const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) { await sleep(2000); continue; }
      throw new Error('GraphQL error: ' + JSON.stringify(json.errors));
    }

    const data = json.data.products;
    for (const edge of data.edges) {
      const prod = edge.node;
      const imgProducto = prod.featuredImage?.url || null;
      for (const ve of prod.variants.edges) {
        const v = ve.node;
        const url = v.image?.url || imgProducto;  // variante > producto
        const vid = idNumerico(v.id);
        if (vid && url) mapa.set(vid, url);
      }
    }
    pagina++;
    process.stdout.write(`\r  Página ${pagina} — ${mapa.size} imágenes…`);
    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
    await sleep(500);
  }
  process.stdout.write('\n');
  return mapa;
}

async function actualizar(mapa) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  let actualizados = 0;
  try {
    await client.query('BEGIN');
    for (const [vid, url] of mapa) {
      const r = await client.query(
        `UPDATE producto SET imagen_url = $1, actualizado_en = now()
         WHERE shopify_variant_id = $2 AND (imagen_url IS DISTINCT FROM $1)`,
        [url, vid]);
      actualizados += r.rowCount;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
  return actualizados;
}

async function main() {
  console.log(`Tienda: ${SHOPIFY_STORE_DOMAIN}  ${DRY_RUN ? '· DRY-RUN' : ''}`);
  console.log('1) Token…');
  const token = await obtenerToken();
  console.log('2) Bajando imágenes de Shopify…');
  const mapa = await pullImagenes(token);
  console.log(`   ${mapa.size} variantes con imagen encontradas.`);

  if (DRY_RUN) {
    console.log('DRY-RUN: no se escribió nada.');
    const muestra = [...mapa.entries()].slice(0, 3);
    for (const [vid, url] of muestra) console.log(`   ${vid} -> ${url}`);
    return;
  }

  console.log('3) Actualizando WMS…');
  const n = await actualizar(mapa);
  console.log(`✓ ${n} productos actualizados con su imagen.`);
}

main().catch((err) => {
  console.error('\n✗ FALLÓ:', err.message);
  process.exit(1);
});
