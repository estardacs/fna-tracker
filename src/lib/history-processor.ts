import { supabase } from '@/lib/supabase';
import { unstable_noStore as noStore } from 'next/cache';
import { getDietDataForRange, type DietDaySummary } from '@/lib/diet-processor';
import { getDailyStats } from '@/lib/data-processor';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, format, parseISO, addDays } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const TIMEZONE = 'America/Santiago';

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
  steps: number | null; // null = sin fila en health_daily_metrics; 0 = fila existe pero sin pasos
  calories: number;
  topFoods: { name: string; cal: number }[];
  weightKg: number | null;
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

  // Use noon Santiago time to avoid day-boundary issues with new Date('yyyy-MM-dd') parsing as UTC midnight
  const date = dateStr
    ? toZonedTime(parseISO(dateStr + 'T12:00:00'), TIMEZONE)
    : toZonedTime(new Date(), TIMEZONE);

  const emptyTotals = { screenTime: 0, pc: 0, mobile: 0, reading: 0, gaming: 0, office: 0, home: 0, outside: 0, topApps: [], topGames: [], topBooks: [], totalSleepMinutes: 0, avgSleepMinutes: 0, totalSteps: 0, totalCalories: 0, avgCalories: 0 };

  if (period === 'yearly') {
    return getYearlyFromDailySummary(date);
  }

  // Weekly / Monthly — read directly from daily_summary + health tables
  const startDate = period === 'weekly' ? startOfWeek(date, { weekStartsOn: 1 }) : startOfMonth(date);
  const endDate   = period === 'weekly' ? endOfWeek(date, { weekStartsOn: 1 })   : endOfMonth(date);
  const startIso  = format(startDate, 'yyyy-MM-dd');
  const endIso    = format(endDate,   'yyyy-MM-dd');

  const periodStartUtc = fromZonedTime(parseISO(startIso + 'T00:00:00'), TIMEZONE).toISOString();
  const periodEndUtc   = fromZonedTime(parseISO(endIso   + 'T23:59:59'), TIMEZONE).toISOString();

  const [screenRes, metricsRes, sleepRes, dietForRange, weightRes, weightBeforeRes] = await Promise.all([
    supabase.from('daily_summary').select('*').gte('date', startIso).lte('date', endIso).order('date', { ascending: true }),
    supabase.from('health_daily_metrics').select('date, step_count').gte('date', startIso).lte('date', endIso),
    supabase.from('health_sleep_sessions').select('date, duration_minutes').gte('date', startIso).lte('date', endIso).gte('duration_minutes', 60),
    getDietDataForRange(startIso, endIso),
    supabase.from('health_weight_log').select('weight_kg, created_at').gte('created_at', periodStartUtc).lte('created_at', periodEndUtc).order('created_at', { ascending: true }),
    supabase.from('health_weight_log').select('weight_kg').lt('created_at', periodStartUtc).order('created_at', { ascending: false }).limit(1),
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
  // Weight: last reading per Santiago day, then carry-forward for days without entry
  const weightByDay = new Map<string, number>();
  for (const w of (weightRes.data || []) as any[]) {
    const dayStr = format(toZonedTime(new Date(w.created_at), TIMEZONE), 'yyyy-MM-dd');
    weightByDay.set(dayStr, w.weight_kg);
  }
  // Build carry-forward map: for each date in range, use own reading or last known
  const weightMap = new Map<string, number>();
  let lastKnownWeight: number | null = (weightBeforeRes.data?.[0]?.weight_kg) ?? null;
  for (let d = new Date(startIso + 'T12:00:00'); format(d, 'yyyy-MM-dd') <= endIso; d = addDays(d, 1)) {
    const dayStr = format(d, 'yyyy-MM-dd');
    if (weightByDay.has(dayStr)) lastKnownWeight = weightByDay.get(dayStr)!;
    if (lastKnownWeight !== null) weightMap.set(dayStr, lastKnownWeight);
  }

  const dietMap = dietForRange;
  const screenRowMap = new Map<string, any>((screenRes.data || []).map((r: any) => [r.date, r]));

  // Today's live screen time (if today is within this period)
  const todayStr = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
  const todayInRange = todayStr >= startIso && todayStr <= endIso;
  const todayStats = todayInRange ? await getDailyStats(todayStr) : null;

  // Union of ALL dates that have any data
  const allDates = new Set<string>([
    ...(screenRes.data || []).map((r: any) => r.date as string),
    ...Array.from(dietMap.keys()),
    ...Array.from(stepsMap.keys()),
    ...Array.from(sleepMap.keys()),
    ...(todayInRange ? [todayStr] : []),
  ]);
  const sortedDates = Array.from(allDates).sort();

  const aggApps: Record<string, number> = {};
  const aggGames: Record<string, number> = {};
  const aggBooks: Record<string, number> = {};

  const items: HistoryItem[] = sortedDates.map((date) => {
    const row = screenRowMap.get(date);

    // Screen time: prefer today's live stats for today, else daily_summary row
    let screenTime = 0, pcMin = 0, mobileMin = 0, readMin = 0, gameMin = 0;
    let localApps: { name: string; minutes: number }[] = [];

    if (date === todayStr && todayStats) {
      screenTime = todayStats.screenTimeMinutes;
      pcMin      = todayStats.pcTotalMinutes;
      mobileMin  = todayStats.mobileTotalMinutes;
      readMin    = todayStats.readingMinutes;
      gameMin    = todayStats.gamingMinutes;
      localApps  = todayStats.pcAppHistory.all.slice(0, 3);
    } else if (row) {
      screenTime = row.screentime_minutes || 0;
      pcMin      = row.pc_total_minutes   || 0;
      mobileMin  = row.mobile_total_minutes || 0;
      readMin    = row.reading_minutes    || 0;
      gameMin    = row.gaming_minutes     || 0;
      if (row.pc_app_summary)     Object.entries(row.pc_app_summary).forEach(([k, v]) => localApps.push({ name: k, minutes: Number(v) }));
      if (row.mobile_app_summary) Object.entries(row.mobile_app_summary).forEach(([k, v]) => localApps.push({ name: k, minutes: Number(v) }));
      mergeSummaries(aggApps,  row.pc_app_summary);
      mergeSummaries(aggApps,  row.mobile_app_summary);
      mergeSummaries(aggGames, row.games_summary);
      mergeSummaries(aggBooks, row.books_summary);
    }

    const dietDay = dietMap.get(date);
    return {
      label: date,
      dateKey: date,
      totalScreenTime: screenTime,
      pcMinutes: pcMin,
      mobileMinutes: mobileMin,
      readingMinutes: readMin,
      gamingMinutes: gameMin,
      topApps: localApps.sort((a, b) => b.minutes - a.minutes).slice(0, 3),
      sleepMinutes: sleepMap.get(date) ?? 0,
      steps: stepsMap.has(date) ? (stepsMap.get(date) ?? 0) : null,
      calories: dietDay?.calories ?? 0,
      topFoods: dietDay?.topFoods ?? [],
      weightKg: weightMap.get(date) ?? null,
    };
  });

  const totals = items.reduce((acc, item) => {
    const row = screenRowMap.get(item.dateKey);
    let officeMin = 0, homeMin = 0, outsideMin = 0;
    if (item.dateKey === todayStr && todayStats) {
      officeMin  = todayStats.locationStats.officeMinutes;
      homeMin    = todayStats.locationStats.homeMinutes;
      outsideMin = todayStats.locationStats.outsideMinutes;
    } else if (row) {
      officeMin  = row.office_minutes  || 0;
      homeMin    = row.home_minutes    || 0;
      outsideMin = row.outside_minutes || 0;
    }
    return {
      screenTime: acc.screenTime + item.totalScreenTime,
      pc: acc.pc + item.pcMinutes,
      mobile: acc.mobile + item.mobileMinutes,
      reading: acc.reading + item.readingMinutes,
      gaming: acc.gaming + item.gamingMinutes,
      office:  acc.office  + officeMin,
      home:    acc.home    + homeMin,
      outside: acc.outside + outsideMin,
      totalSleepMinutes: acc.totalSleepMinutes + item.sleepMinutes,
      totalSteps: acc.totalSteps + (item.steps ?? 0),
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
    requestDate: format(date, 'yyyy-MM-dd'),
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

  const yearStartUtc = fromZonedTime(parseISO(startIso + 'T00:00:00'), TIMEZONE).toISOString();
  const yearEndUtc   = fromZonedTime(parseISO(endIso   + 'T23:59:59'), TIMEZONE).toISOString();

  const [{ data, error }, { data: stepsData }, { data: sleepData }, dietMapY, { data: weightDataY }, { data: weightBeforeY }] = await Promise.all([
    supabase.from('daily_summary').select('*').gte('date', startIso).lte('date', endIso).order('date', { ascending: true }),
    supabase.from('health_daily_metrics').select('date, step_count').gte('date', startIso).lte('date', endIso),
    supabase.from('health_sleep_sessions').select('date, duration_minutes').gte('date', startIso).lte('date', endIso).gte('duration_minutes', 60),
    getDietDataForRange(startIso, endIso),
    supabase.from('health_weight_log').select('weight_kg, created_at').gte('created_at', yearStartUtc).lte('created_at', yearEndUtc).order('created_at', { ascending: true }),
    supabase.from('health_weight_log').select('weight_kg').lt('created_at', yearStartUtc).order('created_at', { ascending: false }).limit(1),
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
  // Weight per Santiago day with carry-forward
  const weightByDayY = new Map<string, number>();
  for (const w of (weightDataY || []) as any[]) {
    const dayStr = format(toZonedTime(new Date(w.created_at), TIMEZONE), 'yyyy-MM-dd');
    weightByDayY.set(dayStr, w.weight_kg);
  }
  const weightMapY = new Map<string, number>();
  let lastKnownWeightY: number | null = (weightBeforeY?.[0]?.weight_kg) ?? null;
  for (let d = new Date(startIso + 'T12:00:00'); format(d, 'yyyy-MM-dd') <= endIso; d = addDays(d, 1)) {
    const dayStr = format(d, 'yyyy-MM-dd');
    if (weightByDayY.has(dayStr)) lastKnownWeightY = weightByDayY.get(dayStr)!;
    if (lastKnownWeightY !== null) weightMapY.set(dayStr, lastKnownWeightY);
  }

  const screenRowMap = new Map<string, any>((data || []).map((r: any) => [r.date, r]));

  // Today's live data
  const todayStrY = format(toZonedTime(new Date(), TIMEZONE), 'yyyy-MM-dd');
  const todayInRangeY = todayStrY >= startIso && todayStrY <= endIso;
  const todayStatsY = todayInRangeY ? await getDailyStats(todayStrY) : null;

  // Union of ALL dates with any data (screen time + diet + steps + sleep + today live)
  const allYearDates = new Set<string>([
    ...(data || []).map((r: any) => r.date as string),
    ...Array.from(dietMapY.keys()),
    ...Array.from(stepsMap.keys()),
    ...Array.from(sleepMapY.keys()),
    ...(todayInRangeY ? [todayStrY] : []),
  ]);

  // Group ALL dates by week (Monday)
  const weekMap = new Map<string, string[]>();
  for (const date of allYearDates) {
    const d = parseISO(date + 'T12:00:00');
    const weekStart = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    if (!weekMap.has(weekStart)) weekMap.set(weekStart, []);
    weekMap.get(weekStart)!.push(date);
  }

  const aggApps: Record<string, number> = {};
  const aggGames: Record<string, number> = {};
  const aggBooks: Record<string, number> = {};
  let yearTotals = { screenTime: 0, pc: 0, mobile: 0, reading: 0, gaming: 0, office: 0, home: 0, outside: 0, totalSleepMinutes: 0, totalSteps: 0, totalCalories: 0 };

  const items: HistoryItem[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, dates]) => {
      const weekAggApps: Record<string, number> = {};
      let wScreen = 0, wPc = 0, wMobile = 0, wReading = 0, wGaming = 0, wSleep = 0, wSteps = 0, wCalories = 0;
      let wWeight: number | null = null;
      const weekFoodsAgg: Record<string, number> = {};

      for (const date of dates) {
        const row = screenRowMap.get(date);

        if (date === todayStrY && todayStatsY) {
          wScreen  += todayStatsY.screenTimeMinutes  || 0;
          wPc      += todayStatsY.pcTotalMinutes      || 0;
          wMobile  += todayStatsY.mobileTotalMinutes  || 0;
          wReading += todayStatsY.readingMinutes       || 0;
          wGaming  += todayStatsY.gamingMinutes        || 0;
        } else if (row) {
          wScreen  += row.screentime_minutes   || 0;
          wPc      += row.pc_total_minutes     || 0;
          wMobile  += row.mobile_total_minutes || 0;
          wReading += row.reading_minutes      || 0;
          wGaming  += row.gaming_minutes       || 0;
          yearTotals.office  += row.office_minutes  || 0;
          yearTotals.home    += row.home_minutes    || 0;
          yearTotals.outside += row.outside_minutes || 0;
          mergeSummaries(aggApps,     row.pc_app_summary);
          mergeSummaries(aggApps,     row.mobile_app_summary);
          mergeSummaries(aggGames,    row.games_summary);
          mergeSummaries(aggBooks,    row.books_summary);
          mergeSummaries(weekAggApps, row.pc_app_summary);
          mergeSummaries(weekAggApps, row.mobile_app_summary);
        }

        wSleep  += sleepMapY.get(date) ?? 0;
        wSteps  += stepsMap.get(date)  ?? 0;
        const dayDiet = dietMapY.get(date);
        wCalories += dayDiet?.calories ?? 0;
        for (const f of (dayDiet?.topFoods ?? [])) {
          weekFoodsAgg[f.name] = (weekFoodsAgg[f.name] ?? 0) + f.cal;
        }
        const dayWeight = weightMapY.get(date);
        if (dayWeight !== undefined) wWeight = dayWeight; // last reading of the week
      }

      yearTotals.screenTime        += wScreen;
      yearTotals.pc                += wPc;
      yearTotals.mobile            += wMobile;
      yearTotals.reading           += wReading;
      yearTotals.gaming            += wGaming;
      yearTotals.totalSleepMinutes += wSleep;
      yearTotals.totalSteps        += wSteps;
      yearTotals.totalCalories     += wCalories;

      const topFoodsWeek = Object.entries(weekFoodsAgg)
        .map(([name, cal]) => ({ name, cal }))
        .sort((a, b) => b.cal - a.cal)
        .slice(0, 4);

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
        steps: dates.some(d => stepsMap.has(d)) ? wSteps : null,
        calories: wCalories,
        topFoods: topFoodsWeek,
        weightKg: wWeight,
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
