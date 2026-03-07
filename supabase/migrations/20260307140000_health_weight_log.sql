CREATE TABLE health_weight_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date         date NOT NULL,
  weight_kg    numeric(5,2) NOT NULL,
  body_fat_pct numeric(5,2),
  muscle_kg    numeric(5,2),
  metadata     jsonb DEFAULT '{}'::jsonb,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX idx_weight_log_date ON health_weight_log (date DESC);

ALTER TABLE health_weight_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all" ON health_weight_log FOR ALL USING (true) WITH CHECK (true);
