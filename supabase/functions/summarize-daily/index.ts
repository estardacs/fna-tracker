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

// Mirrors OFFICE_SSIDS in src/lib/data-processor.ts — keep both in sync.
// 'GeCo' is the former workplace (through 2026-08-19); 'IF-Comunidad' is the current one.
const OFFICE_SSIDS = new Set(['GeCo', 'IF-Comunidad']);

const METRICS_PAGE_SIZE = 1000;

// Days summarized per invocation. Bounded so a long backlog cannot exceed the
// function's wall-clock limit; the caller re-invokes until `done` comes back true.
const DEFAULT_MAX_DAYS = 15;

/**
 * PostgREST caps every response at 1000 rows (db-max-rows) and `.limit()` cannot raise
 * that ceiling, so a busy day used to be read truncated — and then deleted anyway.
 * Page through the range instead.
 *
 * The explicit ordering matters twice over: the `id` tie-breaker stops rows sharing a
 * `created_at` from being skipped or repeated across page boundaries, and mobile
 * duration is derived from consecutive events, so chronological order is required for
 * the numbers to be correct at all.
 *
 * Mirrors fetchAllMetrics() in src/lib/data-processor.ts — keep both in sync.
 */
async function fetchAllMetrics(supabase: any, startIso: string, endIso: string) {
  const all: any[] = [];
  for (let offset = 0; ; offset += METRICS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('metrics')
      .select('*')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + METRICS_PAGE_SIZE - 1);

    if (error) {
      console.error('[Summarizer] Error fetching metrics:', error.message);
      throw error;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < METRICS_PAGE_SIZE) break;
  }
  return all;
}

/**
 * Deletes every raw metric in the range. The 1000-row cap applies to DELETE too, so a
 * single call leaves residue on busy days — loop until a pass removes nothing.
 */
async function deleteAllMetrics(supabase: any, startIso: string, endIso: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('metrics')
      .delete()
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .select('id');

    if (error) throw error;
    const n = data?.length ?? 0;
    deleted += n;
    if (n === 0) break;
  }
  return deleted;
}

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

  // Fetch all data for the day, paginated past the 1000-row cap
  const metrics = await fetchAllMetrics(supabase, startIso, endIso);

  // Mirrors PC_DEVICE_IDS in src/lib/data-processor.ts — keep both in sync. The first
  // three are retired machines, kept so historical days still resolve.
  const pcData = metrics.filter((m: any) => ['windows-pc', 'Lenovo Yoga 7 Slim', 'PC Escritorio', 'Zenbook'].includes(m.device_id));
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
  
  const getLocationType = (wifi: string | undefined, deviceId?: string): 'office' | 'home' | 'outside' | 'university' => {
    const ssid = wifi ? wifi.trim() : '';
    if (deviceId === 'PC Escritorio') {
      if (OFFICE_SSIDS.has(ssid)) return 'office';
      if (ssid === 'eduroam' || ssid === 'Eduroam') return 'university';
      return 'home';
    }
    if (!ssid) return 'outside';
    if (OFFICE_SSIDS.has(ssid)) return 'office';
    if (ssid.includes('Depto 402') || ssid === 'Ethernet/Off') return 'home';
    if (ssid === 'eduroam' || ssid === 'Eduroam') return 'university';
    return 'outside';
  };

  const pcAppsMapAll = new Map<string, number>();
  let totalPcSeconds = 0;
  let totalGamingSeconds = 0;
  const gamesMap = new Map<string, number>();
  const locBreakdown = { pc: { office: 0, home: 0, outside: 0, university: 0 }, mobile: { office: 0, home: 0, outside: 0, university: 0 } };
  let rawOfficeMinutes = 0, rawHomeMinutes = 0, rawOutsideMinutes = 0, rawUniversityMinutes = 0;

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
        else if (cleanApp === 'GenshinImpact' || cleanApp === 'Genshin Impact') { isGame = true; gameTitle = 'Genshin Impact'; }

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
    const loc = getLocationType(wifi, row.device_id);
    const activeMin = totalSecondsInBatch / 60;
    if (loc === 'office') { rawOfficeMinutes += activeMin; locBreakdown.pc.office += activeMin; }
    else if (loc === 'home') { rawHomeMinutes += activeMin; locBreakdown.pc.home += activeMin; }
    else if (loc === 'university') { rawUniversityMinutes += activeMin; locBreakdown.pc.university += activeMin; }
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
      const timeDiffSec = (new Date(nextEvent.created_at).getTime() - new Date(currentEvent.created_at).getTime()) / 1000;
      if (currentEvent.metadata?.screen_time_today != null && nextEvent.metadata?.screen_time_today != null) {
        const t1 = parseFloat(currentEvent.metadata.screen_time_today);
        const t2 = parseFloat(nextEvent.metadata.screen_time_today);
        if (!isNaN(t1) && !isNaN(t2)) {
          valid = true;
          // Cap at timeDiffSec: screen time delta can never exceed elapsed wall-clock time.
          // When t2 <= t1, phone was locked (stt didn't increase) → 0, not the fallback.
          if (t2 > t1) durationSec = Math.min(t2 - t1, timeDiffSec);
        }
      }
      if (!valid) {
        durationSec = Math.min(timeDiffSec, 600);
      }
    } else {
      // For the last event of the day in a historical summary, assume a small default duration
      durationSec = 30;
    }
    if (durationSec < 0) durationSec = 0; // Sanity check

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
    else if (loc === 'university') { rawUniversityMinutes += durationMin; locBreakdown.mobile.university += durationMin; }
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

  const simultaneousMs = Math.max(0, ((totalPcSeconds + totalMobileSeconds) * 1000) - exactDedupMs);

  const toArray = (map: Map<string, number>) => Array.from(map.entries()).map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes);

  // Build hourly activity timeline from minuteSlots
  const timelineData = new Map<string, { pc: number, mobile: number }>();
  for (let i = 0; i < 24; i++) timelineData.set(i.toString().padStart(2, '0'), { pc: 0, mobile: 0 });
  minuteSlots.forEach((level, timeKey) => {
    const hour = timeKey.split(':')[0];
    const current = timelineData.get(hour)!;
    if (level >= 2) current.pc++;
    else if (level === 1) current.mobile++;
  });
  const activityTimeline = Array.from(timelineData.entries())
    .map(([hour, stats]) => ({ hour: `${hour}:00`, pc: stats.pc, mobile: stats.mobile }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

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
    locationStats: { officeMinutes: rawOfficeMinutes, homeMinutes: rawHomeMinutes, outsideMinutes: rawOutsideMinutes, universityMinutes: rawUniversityMinutes },
    locationBreakdown: { pc: locBreakdown.pc, mobile: locBreakdown.mobile },
    activityTimeline,
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


// Helper: build and upsert a daily_summary row for a given dateStr
async function processDay(supabaseAdmin: any, dateStr: string, deleteRaw: boolean): Promise<boolean> {
  const stats = await calculateDailyStats(supabaseAdmin, dateStr);

  const summaryData = {
    date: dateStr,
    pc_total_minutes: Math.round(stats.pcTotalMinutes),
    mobile_total_minutes: Math.round(stats.mobileTotalMinutes),
    reading_minutes: Math.round(stats.readingMinutes),
    gaming_minutes: Math.round(stats.gamingMinutes),
    screentime_minutes: Math.round(stats.screenTimeMinutes),
    simultaneous_minutes: Math.round(stats.simultaneousMinutes),
    office_minutes: Math.round(stats.locationStats.officeMinutes),
    home_minutes: Math.round(stats.locationStats.homeMinutes),
    outside_minutes: Math.round(stats.locationStats.outsideMinutes),
    university_minutes: Math.round(stats.locationStats.universityMinutes),
    pc_app_summary: Object.fromEntries(stats.pcAppHistory.all.map((app: any) => [app.name, Math.round(app.minutes)])),
    mobile_app_summary: Object.fromEntries(stats.topMobileApps.map((app: any) => [app.name, Math.round(app.minutes)])),
    games_summary: Object.fromEntries(stats.gamesPlayedToday.map((game: any) => [game.title, Math.round(game.timeSpentSec / 60)])),
    books_summary: Object.fromEntries(stats.booksReadToday.map((book: any) => [book.title, Math.round(book.timeSpentSec / 60)])),
    location_breakdown: {
      pc: {
        office: Math.round(stats.locationBreakdown.pc.office),
        home: Math.round(stats.locationBreakdown.pc.home),
        outside: Math.round(stats.locationBreakdown.pc.outside),
        university: Math.round(stats.locationBreakdown.pc.university),
      },
      mobile: {
        office: Math.round(stats.locationBreakdown.mobile.office),
        home: Math.round(stats.locationBreakdown.mobile.home),
        outside: Math.round(stats.locationBreakdown.mobile.outside),
        university: Math.round(stats.locationBreakdown.mobile.university),
      }
    },
    // Consolidated view data: hourly chart + event log (sufficient to render charts without raw metrics)
    activity_timeline: stats.activityTimeline.map((slot: any) => ({ hour: slot.hour, pc: slot.pc, mobile: slot.mobile })),
    recent_events: stats.recentEvents,
  };

  const { error: upsertError } = await supabaseAdmin.from('daily_summary').upsert(summaryData, { onConflict: 'date' });
  if (upsertError) {
    throw new Error(`Failed to upsert daily summary for ${dateStr}: ${upsertError.message}`);
  }
  console.log(`[Summarizer] Upserted daily_summary for ${dateStr}.`);

  // Raw metrics are kept by default. Deleting them is irreversible, so it only happens
  // when the caller explicitly opts in — after the summaries have been eyeballed.
  if (!deleteRaw) {
    console.log(`[Summarizer] Kept raw metrics for ${dateStr} (deleteRaw=false).`);
    return true;
  }

  const targetLocal = toZonedTime(parseISO(dateStr + 'T12:00:00'), TIMEZONE);
  const startUtc = fromZonedTime(startOfDay(targetLocal), TIMEZONE).toISOString();
  const endUtc   = fromZonedTime(endOfDay(targetLocal),   TIMEZONE).toISOString();
  try {
    const deleted = await deleteAllMetrics(supabaseAdmin, startUtc, endUtc);
    console.log(`[Summarizer] Deleted ${deleted} raw metrics for ${dateStr} (${startUtc} → ${endUtc}).`);
  } catch (e: any) {
    throw new Error(`Failed to delete metrics for ${dateStr}: ${e.message}`);
  }

  return true;
}

// Main Deno server
Deno.serve(async (req) => {
  // 1. Authorization — accept secret via X-Secret header OR as the full Bearer token
  const xSecret = req.headers.get('X-Secret');
  const authHeader = req.headers.get('Authorization') || '';
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const providedSecret = xSecret || bearerSecret;
  if (providedSecret !== Deno.env.get('SUMMARIZER_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Optional tuning from the body. Defaults are the conservative ones: a bounded batch
  // so a long backlog cannot blow the wall-clock limit, and no deletion of raw metrics.
  const body = await req.json().catch(() => ({})) as { maxDays?: number; deleteRaw?: boolean };
  const maxDays = Math.min(Math.max(Number(body.maxDays) || DEFAULT_MAX_DAYS, 1), 60);
  const deleteRaw = body.deleteRaw === true;

  try {
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Compute "today" in Santiago — NEVER process today's data, it's still accumulating
    const nowSantiago = toZonedTime(new Date(), TIMEZONE);
    const todayStr = format(nowSantiago, 'yyyy-MM-dd');

    // Upper bound for metrics query: end of yesterday in Santiago → UTC
    const endOfYesterdayLocal = endOfDay(subDays(nowSantiago, 1));
    const endOfYesterdayUtc = fromZonedTime(endOfYesterdayLocal, TIMEZONE).toISOString();

    console.log(`[Summarizer] Today (Santiago): ${todayStr}. Looking for pending days before this.`);

    // Get already-summarized dates (small query, fast)
    const { data: existingSummaries } = await supabaseAdmin
      .from('daily_summary')
      .select('date');
    const summarizedDates = new Set((existingSummaries || []).map((s: any) => s.date));

    // Find the date range in metrics using min/max queries (avoids row-limit issues)
    const [{ data: earliestRow }, { data: latestRow }] = await Promise.all([
      supabaseAdmin.from('metrics').select('created_at').lte('created_at', endOfYesterdayUtc).order('created_at', { ascending: true  }).limit(1),
      supabaseAdmin.from('metrics').select('created_at').lte('created_at', endOfYesterdayUtc).order('created_at', { ascending: false }).limit(1),
    ]);

    if (!earliestRow?.length || !latestRow?.length) {
      return new Response(JSON.stringify({ message: 'No metrics found before today.' }), {
        headers: { 'Content-Type': 'application/json' }, status: 200,
      });
    }

    // Generate every Santiago date between earliest and latest metric
    const firstDateStr = format(toZonedTime(new Date(earliestRow[0].created_at), TIMEZONE), 'yyyy-MM-dd');
    const lastDateStr  = format(toZonedTime(new Date(latestRow[0].created_at),  TIMEZONE), 'yyyy-MM-dd');

    const allDates: string[] = [];
    let cursor = parseISO(firstDateStr + 'T12:00:00');
    const end  = parseISO(lastDateStr  + 'T12:00:00');
    while (cursor <= end) {
      allDates.push(format(cursor, 'yyyy-MM-dd'));
      cursor = addDays(cursor, 1);
    }

    // Dates that need processing = in range, before today, not yet summarized
    const pendingDates = allDates.filter(d => d < todayStr && !summarizedDates.has(d));

    // Only a bounded slice per invocation. Each day is committed as it finishes, so
    // re-invoking picks up exactly where this run stopped.
    const datesToProcess = pendingDates.slice(0, maxDays);
    const remaining = pendingDates.length - datesToProcess.length;

    console.log(`[Summarizer] Pending: ${pendingDates.length}. Processing ${datesToProcess.length} this run (deleteRaw=${deleteRaw}).`);

    if (datesToProcess.length === 0) {
      return new Response(JSON.stringify({
        message: 'No pending days to summarize.',
        processed: 0, remaining: 0, done: true,
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // Process each pending day
    for (const dateStr of datesToProcess) {
      await processDay(supabaseAdmin, dateStr, deleteRaw);
    }

    // Update period summaries for all affected weeks/months/years
    const affectedWeeks = new Set<string>();
    const affectedMonths = new Set<string>();
    const affectedYears = new Set<number>();

    for (const dateStr of datesToProcess) {
      const d = parseISO(dateStr + 'T12:00:00');
      const weekStart = startOfWeek(d, { weekStartsOn: 1 });
      affectedWeeks.add(format(weekStart, 'yyyy-MM-dd'));
      affectedMonths.add(format(startOfMonth(d), 'yyyy-MM-dd'));
      affectedYears.add(getYear(d));
    }

    for (const weekStartStr of affectedWeeks) {
      const weekStart = parseISO(weekStartStr + 'T12:00:00');
      const weekEnd = addDays(weekStart, 6);
      await updatePeriodSummary(supabaseAdmin, 'weekly', weekStartStr, format(weekEnd, 'yyyy-MM-dd'), 'week_start_date', weekStartStr);
    }

    for (const monthStartStr of affectedMonths) {
      const monthStart = parseISO(monthStartStr + 'T12:00:00');
      const nextMonth = startOfMonth(addDays(monthStart, 32));
      const monthEnd = subDays(nextMonth, 1);
      await updatePeriodSummary(supabaseAdmin, 'monthly', monthStartStr, format(monthEnd, 'yyyy-MM-dd'), 'month_start_date', monthStartStr);
    }

    for (const year of affectedYears) {
      const yearStart = startOfYear(new Date(year, 6, 1));
      const yearEnd = subDays(startOfYear(new Date(year + 1, 6, 1)), 1);
      await updatePeriodSummary(supabaseAdmin, 'yearly', format(yearStart, 'yyyy-MM-dd'), format(yearEnd, 'yyyy-MM-dd'), 'year', year);
    }

    return new Response(JSON.stringify({
      message: `Processed ${datesToProcess.length} day(s): ${datesToProcess.join(', ')}`,
      processed: datesToProcess.length,
      dates: datesToProcess,
      remaining,
      done: remaining === 0,
      deletedRaw: deleteRaw,
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Summarizer] An unexpected error occurred:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
