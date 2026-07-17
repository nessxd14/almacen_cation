#!/usr/bin/env node
// =====================================================================
//  WMS — BOOTSTRAP DE CATÁLOGO DESDE SHOPIFY  (Paso 1 + mapeo, en uno)
//
//  Qué hace:
//    1. Obtiene token shpat_ vía OAuth client_credentials.
//    2. Baja TODO el catálogo ACTIVO de Shopify (GraphQL, paginado).
//    3. Transforma según las decisiones lockeadas:
//         - 1 variante Shopify  -> 1 `producto`  (cada variante separada)
//         - producto multi-variante -> 1 `familia` (agrupador)
//         - producto 1-variante     -> familia_id NULL ("genérico suelto")
//         - sku_interno SOLO si es único global; si colisiona -> NULL +
//           el SKU va a `identificador` (tipo 'fabrica', permite duplicados)
//         - barcode -> `identificador` (tipo 'barra')
//         - selectedOptions (COLOR/MEDIDA/...) -> atributo/atributo_valor
//         - cada producto recibe su presentación base (factor 1, es_base)
//         - los shopify_*_id vienen DIRECTO del API (cero matching)
//    4. Inserta en Postgres en UNA transacción, idempotente
//       (ON CONFLICT en los índices únicos de mapeo).
//    5. Imprime un reporte: creados, colisiones resueltas, sin-código,
//       sin-precio, atributos sembrados.
//
//  Requisitos:
//    - Node 18+ (usa fetch nativo)
//    - npm i pg
//    - Haber corrido migracion_indices_shopify.sql
//    - Variables de entorno (.env cargado por tu shell o --env-file):
//        SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_STORE_DOMAIN
//        SHOPIFY_API_VERSION   (default 2026-01; lectura)
//        DATABASE_URL          (ej: postgresql://postgres:postgres@127.0.0.1:54322/postgres)
//
//  Uso:
//    node --env-file=.env bootstrap_catalogo.mjs            # ejecuta
//    node --env-file=.env bootstrap_catalogo.mjs --dry-run  # NO escribe BD
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

// Limpia el artefacto de Excel (apóstrofo inicial) y descarta basura.
function normalizarSku(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (s.startsWith("'")) s = s.slice(1).trim();   // '046 -> 046
  if (s === '' || s === '0') return null;          // '0 y vacíos no son SKU
  return s;
}

function normalizarBarcode(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

// Shopify es la fuente: se preserva tal cual llega (solo trim y truncado
// defensivo), sin title-case ni transformación — WMS es dueño después de
// esta siembra única, no hay re-normalización continua.
function normalizarVendor(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  return s === '' ? null : s.slice(0, 120);
}

// Mapa de nombres de opción inconsistentes -> atributo canónico.
const MAPA_ATRIBUTOS = {
  'COLOR': 'Color', 'COLORES': 'Color', 'COLOR ': 'Color',
  'MEDIDA': 'Medida', 'MEDIDAS': 'Medida',
  'MODELO': 'Modelo',
  'TAMAÑO': 'Tamaño', 'TAMANO': 'Tamaño',
  'CLASIFICACION': 'Clasificación', 'CLASIFICACIÓN': 'Clasificación',
  'CANTIDAD': 'Cantidad',
};

function normalizarNombreAtributo(name) {
  if (!name) return null;
  const key = name.trim().toUpperCase();
  if (key === 'TITLE') return null;               // opción default de Shopify, no es atributo
  if (MAPA_ATRIBUTOS[key]) return MAPA_ATRIBUTOS[key];
  // Title-case por defecto para cualquier otro nombre no mapeado.
  const t = name.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// GID "gid://shopify/ProductVariant/123" -> "123" (los webhooks usan numérico).
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
        title
        handle
        vendor
        variants(first: 100) {
          edges {
            node {
              id
              title
              sku
              barcode
              price
              inventoryItem { id }
              selectedOptions { name value }
            }
          }
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
      // Manejo básico de throttling: si nos limitan, esperamos y reintentamos.
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
    await sleep(500); // cortesía con el rate limit
  }
  process.stdout.write('\n');
  return productos;
}

// ---------------------------------------------------------------------
//  TRANSFORMACIÓN: API -> filas a insertar
// ---------------------------------------------------------------------

function transformar(productos) {
  // 1ª pasada: frecuencia de SKU normalizado para decidir sku_interno único.
  const freqSku = new Map();
  for (const p of productos) {
    for (const v of p.variants.edges) {
      const sku = normalizarSku(v.node.sku);
      if (sku) freqSku.set(sku, (freqSku.get(sku) || 0) + 1);
    }
  }

  const rep = {
    familias: 0, productos: 0, presentaciones: 0,
    identBarra: 0, identFabrica: 0,
    skuColision: 0, sinCodigo: 0, sinPrecio: 0, sinVendor: 0,
    atributos: new Set(), valores: 0,
  };

  const familias = [];   // { key(handle), nombre, shopify_product_id, productos:[...] }
  for (const p of productos) {
    const variantes = p.variants.edges.map((e) => e.node);
    const multi = variantes.length > 1;
    const marca = normalizarVendor(p.vendor);   // vendor es a nivel product, común a todas las variantes

    const fam = {
      esFamilia: multi,
      nombre: p.title?.slice(0, 200) || p.handle,
      shopify_product_id: idNumerico(p.id),
      productos: [],
    };
    if (multi) rep.familias++;

    for (const v of variantes) {
      const sku = normalizarSku(v.sku);
      const barcode = normalizarBarcode(v.barcode);
      const skuUnico = sku && freqSku.get(sku) === 1;
      if (sku && !skuUnico) rep.skuColision++;
      if (!sku && !barcode) rep.sinCodigo++;
      if (!marca) rep.sinVendor++;

      const precio = v.price != null && v.price !== '' ? Number(v.price) : null;
      if (precio === null || precio === 0) rep.sinPrecio++;

      const vt = v.title && v.title !== 'Default Title' ? ` - ${v.title}` : '';
      const nombre = `${p.title}${vt}`.slice(0, 250);

      const atributos = [];
      for (const opt of v.selectedOptions || []) {
        const an = normalizarNombreAtributo(opt.name);
        if (!an || !opt.value || opt.value === 'Default Title') continue;
        atributos.push({ atributo: an, valor: opt.value.slice(0, 80) });
        rep.atributos.add(an);
        rep.valores++;
      }

      const identificadores = [];
      if (barcode) {
        identificadores.push({ valor: barcode.slice(0, 128), tipo: 'barra', origen: 'fabricante' });
        rep.identBarra++;
      }
      if (sku) {
        // El SKU del vendedor va a 'fabrica' con origen 'interno'.
        identificadores.push({ valor: sku.slice(0, 128), tipo: 'fabrica', origen: 'interno' });
        rep.identFabrica++;
      }

      fam.productos.push({
        nombre,
        sku_interno: skuUnico ? sku.slice(0, 64) : null,
        marca,
        precio_base: precio,
        shopify_variant_id: idNumerico(v.id),
        shopify_inventory_item_id: idNumerico(v.inventoryItem?.id),
        atributos,
        identificadores,
      });
      rep.productos++;
      rep.presentaciones++;
    }
    familias.push(fam);
  }
  return { familias, rep };
}

// ---------------------------------------------------------------------
//  CARGA EN POSTGRES (transaccional, idempotente)
// ---------------------------------------------------------------------

async function cargar(familias) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  // Cache de atributos/valores para no repetir lookups.
  const cacheAtributo = new Map();        // nombre -> id
  const cacheValor = new Map();           // `${atributoId}|${valor}` -> id

  async function upsertAtributo(nombre) {
    if (cacheAtributo.has(nombre)) return cacheAtributo.get(nombre);
    const r = await client.query(
      `INSERT INTO atributo (nombre) VALUES ($1)
       ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id`, [nombre]);
    cacheAtributo.set(nombre, r.rows[0].id);
    return r.rows[0].id;
  }
  async function upsertValor(atributoId, valor) {
    const k = `${atributoId}|${valor}`;
    if (cacheValor.has(k)) return cacheValor.get(k);
    const r = await client.query(
      `INSERT INTO atributo_valor (atributo_id, valor) VALUES ($1, $2)
       ON CONFLICT (atributo_id, valor) DO UPDATE SET valor = EXCLUDED.valor
       RETURNING id`, [atributoId, valor]);
    cacheValor.set(k, r.rows[0].id);
    return r.rows[0].id;
  }

  try {
    await client.query('BEGIN');

    for (const fam of familias) {
      let familiaId = null;
      if (fam.esFamilia) {
        // ON CONFLICT con índice parcial requiere la cláusula WHERE explícita.
        const r = await client.query(
          `INSERT INTO familia (nombre, shopify_product_id) VALUES ($1, $2)
           ON CONFLICT (shopify_product_id) WHERE shopify_product_id IS NOT NULL
           DO UPDATE SET nombre = EXCLUDED.nombre
           RETURNING id`,
          [fam.nombre, fam.shopify_product_id]);
        familiaId = r.rows[0].id;
      }

      for (const prod of fam.productos) {
        // Upsert producto por shopify_variant_id. (xmax = 0) => fue INSERT.
        // unidad_base va SIEMPRE hardcodeado a 'unidad', nunca derivado del
        // título/opciones de Shopify: Shopify no expone un "tamaño de bulto"
        // estructurado, y adivinarlo del título (regex tipo "PAQUETE X N")
        // es justo el patrón inconsistente que se migró a `presentacion`
        // (ver db/migrations/*_presentaciones_paquete.sql). Un producto
        // nuevo que venga en caja/paquete queda en 'unidad' + su
        // presentación de bulto se agrega a mano después.
        // marca va en el INSERT pero NO en el DO UPDATE SET: se siembra
        // solo al crear el producto (semilla única desde Shopify.vendor) y
        // nunca pisa una corrección manual al re-correr el bootstrap.
        const pr = await client.query(
          `INSERT INTO producto
             (familia_id, nombre, sku_interno, unidad_base, precio_base,
              activo, shopify_variant_id, shopify_inventory_item_id, marca)
           VALUES ($1, $2, $3, 'unidad', $4, TRUE, $5, $6, $7)
           ON CONFLICT (shopify_variant_id) WHERE shopify_variant_id IS NOT NULL DO UPDATE
             SET nombre = EXCLUDED.nombre,
                 familia_id = EXCLUDED.familia_id,
                 precio_base = EXCLUDED.precio_base,
                 shopify_inventory_item_id = EXCLUDED.shopify_inventory_item_id
           RETURNING id, (xmax = 0) AS insertado`,
          [familiaId, prod.nombre, prod.sku_interno, prod.precio_base,
           prod.shopify_variant_id, prod.shopify_inventory_item_id, prod.marca]);

        const productoId = pr.rows[0].id;
        const esNuevo = pr.rows[0].insertado;

        // Atributos (idempotente vía upsert + PK compuesta del puente).
        for (const a of prod.atributos) {
          const aid = await upsertAtributo(a.atributo);
          const vid = await upsertValor(aid, a.valor);
          await client.query(
            `INSERT INTO producto_atributo (producto_id, atributo_valor_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [productoId, vid]);
        }

        // Presentación base + identificadores: solo en productos NUEVOS,
        // para no duplicar al re-correr.
        if (esNuevo) {
          const presR = await client.query(
            `INSERT INTO presentacion (producto_id, nombre, factor_unidad_base, es_base)
             VALUES ($1, 'Unidad', 1, TRUE) RETURNING id`,
            [productoId]);
          const presId = presR.rows[0].id;

          for (const ident of prod.identificadores) {
            await client.query(
              `INSERT INTO identificador
                 (presentacion_id, valor, tipo, origen, es_principal)
               VALUES ($1, $2, $3, $4, TRUE)`,
              [presId, ident.valor, ident.tipo, ident.origen]);
          }
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------
//  MAIN
// ---------------------------------------------------------------------

function imprimirReporte(rep) {
  console.log('\n========== REPORTE DE BOOTSTRAP ==========');
  console.log(`  Familias (multi-variante):   ${rep.familias}`);
  console.log(`  Productos (variantes):       ${rep.productos}`);
  console.log(`  Presentaciones base:         ${rep.presentaciones}`);
  console.log(`  Identificadores 'barra':     ${rep.identBarra}`);
  console.log(`  Identificadores 'fabrica':   ${rep.identFabrica}`);
  console.log(`  Atributos distintos:         ${rep.atributos.size}  [${[...rep.atributos].join(', ')}]`);
  console.log(`  Valores de atributo:         ${rep.valores}`);
  console.log('  ---- a revisar manualmente ----');
  console.log(`  SKU en colisión (-> NULL):   ${rep.skuColision}`);
  console.log(`  Sin código escaneable:       ${rep.sinCodigo}  (se cuentan por nombre)`);
  console.log(`  Sin precio (0 o vacío):      ${rep.sinPrecio}`);
  console.log(`  Sin vendor en Shopify:       ${rep.sinVendor}`);
  console.log('==========================================\n');
}

async function main() {
  requireEnv();
  console.log(`Tienda: ${SHOPIFY_STORE_DOMAIN}  ·  API ${SHOPIFY_API_VERSION}  ${DRY_RUN ? '· DRY-RUN' : ''}`);

  console.log('1) Obteniendo token…');
  const token = await obtenerToken();

  console.log('2) Bajando catálogo activo de Shopify…');
  const productos = await pullCatalogo(token);

  console.log('3) Transformando…');
  const { familias, rep } = transformar(productos);
  imprimirReporte(rep);

  if (DRY_RUN) {
    console.log('DRY-RUN: no se escribió nada en la base de datos.');
    return;
  }

  console.log('4) Cargando en Postgres (transacción única)…');
  await cargar(familias);
  console.log('✓ Listo. Catálogo sembrado.');
}

main().catch((err) => {
  console.error('\n✗ FALLÓ:', err.message);
  process.exit(1);
});
