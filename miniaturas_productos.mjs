#!/usr/bin/env node
// =====================================================================
//  WMS — MINIATURAS DE FOTOS DE PRODUCTO (backfill de una sola vez)
//
//  Genera la miniatura de cada producto activo cuya foto vive en el bucket
//  público `producto_imagenes` y todavía no tiene `imagen_miniatura_url`.
//  Las listas del Seller usan la miniatura; la foto completa solo se baja al
//  ampliar.
//
//  Miniatura: lado mayor 320 px, WebP calidad 72 (sharp, fit 'inside', sin
//  agrandar). Ruta: miniatura/{productoId}-{Date.now() en base36}.webp, subida
//  con cacheControl 31536000 y upsert:false (nombre nuevo cada vez).
//
//  Después sube, actualiza `producto.imagen_miniatura_url` en lotes de 200 con
//  un solo UPDATE por lote (así catalogo_version sube pocas veces, no ~1.500).
//
//  Requisitos: Node 20+, npm i, migración 20261117000000_producto_imagen_miniatura
//  aplicada. Variables en .env: VITE_SUPABASE_URL (o SUPABASE_URL),
//  SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL. No imprime llaves.
//
//  Uso:
//    node --env-file=.env miniaturas_productos.mjs [--dry-run] [--limit N]
//
//  --dry-run  descarga y redimensiona pero no sube ni actualiza nada; imprime
//             el mismo resumen.
//
//  Correr UNA vez, fuera del horario de operación. Es idempotente: re-correr
//  solo procesa los productos que sigan sin miniatura (p. ej. los que se
//  promovieron mientras corría el script).
// =====================================================================

import { pathToFileURL } from 'node:url';

export const LADO = 320;
export const CALIDAD_WEBP = 72;
export const CONCURRENCIA = 4;
export const TAMANO_LOTE = 200;
export const BUCKET = 'producto_imagenes';
export const MARCA_BUCKET = '/storage/v1/object/public/producto_imagenes/';
export const CACHE_CONTROL = '31536000';

// Selección: activos, con foto en el bucket y sin miniatura. Espejo en JS de
// la consulta SQL (SQL_CANDIDATOS) para poder probarlo sin base.
export function esCandidato(p) {
  return Boolean(
    p &&
      p.activo !== false &&
      typeof p.imagen_url === 'string' &&
      p.imagen_url.includes(MARCA_BUCKET) &&
      !p.imagen_miniatura_url,
  );
}

export const SQL_CANDIDATOS = `
  SELECT id, imagen_url
    FROM producto
   WHERE activo
     AND imagen_url LIKE '%${MARCA_BUCKET}%'
     AND imagen_miniatura_url IS NULL
   ORDER BY id`;

export function rutaMiniatura(productoId, ahora = Date.now()) {
  return `miniatura/${productoId}-${ahora.toString(36)}.webp`;
}

// UPDATE de un lote en una sola sentencia. `filas` = [{ id, url }].
// Devuelve { text, values } listo para pg. El `is null` del WHERE protege
// contra pisar una miniatura puesta mientras corría el script.
export function construirUpdateLote(filas) {
  if (!filas.length) throw new Error('Lote vacío');
  const values = [];
  const tuplas = filas.map((f, i) => {
    values.push(String(f.id), f.url);
    return `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`;
  });
  const text =
    'UPDATE producto p SET imagen_miniatura_url = v.url ' +
    `FROM (VALUES ${tuplas.join(', ')}) v(id, url) ` +
    'WHERE p.id::text = v.id AND p.imagen_miniatura_url IS NULL';
  return { text, values };
}

export function partirEnLotes(items, tamano = TAMANO_LOTE) {
  const lotes = [];
  for (let i = 0; i < items.length; i += tamano) lotes.push(items.slice(i, i + tamano));
  return lotes;
}

// resultados: [{ id, ok, bytesAntes, bytesDespues, motivo }]
export function calcularResumen(resultados) {
  const buenos = resultados.filter((r) => r.ok);
  const omitidos = resultados.filter((r) => !r.ok);
  const antes = buenos.reduce((s, r) => s + r.bytesAntes, 0);
  const despues = buenos.reduce((s, r) => s + r.bytesDespues, 0);
  return {
    procesados: resultados.length,
    subidos: buenos.length,
    omitidos: omitidos.map((r) => ({ id: r.id, motivo: r.motivo })),
    kbAntes: Math.round(antes / 1024),
    kbDespues: Math.round(despues / 1024),
    promedioKb: buenos.length ? Math.round((despues / buenos.length / 1024) * 10) / 10 : 0,
  };
}

export function formatearResumen(r, { dryRun = false } = {}) {
  const lineas = [
    `Resumen${dryRun ? ' (DRY-RUN: no se subió ni actualizó nada)' : ''}`,
    `  Procesados:       ${r.procesados}`,
    `  ${dryRun ? 'Generables' : 'Subidos'}:       ${r.subidos}`,
    `  Omitidos:         ${r.omitidos.length}`,
    `  KB originales:    ${r.kbAntes}`,
    `  KB miniaturas:    ${r.kbDespues}`,
    `  Promedio miniatura: ${r.promedioKb} KB`,
  ];
  for (const o of r.omitidos) lineas.push(`    - ${o.id}: ${o.motivo}`);
  return lineas.join('\n');
}

// Ejecuta `fn` sobre `items` con a lo sumo `n` en vuelo.
export async function conConcurrencia(items, n, fn) {
  const salida = new Array(items.length);
  let siguiente = 0;
  const obreros = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      salida[i] = await fn(items[i], i);
    }
  });
  await Promise.all(obreros);
  return salida;
}

async function bajarYRedimensionar(sharp, url) {
  const res = await fetch(url);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const tipo = res.headers.get('content-type') || '';
  if (!tipo.startsWith('image/')) return { error: `no es imagen (${tipo || 'sin content-type'})` };
  const original = Buffer.from(await res.arrayBuffer());
  try {
    const miniatura = await sharp(original)
      .rotate() // respeta EXIF
      .resize({ width: LADO, height: LADO, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: CALIDAD_WEBP })
      .toBuffer();
    return { original: original.length, miniatura };
  } catch (e) {
    return { error: `imagen ilegible (${e.message})` };
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const iLimit = process.argv.indexOf('--limit');
  const limite = iLimit >= 0 ? Number(process.argv[iLimit + 1]) : Infinity;
  if (iLimit >= 0 && !(limite > 0)) throw new Error('--limit requiere un número > 0');

  const { DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!DATABASE_URL) throw new Error('Falta DATABASE_URL');
  if (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('Faltan SUPABASE_URL/VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  }

  const [{ default: pg }, { default: sharp }, { createClient }] = await Promise.all([
    import('pg'),
    import('sharp'),
    import('@supabase/supabase-js'),
  ]);

  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const storage = dryRun
    ? null
    : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from(BUCKET);

  try {
    console.log(`Miniaturas de productos ${dryRun ? '· DRY-RUN' : ''}`);
    const { rows } = await db.query(SQL_CANDIDATOS);
    const candidatos = rows.filter(esCandidato).slice(0, limite);
    console.log(`  ${rows.length} productos sin miniatura; se procesan ${candidatos.length}.`);

    let hechos = 0;
    const resultados = await conConcurrencia(candidatos, CONCURRENCIA, async (p) => {
      const r = { id: p.id, ok: false };
      try {
        const g = await bajarYRedimensionar(sharp, p.imagen_url);
        if (g.error) {
          r.motivo = g.error;
        } else {
          r.bytesAntes = g.original;
          r.bytesDespues = g.miniatura.length;
          if (dryRun) {
            r.ok = true;
            console.log(`  ${p.id}: ${(g.original / 1024).toFixed(0)} KB -> ${(g.miniatura.length / 1024).toFixed(1)} KB`);
          } else {
            const path = rutaMiniatura(p.id);
            const { error } = await storage.upload(path, g.miniatura, {
              contentType: 'image/webp',
              cacheControl: CACHE_CONTROL,
              upsert: false,
            });
            if (error) {
              r.motivo = `falló la subida (${error.message})`;
            } else {
              r.ok = true;
              r.url = storage.getPublicUrl(path).data.publicUrl;
            }
          }
        }
      } catch (e) {
        r.motivo = `error inesperado (${e.message})`;
      }
      hechos++;
      if (hechos % 50 === 0) process.stdout.write(`\r  ${hechos}/${candidatos.length}…`);
      return r;
    });
    process.stdout.write('\n');

    if (!dryRun) {
      const filas = resultados.filter((r) => r.ok).map((r) => ({ id: r.id, url: r.url }));
      let actualizadas = 0;
      for (const lote of partirEnLotes(filas)) {
        const { text, values } = construirUpdateLote(lote);
        const res = await db.query(text, values);
        actualizadas += res.rowCount;
      }
      console.log(`  Filas actualizadas: ${actualizadas}`);
    }

    console.log(formatearResumen(calcularResumen(resultados), { dryRun }));
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('\n✗ FALLÓ:', err.message);
    process.exit(1);
  });
}
