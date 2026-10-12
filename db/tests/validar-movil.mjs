import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
// Browser nuevo y sin red: sólo HTML de las pruebas con personas/productos QA.
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const directory = process.argv[3];
const browser = await chromium.launch({ channel:'chrome',headless:true });
try {
  const context = await browser.newContext({ viewport:{ width:375,height:850 } });
  await context.route('**/*',route => route.abort());
  const page = await context.newPage();
  for (const name of ['carrito-articulo','carrito','enviado','recepcion']) {
    let html = await fs.readFile(path.join(directory,`qr-${name}.html`),'utf8');
    const url = html.match(/href="(https:\/\/almacen-cation\.vercel\.app\/operaciones\/traslados-virtuales\/9\?escanear=1)"/)?.[1];
    if (url) {
      const qr = await QRCode.toDataURL(url,{ width:280,margin:4,errorCorrectionLevel:'M' });
      html = html.replace(/src="data:image\/png;base64,[^"]+"/, `src="${qr}"`);
    }
    for (const width of [320,375,430]) {
      await page.setViewportSize({ width,height:850 });
      await page.setContent(html, { waitUntil:'load' });
      const dims = await page.evaluate(() => ({width:innerWidth,content:document.documentElement.scrollWidth}));
      assert(dims.content <= dims.width, `${name} desborda en ${width}px: ${dims.content}px`);
      if (width === 375) await page.screenshot({path:path.join(directory,`qr-${name}.png`),fullPage:true});
    }
  }
  console.log('OK: carrito, alistado enviado y recepción sin desbordes a 320, 375 y 430 px; vistas QA guardadas.');
} finally { await browser.close(); }
