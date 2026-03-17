-- Add diet_meals_summary JSONB column to daily_summary
-- Stores the full meal breakdown for a day so diet data is archived alongside screen time data.
-- Format: { "desayuno": [{name, cal, prot, carbs, fat, g}], ..., "totals": {cal, prot, carbs, fat} }
ALTER TABLE daily_summary ADD COLUMN IF NOT EXISTS diet_meals_summary jsonb;
