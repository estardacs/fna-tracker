-- Prepares the diet schema for logging through an MCP server.
--
-- Four gaps the current schema cannot express, all required by the tracking workflow:
-- planned vs confirmed intake, where a food's numbers came from, the TDEE needed to
-- compute a deficit, and recipes divided into portions.

-- ---------------------------------------------------------------- 1. plan vs reality
-- Logging a planned day and then eating something else is the single mistake this
-- system existed to prevent, and until now every row looked equally confirmed.
-- Existing rows were entered from the UI after eating, so they default to confirmed.
ALTER TABLE diet_log
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('planned', 'confirmed'));

-- ---------------------------------------------------------------- 2. data provenance
-- 'label' = read off the physical package, 'web' = manufacturer or store listing,
-- 'estimated' = typical value pending verification. NULL means unknown, which is what
-- the 53 pre-existing items are: they were entered before this distinction existed.
ALTER TABLE food_items
  ADD COLUMN IF NOT EXISTS source text CHECK (source IN ('label', 'web', 'estimated')),
  ADD COLUMN IF NOT EXISTS verified_at date;

-- ---------------------------------------------------------------- 3. goals and TDEE
-- A calorie target alone cannot express a deficit. The body metrics are stored so TDEE
-- can be recomputed with Mifflin-St Jeor as weight drops, rather than staying frozen at
-- a value that was only correct on the day it was calculated.
ALTER TABLE diet_goals
  ADD COLUMN IF NOT EXISTS tdee_calories   int,
  ADD COLUMN IF NOT EXISTS height_cm       numeric,
  ADD COLUMN IF NOT EXISTS birth_year      int,
  ADD COLUMN IF NOT EXISTS sex             text CHECK (sex IN ('M', 'F')),
  ADD COLUMN IF NOT EXISTS activity_factor numeric DEFAULT 1.3,
  ADD COLUMN IF NOT EXISTS target_weight_kg numeric;

UPDATE diet_goals SET
  calories         = 1750,
  protein_g        = 150,
  fat_g            = 55,
  carbs_g          = 175,
  tdee_calories    = 2440,
  height_cm        = 178,
  birth_year       = 2003,   -- 23 years old as of 2026-09; adjust if the birthday has passed
  sex              = 'M',
  activity_factor  = 1.3,
  target_weight_kg = 75
WHERE id = 1;

-- ---------------------------------------------------------------- 4. recipe portions
-- meal_combos already works and the UI uses it, but it assumed one combo equals one
-- serving. A batch-cooked meal prep is one set of ingredients divided N ways, so logging
-- "one portion" must divide the totals. servings = 1 keeps existing combos identical.
ALTER TABLE meal_combos
  ADD COLUMN IF NOT EXISTS servings int NOT NULL DEFAULT 1 CHECK (servings >= 1);

-- ---------------------------------------------------------------- 5. remove dead tables
-- recipes / recipe_ingredients were created in the original diet migration and never
-- used: zero rows, zero references anywhere in src/. meal_combos superseded them.
-- diet_log.recipe_id is NULL on all 119 rows.
ALTER TABLE diet_log DROP COLUMN IF EXISTS recipe_id;
DROP TABLE IF EXISTS recipe_ingredients;
DROP TABLE IF EXISTS recipes;

-- ---------------------------------------------------------------- indexes
CREATE INDEX IF NOT EXISTS diet_log_date_idx ON diet_log (date);
CREATE INDEX IF NOT EXISTS diet_log_date_status_idx ON diet_log (date, status);
