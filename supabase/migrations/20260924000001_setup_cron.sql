-- Nightly trigger for the summarize-daily Edge Function.
--
-- Replaces 20260220000000_setup_cron.sql, which never worked and was never applied:
--   * it only created pg_net, so cron.schedule() failed — pg_cron was never enabled
--   * it embedded the literal placeholder '<YOUR_SUMMARIZER_SECRET>', which would
--     have returned 401 even if the job had been created
--
-- The secret is read from Supabase Vault so it never lands in the repo. Create it once
-- before applying this migration:
--
--   select vault.create_secret('<the real secret>', 'summarizer_secret');

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any previous incarnation of the job before rescheduling.
DO $$
BEGIN
  PERFORM cron.unschedule('summarize-daily-job');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 04:17 UTC ≈ 01:17 in America/Santiago (00:17 in winter). Runs well after midnight
-- local time so the previous day is fully closed before it is summarized.
SELECT cron.schedule(
  'summarize-daily-job',
  '17 4 * * *',
  $$
    SELECT net.http_post(
      url := 'https://nyzckjinvnvqtrrfcjub.supabase.co/functions/v1/summarize-daily',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'summarizer_secret')
      ),
      body := jsonb_build_object('maxDays', 15)
    );
  $$
);

-- Verify afterwards with:
--   select jobid, schedule, jobname, active from cron.job;
--   select status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 5;
--
-- That second table is what would have surfaced this failure back in March.
