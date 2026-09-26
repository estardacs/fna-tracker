-- Network → location mapping, moved out of code and into data.
--
-- Until now this lived hardcoded in three places: OFFICE_SSIDS and formatWifiName in
-- src/lib/data-processor.ts, a mirrored copy in the summarize-daily Edge Function, and
-- NETWORK_MAP in the MacBook's .env.local. Adding a network meant editing code and
-- deploying, and for the Mac, editing a file that is not even versioned.
--
-- Two identifier kinds, because the devices report differently:
--   ssid         — Zenbook and phone send metadata.wifi_ssid
--   gateway_mac  — macOS 14.4+ hides the SSID from unprivileged processes, so the Mac
--                  reports its default gateway's MAC instead
--
-- The four categories are fixed: daily_summary has one column per category, so a fifth
-- would need a migration plus changes to the rollups and the charts. `label` is free
-- text, so two different networks can both be `home` with distinct names.

CREATE TABLE IF NOT EXISTS network_locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL CHECK (kind IN ('ssid', 'gateway_mac')),
  value      text NOT NULL,
  category   text NOT NULL CHECK (category IN ('home', 'office', 'university', 'outside')),
  label      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

ALTER TABLE network_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON network_locations FOR ALL USING (true) WITH CHECK (true);

-- Seed reproduces the current hardcoded rules exactly, so applying this changes no
-- numbers anywhere. Any difference in a day's location breakdown after this migration
-- is a bug, not an expected effect.
--
-- The old rule matched home with ssid.includes('Depto 402'), which caught 'Depto 402 2'
-- as a side effect. This table compares for equality — more predictable — so both names
-- are seeded explicitly.
INSERT INTO network_locations (kind, value, category, label) VALUES
  ('ssid',        'Depto 402',         'home',       'Casa'),
  ('ssid',        'Depto 402 2',       'home',       'Casa'),
  ('ssid',        'Ethernet/Off',      'home',       'Casa'),
  ('ssid',        'GeCo',              'office',     'Oficina'),
  ('ssid',        'IF-Comunidad',      'office',     'Diio'),
  ('ssid',        'eduroam',           'university', 'Universidad'),
  ('ssid',        'Eduroam',           'university', 'Universidad'),
  ('gateway_mac', '2c:96:82:95:97:90', 'home',       'Casa')
ON CONFLICT (kind, value) DO NOTHING;
