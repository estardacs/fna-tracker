-- Freezes workout calories at the weight in force on the workout's date.
--
-- Net kcal used to be recomputed on every read from the CURRENT BMR, so each weigh-in
-- silently rewrote the exercise — and the deficit — of every past day. Now both figures are
-- stored once and never recomputed. Applied with `supabase db query --linked`.

ALTER TABLE health_workouts ADD COLUMN IF NOT EXISTS net_calories int;

-- Manual rows already store gross; net is gross minus the resting share, using the BMR that
-- was recorded in metadata when the row was logged.
UPDATE health_workouts SET
  net_calories = greatest(0, round(calories_burned - (metadata->>'bmr')::numeric / 24 * duration_seconds / 3600.0))
WHERE source = 'manual' AND net_calories IS NULL AND metadata ? 'bmr';

-- Health Connect rows without calories: medium MET of the activity (same table as
-- workout-service), BMR from the weight logged on or before the workout's date — or the
-- earliest weigh-in if none precedes it. Flagged as estimated.
WITH w AS (
  SELECT hw.id, hw.duration_seconds, hw.calories_burned,
    CASE hw.activity_type WHEN 'walking' THEN 3.5 WHEN 'cycling' THEN 6.8 WHEN 'running' THEN 8.3
      WHEN 'swimming' THEN 8.3 ELSE 4.0 END AS met,
    (10 * coalesce(
        (SELECT weight_kg FROM health_weight_log l
          WHERE l.date <= (hw.start_time AT TIME ZONE 'America/Santiago')::date
          ORDER BY l.date DESC, l.created_at DESC LIMIT 1),
        (SELECT weight_kg FROM health_weight_log ORDER BY date, created_at LIMIT 1))
      + 6.25 * g.height_cm
      - 5 * (extract(year FROM now() AT TIME ZONE 'America/Santiago') - g.birth_year)
      + CASE WHEN g.sex = 'M' THEN 5 ELSE -161 END) AS bmr
  FROM health_workouts hw, diet_goals g
  WHERE g.id = 1 AND hw.source = 'health_connect' AND hw.net_calories IS NULL
)
UPDATE health_workouts hw SET
  met = CASE WHEN hw.calories_burned IS NULL THEN w.met ELSE hw.met END,
  calories_burned = coalesce(hw.calories_burned, round(w.met * w.bmr / 24 * w.duration_seconds / 3600.0)),
  net_calories = greatest(0, round(
    coalesce(hw.calories_burned, w.met * w.bmr / 24 * w.duration_seconds / 3600.0)
    - w.bmr / 24 * w.duration_seconds / 3600.0)),
  metadata = CASE WHEN hw.calories_burned IS NULL
    THEN hw.metadata || jsonb_build_object('calories_estimated', true, 'bmr', round(w.bmr))
    ELSE hw.metadata || jsonb_build_object('bmr', round(w.bmr)) END
FROM w WHERE hw.id = w.id;
