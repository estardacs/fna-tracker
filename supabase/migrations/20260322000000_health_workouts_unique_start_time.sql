-- Add unique constraint on start_time to allow upsert deduplication
ALTER TABLE health_workouts ADD CONSTRAINT health_workouts_start_time_key UNIQUE (start_time);
