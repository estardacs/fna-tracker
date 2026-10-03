-- Workouts logged by chat through the MCP server, alongside the ones Health Connect sends.
--
-- Applied with `supabase db query --linked`, not `db push`: the migration history is out of
-- sync with the remote database. Idempotent so re-running it is harmless.

-- ---------------------------------------------------------------- 1. provenance
-- Every existing row, and every row /api/track/health keeps sending (it never sets source),
-- came from Health Connect, so that is the default. Only the MCP writes 'manual'.
ALTER TABLE health_workouts
  ADD COLUMN IF NOT EXISTS source    text NOT NULL DEFAULT 'health_connect'
    CHECK (source IN ('health_connect', 'manual')),
  ADD COLUMN IF NOT EXISTS intensity text CHECK (intensity IN ('low', 'medium', 'high')),
  -- The MET actually used, so a logged calorie figure can always be traced back to its input.
  ADD COLUMN IF NOT EXISTS met       numeric,
  ADD COLUMN IF NOT EXISTS notes     text;

-- ---------------------------------------------------------------- 2. correcting mistakes
-- The table only allowed INSERT and SELECT. Deleting is limited to manual rows in the
-- database itself: a Health Connect row would simply be upserted back on the next sync.
DROP POLICY IF EXISTS "Allow anon delete manual" ON health_workouts;
CREATE POLICY "Allow anon delete manual" ON health_workouts
  FOR DELETE USING (source = 'manual');

-- ---------------------------------------------------------------- 3. sedentary baseline
-- Logged exercise is now added to the day's expenditure. A 1.3 factor already assumes some
-- daily activity, so keeping it would count that activity twice. 1.2 is the sedentary
-- baseline; the TDEE is recomputed with Mifflin-St Jeor from the latest weigh-in.
UPDATE diet_goals g SET
  activity_factor = 1.2,
  tdee_calories = round(1.2 * (
    10 * w.weight_kg + 6.25 * g.height_cm
    - 5 * (extract(year FROM now() AT TIME ZONE 'America/Santiago') - g.birth_year)
    + CASE WHEN g.sex = 'M' THEN 5 ELSE -161 END
  ))
FROM (SELECT weight_kg FROM health_weight_log ORDER BY date DESC LIMIT 1) w
WHERE g.id = 1;
