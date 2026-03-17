-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Safely attempt to remove the job if it exists
DO $$
BEGIN
  PERFORM cron.unschedule('summarize-daily-job');
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore the error if the job does not exist yet
    NULL;
END $$;

-- Schedule the summarize-daily Edge Function
-- '0 4 * * *' in UTC corresponds to 1:00 AM in America/Santiago (during DST/summer time) or 12:00 AM (during winter time).
-- Replace '<YOUR_SUMMARIZER_SECRET>' with the secret string set in your environment.
SELECT cron.schedule(
  'summarize-daily-job',
  '0 4 * * *',
  $$
    SELECT net.http_post(
      url := 'https://nyzckjinvnvqtrrfcjub.supabase.co/functions/v1/summarize-daily',
      headers := '{"Authorization": "Bearer <YOUR_SUMMARIZER_SECRET>", "Content-Type": "application/json"}'::jsonb
    )
  $$
);
