-- ============================================================
-- Phase 2 Redesign: Normalize food_items to per-100g,
-- add fuzzy search, use_count, meal_combos
-- ============================================================

-- Enable pg_trgm for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---- 1. Normalize food_items --------------------------------
ALTER TABLE food_items
  ADD COLUMN IF NOT EXISTS calories_per_100g numeric,
  ADD COLUMN IF NOT EXISTS protein_per_100g  numeric,
  ADD COLUMN IF NOT EXISTS carbs_per_100g    numeric,
  ADD COLUMN IF NOT EXISTS fat_per_100g      numeric,
  ADD COLUMN IF NOT EXISTS fiber_per_100g    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sodium_per_100g   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sugar_per_100g    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS use_count         int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS name_normalized   text;

-- Migrate: items WITH serving_size_g → divide to per-100g
UPDATE food_items
SET
  calories_per_100g = ROUND((calories      / serving_size_g * 100)::numeric, 2),
  protein_per_100g  = ROUND((protein_g     / serving_size_g * 100)::numeric, 2),
  carbs_per_100g    = ROUND((carbs_g       / serving_size_g * 100)::numeric, 2),
  fat_per_100g      = ROUND((fat_g         / serving_size_g * 100)::numeric, 2),
  fiber_per_100g    = ROUND((COALESCE(fiber_g,  0) / serving_size_g * 100)::numeric, 2),
  sodium_per_100g   = ROUND((COALESCE(sodium_mg, 0) / serving_size_g * 100)::numeric, 2),
  sugar_per_100g    = ROUND((COALESCE(sugar_g,  0) / serving_size_g * 100)::numeric, 2)
WHERE serving_size_g IS NOT NULL AND serving_size_g > 0;

-- Migrate: items WITHOUT serving_size_g → treat existing as per-100g
UPDATE food_items
SET
  calories_per_100g = calories,
  protein_per_100g  = protein_g,
  carbs_per_100g    = carbs_g,
  fat_per_100g      = fat_g,
  fiber_per_100g    = COALESCE(fiber_g,  0),
  sodium_per_100g   = COALESCE(sodium_mg, 0),
  sugar_per_100g    = COALESCE(sugar_g,  0)
WHERE serving_size_g IS NULL OR serving_size_g = 0;

-- Ensure no NULLs remain
UPDATE food_items SET
  calories_per_100g = COALESCE(calories_per_100g, calories,   0),
  protein_per_100g  = COALESCE(protein_per_100g,  protein_g,  0),
  carbs_per_100g    = COALESCE(carbs_per_100g,    carbs_g,    0),
  fat_per_100g      = COALESCE(fat_per_100g,      fat_g,      0);

ALTER TABLE food_items
  ALTER COLUMN calories_per_100g SET NOT NULL,
  ALTER COLUMN protein_per_100g  SET NOT NULL,
  ALTER COLUMN carbs_per_100g    SET NOT NULL,
  ALTER COLUMN fat_per_100g      SET NOT NULL;

-- Normalize names: strip "(Xg)" parenthetical quantities, lowercase, collapse spaces
UPDATE food_items SET name_normalized = TRIM(
  REGEXP_REPLACE(
    LOWER(REGEXP_REPLACE(name, '\s*\(\s*\d+\.?\d*\s*g\s*\)', '', 'gi')),
    '\s+', ' ', 'g'
  )
);
UPDATE food_items SET name_normalized = LOWER(TRIM(name)) WHERE name_normalized IS NULL OR name_normalized = '';
ALTER TABLE food_items ALTER COLUMN name_normalized SET NOT NULL;

-- Fuzzy-search indexes
CREATE INDEX IF NOT EXISTS food_items_name_trgm      ON food_items USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS food_items_norm_trgm      ON food_items USING gin (name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS food_items_use_count_idx  ON food_items (use_count DESC);

-- ---- 2. Search function (used by API via .rpc()) -----------
CREATE OR REPLACE FUNCTION search_food_items(q text, lim int DEFAULT 10)
RETURNS TABLE (
  id              uuid,
  name            text,
  name_normalized text,
  brand           text,
  calories_per_100g numeric,
  protein_per_100g  numeric,
  carbs_per_100g    numeric,
  fat_per_100g      numeric,
  fiber_per_100g    numeric,
  sodium_per_100g   numeric,
  sugar_per_100g    numeric,
  serving_size_g    numeric,
  serving_label     text,
  use_count         int,
  similarity_score  real
)
LANGUAGE sql STABLE AS $$
  SELECT
    id, name, name_normalized, brand,
    calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
    fiber_per_100g, sodium_per_100g, sugar_per_100g,
    serving_size_g, serving_label, use_count,
    similarity(name_normalized, LOWER(q))::real AS similarity_score
  FROM food_items
  WHERE
    name           ILIKE '%' || q || '%'
    OR name_normalized ILIKE '%' || LOWER(q) || '%'
    OR name_normalized %  LOWER(q)
  ORDER BY
    similarity(name_normalized, LOWER(q)) DESC,
    use_count DESC
  LIMIT lim;
$$;

-- ---- 3. grams_consumed in diet_log -------------------------
ALTER TABLE diet_log ADD COLUMN IF NOT EXISTS grams_consumed numeric;

-- ---- 4. meal_combos / combo_items --------------------------
CREATE TABLE IF NOT EXISTS meal_combos (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  use_count  int         NOT NULL DEFAULT 0,
  last_used  date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS combo_items (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id       uuid    NOT NULL REFERENCES meal_combos(id) ON DELETE CASCADE,
  food_item_id   uuid    NOT NULL REFERENCES food_items(id) ON DELETE RESTRICT,
  grams_consumed numeric NOT NULL
);

ALTER TABLE meal_combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'meal_combos' AND policyname = 'anon_all') THEN
    CREATE POLICY "anon_all" ON meal_combos FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'combo_items' AND policyname = 'anon_all') THEN
    CREATE POLICY "anon_all" ON combo_items FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
