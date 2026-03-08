-- Allow food_items to be deleted even when referenced in diet_log or combo_items.
-- diet_log rows become "orphaned" (food_item_id = NULL) but are kept for history.
-- combo_items rows are deleted in cascade (the combo ingredient loses meaning without the food).

-- diet_log: change food_item_id FK from RESTRICT → SET NULL
ALTER TABLE diet_log DROP CONSTRAINT IF EXISTS diet_log_food_item_id_fkey;
ALTER TABLE diet_log
  ADD CONSTRAINT diet_log_food_item_id_fkey
  FOREIGN KEY (food_item_id) REFERENCES food_items(id) ON DELETE SET NULL;

-- combo_items: change food_item_id FK from RESTRICT → CASCADE
ALTER TABLE combo_items DROP CONSTRAINT IF EXISTS combo_items_food_item_id_fkey;
ALTER TABLE combo_items
  ADD CONSTRAINT combo_items_food_item_id_fkey
  FOREIGN KEY (food_item_id) REFERENCES food_items(id) ON DELETE CASCADE;
