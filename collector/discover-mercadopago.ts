/**
 * Descubridor del saldo de MercadoPago.
 *
 * El API oficial NO entrega el saldo: `/users/{id}/mercadopago_account/balance` responde 403
 * forbidden —existe, pero MercadoPago se lo niega a una aplicación de Checkout API— y el
 * reporte de liquidaciones no se puede ni configurar (405 en POST y PUT). El saldo general y
 * las cuentas de ahorro solo viven en el panel web.
 *
 * El login pide código al celular, y eso deja de importar: este script no automatiza el login.
 * Abre Chrome, entras tú con tu código como cualquier día, y mientras navegas se registra qué
 * le pide la página al servidor. Es el mismo reparto que resolvió Santander: la persona navega,
 * el código captura.
 *
 * Imprime método y ruta de cada llamada, y la FORMA de las respuestas JSON que parezcan traer
 * saldos — nombres de campo y tipos, nunca valores.
 *
 *   npm run discover-mp
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from './vendor/open-banking-chile/src/utils.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Rutas que suenan a saldo. Se describe la forma de sus respuestas. */
const INTERESANTES = /balance|saldo|account|wallet|money|availab|invest|rendimien|ahorro/i;

/** Igual que en santander.ts: nombres de campo y tipos, ningún valor. */
function describeShape(value: unknown, depth = 0): string {
  if (depth > 6) return '…';
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[${value.length} × ${describeShape(value[0], depth + 1)}]`;
  }
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const e = Object.entries(value as Record<string, unknown>).slice(0, 25);
    return `{ ${e.map(([k, v]) => `${k}: ${describeShape(v, depth + 1)}`).join(', ')} }`;
  }
  return typeof value;
}

function ask(question: string): Promise<void> {
  process.stdout.write(question);
  return new Promise(resolve => {
    const onData = () => { process.stdin.removeListener('data', onData); process.stdin.pause(); resolve(); };
    process.stdin.resume();
    process.stdin.once('data', onData);
  });
}

async function main() {
  /**
   * Dos modos, y `--attach` es el que sirve contra MercadoPago.
   *
   * Lanzar Chrome con puppeteer lo marca como automatizado: pone `--enable-automation`, deja
   * `navigator.webdriver` en true y arranca con un perfil sin historial ni cookies. MercadoPago
   * lo detecta y bloquea el login —pasó, y costó intentos de una cuenta real—, mientras que los
   * bancos no lo hacen porque el `browser.ts` vendorizado oculta esas señales.
   *
   * Con `--attach` no se lanza nada: la persona abre SU Chrome con un puerto de depuración,
   * entra como cualquier día, y acá solo nos conectamos a observar respuestas. Sin flags de
   * automatización, porque no fuimos nosotros quienes abrimos el navegador.
   */
  const attach = process.argv.includes('--attach');
  let browser;

  if (attach) {
    const puerto = process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? '9222';
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${puerto}` });
    } catch {
      console.error(`No hay un Chrome escuchando en 127.0.0.1:${puerto}.`);
      console.error('Ábrelo así, y despues vuelve a correr esto:');
      console.error('  chrome.exe --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\\chrome-fna"');
      process.exit(1);
    }
    console.log(`Conectado a tu Chrome en el puerto ${puerto}. No voy a navegar ni hacer clic.`);
  } else {
    const chromePath = findChrome(process.env.CHROME_PATH);
    if (!chromePath) {
      console.error('No se encontró Chrome. Pasa CHROME_PATH.');
      process.exit(1);
    }
    console.log('⚠  Lanzando Chrome con puppeteer. MercadoPago detecta esto y bloquea el login;');
    console.log('   para ese sitio usa --attach.');
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      args: ['--disable-dev-shm-usage', '--window-size=1280,900'],
    });
  }

  const pages = await browser.pages();
  const page = pages[pages.length - 1] ?? await browser.newPage();

  const endpoints = new Set<string>();
  const formas = new Map<string, string>();

  function observar(page: import('puppeteer-core').Page) {
  page.on('request', req => {
    try {
      const u = new URL(req.url());
      if (!/mercado(pago|libre)\.c/i.test(u.hostname)) return;
      endpoints.add(`${req.method()} ${u.hostname}${u.pathname}`);
    } catch { /* ignorar */ }
  });

  page.on('response', res => {
    try {
      const u = new URL(res.url());
      if (!/mercado(pago|libre)\.c/i.test(u.hostname)) return;
      if (!INTERESANTES.test(u.pathname)) return;
      if (res.status() < 200 || res.status() >= 300) return;

      const clave = `${u.hostname}${u.pathname}`;
      if (formas.has(clave)) return;
      void res.json()
        .then(body => formas.set(clave, describeShape(body)))
        .catch(() => { /* no era JSON */ });
    } catch { /* ignorar */ }
  });
  }

  if (!attach) {
    await page.goto('https://www.mercadopago.cl/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  // Observar TODAS las pestañas: la persona puede abrir el saldo en una nueva.
  browser.on('targetcreated', async (target) => {
    try {
      const nueva = await target.page();
      if (nueva) observar(nueva);
    } catch { /* no era una página */ }
  });
  for (const p of await browser.pages()) observar(p);

  console.log('\nChrome abierto. Entra a tu cuenta (con el código al celular si lo pide),');
  console.log('anda a donde se ve tu saldo y tus cuentas de ahorro, y déjalo a la vista.');

  // Dos formas de esperar, porque quien lanza esto no siempre es quien navega. Con --wait=N
  // corre sin teclado: sirve cuando el script se dispara desde otra terminal —por ejemplo desde
  // WSL manejando Windows— y la persona solo interactua con la ventana de Chrome.
  const esperaArg = process.argv.slice(2).find(a => a.startsWith('--wait='))?.slice(7);
  const segundos = esperaArg ? Number(esperaArg) : null;

  if (segundos && Number.isFinite(segundos)) {
    console.log(`\nEsperando ${segundos}s mientras navegas. No hace falta tocar esta consola.`);
    for (let queda = segundos; queda > 0; queda -= 30) {
      await new Promise(r => setTimeout(r, Math.min(30, queda) * 1000));
      if (queda > 30) console.log(`  quedan ~${queda - 30}s`);
    }
  } else {
    await ask('\nCuando estés listo, presiona Enter acá: ');
  }

  await new Promise(r => setTimeout(r, 2000));
  // En attach se suelta la conexión: cerrar el Chrome de la persona seria una groseria.
  if (attach) browser.disconnect(); else await browser.close();

  const relevantes = [...endpoints].filter(e => INTERESANTES.test(e)).sort();
  console.log(`\n${endpoints.size} llamadas observadas, ${relevantes.length} que suenan a saldo:\n`);
  for (const e of relevantes) console.log(`  ${e}`);

  if (formas.size > 0) {
    console.log(`\nFormas de respuesta (solo campos y tipos, ningún valor):\n`);
    for (const [ruta, forma] of formas) console.log(`  ${ruta}\n    ${forma}\n`);
  } else {
    console.log('\nNinguna respuesta JSON con pinta de saldo. Las rutas de arriba son el punto de partida.');
  }
}

main().catch(e => { console.error('Error:', e instanceof Error ? e.message : String(e)); process.exit(1); });
