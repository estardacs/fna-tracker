/**
 * Deletes raw metrics for days that have already been summarized.
 *
 * Deliberately separate from the backfill and never automatic: deletion is
 * irreversible, and a bug here is how ~6 months of February–March data was lost.
 *
 * Safety rules enforced below:
 *   - a day is only touched if it has a daily_summary row
 *   - the summary must be non-trivial (a zeroed row means the day was never processed)
 *   - today and future dates are never touched
 *   - dry run is the default; --confirm is required to actually delete
 *
 * Usage:
 *   npm run prune-metrics -- --from=2026-03-17 --to=2026-09-23
 *   npm run prune-metrics -- --from=2026-03-17 --to=2026-09-23 --confirm
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { startOfDay, endOfDay, addDays, format, parseISO } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

dotenv.config({ path: '.env.local' });

const TIMEZONE = 'America/Santiago';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required to delete rows.');
  process.exit(1);
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const from = getArg('from');
const to = getArg('to');
const confirm = args.includes('--confirm');

if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
  console.error('Usage: npm run prune-metrics -- --from=yyyy-MM-dd --to=yyyy-MM-dd [--confirm]');
  process.exit(1);
}

const todayStr = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
if (to >= todayStr) {
  console.error(`--to must be before today (${todayStr}).`);
  process.exit(1);
}

function dayBoundsUtc(date: string) {
  const local = toZonedTime(parseISO(date + 'T12:00:00'), TIMEZONE);
  return {
    startUtc: fromZonedTime(startOfDay(local), TIMEZONE).toISOString(),
    endUtc: fromZonedTime(endOfDay(local), TIMEZONE).toISOString(),
  };
}

async function countMetrics(startUtc: string, endUtc: string): Promise<number> {
  const { count, error } = await supabase
    .from('metrics')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startUtc)
    .lte('created_at', endUtc);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** The 1000-row cap applies to DELETE too, so loop until a pass removes nothing. */
async function deleteAll(startUtc: string, endUtc: string): Promise<number> {
  let total = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('metrics')
      .delete()
      .gte('created_at', startUtc)
      .lte('created_at', endUtc)
      .select('id');
    if (error) throw new Error(error.message);
    const n = data?.length ?? 0;
    total += n;
    if (n === 0) break;
  }
  return total;
}

async function run() {
  const { data: summaries, error } = await supabase
    .from('daily_summary')
    .select('date, screentime_minutes, pc_total_minutes, mobile_total_minutes')
    .gte('date', from).lte('date', to);
  if (error) {
    console.error(`Could not read daily_summary: ${error.message}`);
    process.exit(1);
  }

  const safeToPrune = new Map<string, boolean>();
  for (const row of summaries || []) {
    const nonTrivial = (row.screentime_minutes || 0) > 0
      || (row.pc_total_minutes || 0) > 0
      || (row.mobile_total_minutes || 0) > 0;
    safeToPrune.set(row.date, nonTrivial);
  }

  const dates: string[] = [];
  for (let d = parseISO(from + 'T12:00:00'); format(d, 'yyyy-MM-dd') <= to!; d = addDays(d, 1)) {
    dates.push(format(d, 'yyyy-MM-dd'));
  }

  console.log(`Range ${from} → ${to}  |  ${confirm ? 'DELETING' : 'DRY RUN (use --confirm to delete)'}\n`);

  let totalRows = 0;
  let prunedDays = 0;
  const skipped: string[] = [];

  for (const date of dates) {
    const { startUtc, endUtc } = dayBoundsUtc(date);
    const rows = await countMetrics(startUtc, endUtc);
    if (rows === 0) continue;

    if (!safeToPrune.has(date)) {
      skipped.push(`${date} (no summary, ${rows} rows)`);
      continue;
    }
    if (!safeToPrune.get(date)) {
      skipped.push(`${date} (summary is all zeros, ${rows} rows)`);
      continue;
    }

    if (confirm) {
      const deleted = await deleteAll(startUtc, endUtc);
      console.log(`${date}  deleted ${deleted}`);
      totalRows += deleted;
    } else {
      console.log(`${date}  would delete ${rows}`);
      totalRows += rows;
    }
    prunedDays++;
  }

  console.log(`\n${confirm ? 'Deleted' : 'Would delete'} ${totalRows} rows across ${prunedDays} day(s).`);
  if (skipped.length > 0) {
    console.log(`\nSkipped (not safe to prune):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

run().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
