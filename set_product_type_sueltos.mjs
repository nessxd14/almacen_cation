#!/usr/bin/env node
// =====================================================================
//  Fase 2 (Brief 2, sueltos) — productType para los 1,010 productos sin
//  familia.
//
//  Por qué existe este script y no se hace vía MCP uno por uno:
//    El WMS solo guarda `shopify_variant_id` por producto — para
//    productos "sueltos" (1 sola variante) nunca se guardó el
//    `shopify_product_id` del padre (bootstrap_catalogo.mjs lo descarta
//    cuando el producto Shopify no es multi-variante). Sin ese id no se
//    puede apuntar productUpdate directo, así que este script baja TODO
//    el catálogo activo de Shopify (igual que bootstrap_catalogo.mjs),
//    resuelve variant -> product en memoria, y recién ahí aplica.
//
//  Fuente del rubro: rubros_sueltos.json — mapeo producto_id -> rubro,
//  exportado de clasificacion_rubros_propuesta.xlsx (columna ID = mismo
//  id que producto.id, verificado 1:1 contra la base viva antes de
//  generar este archivo: 1010 ids, sin huérfanos en ninguna dirección).
//
//  Requisitos: igual que bootstrap_catalogo.mjs (Node 18+, npm i pg,
//  mismas env vars: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET,
//  SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION, DATABASE_URL).
//
//  Uso:
//    node --env-file=.env set_product_type_sueltos.mjs --dry-run
//    node --env-file=.env set_product_type_sueltos.mjs
// =====================================================================

import fs from 'fs';
import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');

const {
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_API_VERSION = '2026-01',
  DATABASE_URL,
} = process.env;

function requireEnv() {
  const faltan = [];
  if (!SHOPIFY_CLIENT_ID) faltan.push('SHOPIFY_CLIENT_ID');
  if (!SHOPIFY_CLIENT_SECRET) faltan.push('SHOPIFY_CLIENT_SECRET');
  if (!SHOPIFY_STORE_DOMAIN) faltan.push('SHOPIFY_STORE_DOMAIN');
  if (!DATABASE_URL) faltan.push('DATABASE_URL');
  if (faltan.length) {
    console.error('ERROR: faltan variables de entorno:', faltan.join(', '));
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function idNumerico(gid) {
  if (!gid) return null;
  const m = String(gid).match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------
//  SHOPIFY: token + pull paginado (productos + variantes + productType)
// ---------------------------------------------------------------------

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
  if (!res.ok) throw new Error(`OAuth falló: HTTP ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('OAuth: sin access_token en la respuesta');
  return json.access_token;
}

const QUERY = `
query($cursor: String) {
  products(first: 100, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        title
        productType
        variants(first: 10) {
          edges { node { id } }
        }
      }
    }
  }
}`;

async function pullCatalogo(token) {
  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const productos = [];
  let cursor = null;
  let pagina = 0;

  while (true) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
    });
    const json = await res.json();

    if (json.errors) {
      const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        console.warn('  (throttled, esperando 2s y reintentando…)');
        await sleep(2000);
        continue;
      }
      throw new Error('GraphQL error: ' + JSON.stringify(json.errors));
    }

    const data = json.data.products;
    for (const edge of data.edges) productos.push(edge.node);
    pagina++;
    process.stdout.write(`\r  Página ${pagina} — ${productos.length} productos activos…`);

    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
    await sleep(500);
  }
  process.stdout.write('\n');
  return productos;
}

const MUTATION = `
mutation setProductType($id: ID!, $productType: String) {
  productUpdate(product: { id: $id, productType: $productType }) {
    product { id productType }
    userErrors { field message }
  }
}`;

async function setProductType(token, productId, productType) {
  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query: MUTATION, variables: { id: productId, productType } }),
  });
  const json = await res.json();
  if (json.errors) {
    const throttled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled) {
      await sleep(2000);
      return setProductType(token, productId, productType);
    }
    throw new Error('GraphQL error: ' + JSON.stringify(json.errors));
  }
  const errs = json.data.productUpdate.userErrors;
  if (errs.length) return { ok: false, error: errs.map((e) => e.message).join('; ') };
  return { ok: true };
}

// ---------------------------------------------------------------------
//  MAIN
// ---------------------------------------------------------------------

async function main() {
  requireEnv();
  console.log(`Tienda: ${SHOPIFY_STORE_DOMAIN}  ·  API ${SHOPIFY_API_VERSION}  ${DRY_RUN ? '· DRY-RUN' : ''}`);

  console.log('1) Cargando rubros_sueltos.json…');
  const rubrosPorProductoId = JSON.parse(fs.readFileSync(new URL('./rubros_sueltos.json', import.meta.url)));
  console.log(`   ${Object.keys(rubrosPorProductoId).length} productos sueltos con rubro asignado.`);

  console.log('2) Leyendo productos sueltos de la base (familia_id IS NULL)…');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const { rows: sueltos } = await client.query(
    `SELECT id, nombre, shopify_variant_id FROM producto WHERE familia_id IS NULL`
  );
  await client.end();
  console.log(`   ${sueltos.length} productos sueltos en la base.`);

  // variant_id (numérico) -> { productoId, nombre, rubro }
  const porVariantId = new Map();
  const sinShopifyVariantId = [];
  const sinRubro = [];
  for (const p of sueltos) {
    const rubro = rubrosPorProductoId[String(p.id)];
    if (!rubro) { sinRubro.push(p); continue; }
    if (!p.shopify_variant_id) { sinShopifyVariantId.push(p); continue; }
    porVariantId.set(String(p.shopify_variant_id), { productoId: p.id, nombre: p.nombre, rubro });
  }

  console.log('3) Obteniendo token de Shopify…');
  const token = await obtenerToken();

  console.log('4) Bajando catálogo activo de Shopify (para resolver variant -> product)…');
  const productosShopify = await pullCatalogo(token);

  // Para cada producto Shopify, ver si alguna de sus variantes matchea un
  // "suelto" nuestro. Caso esperado: exactamente 1 match (1 variante = 1
  // producto). Casos raros se reportan y NO se tocan.
  const aplicar = []; // { shopifyProductId, title, productTypeActual, productTypeNuevo, productoId, nombre }
  const yaCorrecto = [];
  const multiplesMatches = []; // producto Shopify con >1 variante nuestra (posible fusión ya hecha en Shopify)
  const vistos = new Set(); // producto_id ya resuelto, para detectar duplicados

  for (const prod of productosShopify) {
    const matches = [];
    for (const edge of prod.variants.edges) {
      const vid = idNumerico(edge.node.id);
      const info = porVariantId.get(vid);
      if (info) matches.push(info);
    }
    if (matches.length === 0) continue;
    if (matches.length > 1) {
      multiplesMatches.push({ shopifyProductId: prod.id, title: prod.title, matches });
      continue;
    }
    const { productoId, nombre, rubro } = matches[0];
    vistos.add(productoId);
    if (prod.productType === rubro) {
      yaCorrecto.push({ productoId, nombre, rubro });
    } else {
      aplicar.push({
        shopifyProductId: prod.id,
        title: prod.title,
        productTypeActual: prod.productType || '(vacío)',
        productTypeNuevo: rubro,
        productoId,
        nombre,
      });
    }
  }

  const noEncontrados = sueltos.filter(
    (p) => rubrosPorProductoId[String(p.id)] && p.shopify_variant_id && !vistos.has(p.id) &&
      !multiplesMatches.some((m) => m.matches.some((mm) => mm.productoId === p.id))
  );

  console.log('\n========== REPORTE ==========');
  console.log(`  Sueltos en base:                 ${sueltos.length}`);
  console.log(`  Sin rubro en rubros_sueltos.json: ${sinRubro.length}`);
  console.log(`  Sin shopify_variant_id:           ${sinShopifyVariantId.length}`);
  console.log(`  Ya tienen el productType correcto:${yaCorrecto.length}`);
  console.log(`  A actualizar:                     ${aplicar.length}`);
  console.log(`  No encontrados en Shopify activo:  ${noEncontrados.length}`);
  console.log(`  Productos Shopify con >1 match (revisar a mano): ${multiplesMatches.length}`);
  console.log('==============================\n');

  if (sinRubro.length) {
    console.log('-- Sin rubro (no están en rubros_sueltos.json) --');
    for (const p of sinRubro.slice(0, 20)) console.log(`   #${p.id} ${p.nombre}`);
    if (sinRubro.length > 20) console.log(`   … y ${sinRubro.length - 20} más`);
  }
  if (noEncontrados.length) {
    console.log('-- No encontrados en Shopify activo (revisar: ¿borrados/inactivos?) --');
    for (const p of noEncontrados.slice(0, 20)) console.log(`   #${p.id} ${p.nombre} (variant_id ${p.shopify_variant_id})`);
    if (noEncontrados.length > 20) console.log(`   … y ${noEncontrados.length - 20} más`);
  }
  if (multiplesMatches.length) {
    console.log('-- Productos Shopify con más de un "suelto" nuestro adentro (NO tocar sin revisar) --');
    for (const m of multiplesMatches) {
      console.log(`   ${m.title} (${m.shopifyProductId}): ${m.matches.map((x) => `#${x.productoId} ${x.nombre}`).join(' | ')}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\nDRY-RUN: se aplicarían ${aplicar.length} cambios. Primeros 30:`);
    for (const a of aplicar.slice(0, 30)) {
      console.log(`   ${a.title}: "${a.productTypeActual}" -> "${a.productTypeNuevo}"`);
    }
    if (aplicar.length > 30) console.log(`   … y ${aplicar.length - 30} más`);
    console.log('\nDRY-RUN: no se escribió nada en Shopify.');
    return;
  }

  console.log(`5) Aplicando ${aplicar.length} cambios en Shopify…`);
  let ok = 0;
  let fallidos = [];
  for (const a of aplicar) {
    const r = await setProductType(token, a.shopifyProductId, a.productTypeNuevo);
    if (r.ok) {
      ok++;
      process.stdout.write(`\r  ${ok}/${aplicar.length}…`);
    } else {
      fallidos.push({ ...a, error: r.error });
    }
    await sleep(300);
  }
  process.stdout.write('\n');
  console.log(`✓ Aplicados: ${ok}/${aplicar.length}`);
  if (fallidos.length) {
    console.log(`✗ Fallidos: ${fallidos.length}`);
    for (const f of fallidos) console.log(`   ${f.title}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error('\n✗ FALLÓ:', err.message);
  process.exit(1);
});
