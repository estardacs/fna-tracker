# open-banking-chile — copia revisada

| | |
|---|---|
| Origen | https://github.com/kaihv/open-banking-chile |
| Licencia | MIT (ver `open-banking-chile/LICENSE`) |
| Commit | `085faafd04601ddbef016b08e63e4c42e83a4dfb` (`main`) |
| Fecha del commit | 2026-05-12 |
| Copiado el | 2026-09-26 |

## Por qué una copia y no una dependencia

**npm no publica este árbol.** El último publicado es `2.1.2`, con dependencias
`{dotenv, exceljs, googleapis, puppeteer-core}`. Este commit de GitHub declara `2.0.0` con
`{dotenv, playwright-core, puppeteer-core, xlsx}`, y el README documenta un `v3.0.0` que no
está publicado en ninguna parte. Instalar desde npm significaría ejecutar código distinto
del que se revisó, con `googleapis` adentro — una superficie enorme de OAuth y tokens sin
ningún uso acá — en el mismo proceso que las claves bancarias en vivo. Y ninguna revisión lo
arregla, porque el próximo `npm install` puede volver a cambiarlo.

Además el scraping de HTML se rompe cuando un banco rediseña su portal. Con la copia, editar
un selector es un commit normal en vez de un parche sobre `node_modules`.

## Qué se copió

Solo el cierre de imports de Banco de Chile: 6 archivos, ~50 KB.

```
src/types.ts
src/utils.ts
src/infrastructure/browser.ts
src/infrastructure/scraper-runner.ts
src/actions/two-factor.ts
src/banks/bchile.ts
```

## Qué se eliminó, y por qué

| Eliminado | Razón |
|---|---|
| `src/infrastructure/downloader.ts` | Descarga cartolas a `os.tmpdir()`. **Nada lo importa** en todo el árbol: es código muerto que escribiría datos financieros a disco. |
| Dependencia `xlsx` | Es el build de SheetJS sin mantención en npm (avisos conocidos de prototype pollution y ReDoS). Nada del árbol lo importa, y acá se envía JSON, no planillas. |
| Dependencia `googleapis`, `exceljs` | Nunca estuvieron en este commit; son de la versión de npm. Se documentan para que no vuelvan a entrar. |
| `src/cli.ts` | Lee las credenciales desde variables de entorno (`BCHILE_RUT`, `BCHILE_PASS`). Acá se piden por stdin y no se guardan. |
| `src/index.ts` | Registro de los 11 bancos. Se importa `bchile` directo. |
| `src/intercept.ts` | Intercepción de `fetch`/XHR en la página. Solo lo usa `bci`. |
| Los otros 10 bancos | Sin uso hoy. `edwards` y `santander` se traen cuando `bchile` esté verde. |
| `src/banks/scotiabank.ts` | Además de no usarse, es el único archivo del repo con `new Function(...)` (17 veces). |
| Tests, `tsup.config.ts`, `AGENTS.md`/`CLAUDE.md`/`CODEX.md`/`GEMINI.md` | Andamiaje del upstream. |

## Cambios respecto a upstream

Uno solo, marcado en el propio archivo:

- **`src/infrastructure/browser.ts` — el sandbox de Chrome queda encendido.** Upstream pone
  `--no-sandbox` y `--disable-setuid-sandbox` fijos en `DEFAULT_ARGS`. Acá son opt-in con
  `OBC_ALLOW_NO_SANDBOX=1`, que solo hace falta en un contenedor corriendo como root.

## Revisión de seguridad — 2026-09-26

Hecha sobre el árbol completo del commit antes de copiar, y antes de cualquier ejecución con
credenciales reales.

| Qué se buscó | Resultado |
|---|---|
| Destinos de red | Todos los `fetch()` de `bchile.ts` corren **dentro de `page.evaluate`**, es decir en el navegador, contra `portalpersonas.bancochile.cl` con la cookie de sesión y el token XSRF de la propia página. **Cero red del lado de Node.** Los únicos hostnames del árbol son portales de bancos más fixtures de test (`api.example.com`, `bank.cl`, `x.cl`). |
| Telemetría / analytics / reporte de errores | Ninguno. |
| Escrituras a disco | `screenshots/` (solo si `saveScreenshots`, que queda en `false`) y `downloader.ts` en `tmpdir` con modo `0700` — eliminado. Nada escribe la clave ni el RUT. |
| `child_process`, `execSync`, `spawn`, `eval` | Ninguno en todo el árbol. |
| `new Function` | Solo en `scotiabank.ts` (no copiado). |
| `require`/`import` con ruta calculada | Ninguno. |
| Args de launch de Puppeteer | **Sin `--user-data-dir`**: perfil desechable, el perfil real de Chrome y la sesión de Google del usuario nunca entran en alcance. Sin `--disable-web-security`, sin `--remote-debugging-port`. |
| `preinstall`/`postinstall` | No hay. Sí hay `prepare: npm run build`, irrelevante: se copia el fuente y nunca se instala el paquete. |
| Destino de la clave | Único. Se traza `options.password` → `runScraper` → `bchileLogin(page, rut, password, …)` → `el.type(password)` sobre los selectores de clave del banco. No hay un segundo consumidor. `debugLog` registra `"3. Filling password..."` sin el valor. |

**Salvedad conocida y aceptada:** el árbol hace anti-detección leve —
`--disable-blink-features=AutomationControlled`, user-agent fijo de Chrome 131 y
`navigator.webdriver = false`. Es inherente al enfoque, no un hallazgo.

## Cómo traer cambios de upstream

A mano, un archivo a la vez, revisando el diff:

```bash
git diff 085faafd04601ddbef016b08e63e4c42e83a4dfb..<nuevo> -- src/banks/bchile.ts
```

Actualizar el commit de esta tabla y volver a pasar la revisión sobre lo que cambió.

## puppeteer-core queda en 24.43.1, no en 25.x

`npm audit` reporta tres avisos **high** en `extract-zip`, que cuelga de
`@puppeteer/browsers` → `puppeteer-core` en todo el rango `19.8.4 - 24.43.1`. El único fix
que ofrece npm es subir a `puppeteer-core@25.12.0`. Se evaluó y **se decidió no subir**.

**El aviso no es alcanzable acá.** `extract-zip` se importa en un solo lugar,
`@puppeteer/browsers/lib/cjs/fileUtil.js`, y solo para desempacar el archivo de un navegador
descargado — con un `await import()` dinámico, así que ni se carga en el proceso. Este
colector siempre pasa `executablePath` a un Chrome ya instalado y nunca descarga nada, de
modo que esa ruta de código no se ejecuta jamás.

**Subir sí rompe algo real.** La versión 25 eliminó `clickCount` de `ClickOptions`. En
`bchile.ts:84` eso es `el.click({ clickCount: 3 })`: un triple click para seleccionar el
texto que ya está en el campo de RUT antes de escribir encima. En la 25 la opción se ignora
en silencio, el RUT se escribiría **a continuación** del contenido previo y el login fallaría.
Y los logins fallidos repetidos son justamente lo que hace que un banco bloquee la cuenta.

Se prefirió un aviso inalcanzable antes que una regresión silenciosa en el paso más frágil
del scraper. Reevaluar cuando `extract-zip` publique un fix, o si upstream migra a la 25 y
adapta ese click.
