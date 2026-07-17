#!/usr/bin/env node
// =====================================================================
//  WMS — BACKFILL DE MARCA DESDE SHOPIFY VENDOR (one-shot)
//
//  Rellena producto.marca con Shopify.vendor para productos existentes
//  que todavía no tienen marca cargada (a mano o por el bootstrap).
//  Nunca pisa una marca ya seteada — WMS es dueño después de esta
//  siembra, no hay sync continuo ni webhooks.
//
//  vendor es un campo a nivel PRODUCT en Shopify (no variant): todas las
//  variantes de un mismo producto Shopify comparten vendor.
//  Match con WMS: por producto.shopify_variant_id.
//
//  Requisitos: Node 18+ (fetch nativo), npm i pg.
//  Variables de entorno (.env cargado por tu shell o --env-file):
//    SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN
//    SHOPIFY_API_VERSION   (default 2026-01; lectura)
//    DATABASE_URL
//
//  Uso:
//    node --env-file=.env backfill_marca.mjs             # ejecuta
//    node --env-file=.env backfill_marca.mjs --dry-run   # NO escribe BD
//    node backfill_marca.mjs --self-test                 # solo asserts locales,
//                                                         # no toca Shopify ni DB
// =====================================================================

import pg from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const SELF_TEST = process.argv.includes('--self-test');

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
  if (!DRY_RUN && !DATABASE_URL) faltan.push('DATABASE_URL');
  if (faltan.length) {
    console.error('ERROR: faltan variables de entorno:', faltan.join(', '));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------
//  NORMALIZACIÓN
// ---------------------------------------------------------------------

// Shopify es la fuente: se preserva tal cual llega (solo trim y truncado
// defensivo), sin title-case ni transformación. Formatea la marca truncando
// si es muy larga. Devuelve null si no hay marca.
function normalizarVendor(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  return s === '' ? null : s.slice(0, 120);
}

function idNumerico(gid) {
  if (!gid) return null;
  const m = String(gid).match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
//  SHOPIFY: token + pull paginado
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
  products(first: 50, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        vendor
        variants(first: 100) {
          edges { node { id } }
        }
      }
    }
  }
}`;

async function pullMarcas(token) {
  const endpoint = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const tuplas = []; // { shopify_variant_id, vendor }
  const rep = { productosEscaneados: 0, variantesConVendor: 0, variantesSinVendor: 0 };
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
      if (throttled) {
        console.warn('  (throttled, esperando 2s y reintentando…)');
        await sleep(2000);
        continue;
      }
      throw new Error('GraphQL error: ' + JSON.stringify(json.errors));
    }

    const data = json.data.products;
    for (const edge of data.edges) {
      const p = edge.node;
      rep.productosEscaneados++;
      const vendor = normalizarVendor(p.vendor);
      for (const ve of p.variants.edges) {
        const vid = idNumerico(ve.node.id);
        if (!vid) continue;
        tuplas.push({ shopify_variant_id: vid, vendor });
        if (vendor) rep.variantesConVendor++;
        else rep.variantesSinVendor++;
      }
    }
    pagina++;
    process.stdout.write(`\r  Página ${pagina} — ${tuplas.length} variantes…`);

    if (!data.pageInfo.hasNextPage) break;
    cursor = data.pageInfo.endCursor;
    await sleep(500);
  }
  process.stdout.write('\n');
  return { tuplas, rep };
}

// ---------------------------------------------------------------------
//  CARGA EN POSTGRES (transaccional)
// ---------------------------------------------------------------------

// Nunca pisa marca ya seteada: primero se chequea el estado actual en WMS
// para poder reportar por separado "ya tenía marca" vs "sin match", y
// recién después se actualizan solo las filas que de verdad lo necesitan
// (mismo resultado que un UPDATE con WHERE marca IS NULL OR marca = '',
// pero permite distinguir las tres categorías del reporte).
async function actualizar(conVendor) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const resultado = { rellenados: 0, yaTenianMarca: 0, sinMatch: 0 };

  try {
    await client.query('BEGIN');

    const ids = conVendor.map((t) => t.shopify_variant_id);
    const { rows: existentes } = await client.query(
      `SELECT shopify_variant_id, marca FROM producto WHERE shopify_variant_id = ANY($1::varchar[])`,
      [ids]);
    const marcaActual = new Map(existentes.map((r) => [r.shopify_variant_id, r.marca]));

    for (const { shopify_variant_id, vendor } of conVendor) {
      if (!marcaActual.has(shopify_variant_id)) {
        resultado.sinMatch++;
        continue;
      }
      const actual = marcaActual.get(shopify_variant_id);
      if (actual != null && actual !== '') {
        resultado.yaTenianMarca++;
        continue;
      }
      const r = await client.query(
        `UPDATE producto SET marca = $1, actualizado_en = now()
         WHERE shopify_variant_id = $2 AND (marca IS NULL OR marca = '')`,
        [vendor, shopify_variant_id]);
      resultado.rellenados += r.rowCount;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
  return resultado;
}

// ---------------------------------------------------------------------
//  SELF-TEST (sin Shopify ni DB)
// ---------------------------------------------------------------------

function selfTest() {
  let ok = 0, fail = 0;
  function check(desc, actual, esperado) {
    const pasa = actual === esperado;
    console.log(`  ${pasa ? 'OK  ' : 'FAIL'} ${desc} -> ${JSON.stringify(actual)}${pasa ? '' : ` (esperado ${JSON.stringify(esperado)})`}`);
    if (pasa) ok++; else fail++;
  }

  console.log('== self-test: normalizarVendor ==');
  check('normalizarVendor(null)', normalizarVendor(null), null);
  check("normalizarVendor('')", normalizarVendor(''), null);
  check("normalizarVendor('  ')", normalizarVendor('  '), null);
  check("normalizarVendor('Faber-Castell')", normalizarVendor('Faber-Castell'), 'Faber-Castell');
  check("normalizarVendor('  Faber  ')", normalizarVendor('  Faber  '), 'Faber');
  const largo = normalizarVendor('X'.repeat(200));
  check("normalizarVendor('X'.repeat(200)).length === 120", largo.length, 120);

  console.log(`\n${ok} OK, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------
//  MAIN
// ---------------------------------------------------------------------

function imprimirReporte(rep, resultado) {
  console.log('\n========== REPORTE DE BACKFILL DE MARCA ==========');
  console.log(`  Productos escaneados en Shopify:  ${rep.productosEscaneados}`);
  console.log(`  Variantes con vendor no vacío:    ${rep.variantesConVendor}`);
  console.log(`  Variantes sin vendor en Shopify:  ${rep.variantesSinVendor}`);
  console.log('  ---- resultados en WMS ----');
  console.log(`  Rellenados (marca era NULL):      ${resultado?.rellenados ?? '—'}`);
  console.log(`  Ya tenían marca (skip):           ${resultado?.yaTenianMarca ?? '—'}`);
  console.log(`  Sin match en WMS (variant desconocida): ${resultado?.sinMatch ?? '—'}`);
  console.log('==================================================\n');
}

async function main() {
  if (SELF_TEST) { selfTest(); return; }

  requireEnv();
  console.log(`Tienda: ${SHOPIFY_STORE_DOMAIN}  ·  API ${SHOPIFY_API_VERSION}  ${DRY_RUN ? '· DRY-RUN' : ''}`);

  console.log('1) Obteniendo token…');
  const token = await obtenerToken();

  console.log('2) Bajando vendor de Shopify…');
  const { tuplas, rep } = await pullMarcas(token);
  const conVendor = tuplas.filter((t) => t.vendor);

  if (DRY_RUN) {
    imprimirReporte(rep, null);
    console.log('DRY-RUN: no se escribió nada en la base de datos.');
    return;
  }

  console.log('3) Actualizando WMS (solo donde marca IS NULL OR marca = \'\')…');
  const resultado = await actualizar(conVendor);
  imprimirReporte(rep, resultado);
  console.log('✓ Listo.');
}

main().catch((err) => {
  console.error('\n✗ FALLÓ:', err.message);
  process.exit(1);
});
