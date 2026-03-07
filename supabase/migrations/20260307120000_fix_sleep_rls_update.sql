-- Fix: health_sleep_sessions had no UPDATE policy.
-- The upsert (onConflict: 'date,start_time') does INSERT on first call,
-- then UPDATE on WorkManager retries — which RLS was blocking → HTTP 500.

CREATE POLICY "Allow anon update" ON health_sleep_sessions
  FOR UPDATE USING (true) WITH CHECK (true);
