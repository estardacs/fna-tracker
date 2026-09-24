/**
 * Backfill daily_summary from raw metrics, using getDailyStats() as the single source
 * of truth so the results match what the dashboard renders.
 *
 * Never deletes raw metrics — pruning is a separate, explicit step (prune-metrics.ts).
 *
 * Usage:
 *   npm run backfill -- --from=2026-03-17 --to=2026-09-23 --dry-run
 *   npm run backfill -- --from=2026-03-17 --to=2026-09-23
 *   npm run backfill -- --from=2026-03-18 --to=2026-03-18 --force   # recompute one day
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { startOfWeek, startOfMonth, startOfYear, addDays, subDays, format, parseISO, getYear } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

dotenv.config({ path: '.env.local' });

// data-processor builds its Supabase client at module scope, reading process.env as it
// loads. A static import would be hoisted above the dotenv call above, leaving that
// client with undefined credentials — so it is imported dynamically, inside run().
// This `typeof import(...)` is erased at compile time and keeps full typing.
type DataProcessor = typeof import('../src/lib/data-processor.js');
type Stats = Awaited<ReturnType<DataProcessor['getDailyStats']>>;

const TIMEZONE = 'America/Santiago';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ---------------------------------------------------------------- args

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const from = getArg('from');
const to = getArg('to');
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
  console.error('Usage: npm run backfill -- --from=yyyy-MM-dd --to=yyyy-MM-dd [--dry-run] [--force]');
  process.exit(1);
}
if (from > to) {
  console.error(`Invalid range: --from=${from} is after --to=${to}`);
  process.exit(1);
}

// Today is still accumulating data; summarizing it would freeze a partial day.
const todayStr = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
if (to >= todayStr) {
  console.error(`--to must be before today (${todayStr}). Today's data is still accumulating.`);
  process.exit(1);
}

// ---------------------------------------------------------------- period rollups

function mergeJsonSummaries(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const source of [a, b]) {
    if (!source) continue;
    for (const [key, val] of Object.entries(source)) {
      result[key] = (result[key] || 0) + Number(val);
    }
  }
  return result;
}

async function updatePeriodSummary(
  periodType: 'weekly' | 'monthly' | 'yearly',
  startDate: string,
  endDate: string,
  keyField: string,
  keyValue: string | number
) {
  const { data: dailyRows, error } = await supabase
    .from('daily_summary')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);

  if (error || !dailyRows || dailyRows.length === 0) {
    console.warn(`  ! no daily rows for ${periodType} ${keyValue} — skipped`);
    return;
  }

  const summary = dailyRows.reduce((acc, day) => ({
    total_screentime_minutes: acc.total_screentime_minutes + (day.screentime_minutes || 0),
    total_pc_minutes: acc.total_pc_minutes + (day.pc_total_minutes || 0),
    total_mobile_minutes: acc.total_mobile_minutes + (day.mobile_total_minutes || 0),
    total_reading_minutes: acc.total_reading_minutes + (day.reading_minutes || 0),
    total_gaming_minutes: acc.total_gaming_minutes + (day.gaming_minutes || 0),
    pc_app_summary: mergeJsonSummaries(acc.pc_app_summary, day.pc_app_summary),
    mobile_app_summary: mergeJsonSummaries(acc.mobile_app_summary, day.mobile_app_summary),
    games_summary: mergeJsonSummaries(acc.games_summary, day.games_summary),
    books_summary: mergeJsonSummaries(acc.books_summary, day.books_summary),
  }), {
    total_screentime_minutes: 0, total_pc_minutes: 0, total_mobile_minutes: 0,
    total_reading_minutes: 0, total_gaming_minutes: 0,
    pc_app_summary: {}, mobile_app_summary: {}, games_summary: {}, books_summary: {},
  });

  const payload = {
    [keyField]: keyValue,
    ...summary,
    avg_daily_screentime_minutes: Math.round(summary.total_screentime_minutes / dailyRows.length),
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase.from(`${periodType}_summary`).upsert(payload, { onConflict: keyField });
  if (upsertError) console.error(`  ! ${periodType} ${keyValue}: ${upsertError.message}`);
}

// ---------------------------------------------------------------- main

function buildSummaryRow(date: string, stats: Stats) {
  return {
    date,
    pc_total_minutes: Math.round(stats.pcTotalMinutes),
    mobile_total_minutes: Math.round(stats.mobileTotalMinutes),
    reading_minutes: Math.round(stats.readingMinutes),
    gaming_minutes: Math.round(stats.gamingMinutes),
    screentime_minutes: Math.round(stats.screenTimeMinutes),
    simultaneous_minutes: Math.round(stats.simultaneousMinutes),
    office_minutes: Math.round(stats.locationStats.officeMinutes),
    home_minutes: Math.round(stats.locationStats.homeMinutes),
    outside_minutes: Math.round(stats.locationStats.outsideMinutes),
    university_minutes: Math.round(stats.locationStats.universityMinutes || 0),
    pc_app_summary: Object.fromEntries(stats.pcAppHistory.all.map(a => [a.name, Math.round(a.minutes)])),
    mobile_app_summary: Object.fromEntries(stats.topMobileApps.map(a => [a.name, Math.round(a.minutes)])),
    games_summary: Object.fromEntries(stats.gamesPlayedToday.map(g => [g.title, Math.round(g.timeSpentSec / 60)])),
    books_summary: Object.fromEntries(stats.booksReadToday.map(b => [b.title, Math.round(b.timeSpentSec / 60)])),
    location_breakdown: {
      pc: stats.locationBreakdown.pc,
      mobile: stats.locationBreakdown.mobile,
    },
    activity_timeline: stats.activityTimeline.map(s => ({ hour: s.hour, pc: s.pc, mobile: s.mobile })),
    recent_events: stats.recentEvents,
  };
}

async function run() {
  const { getDailyStats } = await import('../src/lib/data-processor.js');

  const allDates: string[] = [];
  for (let d = parseISO(from + 'T12:00:00'); format(d, 'yyyy-MM-dd') <= to!; d = addDays(d, 1)) {
    allDates.push(format(d, 'yyyy-MM-dd'));
  }

  const { data: existing, error: exErr } = await supabase
    .from('daily_summary').select('date').gte('date', from).lte('date', to);
  if (exErr) {
    console.error(`Could not read daily_summary: ${exErr.message}`);
    process.exit(1);
  }
  const alreadyDone = new Set((existing || []).map((r: { date: string }) => r.date));

  // Skipping existing rows is deliberate: days summarized before the pagination fix had
  // their raw metrics partly deleted, so recomputing them now would yield worse numbers.
  const targets = force ? allDates : allDates.filter(d => !alreadyDone.has(d));

  console.log(`Range ${from} → ${to}: ${allDates.length} days, ${alreadyDone.size} already summarized.`);
  console.log(`Processing ${targets.length}${force ? ' (--force: overwriting existing)' : ''}${dryRun ? ' [DRY RUN — nothing is written]' : ''}\n`);

  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const written: string[] = [];
  const empty: string[] = [];
  const failed: string[] = [];
  let consecutiveFailures = 0;

  for (const date of targets) {
    try {
      const stats = await getDailyStats(date);
      const row = buildSummaryRow(date, stats);

      // A day with no activity at all means there were no raw metrics for it. Writing a
      // row of zeros would mask that gap, so leave it absent instead.
      if (row.screentime_minutes === 0 && row.pc_total_minutes === 0 && row.mobile_total_minutes === 0) {
        empty.push(date);
        console.log(`${date}  — no data, skipped`);
        continue;
      }

      const line = `${date}  screen ${String(row.screentime_minutes).padStart(4)}m`
        + `  pc ${String(row.pc_total_minutes).padStart(4)}`
        + `  mob ${String(row.mobile_total_minutes).padStart(4)}`
        + `  read ${String(row.reading_minutes).padStart(3)}`
        + `  game ${String(row.gaming_minutes).padStart(3)}`;

      if (dryRun) {
        console.log(`${line}   (dry run)`);
      } else {
        const { error } = await supabase.from('daily_summary').upsert(row, { onConflict: 'date' });
        if (error) throw new Error(error.message);
        console.log(line);
        written.push(date);
      }
      consecutiveFailures = 0;
    } catch (e) {
      failed.push(date);
      consecutiveFailures++;
      console.error(`${date}  ! ${e instanceof Error ? e.message : String(e)}`);
      if (consecutiveFailures >= 5) {
        console.error('\nAborting: 5 consecutive failures — something is systematically wrong.');
        break;
      }
    }
  }

  if (dryRun) {
    console.log(`\nDry run complete. ${targets.length - empty.length - failed.length} day(s) would be written.`);
    return;
  }

  if (written.length > 0) {
    console.log(`\nRolling up weekly/monthly/yearly summaries...`);
    const weeks = new Set<string>();
    const months = new Set<string>();
    const years = new Set<number>();
    for (const date of written) {
      const d = parseISO(date + 'T12:00:00');
      weeks.add(format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
      months.add(format(startOfMonth(d), 'yyyy-MM-dd'));
      years.add(getYear(d));
    }

    for (const w of weeks) {
      const start = parseISO(w + 'T12:00:00');
      await updatePeriodSummary('weekly', w, format(addDays(start, 6), 'yyyy-MM-dd'), 'week_start_date', w);
    }
    for (const m of months) {
      const start = parseISO(m + 'T12:00:00');
      const end = subDays(startOfMonth(addDays(start, 32)), 1);
      await updatePeriodSummary('monthly', m, format(end, 'yyyy-MM-dd'), 'month_start_date', m);
    }
    for (const y of years) {
      const start = startOfYear(new Date(y, 6, 1));
      const end = subDays(startOfYear(new Date(y + 1, 6, 1)), 1);
      await updatePeriodSummary('yearly', format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'), 'year', y);
    }
  }

  console.log(`\nDone. written=${written.length}  empty=${empty.length}  failed=${failed.length}`);
  if (failed.length > 0) {
    console.error(`Failed days: ${failed.join(', ')}`);
    process.exit(1);
  }
}

run().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
