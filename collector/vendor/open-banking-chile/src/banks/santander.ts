import type { Frame, Page } from "puppeteer-core";
import type { BankMovement, BankScraper, MovementSource, ScrapeResult, ScraperOptions } from "../types.js";
import { MOVEMENT_SOURCE } from "../types.js";
import { deduplicateMovements, closePopups, delay, normalizeDate, parseChileanAmount } from "../utils.js";
import { createInterceptor } from "../intercept.js";
import { runScraper } from "../infrastructure/scraper-runner.js";
import type { BrowserSession } from "../infrastructure/browser.js";
import { fillRut, fillPassword, clickSubmit, detectLoginError } from "../actions/login.js";
import { detect2FA, waitFor2FA } from "../actions/two-factor.js";
import { clickByText, clickSidebarItem, dismissBanners, clickWidget } from "../actions/navigation.js";
import { extractAccountMovements } from "../actions/extraction.js";
import { paginateAndExtract } from "../actions/pagination.js";
import { extractBalance } from "../actions/balance.js";
import { clickTcTab, extractCreditCardMovements } from "../actions/credit-card.js";

// ─── Santander-specific constants ────────────────────────────────────

const BANK_URL = "https://banco.santander.cl/personas";

// ─── API endpoint prefixes ───────────────────────────────────────
const SANTANDER_CHECKING_API_PREFIX =
  "https://openbanking.santander.cl/account_balances_transactions_and_withholdings_retail/v1/current-accounts/transactions";
const SANTANDER_CC_API_PREFIX =
  "https://api-dsk.santander.cl/perdsk/tarjetasDeCredito/consultaUltimosMovimientos";
const SANTANDER_CC_BILLED_API_PREFIX =
  "https://api-dsk.santander.cl/perdsk/tarjetasDeCredito/estadoCuentaNacional";

// ─── API response normalizers ────────────────────────────────────

interface SantanderCheckingApiMovement {
  transactionDate: string; // "2026-03-19"
  movementAmount: string; // "00000010000000-" (centavos, trailing - = debit)
  chargePaymentFlag: string; // "D" = debit, "H" = haber/credit
  observation: string;
  expandedCode: string;
  newBalance?: string;
}

/**
 * DIAGNÓSTICO (cambio respecto a upstream).
 *
 * Describe la FORMA de una respuesta: nombres de campos, tipos y largos de arreglo. Nunca
 * valores. Así se puede pegar en un chat o un issue sin exponer un solo movimiento real.
 *
 * Existe porque `normalizeSantanderCheckingApiMovements` asume `{ movements: [...] }`, y si el
 * banco envuelve la lista de otra forma devuelve 0 en silencio — indistinguible de una cuenta
 * sin movimientos.
 */
export function describeShape(value: unknown, depth = 0): string {
  if (depth > 7) return "…";
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[${value.length} × ${describeShape(value[0], depth + 1)}]`;
  }
  if (value === null) return "null";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 30);
    return `{ ${entries.map(([k, v]) => `${k}: ${describeShape(v, depth + 1)}`).join(", ")} }`;
  }
  return typeof value;
}


// ─── Normalizador genérico de sobre open banking (cambio respecto a upstream) ─────────
//
// `normalizeSantanderCheckingApiMovements` asume `{ movements: [...] }` con montos en
// centavos como string. El endpoint que el banco usa hoy
// (openbanking.santander.cl/account_balances_transactions_and_withholdings_retail) responde con
// otra envoltura, y al no reconocerla el normalizador devuelve 0 en silencio.
//
// Esto busca el arreglo de transacciones donde sea que esté y mapea los nombres de campo
// habituales, tanto los de Santander como los del estándar tipo Berlin Group.

const DATE_KEYS = ["bookingDate", "valueDate", "transactionDate", "fechaContable", "fecha", "date"];
// `movementAmount` queda DELIBERADAMENTE fuera: viene en centavos como string y solo el
// normalizador legado sabe que hay que dividir por 100. Si entrara acá, un valor ya expresado
// en pesos se multiplicaría por 100 — el error de escala que después no se distingue de un
// monto real.
const AMOUNT_KEYS = ["transactionAmount", "amount", "monto", "importe"];
const DESC_KEYS = [
  "remittanceInformationUnstructured", "additionalInformation", "observation", "expandedCode",
  "creditorName", "debtorName", "merchantName", "NombreComercio", "descripcion", "description", "glosa",
];
const BALANCE_KEYS = ["balanceAfterTransaction", "newBalance", "saldo", "balance"];

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
}

/**
 * Convierte el monto a número SIN adivinar la escala.
 *
 * El punto es separador de miles en Chile y separador decimal en el estándar, así que la
 * distinción se hace por forma, no por suposición: dividir por 100 un valor que ya venía en
 * pesos produce un error de 100× que después no se distingue de un monto real.
 */
function parseAmount(raw: unknown): number | null {
  const value = raw && typeof raw === "object" ? (raw as { amount?: unknown }).amount : raw;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  let s = value.trim().replace(/\s/g, "");
  let negative = s.startsWith("-") || s.endsWith("-");   // Santander marca el cargo con "-" al final
  s = s.replace(/-/g, "");

  let n: number | null = null;
  if (/^\d+$/.test(s)) n = Number(s);                                  // entero
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ""));  // 1.234.567 → miles
  else if (/^\d+\.\d{1,2}$/.test(s)) n = Number(s);                    // 18990.00 → decimal
  else if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s)) n = Number(s.replace(/\./g, "").replace(",", "."));
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) n = Number(s.replace(/,/g, ""));
  if (n === null || !Number.isFinite(n)) return null;

  return negative ? -n : n;
}

function isDebit(o: Record<string, unknown>, amountRaw: unknown): boolean {
  const ind = String(pick(o, ["creditDebitIndicator", "chargePaymentFlag", "tipo"]) ?? "").toUpperCase();
  if (ind.startsWith("DBIT") || ind === "D" || ind === "CARGO") return true;
  if (ind.startsWith("CRDT") || ind === "C" || ind === "ABONO") return false;
  // El monto puede venir como { amount: "-18990.00", currency: "CLP" }: hay que mirar adentro,
  // o el signo que el propio banco ya expresó se pierde.
  const inner = amountRaw && typeof amountRaw === "object"
    ? (amountRaw as { amount?: unknown }).amount
    : amountRaw;
  const asText = typeof inner === "string" ? inner.trim() : "";
  return asText.startsWith("-") || asText.endsWith("-");
}

function looksTransactional(o: unknown): boolean {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  const keys = Object.keys(o);
  return DATE_KEYS.some((k) => keys.includes(k)) && AMOUNT_KEYS.some((k) => keys.includes(k));
}

function collectTransactionArrays(
  value: unknown,
  out: Record<string, unknown>[][],
  depth = 0,
): void {
  if (depth > 7 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 0 && looksTransactional(value[0])) out.push(value as Record<string, unknown>[]);
    return;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    collectTransactionArrays(v, out, depth + 1);
  }
}

/** yyyy-mm-dd → dd-mm-yyyy. normalizeDate deja pasar el ISO sin tocarlo, y aguas abajo la ruta
 *  exige dd-mm-yyyy y rechaza el lote completo si no calza. */
function isoToDdMmYyyy(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : raw.trim();
}

export function normalizeGenericApiMovements(
  captures: unknown[],
  source: MovementSource = MOVEMENT_SOURCE.account,
): BankMovement[] {
  const movements: BankMovement[] = [];

  for (const capture of captures) {
    const arrays: Record<string, unknown>[][] = [];
    collectTransactionArrays(capture, arrays);

    for (const list of arrays) {
      for (const o of list) {
        const rawDate = pick(o, DATE_KEYS);
        const rawAmount = pick(o, AMOUNT_KEYS);
        if (typeof rawDate !== "string") continue;

        const parsed = parseAmount(rawAmount);
        if (parsed === null || parsed === 0) continue;

        // Un signo negativo en el propio valor manda: es el banco diciéndolo explícitamente.
        // El indicador solo decide cuando el número viene sin signo.
        const debit = parsed < 0 || isDebit(o, rawAmount);
        const amount = debit ? -Math.abs(parsed) : Math.abs(parsed);
        const descRaw = pick(o, DESC_KEYS);
        const balance = parseAmount(pick(o, BALANCE_KEYS)) ?? 0;

        movements.push({
          date: normalizeDate(isoToDdMmYyyy(rawDate)),
          description: typeof descRaw === "string" ? descRaw.trim() : "",
          amount,
          balance,
          source,
        });
      }
    }
  }

  return movements;
}

/** Filas que el normalizador legado descartó por monto cero o ilegible en la última pasada. */
export let skippedZeroAmount = 0;

export function normalizeSantanderCheckingApiMovements(captures: unknown[]): BankMovement[] {
  skippedZeroAmount = 0;
  const movements: BankMovement[] = [];
  for (const capture of captures) {
    const obj = capture as { movements?: SantanderCheckingApiMovement[] };
    const list = obj?.movements;
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      const digits = String(m.movementAmount ?? "").replace(/[^0-9]/g, "");
      const raw = parseInt(digits, 10);
      // CAMBIO RESPECTO A UPSTREAM: contar los descartes. Un `continue` silencioso convierte
      // "la respuesta venía vacía" en "no hay movimientos", que son cosas muy distintas.
      if (!raw || isNaN(raw)) { skippedZeroAmount++; continue; }
      const clp = raw / 100;
      const isDebit = m.chargePaymentFlag === "D" || m.movementAmount.endsWith("-");
      const amount = isDebit ? -clp : clp;
      const description = (m.observation?.trim() || m.expandedCode?.trim() || "").trim();
      let balance = 0;
      if (m.newBalance) {
        const balDigits = m.newBalance.replace(/[^0-9]/g, "");
        balance = Math.round(parseInt(balDigits, 10) / 100);
      }
      movements.push({
        date: normalizeDate(m.transactionDate),
        description,
        amount,
        balance,
        source: MOVEMENT_SOURCE.account,
      });
    }
  }
  return movements;
}

interface SantanderCcApiMovement {
  Fecha: string; // "18/01/2026"
  Comercio: string;
  Descripcion: string;
  Importe: string; // "3.990" (Chilean thousands)
  IndicadorDebeHaber: string; // "D" = debit, "H" = credit
}

export function isSaldoInicial(description: string): boolean {
  return /saldo\s+inicial/i.test(description);
}

export function normalizeSantanderUnbilledApiMovements(captures: unknown[]): BankMovement[] {
  const movements: BankMovement[] = [];
  for (const capture of captures) {
    const obj = capture as { DATA?: { MatrizMovimientos?: SantanderCcApiMovement[] } };
    const list = obj?.DATA?.MatrizMovimientos;
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      const raw = parseChileanAmount(m.Importe);
      if (!raw || isNaN(raw)) continue;
      const isDebit = m.IndicadorDebeHaber === "D";
      const amount = isDebit ? -raw : raw;
      const description = (m.Comercio?.trim() || m.Descripcion?.trim() || "").trim();
      if (isSaldoInicial(description)) continue;
      movements.push({
        date: normalizeDate(m.Fecha),
        description,
        amount,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_unbilled,
      });
    }
  }
  return movements;
}

interface SantanderBilledApiMovement {
  FechaTxs: string; // "2026-01-28"
  NombreComercio: string;
  MontoTxs: string; // "0000833685" or "50.000" (Chilean thousands, leading zeros)
  NumeroCuotas: string; // "00"
  TotalCuotas: string; // "00"
}

export function normalizeSantanderBilledApiMovements(captures: unknown[]): BankMovement[] {
  const movements: BankMovement[] = [];
  for (const capture of captures) {
    const path = (capture as Record<string, unknown>)?.DATA as Record<string, unknown> | undefined;
    const response = path?.AS_TIB_WM02_CONEstCtaNacional_Response as
      | Record<string, unknown>
      | undefined;
    const output = response?.OUTPUT as Record<string, unknown> | undefined;
    const list = output?.Matriz as SantanderBilledApiMovement[] | undefined;
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      // Strip leading zeros + dots (Chilean thousands separator), parse as integer pesos
      const cleaned = m.MontoTxs.replace(/^0+/, "").replace(/\./g, "") || "0";
      const raw = parseInt(cleaned, 10);
      if (!raw || isNaN(raw)) continue;
      if (isSaldoInicial(m.NombreComercio)) continue;
      const isPayment = m.NombreComercio.toLowerCase().includes("monto cancelado");
      const amount = isPayment ? raw : -raw;
      const totalCuotas = parseInt(m.TotalCuotas.replace(/^0+/, "") || "0", 10);
      const currentCuota = parseInt(m.NumeroCuotas.replace(/^0+/, "") || "0", 10);
      const installments =
        totalCuotas > 0
          ? `${String(currentCuota).padStart(2, "0")}/${String(totalCuotas).padStart(2, "0")}`
          : undefined;
      movements.push({
        date: normalizeDate(m.FechaTxs),
        description: m.NombreComercio,
        amount,
        balance: 0,
        source: MOVEMENT_SOURCE.credit_card_billed,
        ...(installments ? { installments } : {}),
      });
    }
  }
  return movements;
}

// Sidebar menu IDs — generated by Santander's Angular framework, may change
const SIDEBAR = {
  cuentas: "#menu-uid-0410",
  movimientos: "#menu-uid-0413",
  tarjetas: "#menu-uid-0420",
  misTc: ["#menu-uid-0421", "#menu-uid-042182"],
  maxX: 300,
};

const LOGIN_SELECTORS = {
  rutSelectors: ["#rut"],
  passwordSelectors: ["#pass"],
  rutFormat: "clean" as const,
};

const TWO_FACTOR_CONFIG = {
  timeoutEnvVar: "SANTANDER_2FA_TIMEOUT_SEC",
  frameFn: async (page: Page) => {
    const handle = await page.$("iframe#login-frame");
    return handle ? await handle.contentFrame() : null;
  },
};

// ─── Santander-specific helpers ──────────────────────────────────────

type MovementAccount = { index: number; label: string };

async function getLoginFrame(page: Page): Promise<Frame | null> {
  const handle = await page.$("iframe#login-frame");
  return handle ? await handle.contentFrame() : null;
}

async function listMovementAccounts(page: Page): Promise<MovementAccount[]> {
  return await page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll("#tabs-carousel-movs .swiper-slide"));
    const out: Array<{ index: number; label: string }> = [];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i] as HTMLElement;
      const text = slide.innerText?.replace(/\s+/g, " ").trim() || "";
      if (!text) continue;
      const typeMatch = text.match(/Cuenta\s+(Corriente|Vista)/i);
      const numberMatch = text.match(/\d(?:[\s.]\d+){3,}/);
      const type = typeMatch ? `Cuenta ${typeMatch[1]}` : "Cuenta";
      const number = numberMatch ? numberMatch[0].replace(/\s+/g, " ").trim() : `#${i + 1}`;
      out.push({ index: i, label: `${type} ${number}`.trim() });
    }
    return out;
  });
}

async function selectMovementAccount(page: Page, index: number): Promise<boolean> {
  const clicked = await page.evaluate((targetIndex: number) => {
    const byAria = document.querySelector(
      `#tabs-carousel-movs [aria-label='Go to slide ${targetIndex + 1}']`,
    ) as HTMLElement | null;
    if (byAria) { byAria.click(); return true; }

    const dots = Array.from(document.querySelectorAll("#tabs-carousel-movs .swiper-pagination-bullet"));
    if (dots[targetIndex]) { (dots[targetIndex] as HTMLElement).click(); return true; }

    const slides = Array.from(document.querySelectorAll("#tabs-carousel-movs .swiper-slide"));
    if (slides[targetIndex]) {
      const slide = slides[targetIndex] as HTMLElement;
      const clickable =
        (slide.querySelector(".container-account, .container-account-ccc, .container-image") as HTMLElement | null) ||
        slide;
      clickable.click();
      return true;
    }
    return false;
  }, index);

  if (!clicked) return false;
  await delay(1200);

  // Verify the correct slide activated
  const verify = async () =>
    page.evaluate(() => {
      const slides = Array.from(document.querySelectorAll("#tabs-carousel-movs .swiper-slide"));
      return slides.findIndex((s) => (s as HTMLElement).className.includes("swiper-slide-active"));
    });

  if ((await verify()) === index) return true;
  await delay(1800);
  return (await verify()) === index;
}

async function navigateToMovements(page: Page, debugLog: string[]): Promise<void> {
  // Try sidebar: Cuentas → Movimientos
  const cuentasClicked = await clickSidebarItem(
    page, [SIDEBAR.cuentas], ["cuentas"], SIDEBAR.maxX,
  );
  if (cuentasClicked) {
    debugLog.push("  Sidebar: Cuentas");
    await delay(2000);
  }

  const movClicked = await clickSidebarItem(
    page, [SIDEBAR.movimientos], ["movimientos"], SIDEBAR.maxX,
  );
  if (movClicked) {
    debugLog.push("  Sidebar: Movimientos");
    await delay(4500);
    return;
  }

  // Fallback: click account widget on dashboard
  const widgetSel = await clickWidget(page, [
    "#cuentas .box-product",
    "#cuentas .mat-ripple.box-product",
    "#cuentas .datos",
    "#cuentas .product-container .mat-ripple",
  ], 4500);
  if (widgetSel) {
    debugLog.push(`  Account widget: ${widgetSel}`);
    return;
  }

  // Last resort: TC movements widget
  const tcWidget = await clickWidget(page, [
    "#tarjetas-creditos .movement",
    "#tarjetas-creditos .menu-popup .movement",
    "#tarjetas-creditos .container-hover .movement",
  ], 4500);
  if (tcWidget) {
    debugLog.push(`  TC widget: ${tcWidget}`);
  } else {
    debugLog.push("  No direct movement entry point found from dashboard.");
  }
}

async function navigateToCreditCardSection(page: Page, debugLog: string[]): Promise<boolean> {
  // Open Tarjetas submenu
  const tarjetasClicked = await clickSidebarItem(
    page, [SIDEBAR.tarjetas], ["tarjetas"], SIDEBAR.maxX,
  );
  if (tarjetasClicked) {
    debugLog.push("  Tarjetas menu opened");
    await delay(1500);
  }

  // Click "Mis Tarjetas de Crédito"
  const tcClicked = await clickSidebarItem(
    page, SIDEBAR.misTc, ["mis tarjetas de crédito", "mis tarjetas de credito"], SIDEBAR.maxX,
  );
  if (tcClicked) {
    debugLog.push("  Opened 'Mis Tarjetas de Credito'");
    await delay(3500);
  }

  if (page.url().toLowerCase().includes("saldos_tc")) return true;

  // Fallback: dashboard TC widget
  const widget = await clickWidget(page, [
    "#tarjetas-creditos .movement",
    "#tarjetas-creditos .container-hover .movement",
    "#tarjetas-creditos .menu-popup .movement",
  ]);
  if (widget) {
    debugLog.push("  Opened TC from dashboard widget");
  }

  return page.url().toLowerCase().includes("saldos_tc");
}

// ─── Main scrape function ────────────────────────────────────────────

async function scrapeSantander(
  session: BrowserSession,
  options: ScraperOptions,
): Promise<ScrapeResult> {
  const { rut, password, saveScreenshots: doScreenshots, onProgress } = options;
  const { page, debugLog, screenshot: doSave } = session;
  const bank = "santander";
  const progress = onProgress || (() => {});

  // DIAGNÓSTICO (cambio respecto a upstream).
  //
  // La intercepción funciona por prefijo de URL con una ventana de 10 segundos, así que "no
  // data" puede significar dos cosas muy distintas: que el banco renombró el endpoint, o que la
  // llamada ocurre fuera de esa ventana. Sin saber cuál, arreglar la extracción es a ciegas.
  //
  // Se registran solo MÉTODO y RUTA de lo que pide la página en dominios del banco. Sin
  // cuerpos, sin query strings, sin cabeceras: nada de esto lleva datos financieros ni
  // credenciales, solo la forma del API. Se ve únicamente con --debug.
  const seenEndpoints = new Set<string>();
  let lastTransactionsRequestBody: unknown = null;

  page.on("request", (req) => {
    try {
      const u = new URL(req.url());
      if (!u.hostname.endsWith("santander.cl")) return;
      seenEndpoints.add(`${req.method()} ${u.hostname}${u.pathname}`);

      // Se guarda el cuerpo del POST de movimientos para poder describir su FORMA. Saber qué
      // campos espera es lo que permite llamar al endpoint directamente con el rango de fechas
      // que uno quiere, en vez de depender de que la UI lance la consulta sola.
      if (req.method() === "POST" && req.url().startsWith(SANTANDER_CHECKING_API_PREFIX)) {
        const raw = req.postData();
        if (raw) {
          try { lastTransactionsRequestBody = JSON.parse(raw); }
          catch { lastTransactionsRequestBody = { __noJson: raw.length }; }
        }
      }
    } catch { /* URL no parseable, se ignora */ }
  });

  // Install API interceptor before first page.goto()
  const interceptor = await createInterceptor(page, [
    { id: "santander-checking", urlPrefix: SANTANDER_CHECKING_API_PREFIX },
    { id: "santander-credit-card-unbilled", urlPrefix: SANTANDER_CC_API_PREFIX },
    { id: "santander-credit-card-billed", urlPrefix: SANTANDER_CC_BILLED_API_PREFIX },
  ]);

  // 1. Navigate
  debugLog.push("1. Navigating to Santander...");
  progress("Abriendo sitio del banco...");
  await page.goto(BANK_URL, { waitUntil: "networkidle2", timeout: 30000 });
  await delay(2000);
  await dismissBanners(page);
  await doSave(page, "01-homepage");

  // 2. Open login
  debugLog.push("2. Opening login form...");
  const loginOpened =
    (await page.$eval("#btnIngresar", (el) => {
      (el as HTMLElement).click();
      return true;
    }).catch(() => false)) ||
    (await clickByText(page, [
      "ingresar", "acceso clientes", "banco en linea", "iniciar sesión", "iniciar sesion",
    ]));

  if (!loginOpened) {
    const ss = await page.screenshot({ encoding: "base64" });
    return { success: false, bank, accounts: [], error: "No se encontró el botón de ingreso.", screenshot: ss as string, debug: debugLog.join("\n") };
  }

  await delay(3500);
  await doSave(page, "02-login");

  // Detect login iframe
  const loginFrame = await getLoginFrame(page);
  const ctx = loginFrame || page;
  if (loginFrame) {
    debugLog.push("  Login iframe detectado.");
  }

  // Wait for login inputs
  try {
    await ctx.waitForSelector("#rut", { timeout: 15000 });
    await ctx.waitForSelector("#pass", { timeout: 15000 });
  } catch {
    const ss = await page.screenshot({ encoding: "base64" });
    return { success: false, bank, accounts: [], error: "No cargaron los campos de login (#rut/#pass).", screenshot: ss as string, debug: debugLog.join("\n") };
  }

  // 3-5. Login
  debugLog.push("3. Filling RUT...");
  progress("Ingresando RUT...");
  const rutOk = await fillRut(ctx, rut, LOGIN_SELECTORS);
  if (!rutOk) {
    const ss = await page.screenshot({ encoding: "base64" });
    return { success: false, bank, accounts: [], error: "No se encontró campo de RUT.", screenshot: ss as string, debug: debugLog.join("\n") };
  }
  await delay(3500);

  debugLog.push("4. Filling password...");
  const passOk = await fillPassword(ctx, password, LOGIN_SELECTORS);
  if (!passOk) {
    const ss = await page.screenshot({ encoding: "base64" });
    return { success: false, bank, accounts: [], error: "No se encontró campo de clave.", screenshot: ss as string, debug: debugLog.join("\n") };
  }
  await delay(700);

  debugLog.push("5. Submitting login...");
  progress("Iniciando sesión...");
  await clickSubmit(ctx, page, LOGIN_SELECTORS);
  await delay(7000);
  await doSave(page, "03-post-login");

  // 2FA check
  if (await detect2FA(page, TWO_FACTOR_CONFIG)) {
    const approved = await waitFor2FA(page, debugLog, TWO_FACTOR_CONFIG);
    await doSave(page, "03b-after-2fa");
    if (!approved) {
      const ss = await page.screenshot({ encoding: "base64" });
      return { success: false, bank, accounts: [], error: "Timeout esperando aprobación de 2FA.", screenshot: ss as string, debug: debugLog.join("\n") };
    }
  }

  // Login error check
  const loginError = await detectLoginError(page, await getLoginFrame(page));
  if (loginError) {
    const ss = await page.screenshot({ encoding: "base64" });
    return { success: false, bank, accounts: [], error: `Error del banco: ${loginError}`, screenshot: ss as string, debug: debugLog.join("\n") };
  }

  debugLog.push("6. Login OK.");
  progress("Sesión iniciada correctamente");
  await closePopups(page);

  // 7. Navigate to movements
  debugLog.push("7. Navigating to movements...");
  progress("Extrayendo movimientos de cuenta...");
  await navigateToMovements(page, debugLog);
  await delay(4000);
  await doSave(page, "04-movements");

  // Multi-account handling
  const accounts = await listMovementAccounts(page);
  if (accounts.length > 0) {
    debugLog.push(`  Accounts: ${accounts.map((a) => a.label).join(" | ")}`);
  }

  let movements: BankMovement[] = [];

  // CAMBIO RESPECTO A UPSTREAM — ver ../../UPSTREAM.md
  //
  // Upstream junta TODO —las tres cuentas y la tarjeta— en un solo `accounts: [{ balance,
  // movements }]` sin label. Con tres cuentas reales eso produce una cuenta inventada que
  // mezcla movimientos de productos distintos, y los cargos de la tarjeta quedarían guardados
  // como si fueran de una cuenta corriente. Acá se conserva la separación.
  const perAccount = new Map<string, BankMovement[]>();
  const cardMovements: BankMovement[] = [];

  // Try API interception for checking account
  const checkingCaptures = await interceptor.waitFor("santander-checking", 10_000);
  if (checkingCaptures.length > 0) {
    debugLog.push(`  Checking API: ${checkingCaptures.length} response(s) captured`);
    let apiMovements = normalizeSantanderCheckingApiMovements(checkingCaptures);
    debugLog.push(
      `  Checking API movements: ${apiMovements.length}` +
      (skippedZeroAmount > 0 ? ` (${skippedZeroAmount} fila(s) descartada(s) por monto 0 o ilegible)` : ""),
    );

    if (apiMovements.length === 0) {
      // El formato de upstream no calzó. Se intenta el sobre genérico antes de rendirse al HTML.
      apiMovements = normalizeGenericApiMovements(checkingCaptures);
      debugLog.push(`  Checking API (sobre genérico): ${apiMovements.length} movement(s)`);
    }
    if (apiMovements.length === 0) {
      // Ninguno de los dos entendió la respuesta. La forma dice por qué, sin exponer datos.
      debugLog.push(`  forma de la respuesta: ${describeShape(checkingCaptures[0])}`);

      // Las CLAVES de additionalInfo, no sus valores: ahí el banco suele poner el motivo
      // ("sin movimientos para el período"), y eso distingue "vino vacío" de "no hay nada".
      const info = (checkingCaptures[0] as { additionalInfo?: Array<{ key?: string }> })?.additionalInfo;
      if (Array.isArray(info)) {
        debugLog.push(`  additionalInfo keys: ${info.map((i) => i?.key ?? "?").join(", ")}`);
      }

      // Y el CUERPO de la petición, también solo su forma: es lo que permitiría llamar al
      // endpoint directamente con un rango de fechas, en vez de pelear con la UI.
      if (lastTransactionsRequestBody !== null) {
        debugLog.push(`  forma del request: ${describeShape(lastTransactionsRequestBody)}`);
      } else {
        debugLog.push("  forma del request: no se capturó el cuerpo del POST");
      }
    }
    if (apiMovements.length > 0) {
      movements.push(...apiMovements);
    }
  }

  if (movements.length === 0) {
    debugLog.push("  Checking API: no data, falling back to HTML extraction");
    if (accounts.length <= 1) {
      movements = await paginateAndExtract(page, extractAccountMovements, debugLog);
    } else {
      for (const account of accounts) {
        const switched = await selectMovementAccount(page, account.index);
        if (!switched) {
          debugLog.push(`  Could not switch to ${account.label}`);
          continue;
        }
        const acctMovements = await paginateAndExtract(page, extractAccountMovements, debugLog);
        perAccount.set(account.label, acctMovements);
        movements.push(...acctMovements);
        debugLog.push(`  ${account.label}: ${acctMovements.length} movement(s)`);
      }
    }
  }
  movements = deduplicateMovements(movements);

  // 7b. Credit card movements
  debugLog.push("7b. Navigating to credit card movements...");
  progress("Extrayendo movimientos de tarjeta de crédito...");
  const tcReady = await navigateToCreditCardSection(page, debugLog);
  if (tcReady) {
    if (await clickTcTab(page, "movimientos por facturar")) {
      const unbilledCaptures = await interceptor.waitFor("santander-credit-card-unbilled", 10_000);
      if (unbilledCaptures.length > 0) {
        debugLog.push(`  forma TC unbilled: ${describeShape(unbilledCaptures[0])}`);
        const unbilledMovements = normalizeSantanderUnbilledApiMovements(unbilledCaptures);
        cardMovements.push(...unbilledMovements);
        debugLog.push(`  CC API (unbilled): ${unbilledMovements.length} movement(s)`);
      } else {
        debugLog.push("  CC API (unbilled): no data, falling back to HTML extraction");
        const unbilled = await extractCreditCardMovements(page, "unbilled");
        cardMovements.push(...unbilled);
        debugLog.push(`  TC por facturar: ${unbilled.length} movement(s)`);
      }
    }
    if (await clickTcTab(page, "movimientos facturados")) {
      const billedCaptures = await interceptor.waitFor("santander-credit-card-billed", 10_000);
      if (billedCaptures.length > 0) {
        debugLog.push(`  forma TC billed: ${describeShape(billedCaptures[0])}`);
        const billedMovements = normalizeSantanderBilledApiMovements(billedCaptures);
        cardMovements.push(...billedMovements);
        debugLog.push(`  CC API (billed): ${billedMovements.length} movement(s)`);
      } else {
        debugLog.push("  CC API (billed): no data, falling back to HTML extraction");
        const billed = await extractCreditCardMovements(page, "billed");
        cardMovements.push(...billed);
        debugLog.push(`  TC facturados: ${billed.length} movement(s)`);
      }
    }
  } else {
    debugLog.push("  Could not open credit card section.");
  }
  movements = deduplicateMovements(movements);

  // 8. Balance
  let balance: number | undefined;
  const withBalance = movements.find((m) => m.balance > 0);
  if (withBalance) {
    balance = withBalance.balance;
    debugLog.push(`  Balance from movements: $${balance.toLocaleString("es-CL")}`);
  }
  if (balance === undefined || balance === 0) {
    balance = await extractBalance(page);
  }

  // Volcado al final: si la extracción trajo 0, acá está la lista de lo que la página sí llamó.
  if (seenEndpoints.size > 0) {
    debugLog.push(`  endpoints vistos (${seenEndpoints.size}):`);
    for (const e of [...seenEndpoints].sort()) debugLog.push(`    ${e}`);
  }

  const totalCount = movements.length + cardMovements.length;
  debugLog.push(`8. Extracted ${movements.length} de cuenta + ${cardMovements.length} de tarjeta`);
  progress(`Listo — ${totalCount} movimientos totales`);
  debugLog.push(balance !== undefined ? `9. Balance: $${balance.toLocaleString("es-CL")}` : "9. Balance not found");

  await doSave(page, "05-final");
  const ss = doScreenshots ? ((await page.screenshot({ encoding: "base64", fullPage: true })) as string) : undefined;

  // Una cuenta por producto detectado. `extractBalance` lee UN número de la pantalla, que
  // corresponde a la cuenta seleccionada en ese momento — con varias cuentas no se puede
  // atribuir con honestidad, así que solo se adjunta cuando hay una sola. Un saldo puesto en la
  // cuenta equivocada es peor que un saldo ausente.
  const single = perAccount.size <= 1;
  const accountEntries =
    perAccount.size > 0
      ? [...perAccount.entries()].map(([label, movs]) => ({
          label,
          balance: single ? balance : undefined,
          movements: deduplicateMovements(movs),
        }))
      : [{ label: accounts[0]?.label, balance, movements }];

  return {
    success: true,
    bank,
    accounts: accountEntries,
    creditCards: cardMovements.length > 0
      ? [{ label: "Tarjeta de Crédito", movements: deduplicateMovements(cardMovements) }]
      : undefined,
    screenshot: ss,
    debug: debugLog.join("\n"),
  };
}

// ─── Export ──────────────────────────────────────────────────────────

const santander: BankScraper = {
  id: "santander",
  name: "Banco Santander",
  url: BANK_URL,
  scrape: (options) => runScraper("santander", options, {}, scrapeSantander),
};

export default santander;
