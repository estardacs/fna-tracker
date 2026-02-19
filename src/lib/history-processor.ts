import { supabase } from '@/lib/supabase';
import { unstable_noStore as noStore } from 'next/cache';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, format } from 'date-fns';

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
  
  let startDate: Date;
  let endDate: Date;
  let tableName: string;
  let dateField: string;

  // 1. Determine Range and Table
  if (period === 'weekly') {
    startDate = startOfWeek(date, { weekStartsOn: 1 });
    endDate = endOfWeek(date, { weekStartsOn: 1 });
    tableName = 'daily_summary';
    dateField = 'date';
  } else if (period === 'monthly') {
    startDate = startOfMonth(date);
    endDate = endOfMonth(date);
    tableName = 'daily_summary';
    dateField = 'date';
  } else { // yearly
    startDate = startOfYear(date);
    endDate = endOfYear(date);
    tableName = 'weekly_summary';
    dateField = 'week_start_date';
  }

  const startIso = format(startDate, 'yyyy-MM-dd');
  const endIso = format(endDate, 'yyyy-MM-dd');

  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .gte(dateField, startIso)
    .lte(dateField, endIso)
    .order(dateField, { ascending: true });

  if (error) {
    console.error("History query error:", error);
    return { 
        period, dateLabel: 'Error', requestDate: date.toISOString(), items: [], 
        totals: { screenTime: 0, pc: 0, mobile: 0, reading: 0, gaming: 0, office: 0, home: 0, outside: 0, topApps: [], topGames: [], topBooks: [] } 
    };
  }

  // 2. Map Items & Accumulate Aggregates
  const aggApps: Record<string, number> = {};
  const aggGames: Record<string, number> = {};
  const aggBooks: Record<string, number> = {};

  const items: HistoryItem[] = (data || []).map((row: any) => {
    const dKey = row[dateField];
    
    // Merge into global period aggregates
    mergeSummaries(aggApps, row.pc_app_summary);
    mergeSummaries(aggApps, row.mobile_app_summary);
    mergeSummaries(aggGames, row.games_summary);
    mergeSummaries(aggBooks, row.books_summary);

    // Extract local top apps for the item card
    const localApps: { name: string; minutes: number }[] = [];
    if (row.pc_app_summary) Object.entries(row.pc_app_summary).forEach(([k, v]) => localApps.push({ name: k, minutes: Number(v) }));
    if (row.mobile_app_summary) Object.entries(row.mobile_app_summary).forEach(([k, v]) => localApps.push({ name: k, minutes: Number(v) }));
    const topApps = localApps.sort((a, b) => b.minutes - a.minutes).slice(0, 3);

    return {
      label: dKey,
      dateKey: dKey,
      totalScreenTime: period === 'yearly' ? (row.total_screentime_minutes || 0) : (row.screentime_minutes || 0),
      pcMinutes: period === 'yearly' ? (row.total_pc_minutes || 0) : (row.pc_total_minutes || 0),
      mobileMinutes: period === 'yearly' ? (row.total_mobile_minutes || 0) : (row.mobile_total_minutes || 0),
      readingMinutes: period === 'yearly' ? (row.total_reading_minutes || 0) : (row.reading_minutes || 0),
      gamingMinutes: period === 'yearly' ? (row.total_gaming_minutes || 0) : (row.gaming_minutes || 0),
      topApps
    };
  });

  // 3. Calculate Totals
  const totals = items.reduce((acc, item, index) => {
    const row = (data || [])[index];
    
    // Location aggregation (currently only in daily_summary table)
    let office = 0, home = 0, outside = 0;
    if (tableName === 'daily_summary') {
        office = row.office_minutes || 0;
        home = row.home_minutes || 0;
        outside = row.outside_minutes || 0;
    }

    return {
        screenTime: acc.screenTime + item.totalScreenTime,
        pc: acc.pc + item.pcMinutes,
        mobile: acc.mobile + item.mobileMinutes,
        reading: acc.reading + item.readingMinutes,
        gaming: acc.gaming + item.gamingMinutes,
        office: acc.office + office,
        home: acc.home + home,
        outside: acc.outside + outside
    };
  }, { screenTime: 0, pc: 0, mobile: 0, reading: 0, gaming: 0, office: 0, home: 0, outside: 0 });

  return {
    period,
    dateLabel: startIso,
    requestDate: date.toISOString(),
    items,
    totals: {
        ...totals,
        topApps: toSortedArray(aggApps, 10),
        topGames: toSortedArray(aggGames, 5),
        topBooks: toSortedArray(aggBooks, 5)
    }
  };
}
