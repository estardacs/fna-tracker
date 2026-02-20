-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS pg_net;

-- NOTE: pg_cron is enabled by default in Supabase via Dashboard or by default on new projects.
-- Ensure pg_cron is available if you are self-hosting.

-- Remove any existing job with the same name
SELECT cron.unschedule('summarize-daily-job');

-- Schedule the summarize-daily Edge Function
-- '0 4 * * *' in UTC corresponds to 1:00 AM in America/Santiago (during DST/summer time) or 12:00 AM (during winter time).
-- You will need to replace the URL with your project's Edge Function URL, 
-- and replace '<YOUR_SUMMARIZER_SECRET>' with the secret string set in your environment.
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
