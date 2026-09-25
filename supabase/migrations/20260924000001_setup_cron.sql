-- Nightly trigger for the summarize-daily Edge Function.
--
-- Replaces two broken predecessors:
--
-- 1. 20260220000000_setup_cron.sql, which was never applied and could not have worked:
--    it created only pg_net (so cron.schedule had no pg_cron) and embedded the literal
--    placeholder '<YOUR_SUMMARIZER_SECRET>'.
--
-- 2. A hand-made job named "summarize daily" (jobid 2, '0 3 * * *') that ran nightly and
--    failed every single time with 401 UNAUTHORIZED_NO_AUTH_HEADER. Its headers were
--    built as:
--        jsonb_build_object('Name', 'Authorization', 'Bearer SUMMARIZER_SECRET', '<secret>')
--    jsonb_build_object takes alternating key/value arguments, so that produced
--    {"Name": "Authorization", "Bearer SUMMARIZER_SECRET": "<secret>"} — no Authorization
--    header at all. It has been unscheduled.
--
-- Two separate credentials are required, and missing either one fails the call:
--   * Authorization: a valid JWT (the anon key). The Functions gateway rejects the
--     request before it ever reaches our code without it.
--   * X-Secret: what the function itself checks against SUMMARIZER_SECRET.
--
-- Both live in Supabase Vault so no credential lands in the repo. Create them once:
--
--   select vault.create_secret('<summarizer secret>', 'summarizer_secret');
--   select vault.create_secret('<anon key>', 'anon_key');

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('summarize-daily-job');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- 04:17 UTC ≈ 01:17 in America/Santiago (00:17 in winter), well after the previous day
-- has closed. The default pg_net timeout (5s) is far too short for a batch of days.
SELECT cron.schedule(
  'summarize-daily-job',
  '17 4 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://nyzckjinvnvqtrrfcjub.supabase.co/functions/v1/summarize-daily',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'anon_key'),
        'X-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'summarizer_secret')
      ),
      body := jsonb_build_object('maxDays', 15),
      timeout_milliseconds := 120000
    );
  $cron$
);

-- Verify afterwards. job_run_details records whether the job fired; _http_response
-- records what the function actually answered — check both, since a job can "succeed"
-- while the request it made came back 401.
--
--   select jobid, jobname, schedule, active from cron.job;
--   select status, return_message, start_time
--     from cron.job_run_details order by start_time desc limit 5;
--   select status_code, content, created
--     from net._http_response order by created desc limit 5;
