import { createClient } from '@supabase/supabase-js';
import { startOfDay, endOfDay, format, parseISO, subDays, startOfWeek, addDays, startOfMonth, startOfYear, getYear } from 'date-fns';
import { es } from 'date-fns/locale';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

// Type definitions copied from the original file for self-containment
type DashboardStats = {
  pcTotalMinutes: number;
  mobileTotalMinutes: number;
  readingMinutes: number;
  booksReadToday: { title: string; percent: number; timeSpentSec: number }[];
  activityTimeline: { hour: string; pc: number; mobile: number }[];
  pcAppHistory: { all: { name: string; minutes: number }[] };
  screenTimeMinutes: number;
  gamingMinutes: number;
  gamesPlayedToday: { title: string; timeSpentSec: number }[];
  topMobileApps: { name: string; minutes: number }[];
  locationStats: { officeMinutes: number; homeMinutes: number; outsideMinutes: number };
  locationBreakdown: { pc: { office: number; home: number; outside: number }; mobile: { office: number; home: number; outside: number } };
  simultaneousMinutes: number;
};

// Helper functions copied from the original file
const TIMEZONE = 'America/Santiago';
const cleanBookTitle = (title: string | undefined): string => {
  if (!title) return 'Desconocido';
  let clean = title.replace(/\.(epub|pdf|mobi|azw3)$/i, '');
  if (clean.toLowerCase().includes('shadow-slave') || clean.toLowerCase().includes('shadow slave')) {
    return 'Shadow Slave';
  }
  clean = clean.replace(/[-_]/g, ' ').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

// The core logic of getDailyStats, adapted to be a self-contained function
async function calculateDailyStats(supabase: any, dateStr: string): Promise<DashboardStats> {
  const targetDate = toZonedTime(parseISO(dateStr + 'T12:00:00'), TIMEZONE);
  const startSantiagoLocal = startOfDay(targetDate);
  const endSantiagoLocal = endOfDay(targetDate);
  const startUtc = fromZonedTime(startSantiagoLocal, TIMEZONE);
  const endUtc = fromZonedTime(endSantiagoLocal, TIMEZONE);
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  console.log(`[Summarizer] Calculating stats for date: ${dateStr}`);
  console.log(`[Summarizer] Query Range (UTC): ${startIso} to ${endIso}`);

  // Fetch all data for the day
  const { data: metrics, error } = await supabase
    .from('metrics')
    .select('*')
    .gte('created_at', startIso)
    .lte('created_at', endIso);

  if (error) {
    console.error('[Summarizer] Error fetching metrics:', error.message);
    throw error;
  }

  const pcData = metrics.filter((m: any) => ['windows-pc', 'Lenovo Yoga 7 Slim', 'PC Escritorio'].includes(m.device_id));
  const mobileData = metrics.filter((m: any) => m.device_id === 'oppo-5-lite');
  const readingData = metrics.filter((m: any) => m.device_id === 'moon-reader');

  console.log(`[Summarizer] Records Found: Total=${metrics.length}, PC=${pcData.length}, Mobile=${mobileData.length}, Reading=${readingData.length}`);

  // This is a simplified version of the processing logic from data-processor.ts
  // It contains the core calculations for the summary.
  const IGNORED_APPS = ['Lanzador del sistema', 'Pantalla Apagada', 'Reloj', 'Clock', 'Barra lateral inteligente'];
  const minuteSlots = new Map<string, number>();
  const allIntervals: { start: number, end: number }[] = [];

  const markSlot = (isoTime: string, durationSec: number, level: number) => {
    const startDate = toZonedTime(new Date(isoTime), TIMEZONE);
    const startMin = startDate.getHours() * 60 + startDate.getMinutes();
    const durationMin = Math.ceil(durationSec / 60);
    for (let i = 0; i < durationMin; i++) {
      const currentMin = startMin + i;
      if (currentMin >= 1440) break;
      const h = Math.floor(currentMin / 60).toString().padStart(2, '0');
      const m = (currentMin % 60).toString().padStart(2, '0');
      const key = `${h}:${m}`;
      const currentLevel = minuteSlots.get(key) || 0;
      if (level > currentLevel) minuteSlots.set(key, level);
    }
  };
  
  const getLocationType = (wifi: string | undefined): 'office' | 'home' | 'outside' => {
    if (!wifi) return 'outside';
    if (wifi === 'GeCo') return 'office';
    if (wifi.includes('Depto 402') || wifi === 'Ethernet/Off') return 'home';
    return 'outside';
  };

  const pcAppsMapAll = new Map<string, number>();
  let totalPcSeconds = 0;
  let totalGamingSeconds = 0;
  const gamesMap = new Map<string, number>();
  const locBreakdown = { pc: { office: 0, home: 0, outside: 0 }, mobile: { office: 0, home: 0, outside: 0 } };
  let rawOfficeMinutes = 0, rawHomeMinutes = 0, rawOutsideMinutes = 0;

  // PC Processing
  pcData.forEach((row: any) => {
    const priority = row.device_id === 'PC Escritorio' ? 3 : 2;
    const breakdown = row.metadata?.breakdown || {};
    let totalSecondsInBatch = 0;
    Object.entries(breakdown).forEach(([app, seconds]) => {
      const sec = Number(seconds);
      if (sec > 0 && app !== 'Idle (Inactivo)' && !IGNORED_APPS.includes(app)) {
        totalSecondsInBatch += sec;
        let cleanApp = app === 'System/Unknown' ? 'Sistema' : app;
        let isGame = false, gameTitle = '';
        if (cleanApp === 'League of Legends') { isGame = true; gameTitle = 'League of Legends'; }
        else if (cleanApp === 'Endfield') { isGame = true; gameTitle = 'Arknights: Endfield'; }

        if (isGame) {
          totalGamingSeconds += sec;
          gamesMap.set(gameTitle, (gamesMap.get(gameTitle) || 0) + sec);
        }
        const min = sec / 60;
        pcAppsMapAll.set(cleanApp, (pcAppsMapAll.get(cleanApp) || 0) + min);
      }
    });

    totalPcSeconds += totalSecondsInBatch;
    if (totalSecondsInBatch > 0) {
      markSlot(row.created_at, totalSecondsInBatch, priority);
      const sT = new Date(row.created_at).getTime();
      allIntervals.push({ start: sT, end: sT + (totalSecondsInBatch * 1000) });
    }

    const wifi = row.metadata?.wifi_ssid;
    const loc = getLocationType(wifi);
    const activeMin = totalSecondsInBatch / 60;
    if (loc === 'office') { rawOfficeMinutes += activeMin; locBreakdown.pc.office += activeMin; }
    else if (loc === 'home') { rawHomeMinutes += activeMin; locBreakdown.pc.home += activeMin; }
    else { rawOutsideMinutes += activeMin; locBreakdown.pc.outside += activeMin; }
  });

  // Mobile Processing
  let totalReadingMinutes = 0;
  const mobileAppsMap = new Map<string, number>();
  const bookTimeMap = new Map<string, number>();
  let totalMobileSeconds = 0;

  mobileData.forEach((currentEvent: any, i: number) => {
    const nextEvent = mobileData[i + 1];
    
    let durationSec = 0;
    if (nextEvent) {
      let valid = false;
      if (currentEvent.metadata?.screen_time_today && nextEvent.metadata?.screen_time_today) {
        const t1 = parseFloat(currentEvent.metadata.screen_time_today);
        const t2 = parseFloat(nextEvent.metadata.screen_time_today);
        if (!isNaN(t1) && !isNaN(t2) && t2 > t1) { durationSec = t2 - t1; valid = true; }
      }
      if (!valid) {
        durationSec = (new Date(nextEvent.created_at).getTime() - new Date(currentEvent.created_at).getTime()) / 1000;
      }
    } else {
      // For the last event of the day in a historical summary, assume a small default duration
      durationSec = 30;
    }
    if (durationSec < 0 || durationSec > 600) durationSec = 30; // Sanity check for huge gaps

    const appName = currentEvent.metadata?.app_name || 'Desconocido';
    if (!IGNORED_APPS.includes(appName) && durationSec > 5) {
      markSlot(currentEvent.created_at, durationSec, 1);
      totalMobileSeconds += durationSec;
      const sT = new Date(currentEvent.created_at).getTime();
      allIntervals.push({ start: sT, end: sT + (durationSec * 1000) });
    }

    const durationMin = durationSec / 60;
    const wifi = currentEvent.metadata?.wifi_ssid || '';
    const loc = getLocationType(wifi);
    if (loc === 'office') { rawOfficeMinutes += durationMin; locBreakdown.mobile.office += durationMin; }
    else if (loc === 'home') { rawHomeMinutes += durationMin; locBreakdown.mobile.home += durationMin; }
    else if (durationMin > 0) { rawOutsideMinutes += durationMin; locBreakdown.mobile.outside += durationMin; }

    if (!IGNORED_APPS.includes(appName)) {
      mobileAppsMap.set(appName, (mobileAppsMap.get(appName) || 0) + durationMin);
    }

    if (appName.toLowerCase().includes('moon+') || currentEvent.metadata?.package?.includes('moonreader')) {
      totalReadingMinutes += durationMin;
      const eventTime = new Date(currentEvent.created_at).getTime();
      let activeBook = 'Desconocido';
      for (const read of readingData) {
        const readTime = new Date(read.created_at).getTime();
        if (Math.abs(readTime - eventTime) < 20 * 60 * 1000) { // 20 min window
          activeBook = cleanBookTitle(read.metadata?.book_title);
          break;
        }
      }
      if (activeBook !== 'Desconocido') bookTimeMap.set(activeBook, (bookTimeMap.get(activeBook) || 0) + durationSec);
    }
  });

  const booksFinalMap = new Map<string, { title: string; percent: number; timeSpentSec: number }>();
  readingData?.forEach((row: any) => {
    const title = cleanBookTitle(row.metadata?.book_title);
    if (!booksFinalMap.has(title)) {
      booksFinalMap.set(title, { title, percent: row.value, timeSpentSec: 0 });
    }
  });
  bookTimeMap.forEach((sec, title) => {
    if (booksFinalMap.has(title)) booksFinalMap.get(title)!.timeSpentSec = sec;
    else booksFinalMap.set(title, { title, percent: 0, timeSpentSec: sec });
  });
  
  // Fallback: If we have reading time but no identified book, fetch the last one from history
  if (booksFinalMap.size === 0 && totalReadingMinutes > 0) {
    const { data: lastBookData } = await supabase
      .from('metrics')
      .select('*')
      .eq('device_id', 'moon-reader')
      .lt('created_at', startIso)
      .order('created_at', { ascending: false })
      .limit(1);

    if (lastBookData && lastBookData.length > 0) {
      const lastBook = lastBookData[0];
      const title = cleanBookTitle(lastBook.metadata?.book_title);
      booksFinalMap.set(title, { 
        title, 
        percent: lastBook.value || 0, 
        timeSpentSec: totalReadingMinutes * 60 
      });
    }
  }

  allIntervals.sort((a, b) => a.start - b.start);
  let exactDedupMs = 0;
  if (allIntervals.length > 0) {
    let current = allIntervals[0];
    for (let i = 1; i < allIntervals.length; i++) {
      const next = allIntervals[i];
      if (next.start < current.end) {
        current.end = Math.max(current.end, next.end);
      } else {
        exactDedupMs += (current.end - current.start);
        current = next;
      }
    }
    exactDedupMs += (current.end - current.start);
  }

  const simultaneousMs = ((totalPcSeconds + totalMobileSeconds) * 1000) - exactDedupMs;

  const toArray = (map: Map<string, number>) => Array.from(map.entries()).map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes);

  return {
    pcTotalMinutes: totalPcSeconds / 60,
    mobileTotalMinutes: totalMobileSeconds / 60,
    screenTimeMinutes: exactDedupMs / 1000 / 60,
    simultaneousMinutes: simultaneousMs > 0 ? simultaneousMs / 1000 / 60 : 0,
    readingMinutes: totalReadingMinutes,
    gamingMinutes: totalGamingSeconds / 60,
    gamesPlayedToday: Array.from(gamesMap.entries()).map(([title, sec]) => ({ title, timeSpentSec: sec })),
    booksReadToday: Array.from(booksFinalMap.values()),
    pcAppHistory: { all: toArray(pcAppsMapAll) },
    topMobileApps: toArray(mobileAppsMap),
    locationStats: { officeMinutes: rawOfficeMinutes, homeMinutes: rawHomeMinutes, outsideMinutes: rawOutsideMinutes },
    locationBreakdown: { pc: locBreakdown.pc, mobile: locBreakdown.mobile },
    activityTimeline: [], // Not needed for summary
  };
}

// ------------------------------------------------------------------
// AGGREGATION LOGIC
// ------------------------------------------------------------------

function mergeJsonSummaries(a: Record<string, any>, b: Record<string, any>): Record<string, number> {
  const result: Record<string, number> = {};
  // Handle 'a'
  if (a) {
    for (const [key, val] of Object.entries(a)) {
      result[key] = (result[key] || 0) + Number(val);
    }
  }
  // Handle 'b'
  if (b) {
    for (const [key, val] of Object.entries(b)) {
      result[key] = (result[key] || 0) + Number(val);
    }
  }
  return result;
}

async function updatePeriodSummary(
  supabase: any,
  periodType: 'weekly' | 'monthly' | 'yearly',
  startDate: string,
  endDate: string,
  keyField: string,
  keyValue: any
) {
  console.log(`[Summarizer] Updating ${periodType} summary for ${keyValue} (${startDate} to ${endDate})`);

  // 1. Fetch all DAILY summaries for this period
  const { data: dailyRows, error } = await supabase
    .from('daily_summary')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) {
    console.error(`[Summarizer] Error fetching daily summaries for ${periodType}:`, error);
    return;
  }

  if (!dailyRows || dailyRows.length === 0) {
    console.log(`[Summarizer] No daily data found for ${periodType} ${keyValue}. Skipping.`);
    return;
  }

  // 2. Aggregate Data
  let totalScreen = 0;
  let totalPc = 0;
  let totalMobile = 0;
  let totalReading = 0;
  let totalGaming = 0;

  let aggPcApps: Record<string, number> = {};
  let aggMobileApps: Record<string, number> = {};
  let aggGames: Record<string, number> = {};
  let aggBooks: Record<string, number> = {};

  dailyRows.forEach((day: any) => {
    totalScreen += day.screentime_minutes || 0;
    totalPc += day.pc_total_minutes || 0;
    totalMobile += day.mobile_total_minutes || 0;
    totalReading += day.reading_minutes || 0;
    totalGaming += day.gaming_minutes || 0;

    aggPcApps = mergeJsonSummaries(aggPcApps, day.pc_app_summary);
    aggMobileApps = mergeJsonSummaries(aggMobileApps, day.mobile_app_summary);
    aggGames = mergeJsonSummaries(aggGames, day.games_summary);
    aggBooks = mergeJsonSummaries(aggBooks, day.books_summary);
  });

  const avgDailyScreen = Math.round(totalScreen / dailyRows.length);

  // 3. Upsert Summary
  const summaryPayload = {
    [keyField]: keyValue,
    total_screentime_minutes: totalScreen,
    avg_daily_screentime_minutes: avgDailyScreen,
    total_pc_minutes: totalPc,
    total_mobile_minutes: totalMobile,
    total_reading_minutes: totalReading,
    total_gaming_minutes: totalGaming,
    pc_app_summary: aggPcApps,
    mobile_app_summary: aggMobileApps,
    games_summary: aggGames,
    books_summary: aggBooks,
    updated_at: new Date().toISOString()
  };

  const { error: upsertError } = await supabase
    .from(`${periodType}_summary`)
    .upsert(summaryPayload, { onConflict: keyField });

  if (upsertError) {
    console.error(`[Summarizer] Error updating ${periodType} summary:`, upsertError);
  } else {
    console.log(`[Summarizer] Successfully updated ${periodType} summary for ${keyValue}`);
  }
}


// Main Deno server
Deno.serve(async (req) => {
  // 1. Authorization
  const authHeader = req.headers.get('Authorization')!;
  if (authHeader !== `Bearer ${Deno.env.get('SUMMARIZER_SECRET')}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    // 2. Setup Clients and Dates
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    
    // We process "yesterday" relative to the current server time
    const now = new Date();
    const yesterday = subDays(now, 1);
    const yesterdayStr = format(yesterday, 'yyyy-MM-dd');

    // 3. Calculate Stats for Yesterday
    const stats = await calculateDailyStats(supabaseAdmin, yesterdayStr);

    // 4. Prepare the summary object for insertion
    const summaryData = {
      date: yesterdayStr,
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
      location_breakdown: {
          pc: {
              office: Math.round(stats.locationBreakdown.pc.office),
              home: Math.round(stats.locationBreakdown.pc.home),
              outside: Math.round(stats.locationBreakdown.pc.outside),
          },
          mobile: {
              office: Math.round(stats.locationBreakdown.mobile.office),
              home: Math.round(stats.locationBreakdown.mobile.home),
              outside: Math.round(stats.locationBreakdown.mobile.outside),
          }
      }
    };

    // 5. Insert summary into the new table
    const { error: insertError } = await supabaseAdmin.from('daily_summary').insert(summaryData);
    
    // Ignore duplicate key error (if we re-run the script)
    if (insertError) {
        if (insertError.code === '23505') { // Unique violation
             console.log(`[Summarizer] Summary for ${yesterdayStr} already exists. Proceeding to aggregation.`);
        } else {
             throw new Error(`[Summarizer] Failed to insert daily summary: ${insertError.message}`);
        }
    } else {
        console.log(`[Summarizer] Successfully created summary for ${yesterdayStr}.`);
    }

    // 6. Delete the raw metrics for that day
    const startOfDayToDel = fromZonedTime(startOfDay(yesterday), TIMEZONE).toISOString();
    const endOfDayToDel = fromZonedTime(endOfDay(yesterday), TIMEZONE).toISOString();
    
    console.log(`[Summarizer] Deleting raw metrics between ${startOfDayToDel} and ${endOfDayToDel}...`);
    const { error: deleteError } = await supabaseAdmin
      .from('metrics')
      .delete()
      .gte('created_at', startOfDayToDel)
      .lte('created_at', endOfDayToDel);

    if (deleteError) throw new Error(`[Summarizer] Failed to delete raw metrics: ${deleteError.message}`);
    console.log(`[Summarizer] Successfully deleted raw metrics for ${yesterdayStr}.`);


    // 7. Update AGGREGATED TABLES (Weekly, Monthly, Yearly)
    
    // Weekly
    const weekStart = startOfWeek(yesterday, { weekStartsOn: 1 }); // Monday
    const weekEnd = addDays(weekStart, 6); // Sunday
    await updatePeriodSummary(
        supabaseAdmin, 
        'weekly', 
        format(weekStart, 'yyyy-MM-dd'), 
        format(weekEnd, 'yyyy-MM-dd'), 
        'week_start_date', 
        format(weekStart, 'yyyy-MM-dd')
    );

    // Monthly
    const monthStart = startOfMonth(yesterday);
    const monthEnd = endOfDay(subDays(addDays(monthStart, 32), new Date(addDays(monthStart, 32)).getDate())); // Last day of month hack or just end of month
    // Easier way for end of month in SQL query is just matching the month. 
    // But for our range query, we can use the first and last day.
    // Actually, updatePeriodSummary takes date strings.
    // Let's rely on date-fns `endOfMonth` if available, or just filtering by month start in SQL is harder with current generic function.
    // Let's stick to start/end dates.
    const nextMonth = startOfMonth(addDays(monthStart, 32));
    const realMonthEnd = subDays(nextMonth, 1);
    
    await updatePeriodSummary(
        supabaseAdmin, 
        'monthly', 
        format(monthStart, 'yyyy-MM-dd'), 
        format(realMonthEnd, 'yyyy-MM-dd'), 
        'month_start_date', 
        format(monthStart, 'yyyy-MM-dd')
    );

    // Yearly
    const yearStart = startOfYear(yesterday);
    const yearEnd = subDays(startOfYear(addDays(yearStart, 400)), 1); // rough end of year
    await updatePeriodSummary(
        supabaseAdmin, 
        'yearly', 
        format(yearStart, 'yyyy-MM-dd'), 
        format(yearEnd, 'yyyy-MM-dd'), 
        'year', 
        getYear(yesterday)
    );

    return new Response(JSON.stringify({ message: `Successfully summarized and cleaned data for ${yesterdayStr}.` }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    console.error('[Summarizer] An unexpected error occurred:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
