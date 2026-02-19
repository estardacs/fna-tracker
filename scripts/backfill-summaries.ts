import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { getDailyStats } from '../src/lib/data-processor.js';
import { startOfWeek, addDays, startOfMonth, startOfYear, getYear, format } from 'date-fns';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function mergeJsonSummaries(a: Record<string, any>, b: Record<string, any>): Record<string, number> {
  const result: Record<string, number> = {};
  if (a) {
    for (const [key, val] of Object.entries(a)) {
      result[key] = (result[key] || 0) + Number(val);
    }
  }
  if (b) {
    for (const [key, val] of Object.entries(b)) {
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
  keyValue: any
) {
  console.log(`Updating ${periodType} summary for ${keyValue}...`);

  const { data: dailyRows, error } = await supabase
    .from('daily_summary')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);

  if (error || !dailyRows || dailyRows.length === 0) {
    console.error(`No daily data found for ${periodType} ${keyValue}. Skipping.`);
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
      pc_app_summary: {}, mobile_app_summary: {}, games_summary: {}, books_summary: {}
  });

  const payload = {
    [keyField]: keyValue,
    ...summary,
    avg_daily_screentime_minutes: Math.round(summary.total_screentime_minutes / dailyRows.length),
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase.from(`${periodType}_summary`).upsert(payload, { onConflict: keyField });
  if (upsertError) console.error(`Error updating ${periodType} summary:`, upsertError);
}

async function runBackfill() {
  const datesToProcess = ['2026-02-18'];

  console.log("--- Starting Backfill Process (Single Day) ---");

  for (const date of datesToProcess) {
    console.log(`--- Processing date: ${date} ---`);
    
    const stats = await getDailyStats(date);

    const summaryData = {
      date: date,
      pc_total_minutes: Math.round(stats.pcTotalMinutes),
      mobile_total_minutes: Math.round(stats.mobileTotalMinutes),
      reading_minutes: Math.round(stats.readingMinutes),
      gaming_minutes: Math.round(stats.gamingMinutes),
      screentime_minutes: Math.round(stats.screenTimeMinutes),
      simultaneous_minutes: Math.round(stats.simultaneousMinutes),
      office_minutes: Math.round(stats.locationStats.officeMinutes),
      home_minutes: Math.round(stats.locationStats.homeMinutes),
      outside_minutes: Math.round(stats.locationStats.outsideMinutes),
      pc_app_summary: Object.fromEntries(stats.pcAppHistory.all.map(app => [app.name, Math.round(app.minutes)])),
      mobile_app_summary: Object.fromEntries(stats.topMobileApps.map(app => [app.name, Math.round(app.minutes)])),
      games_summary: Object.fromEntries(stats.gamesPlayedToday.map(game => [game.title, Math.round(game.timeSpentSec / 60)])),
      books_summary: Object.fromEntries(stats.booksReadToday.map(book => [book.title, Math.round(book.timeSpentSec / 60)])),
      location_breakdown: stats.locationBreakdown
    };

    console.log(`Inserting summary for ${date}...`);
    const { error } = await supabase.from('daily_summary').upsert(summaryData, { onConflict: 'date' });
    if (error) {
        console.error(`Aborting! Error inserting summary for ${date}:`, error.message);
        return;
    } else {
        console.log(`Successfully inserted summary for ${date}.`);
    }
  }

  console.log("--- Updating Aggregate Summaries ---");
  const lastDate = new Date('2026-02-18');
  
  const weekStart = startOfWeek(lastDate, { weekStartsOn: 1 });
  await updatePeriodSummary('weekly', format(weekStart, 'yyyy-MM-dd'), format(addDays(weekStart, 6), 'yyyy-MM-dd'), 'week_start_date', format(weekStart, 'yyyy-MM-dd'));

  const monthStart = startOfMonth(lastDate);
  await updatePeriodSummary('monthly', format(monthStart, 'yyyy-MM-dd'), format(addDays(startOfMonth(addDays(monthStart, 32)),-1), 'yyyy-MM-dd'), 'month_start_date', format(monthStart, 'yyyy-MM-dd'));

  const yearStart = startOfYear(lastDate);
  await updatePeriodSummary('yearly', format(yearStart, 'yyyy-MM-dd'), format(addDays(startOfYear(addDays(yearStart, 400)), -1), 'yyyy-MM-dd'), 'year', getYear(lastDate));

  console.log("--- Backfill process completed successfully ---");
}

(async () => {
    // SKIPPING CLEAR DATA for safety
    // console.log("--- Clearing Old Summary Data ---");
    
    await runBackfill();
})();
