-- De dónde viene un saldo, y por qué importa distinguirlo.
--
-- Hasta ahora todo snapshot venía del scraper. Con MercadoPago eso deja de alcanzar: su saldo
-- no sale por API (403 en el endpoint de balance, 405 en el reporte de liquidaciones) y en la
-- web va renderizado dentro del HTML, así que la única via honesta es que la persona lo anote.
--
-- Pero un saldo anotado a mano no es solo un parche. Con él, el saldo de cualquier dia se puede
-- calcular como:
--
--     saldo(t) = ultimo saldo anclado + suma de movimientos posteriores
--
-- Y cuando la persona vuelve a anclar, la diferencia entre lo calculado y lo escrito **mide si
-- el feed de movimientos está completo**. Un scraper devuelve un numero y ninguna forma de
-- saber si es correcto; esto devuelve un numero y su margen de error.
--
--   scraped  — leido del banco por el colector
--   manual   — anotado por la persona; es el ancla
--   derived  — calculado desde el ultimo ancla mas los movimientos
--
-- El default es 'scraped' para que las filas existentes queden correctamente clasificadas sin
-- tocarlas: todas vienen del colector.

ALTER TABLE bank_balance_snapshots
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'scraped'
    CHECK (source IN ('scraped', 'manual', 'derived'));

-- Nota para la persona que anota: un ancla se registra con la fecha en que se miro el saldo,
-- no la de hoy. `captured_at` ya existe y acepta ese valor.
CREATE INDEX IF NOT EXISTS bank_balance_snapshots_manual_idx
  ON bank_balance_snapshots (account_id, captured_at DESC)
  WHERE source = 'manual';
