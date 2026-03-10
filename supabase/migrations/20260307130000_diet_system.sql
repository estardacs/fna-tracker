-- 1. Personal food library
CREATE TABLE food_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  brand          text,
  calories       numeric NOT NULL,
  protein_g      numeric NOT NULL DEFAULT 0,
  carbs_g        numeric NOT NULL DEFAULT 0,
  fat_g          numeric NOT NULL DEFAULT 0,
  fiber_g        numeric DEFAULT 0,
  sodium_mg      numeric DEFAULT 0,
  sugar_g        numeric DEFAULT 0,
  serving_size_g numeric,
  serving_label  text,
  created_at     timestamptz DEFAULT now()
);

-- 2. Recipes
CREATE TABLE recipes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  servings   int DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- 3. Recipe ingredients
CREATE TABLE recipe_ingredients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id    uuid REFERENCES recipes(id) ON DELETE CASCADE,
  food_item_id uuid REFERENCES food_items(id) ON DELETE RESTRICT,
  quantity     numeric NOT NULL DEFAULT 1
);

-- 4. Daily diet log
CREATE TABLE diet_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date NOT NULL,
  meal         text NOT NULL CHECK (meal IN ('desayuno','almuerzo','once','cena','snack')),
  food_item_id uuid REFERENCES food_items(id),
  recipe_id    uuid REFERENCES recipes(id),
  quantity     numeric NOT NULL DEFAULT 1,
  calories     numeric NOT NULL,
  protein_g    numeric NOT NULL DEFAULT 0,
  carbs_g      numeric NOT NULL DEFAULT 0,
  fat_g        numeric NOT NULL DEFAULT 0,
  fiber_g      numeric DEFAULT 0,
  sodium_mg    numeric DEFAULT 0,
  sugar_g      numeric DEFAULT 0,
  logged_at    timestamptz DEFAULT now()
);

-- 5. Daily calorie goal (single-row config)
CREATE TABLE diet_goals (
  id        int PRIMARY KEY DEFAULT 1,
  calories  int NOT NULL DEFAULT 1700,
  protein_g int DEFAULT 130,
  carbs_g   int DEFAULT 170,
  fat_g     int DEFAULT 60
);
INSERT INTO diet_goals DEFAULT VALUES;

-- RLS
ALTER TABLE food_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE diet_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE diet_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON food_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON recipes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON recipe_ingredients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON diet_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON diet_goals FOR ALL USING (true) WITH CHECK (true);
