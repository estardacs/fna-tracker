import { supabase } from '@/lib/supabase';
import { unstable_noStore as noStore } from 'next/cache';
import { getDietCaloriesForRange } from '@/lib/diet-processor';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, format, parseISO, addDays } from 'date-fns';

export type PeriodType = 'weekly' | 'monthly' | 'yearly';

export interface HistoryItem {
  label: string;
  dateKey: string;
  totalScreenTime: number;
  pcMinutes: number;
  mobileMinutes: number;
  readingMinutes: number;
  gamingMinutes: number;
  topApps: { name: string; minutes: number }[];
  sleepMinutes: number;
  steps: number;
  calories: number;
}

export interface HistoryPayload {
  period: PeriodType;
  dateLabel: string;
  requestDate: string; // Anchor date for stable navigation
  items: HistoryItem[];
  totals: {
    screenTime: number;
    pc: number;
    mobile: number;
    reading: number;
    gaming: number;
    // Location Context
    office: number;
    home: number;
    outside: number;
    topApps: { name: string; minutes: number }[];
    topGames: { name: string; minutes: number }[];
    topBooks: { name: string; minutes: number }[];
    totalSleepMinutes: number;
    avgSleepMinutes: number;
    totalSteps: number;
    totalCalories: number;
    avgCalories: number;
  }
}

// Helper to merge JSON summaries
function mergeSummaries(target: Record<string, number>, source: any) {
    if (!source) return;
    Object.entries(source).forEach(([key, val]) => {
        target[key] = (target[key] || 0) + Number(val);
    });
}

function toSortedArray(map: Record<string, number>, limit: number = 10) {
    return Object.entries(map)
        .map(([name, minutes]) => ({ name, minutes }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, limit);
}

export async function getHistoryData(period: PeriodType, dateStr?: string): Promise<HistoryPayload> {
  noStore();
  console.log(`[SERVER] getHistoryData called with period="${period}" date="${dateStr}"`);

  const date = dateStr ? new Date(dateStr) : new Date();

  const emptyTotals = { screenTime: 0, pc: 0, mobile: 0, reading: 0, gaming: 0, office: 0, home: 0, outside: 0, topApps: [], topGames: [], topBooks: [], totalSleepMinutes: 0, avgSleepMinutes: 0, totalSteps: 0, totalCalories: 0, avgCalories: 0 };

  if (period === 'yearly') {
    return getYearlyFromDailySummary(date);
  }

  // Weekly / Monthly — read directly from daily_summary + health tables
  const startDate = period === 'weekly' ? startOfWeek(date, { weekStartsOn: 1 }) : startOfMonth(date);
  const endDate   = period === 'weekly' ? endOfWeek(date, { weekStartsOn: 1 })   : endOfMonth(date);
  const startIso  = format(startDate, 'yyyy-MM-dd');
  const endIso    = format(endDate,   'yyyy-MM-dd');

  const [screenRes, metricsRes, sleepRes, caloriesForRange] = await Promise.all([
    supabase.from('daily_summary').select('*').gte('date', startIso).lte('date', endIso).order('date', { ascending: true }),
    supabase.from('health_daily_metrics').select('date, step_count').gte('date', startIso).lte('date', endIso),
    supabase.from('health_sleep_sessions').select('date, duration_minutes').gte('date', startIso).lte('date', endIso).gte('duration_minutes', 60),
    getDietCaloriesForRange(startIso, endIso),
  ]);

  if (screenRes.error) {
    console.error("History query error:", screenRes.error);
    return { period, dateLabel: 'Error', requestDate: date.toISOString(), items: [], totals: emptyTotals };
  }

  // Build health lookups per date
  const stepsMap = new Map<string, number>((metricsRes.data || []).map((r: any) => [r.date, r.step_count || 0]));
  const sleepMap = new Map<string, number>();
  for (const s of (sleepRes.data || []) as any[]) {
    const prev = sleepMap.get(s.date) ?? 0;
    if ((s.duration_minutes || 0) > prev) sleepMap.set(s.date, s.duration_minutes);
  }

  // Calorie lookup already built by getDietCaloriesForRange (same logic as diet page)
  const caloriesMap = caloriesForRange;

  const aggApps: Record<string, number> = {};
  const aggGames: Record<string, number> = {};
  const aggBooks: Record<string, number> = {};

  // Build a map of screen rows keyed by date for quick lookup
  const screenRowMap = new Map<string, any>((screenRes.data || []).map((r: any) => [r.date, r]));

  // Union of dates: all dates that have screen time OR diet entries
  const allDates = new Set<string>([
    ...(screenRes.data || []).map((r: any) => r.date as string),
    ...Array.from(caloriesMap.keys()),
  ]);
  const sortedDates = Array.from(allDates).sort();

  const items: HistoryItem[] = sortedDates.map((date) => {
    const row = screenRowMap.get(date);
    if (row) {
      mergeSummaries(aggApps, row.pc_app_summary);
      mergeSummaries(aggApps, row.mobile_app_summary);
      mergeSummaries(aggGames, row.games_summary);
      mergeSummaries(aggBooks, row.books_summary);
    }

    const localApps: { name: string; minutes: number }[] = [];
    if (row?.pc_app_summary) Object.entries(row.pc_app_summary).forEach(([k, v]) => localApps.push({ name: k, minutes: Number(v) }));
    if (row?.mobile_app_summary) Object.entries(row.mobile_app_summary).forEach(([k, v]) => localApps.push({ name: k, minutes: Number(v) }));

    return {
      label: date,
      dateKey: date,
      totalScreenTime: row?.screentime_minutes || 0,
      pcMinutes: row?.pc_total_minutes || 0,
      mobileMinutes: row?.mobile_total_minutes || 0,
      readingMinutes: row?.reading_minutes || 0,
      gamingMinutes: row?.gaming_minutes || 0,
      topApps: localApps.sort((a, b) => b.minutes - a.minutes).slice(0, 3),
      sleepMinutes: sleepMap.get(date) ?? 0,
      steps: stepsMap.get(date) ?? 0,
      calories: caloriesMap.get(date) ?? 0,
    };
  });

  const totals = items.reduce((acc, item) => {
    const row = screenRowMap.get(item.dateKey);
    return {
      screenTime: acc.screenTime + item.totalScreenTime,
      pc: acc.pc + item.pcMinutes,
      mobile: acc.mobile + item.mobileMinutes,
      reading: acc.reading + item.readingMinutes,
      gaming: acc.gaming + item.gamingMinutes,
      office: acc.office + (row?.office_minutes || 0),
      home:   acc.home   + (row?.home_minutes   || 0),
      outside: acc.outside + (row?.outside_minutes || 0),
      totalSleepMinutes: acc.totalSleepMinutes + item.sleepMinutes,
      totalSteps: acc.totalSteps + item.steps,
      totalCalories: acc.totalCalories + item.calories,
    };
  }, { screenTime: 0, pc: 0, mobile: 0, reading: 0, gaming: 0, office: 0, home: 0, outside: 0, totalSleepMinutes: 0, totalSteps: 0, totalCalories: 0 });

  const daysWithSleep = items.filter(i => i.sleepMinutes > 0).length;
  const avgSleepMinutes = daysWithSleep > 0 ? Math.round(totals.totalSleepMinutes / daysWithSleep) : 0;
  const daysWithCalories = items.filter(i => i.calories > 0).length;
  const avgCalories = daysWithCalories > 0 ? Math.round(totals.totalCalories / daysWithCalories) : 0;

  return {
    period,
    dateLabel: startIso,
    requestDate: date.toISOString(),
    items,
    totals: { ...totals, avgSleepMinutes, avgCalories, topApps: toSortedArray(aggApps, 10), topGames: toSortedArray(aggGames, 5), topBooks: toSortedArray(aggBooks, 5) },
  };
}

/** Yearly view: computes week-level aggregates from daily_summary on-the-fly.
 *  No dependency on weekly_summary — works even if the cron rollup never ran. */
async function getYearlyFromDailySummary(date: Date): Promise<HistoryPayload> {
  const startDate = startOfYear(date);
  const endDate   = endOfYear(date);
  const startIso  = format(startDate, 'yyyy-MM-dd');
  const endIso    = format(endDate,   'yyyy-MM-dd');

  const emptyTotals = { screenTime: 0, pc: 0, mobile: 0, reading: 0, gaming: 0, office: 0, home: 0, outside: 0, topApps: [], topGames: [], topBooks: [], totalSleepMinutes: 0, avgSleepMinutes: 0, totalSteps: 0, totalCalories: 0, avgCalories: 0 };

  const [{ data, error }, { data: stepsData }, { data: sleepData }, caloriesMapY] = await Promise.all([
    supabase.from('daily_summary').select('*').gte('date', startIso).lte('date', endIso).order('date', { ascending: true }),
    supabase.from('health_daily_metrics').select('date, step_count').gte('date', startIso).lte('date', endIso),
    supabase.from('health_sleep_sessions').select('date, duration_minutes').gte('date', startIso).lte('date', endIso).gte('duration_minutes', 60),
    getDietCaloriesForRange(startIso, endIso),
  ]);

  if (error) {
    console.error("Yearly history query error:", error);
    return { period: 'yearly', dateLabel: 'Error', requestDate: date.toISOString(), items: [], totals: emptyTotals };
  }

  const stepsMap = new Map<string, number>((stepsData || []).map((r: any) => [r.date, r.step_count || 0]));
  const sleepMapY = new Map<string, number>();
  for (const s of (sleepData || []) as any[]) {
    const prev = sleepMapY.get(s.date) ?? 0;
    if ((s.duration_minutes || 0) > prev) sleepMapY.set(s.date, s.duration_minutes);
  }

  // Group daily rows by week (Monday)
  const weekMap = new Map<string, any[]>();
  for (const row of (data || [])) {
    const d = parseISO(row.date + 'T12:00:00');
    const weekStart = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    if (!weekMap.has(weekStart)) weekMap.set(weekStart, []);
    weekMap.get(weekStart)!.push(row);
  }

  const aggApps: Record<string, number> = {};
  const aggGames: Record<string, number> = {};
  const aggBooks: Record<string, number> = {};
  let yearTotals = { screenTime: 0, pc: 0, mobile: 0, reading: 0, gaming: 0, office: 0, home: 0, outside: 0, totalSleepMinutes: 0, totalSteps: 0, totalCalories: 0 };

  const items: HistoryItem[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, rows]) => {
      const weekAggApps: Record<string, number> = {};
      let wScreen = 0, wPc = 0, wMobile = 0, wReading = 0, wGaming = 0, wSleep = 0, wSteps = 0, wCalories = 0;

      for (const row of rows) {
        wScreen    += row.screentime_minutes  || 0;
        wPc        += row.pc_total_minutes    || 0;
        wMobile    += row.mobile_total_minutes || 0;
        wReading   += row.reading_minutes     || 0;
        wGaming    += row.gaming_minutes      || 0;
        wSleep     += sleepMapY.get(row.date) ?? 0;
        wSteps     += stepsMap.get(row.date) ?? 0;
        wCalories  += caloriesMapY.get(row.date) ?? 0;
        yearTotals.office  += row.office_minutes  || 0;
        yearTotals.home    += row.home_minutes    || 0;
        yearTotals.outside += row.outside_minutes || 0;
        mergeSummaries(aggApps,  row.pc_app_summary);
        mergeSummaries(aggApps,  row.mobile_app_summary);
        mergeSummaries(aggGames, row.games_summary);
        mergeSummaries(aggBooks, row.books_summary);
        mergeSummaries(weekAggApps, row.pc_app_summary);
        mergeSummaries(weekAggApps, row.mobile_app_summary);
      }

      yearTotals.screenTime += wScreen;
      yearTotals.pc         += wPc;
      yearTotals.mobile     += wMobile;
      yearTotals.reading    += wReading;
      yearTotals.gaming     += wGaming;
      yearTotals.totalSleepMinutes += wSleep;
      yearTotals.totalSteps        += wSteps;
      yearTotals.totalCalories     += wCalories;

      return {
        label: weekStart,
        dateKey: weekStart,
        totalScreenTime: wScreen,
        pcMinutes: wPc,
        mobileMinutes: wMobile,
        readingMinutes: wReading,
        gamingMinutes: wGaming,
        topApps: toSortedArray(weekAggApps, 3),
        sleepMinutes: wSleep,
        steps: wSteps,
        calories: wCalories,
      };
    });

  const weeksWithSleep = items.filter(i => i.sleepMinutes > 0).length;
  const avgSleepMinutes = weeksWithSleep > 0 ? Math.round(yearTotals.totalSleepMinutes / weeksWithSleep) : 0;
  const weeksWithCalories = items.filter(i => i.calories > 0).length;
  const avgCalories = weeksWithCalories > 0 ? Math.round(yearTotals.totalCalories / weeksWithCalories) : 0;

  return {
    period: 'yearly',
    dateLabel: startIso,
    requestDate: date.toISOString(),
    items,
    totals: { ...yearTotals, avgSleepMinutes, avgCalories, topApps: toSortedArray(aggApps, 10), topGames: toSortedArray(aggGames, 5), topBooks: toSortedArray(aggBooks, 5) },
  };
}
