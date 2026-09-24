-- Adds the university_minutes column that summarize-daily has been writing since the
-- v19 deploy on 2026-03-17.
--
-- The column was never created, so every upsert into daily_summary failed with
-- "Could not find the 'university_minutes' column in the schema cache". That aborted
-- processDay() before any day could be committed, which is why daily summarization
-- silently stopped on 2026-03-16 and 191 days went unsummarized.
--
-- Read paths already tolerate its absence via `|| 0`
-- (src/lib/history-processor.ts:255,261,416 and src/lib/data-processor.ts:570),
-- so university time simply reported as zero in history.

ALTER TABLE daily_summary
  ADD COLUMN IF NOT EXISTS university_minutes INTEGER NOT NULL DEFAULT 0;

-- Period rollups expose the same breakdown.
ALTER TABLE weekly_summary
  ADD COLUMN IF NOT EXISTS total_university_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE monthly_summary
  ADD COLUMN IF NOT EXISTS total_university_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE yearly_summary
  ADD COLUMN IF NOT EXISTS total_university_minutes INTEGER NOT NULL DEFAULT 0;
