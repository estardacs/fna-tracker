-- Gastos: cuentas bancarias, movimientos y saldos.
--
-- ⚠️ EXCEPCIÓN DELIBERADA A LA CONVENCIÓN DEL PROYECTO. Las otras 12 migraciones hacen
-- CREATE POLICY "anon_all" ... USING (true), que da lectura y escritura completa a la anon
-- key — la misma que viaja dentro del bundle del navegador. Para datos bancarios eso es
-- inaceptable: cualquiera que abra devtools podría leer cada transacción.
--
-- Acá el candado es el GRANT, no la RLS:
--
--   1. REVOKE ALL ... FROM anon, authenticated → PostgREST responde
--      42501 "permission denied for table", un error inequívoco y verificable con curl.
--   2. ENABLE ROW LEVEL SECURITY sin políticas → segunda capa. Por sí sola solo daría
--      200 [] (array vacío), indistinguible de "la tabla está vacía", imposible de
--      verificar, y a una política accidental de distancia de filtrarse. Por eso no basta.
--
-- service_role tiene BYPASSRLS, así que el acceso de la app pasa por
-- src/lib/supabase-admin.ts, que es server-only. NUNCA crear una política anon_all acá.
--
-- Tampoco se agregan estas tablas a la publicación supabase_realtime.
--
-- Las credenciales del banco NO existen en este esquema. No hay ninguna columna donde
-- pudieran guardarse, por diseño.
--
-- Se aplica con `supabase db query --linked` pegando este contenido: `db push` está
-- desincronizado en este proyecto. El archivo vive acá para documentar la historia.

-- ─── Cuentas ────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bank_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank          text NOT NULL CHECK (bank IN (
                  'falabella','bice','santander','edwards','scotiabank','bchile',
                  'bci','itau','bestado','cencosud','bancosecurity','mercadopago')),
  kind          text NOT NULL CHECK (kind IN (
                  'checking','savings','credit_card','line_of_credit','wallet')),
  label         text NOT NULL,
  -- Solo máscaras. El scraper entrega "****8335"; esta CHECK hace que una regresión que
  -- empiece a emitir el número completo falle el INSERT en vez de persistirlo.
  mask          text CHECK (mask IS NULL OR mask ~ '^\*{2,4}\d{3,4}$'),
  currency      text NOT NULL DEFAULT 'CLP' CHECK (currency IN ('CLP','USD','UF')),
  -- El banco no entrega ningún id de cuenta, así que la identidad estable la derivamos
  -- nosotros: sha256 de bank|kind|mask cuando hay máscara, y bank|kind|label normalizado
  -- cuando no. Se prefiere la máscara porque el banco cambia el texto del label sin avisar
  -- ("Cuenta Corriente" → "Cta Corriente") y eso crearía una cuenta huérfana por renombre.
  external_key  text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank, external_key)
);

-- ─── Corridas de sincronización ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bank_sync_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank           text NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  -- 'partial' = trajo algunas cuentas y falló en otras, o la ventana no se pudo declarar
  -- completa. Es un estado normal que la UI muestra, no una excepción: con clave dinámica
  -- y scraping de HTML, que una corrida falle es parte de la operación habitual.
  status         text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','ok','partial','failed')),
  accounts_seen  int NOT NULL DEFAULT 0,
  tx_inserted    int NOT NULL DEFAULT 0,
  tx_updated     int NOT NULL DEFAULT 0,
  tx_missing     int NOT NULL DEFAULT 0,
  -- SANITIZADO en src/lib/bank-service.ts antes de llegar acá: nunca el RUT, nunca la
  -- clave, nunca el screenshot ni el debug log del scraper.
  error          text,
  raw_result     jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- La UI pregunta "¿cuándo fue la última sincronización de este banco?" y el colector
-- pregunta lo mismo para no volver a correr antes del límite de 30 minutos.
CREATE INDEX IF NOT EXISTS bank_sync_runs_bank_started_idx
  ON bank_sync_runs (bank, started_at DESC);

-- ─── Movimientos ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bank_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  -- date y no timestamptz: el banco entrega dd-mm-yyyy, granularidad de día. Un timestamp
  -- inventaría precisión, y además new Date('2026-09-26') es medianoche UTC, o sea
  -- 2026-09-25 21:00 en Santiago: un off-by-one en cada fila para siempre.
  posted_date   date NOT NULL,
  -- numeric y nunca float. Positivo = abono, negativo = cargo (igual que BankMovement).
  amount        numeric(14,2) NOT NULL,
  currency      text NOT NULL DEFAULT 'CLP' CHECK (currency IN ('CLP','USD','UF')),
  description   text NOT NULL,
  -- MUTABLE: un movimiento pasa de credit_card_unbilled a credit_card_billed. Por eso está
  -- FUERA de dedup_key y se actualiza en el ON CONFLICT.
  source        text NOT NULL CHECK (source IN (
                  'account','credit_card_unbilled','credit_card_billed')),
  owner         text CHECK (owner IN ('titular','adicional')),
  card          text CHECK (card IS NULL OR card ~ '^\*{2,4}\d{3,4}$'),
  installments  text,
  -- MUTABLE y solo advertencia: el banco re-renderiza el saldo corriente. Sirve para un
  -- único chequeo: el delta entre filas consecutivas debería igualar amount, que es la
  -- única señal disponible de "este scrape perdió una fila".
  balance_after numeric(14,2),
  -- sha256 del subconjunto ESTABLE. Ver buildDedupKey() en src/lib/bank-service.ts.
  dedup_key     text NOT NULL,
  -- n-ésima ocurrencia de una tupla idéntica dentro del mismo (cuenta, día). Dos cafés
  -- iguales el mismo día son dos filas legítimas: occurrence 1 y 2.
  occurrence    int NOT NULL DEFAULT 1 CHECK (occurrence >= 1),
  -- Nunca se borra una fila bancaria. Es el único dato de este proyecto que no se puede
  -- regenerar: los bancos exponen 60-90 días de historia y re-scrapear cuesta un desafío
  -- de seguridad. Si una fila desaparece de una ventana declarada completa se marca acá y
  -- la UI la filtra; si reaparece, vuelve a NULL.
  missing_since  timestamptz,
  -- El movimiento original. Barato, y permite reprocesar desde acá cuando se descubra que
  -- el parser leyó mal un campo, en vez de volver al banco.
  raw            jsonb,
  first_seen_run uuid REFERENCES bank_sync_runs(id) ON DELETE SET NULL,
  last_seen_run  uuid REFERENCES bank_sync_runs(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, posted_date, dedup_key, occurrence)
);

CREATE INDEX IF NOT EXISTS bank_transactions_account_date_idx
  ON bank_transactions (account_id, posted_date DESC);
CREATE INDEX IF NOT EXISTS bank_transactions_recent_idx
  ON bank_transactions (posted_date DESC) WHERE missing_since IS NULL;

-- ─── Saldos ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bank_balance_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  sync_run_id     uuid REFERENCES bank_sync_runs(id) ON DELETE SET NULL,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  balance         numeric(14,2),
  currency        text NOT NULL DEFAULT 'CLP' CHECK (currency IN ('CLP','USD','UF')),
  -- Tarjetas de crédito. El cupo nacional viene en la moneda de la cuenta; el internacional
  -- trae su propia moneda (USD), así que van en columnas separadas en vez de forzar dos
  -- filas de bank_accounts por tarjeta.
  nat_used        numeric(14,2),
  nat_available   numeric(14,2),
  nat_total       numeric(14,2),
  intl_used       numeric(14,2),
  intl_available  numeric(14,2),
  intl_total      numeric(14,2),
  intl_currency   text CHECK (intl_currency IS NULL OR intl_currency IN ('USD','EUR')),
  billing_period      text,
  next_billing_date   date,
  next_due_date       date,
  period_expenses     numeric(14,2),
  stmt_billing_date   date,
  stmt_billed_amount  numeric(14,2),
  stmt_due_date       date,
  stmt_minimum        numeric(14,2),
  raw             jsonb
);

-- Serie temporal append-only: una fila por cuenta por corrida. Es lo que permite graficar
-- el patrimonio en el tiempo y ver la deuda de la tarjeta crecer dentro del período.
CREATE INDEX IF NOT EXISTS bank_balance_snapshots_account_captured_idx
  ON bank_balance_snapshots (account_id, captured_at DESC);

-- ─── El candado ─────────────────────────────────────────────────────────────────────

REVOKE ALL ON bank_accounts, bank_transactions, bank_balance_snapshots, bank_sync_runs
  FROM anon, authenticated;

ALTER TABLE bank_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_sync_runs         ENABLE ROW LEVEL SECURITY;
-- Sin políticas, a propósito.
