-- Fix: health tables had SELECT restricted to authenticated role,
-- but the app uses the anon key everywhere (no auth).
-- Change SELECT policies to allow anon access (app is single-user/personal).

DROP POLICY IF EXISTS "Permitir Select Autenticado" ON health_daily_metrics;
DROP POLICY IF EXISTS "Permitir Select Autenticado" ON health_workouts;
DROP POLICY IF EXISTS "Permitir Select Autenticado" ON health_sleep_sessions;

CREATE POLICY "Allow anon select" ON health_daily_metrics FOR SELECT USING (true);
CREATE POLICY "Allow anon select" ON health_workouts FOR SELECT USING (true);
CREATE POLICY "Allow anon select" ON health_sleep_sessions FOR SELECT USING (true);

-- New table: weight log from Xiaomi scale
-- Ingested via: Báscula Xiaomi → Mi Fitness → Health Connect → MacroDroid → Supabase REST
CREATE TABLE health_weight_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  weight_kg NUMERIC(5,2) NOT NULL,
  body_fat_percent NUMERIC(5,2),
  muscle_mass_kg NUMERIC(5,2),
  bmi NUMERIC(4,1),
  metadata JSONB DEFAULT '{}'::JSONB
);

ALTER TABLE health_weight_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anon insert" ON health_weight_log FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon select" ON health_weight_log FOR SELECT USING (true);

CREATE INDEX idx_weight_created ON health_weight_log (created_at DESC);
