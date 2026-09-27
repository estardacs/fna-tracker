import type { Page } from "puppeteer-core";

export interface EndpointConfig {
  /** Unique identifier used to retrieve captured data */
  id: string;
  /** URL prefix — any request whose URL starts with this string is captured */
  urlPrefix: string;
}

export interface Interceptor {
  /** Returns all captured response bodies for the given endpoint id */
  getAll(id: string): unknown[];
  /**
   * Waits until at least one response has been captured for the given endpoint id.
   * Returns the captured responses, or an empty array if the timeout is reached.
   */
  waitFor(id: string, timeoutMs?: number): Promise<unknown[]>;
}

/**
 * Installs fetch() and XMLHttpRequest interception on the page.
 *
 * Must be called BEFORE page.goto() because it uses:
 *   - page.exposeFunction  — makes a Node.js callback available as window.__obcCapture
 *   - page.evaluateOnNewDocument — installs the wrappers in every new document
 *
 * When a monitored URL is requested by the page, the response JSON is forwarded
 * to Node.js and stored keyed by endpoint id.
 */
export async function createInterceptor(
  page: Page,
  endpoints: EndpointConfig[],
): Promise<Interceptor> {
  const captures = new Map<string, unknown[]>();

  // Huella de cada respuesta ya guardada, para que la misma no entre dos veces por los dos
  // caminos de captura (el hook dentro de la página y el listener de Node). Un duplicado exacto
  // se convertiría en una segunda transacción idéntica aguas abajo, que es un dato inventado.
  const seen = new Set<string>();

  function store(id: string, data: unknown): void {
    const fingerprint = `${id}:${JSON.stringify(data)}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    const existing = captures.get(id) ?? [];
    existing.push(data);
    captures.set(id, existing);
  }

  // CAMBIO RESPECTO A UPSTREAM — ver ../../UPSTREAM.md
  //
  // Captura desde Node con page.on("response"), además del hook dentro de la página.
  //
  // El hook de abajo usa page.exposeFunction + page.evaluateOnNewDocument. El segundo instala
  // el wrapper en TODO documento nuevo, iframes incluidos, pero el primero expone el callback
  // SOLO en el frame principal. En la banca privada de Santander los movimientos los pide un
  // micro-frontend dentro de un iframe cross-origin (mibanco.santander.cl/.../Private_new/),
  // así que el wrapper se instala, se dispara, y llama a un `window.__obcCapture` que en ese
  // documento no existe — y el catch lo descarta en silencio. Resultado: "no data", con el
  // endpoint correcto respondiendo perfectamente.
  //
  // page.on("response") no tiene ese problema: ve todas las respuestas de todos los frames,
  // sin importar el origen y sin depender de ningún binding.
  page.on("response", (res) => {
    const url = res.url();
    const ep = endpoints.find((e) => url.startsWith(e.urlPrefix));
    if (!ep) return;

    // Los preflight OPTIONS y los errores no traen cuerpo útil.
    const status = res.status();
    if (status < 200 || status >= 300) return;

    void res
      .json()
      .then((data: unknown) => store(ep.id, data))
      .catch(() => { /* no era JSON, o el cuerpo ya no está disponible */ });
  });

  // Bridge: called from browser context → stores data in Node.js
  await page.exposeFunction(
    "__obcCapture",
    (id: string, dataJson: string) => {
      try {
        store(id, JSON.parse(dataJson));
      } catch {
        // Ignore malformed JSON
      }
    },
  );

  // Inject the fetch/XHR wrappers before any document loads
  await page.evaluateOnNewDocument(
    (endpointsJson: string) => {
      const eps = JSON.parse(endpointsJson) as Array<{ id: string; urlPrefix: string }>;

      function matchEndpoint(url: string): { id: string; urlPrefix: string } | undefined {
        return eps.find((e) => url.startsWith(e.urlPrefix));
      }

      function capture(id: string, data: unknown): void {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__obcCapture(id, JSON.stringify(data));
        } catch {
          // Bridge not yet ready — ignore
        }
      }

      // ── Wrap fetch ──────────────────────────────────────────────
      const originalFetch = window.fetch;
      window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
        const url =
          typeof args[0] === "string"
            ? args[0]
            : args[0] instanceof Request
              ? args[0].url
              : String(args[0]);

        const ep = matchEndpoint(url);
        const response = await originalFetch.apply(window, args);

        if (ep) {
          response
            .clone()
            .json()
            .then((data: unknown) => capture(ep.id, data))
            .catch(() => {});
        }

        return response;
      };

      // ── Wrap XHR ────────────────────────────────────────────────
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (
        method: string,
        url: string | URL,
        ...rest: [boolean?, string?, string?]
      ): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this as any).__obcEp = matchEndpoint(String(url));
        return origOpen.apply(this, [method, url, ...rest] as Parameters<typeof origOpen>);
      };

      XMLHttpRequest.prototype.send = function (
        ...args: Parameters<typeof origSend>
      ): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ep = (this as any).__obcEp as { id: string } | undefined;
        if (ep) {
          this.addEventListener("load", function (this: XMLHttpRequest) {
            try {
              const data: unknown =
                this.responseType === "json"
                  ? this.response
                  : (JSON.parse(this.responseText) as unknown);
              capture(ep.id, data);
            } catch {
              // Ignore parse errors
            }
          });
        }
        return origSend.apply(this, args);
      };
    },
    JSON.stringify(endpoints),
  );

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    getAll(id: string): unknown[] {
      return captures.get(id) ?? [];
    },

    async waitFor(id: string, timeoutMs = 10_000): Promise<unknown[]> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const data = captures.get(id);
        if (data && data.length > 0) return data;
        await sleep(200);
      }
      return captures.get(id) ?? [];
    },
  };
}
