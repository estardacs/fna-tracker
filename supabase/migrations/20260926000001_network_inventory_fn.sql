-- Inventory of every network ever seen, for the /admin panel.
--
-- Lives in SQL because it is a GROUP BY over ~55k metric rows, which PostgREST cannot
-- express and which would be wasteful to do in JS.
--
-- A row is keyed by gateway MAC when one is present and by SSID otherwise. The MacBook
-- sends both — a MAC it read directly and an SSID its local NETWORK_MAP translated — and
-- the MAC is the raw fact, so it wins. That also stops one Mac network from appearing
-- twice under two identities.

CREATE OR REPLACE FUNCTION get_network_inventory()
RETURNS TABLE (
  kind       text,
  value      text,
  devices    text[],
  row_count  bigint,
  first_seen date,
  last_seen  date
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT
      CASE WHEN coalesce(metadata->>'gateway_mac', '') <> '' THEN 'gateway_mac' ELSE 'ssid' END AS kind,
      coalesce(nullif(metadata->>'gateway_mac', ''), metadata->>'wifi_ssid') AS value,
      device_id,
      created_at
    FROM metrics
    WHERE metadata ? 'wifi_ssid' OR metadata ? 'gateway_mac'
  )
  SELECT
    kind,
    value,
    array_agg(DISTINCT device_id ORDER BY device_id),
    count(*),
    min(created_at)::date,
    max(created_at)::date
  FROM base
  WHERE value IS NOT NULL AND value <> ''
  GROUP BY kind, value
  ORDER BY max(created_at) DESC;
$$;
