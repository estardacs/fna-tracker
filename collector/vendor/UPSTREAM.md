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

El cierre de imports de Banco de Chile, Santander y Edwards: 15 archivos.

```
src/types.ts
src/utils.ts
src/intercept.ts                      (solo santander)
src/infrastructure/browser.ts
src/infrastructure/scraper-runner.ts
src/actions/two-factor.ts
src/actions/{balance,credit-card,extraction,login,navigation,pagination}.ts
src/banks/{bchile,santander,edwards}.ts
```

Cobertura de tarjeta de crédito, que no es igual entre bancos:

| banco | cuenta | TC no facturada | TC facturada |
|---|---|---|---|
| `bchile` | sí | sí (`listaMovNoFactur`) | sí (`estadoCuentaNacional`) |
| `santander` | sí (vía `openbanking.santander.cl`) | sí (`consultaUltimosMovimientos`) | sí (`estadoCuentaNacional`, con cuotas) |
| `edwards` | sí | vía `actions/credit-card.ts` | vía `actions/credit-card.ts` |

Santander declara además `SANTANDER_2FA_TIMEOUT_SEC` y llama a `detect2FA`/`waitFor2FA`, así
que a diferencia de Banco de Chile es probable que pida aprobación en la app. Importa para
cualquier plan de correr esto desatendido.

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

Siete, todos marcados en el propio archivo:

- **`src/infrastructure/browser.ts` — el sandbox de Chrome queda encendido.** Upstream pone
  `--no-sandbox` y `--disable-setuid-sandbox` fijos en `DEFAULT_ARGS`. Acá son opt-in con
  `OBC_ALLOW_NO_SANDBOX=1`, que solo hace falta en un contenedor corriendo como root.

- **`src/utils.ts` — `findChrome` conoce Windows nativo.** Upstream solo busca en rutas de
  Linux, de macOS y en `/mnt/c/...` (o sea WSL mirando el disco de Windows). Corriendo desde
  PowerShell no encuentra nada y el error sugiere `apt install google-chrome-stable`, que en
  Windows no significa nada. Se agregan las rutas nativas, armadas desde `PROGRAMFILES`,
  `PROGRAMFILES(X86)` y `LOCALAPPDATA` en vez de un `C:` fijo. El mensaje de error de
  `browser.ts` también menciona la ruta de Windows y `--chrome=<ruta>`. Vale la pena
  ofrecerlo upstream.

- **`src/banks/bchile.ts` — la cuenta llega con nombre y máscara, y la cartola se puede
  diagnosticar.** Upstream arma `accounts: [{ balance, movements }]`, sin `label`, aunque tiene
  `descripcionLogo` y `mascara` a mano en el producto. Sin máscara la identidad de la cuenta
  tiene que derivarse de un label inventado, y dejaría de ser estable si el banco la renombra.
  `fetchAccountMovements` ahora los devuelve y el resultado los incluye.

  Se agregan además dos líneas al debug log con las claves reales y un objeto de muestra de la
  cartola. `ApiCartolaMov` es la suposición del autor sobre la forma del API del banco, así que
  si el banco renombra un campo, `monto` se lee como ausente y **el monto sale 0 en silencio**
  — que es exactamente lo que pasó en la primera corrida real: 35 movimientos, neto 0. Esas dos
  líneas convierten eso en algo visible. Solo llegan al usuario con `--debug`.

  Ojo: upstream colapsa todas las cuentas corrientes en una sola entrada de `accounts`, así que
  se toma el label de la primera. Con más de una cuenta habría que rehacer esa parte.

- **`src/banks/bchile.ts` — el saldo ya no se reporta como 0 cuando no se pudo leer.** Upstream
  busca `tipo === "CUENTA_CORRIENTE"` y si no calza deja el saldo sin definir, con un
  `catch {}` vacío que se come hasta el error; más abajo cae al `saldo` del primer movimiento de
  la cartola, que ese endpoint devuelve en `"0"`. En una Cuenta Fan el resultado es un saldo 0
  falso, indistinguible de una cuenta vacía de verdad. Ahora hay fallback a la primera cuenta en
  CLP, se registra qué camino se usó y el error deja rastro.

- **`src/banks/santander.ts` — una entrada por cuenta, la tarjeta aparte, y diagnóstico de
  endpoints.** Upstream junta las tres cuentas y la tarjeta en un solo
  `accounts: [{ balance, movements }]` sin label. Con tres cuentas reales eso fabrica una cuenta
  inventada que mezcla productos distintos, y los cargos de la tarjeta quedarían guardados como
  si fueran de una cuenta corriente. Ahora hay una entrada por producto y `creditCards` propio.

  El saldo se adjunta **solo si hay una cuenta**: `extractBalance` lee un número de la pantalla,
  que corresponde a la cuenta seleccionada en ese momento, y con varias no se puede atribuir.
  Un saldo en la cuenta equivocada es peor que un saldo ausente.

  Se agrega además un observador de `page.on("request")` que registra método y ruta de lo que la
  página pide en dominios del banco —sin cuerpos, sin query strings, sin cabeceras— porque la
  intercepción por prefijo con ventana de 10 s no distingue entre "el endpoint cambió de nombre"
  y "la llamada pasó fuera de la ventana", y sin ese dato arreglar la extracción es a ciegas.

  **Estado conocido: la extracción de movimientos de Santander está rota.** Login, listado de
  cuentas y saldo funcionan; las tres cuentas y la tarjeta devuelven 0 movimientos, tanto por
  API como por el fallback de HTML. No hay issue abierto en upstream por esto (sí #53 por
  Scotiabank). Los selectores llevan cuatro meses sin tocarse.

- **`src/banks/edwards.ts` — la tarjeta sale del arreglo de la cuenta.** Mismo defecto que
  Santander: upstream hace `movements.push(...tcPorFact)` y `movements.push(...tcFact)` sobre el
  mismo arreglo de la cuenta corriente. Además de guardar cargos de tarjeta como si fueran de
  cuenta, rompe el reemplazo del conjunto no facturado, que solo corre para cuentas de tipo
  `credit_card`: un movimiento que cambia de monto al facturarse duplicaría para siempre, sin
  nada que retire la copia anterior. Ahora va en `creditCards`.

  **Estado conocido:** los movimientos de cuenta funcionan (20 extraídos, neto plausible). Las
  pestañas de tarjeta no se encuentran, así que no se extrae nada de la TC. Edwards tampoco
  entrega label ni máscara de cuenta, así que su identidad se deriva del label genérico
  "Cuenta" — estable, pero colapsaría dos cuentas en una si alguna vez hay más de una.

- **`src/intercept.ts` — la captura también ocurre a nivel de Node.** Upstream combina
  `page.exposeFunction` con `page.evaluateOnNewDocument`. El segundo instala el wrapper de
  `fetch`/XHR en todo documento nuevo, iframes incluidos; el primero expone el callback **solo en
  el frame principal**. En la banca privada de Santander los movimientos los pide un
  micro-frontend dentro de un iframe cross-origin (`mibanco.santander.cl/.../Private_new/`), así
  que el wrapper se instala, se dispara, y llama a un `window.__obcCapture` que en ese documento
  no existe — y su `catch` lo descarta en silencio.

  El síntoma era "Checking API: no data" con el endpoint correcto respondiendo perfectamente:
  el observador de `page.on("request")` mostró
  `POST openbanking.santander.cl/account_balances_transactions_and_withholdings_retail/v1/current-accounts/transactions`,
  exactamente el prefijo que el scraper busca. Ahora se agrega un `page.on("response")`, que ve
  todas las respuestas de todos los frames sin depender de ningún binding, con una huella por
  respuesta para que los dos caminos de captura no guarden la misma dos veces — un duplicado
  exacto se convertiría aguas abajo en una transacción idéntica inventada.

  Con eso la captura funciona (`Checking API: 1 response(s) captured`), pero el normalizador
  saca 0 movimientos: asume `{ movements: [...] }` con montos en centavos, y el endpoint que el
  banco usa hoy envuelve la lista de otra forma. Se agregan dos cosas:

  `describeShape()`, que imprime nombres de campos, tipos y largos de arreglo y **nunca
  valores**, para poder ver la estructura sin exponer un movimiento real.

  `normalizeGenericApiMovements()`, que busca el arreglo de transacciones donde sea que esté y
  mapea los nombres de campo habituales, tanto de Santander como del estándar tipo Berlin Group.
  Dos decisiones importantes ahí: **`movementAmount` queda fuera a propósito**, porque viene en
  centavos y solo el normalizador legado sabe dividir por 100 — dejarlo entrar multiplicaría por
  100 un valor ya expresado en pesos, y ese error después no se distingue de un monto real. Y la
  escala se decide **por la forma del string**, no por suposición: `1.234.567` son miles,
  `18990.00` es decimal, `18.990,50` es coma decimal. Un signo negativo en el propio valor manda
  sobre el indicador `creditDebitIndicator`, porque es el banco diciéndolo explícitamente.

### Lo que el banco mide de vuelta

La lista de endpoints de Santander incluye `perdsk/seguridad/Biocatch/getScore`, un dominio
`wup-*.santander.cl` con decenas de POST, y `ruxitagentjs` (Dynatrace). O sea: biometría de
comportamiento, que perfila tecleo y mouse precisamente para detectar automatización y toma de
cuentas. No afecta la extracción hoy, pero es el dato más relevante para cualquier plan de
correr esto desatendido desde un datacenter.

## Revisión de seguridad — 2026-09-26, ampliada el 2026-09-27

La segunda pasada cubrió los 8 archivos nuevos que trajeron Santander y Edwards
(`actions/*`, `intercept.ts`, los dos bancos) con los mismos criterios: **cero** red del lado
de Node, cero escrituras a disco, cero `child_process`/`execSync`/`spawn`/`new Function`/
`require` dinámico, cero llamadas a `console.*`, y los únicos hostnames son
`banco.santander.cl`, `api-dsk.santander.cl` y `openbanking.santander.cl`. Los 24 hits de
`eval` son `page.evaluate`.

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
