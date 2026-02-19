import { createClient } from '@supabase/supabase-js';
import { startOfDay, endOfDay, format, parseISO, startOfWeek, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TIMEZONE = 'America/Santiago';

const IGNORED_APPS = ['Lanzador del sistema', 'Pantalla Apagada', 'Reloj', 'Clock', 'Barra lateral inteligente'];

const formatWifiName = (ssid: string | undefined): string => {
  if (!ssid || ssid === 'Sin SSID' || ssid === 'Desconocido' || ssid === 'Ethernet' || ssid === 'SIN_SSID') return 'Desconocido';
  if (ssid === 'GeCo') return 'Oficina';
  if (ssid.includes('Depto 402') || ssid === 'Ethernet/Off') return 'Casa';
  return 'Desconocido';
};

const cleanBookTitle = (title: string | undefined): string => {
  if (!title) return 'Desconocido';
  let clean = title.replace(/\.(epub|pdf|mobi|azw3)$/i, '');
  if (clean.toLowerCase().includes('shadow-slave') || clean.toLowerCase().includes('shadow slave')) {
    return 'Shadow Slave';
  }
  clean = clean.replace(/[-_]/g, ' ').trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

export type DashboardStats = {
  pcTotalMinutes: number;
  mobileTotalMinutes: number;
  readingMinutes: number;
  booksReadToday: { title: string; percent: number; timeSpentSec: number }[];
  activityTimeline: { hour: string; pc: number; mobile: number }[];
  pcAppHistory: {
    all: { name: string; minutes: number }[];
    'Lenovo Yoga 7 Slim': { name: string; minutes: number }[];
    'PC Escritorio': { name: string; minutes: number }[];
  };
  screenTimeMinutes: number;
  gamingMinutes: number;
  gamesPlayedToday: { title: string; timeSpentSec: number }[];
  topMobileApps: { name: string; minutes: number }[];
  recentEvents: { 
    id: number; 
    time: string; 
    device: string; 
    detail: string; 
    duration: string; 
    type: 'pc' | 'mobile' | 'reading';
    battery?: number;
    wifi?: string;
    locationType?: 'office' | 'home' | 'outside';
  }[];
  locationStats: { officeMinutes: number; homeMinutes: number; outsideMinutes: number };
  lastPcStatus: { battery: number; wifi: string; lastSeen: string; isCharging: boolean } | null;
  lastMobileStatus: { wifi: string; lastSeen: string } | null;
  locationBreakdown: {
    pc: { office: number; home: number; outside: number };
    mobile: { office: number; home: number; outside: number };
    screenTime: { office: number; home: number; outside: number };
  };
  simultaneousMinutes: number;
};

export type WeeklyDayStat = {
  date: string;
  dayName: string;
  totalMinutes: number;
  primaryDevice: 'pc' | 'mobile' | 'balanced';
};

export async function getWeeklyStats(): Promise<WeeklyDayStat[]> {
  const days: WeeklyDayStat[] = [];
  const now = new Date();
  const zonedNow = toZonedTime(now, TIMEZONE);
  const startOfCurrentWeek = startOfWeek(zonedNow, { weekStartsOn: 1 });
  
  for (let i = 0; i < 7; i++) {
    const targetDate = addDays(startOfCurrentWeek, i);
    const dateStr = format(targetDate, 'yyyy-MM-dd');
    let stats = { screenTimeMinutes: 0, pcTotalMinutes: 0, mobileTotalMinutes: 0 };
    
    if (targetDate <= zonedNow) {
       stats = await getDailyStats(dateStr);
    }

    let primary: 'pc' | 'mobile' | 'balanced' = 'balanced';
    if (stats.pcTotalMinutes > stats.mobileTotalMinutes * 1.2) primary = 'pc';
    else if (stats.mobileTotalMinutes > stats.pcTotalMinutes * 1.2) primary = 'mobile';
    if (stats.screenTimeMinutes === 0) primary = 'balanced';

    days.push({
      date: dateStr,
      dayName: format(targetDate, 'EEEE', { locale: es }),
      totalMinutes: stats.screenTimeMinutes,
      primaryDevice: primary
    });
  }
  return days;
}

export async function getDailyStats(dateStr?: string): Promise<DashboardStats> {
  const now = new Date();
  let targetDate = toZonedTime(now, TIMEZONE);
  const isToday = !dateStr || format(targetDate, 'yyyy-MM-dd') === dateStr;

  if (dateStr) {
    targetDate = toZonedTime(parseISO(dateStr + 'T12:00:00'), TIMEZONE);
  }

  const startSantiagoLocal = startOfDay(targetDate);
  const endSantiagoLocal = endOfDay(targetDate);
  const startUtc = fromZonedTime(startSantiagoLocal, TIMEZONE);
  const endUtc = fromZonedTime(endSantiagoLocal, TIMEZONE);
  const startIso = startUtc.toISOString();
  const endIso = endUtc.toISOString();

  // Fetch Data
  const { data: pcData } = await supabase.from('metrics').select('*')
    .in('device_id', ['windows-pc', 'Lenovo Yoga 7 Slim', 'PC Escritorio'])
    .gte('created_at', startIso).lte('created_at', endIso).order('created_at', { ascending: true });

  const { data: mobileData } = await supabase.from('metrics').select('*')
    .eq('device_id', 'oppo-5-lite')
    .gte('created_at', startIso).lte('created_at', endIso).order('created_at', { ascending: true });

  const { data: readingData } = await supabase.from('metrics').select('*')
    .eq('device_id', 'moon-reader')
    .gte('created_at', startIso).lte('created_at', endIso).order('created_at', { ascending: true });

  if ((!pcData || pcData.length === 0) && (!mobileData || mobileData.length === 0) && (!readingData || readingData.length === 0)) {
      return {
          pcTotalMinutes: 0, mobileTotalMinutes: 0, readingMinutes: 0, screenTimeMinutes: 0, simultaneousMinutes: 0, gamingMinutes: 0,
          booksReadToday: [], activityTimeline: [], gamesPlayedToday: [], topMobileApps: [], recentEvents: [],
          pcAppHistory: { all: [], 'Lenovo Yoga 7 Slim': [], 'PC Escritorio': [] },
          locationStats: { officeMinutes: 0, homeMinutes: 0, outsideMinutes: 0 },
          locationBreakdown: { pc: { office: 0, home: 0, outside: 0 }, mobile: { office: 0, home: 0, outside: 0 }, screenTime: { office: 0, home: 0, outside: 0 } },
          lastPcStatus: null, lastMobileStatus: null
      };
  }

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

  const getLocationType = (wifi: string | undefined, deviceId?: string, appName?: string): 'office' | 'home' | 'outside' => {
    const ssid = wifi ? wifi.trim() : '';
    if (deviceId === 'PC Escritorio') {
        if (ssid === 'GeCo') return 'office';
        return 'home';
    }
    if (ssid === 'GeCo') return 'office';
    if (ssid.includes('Depto 402') || ssid === 'Ethernet/Off') return 'home';
    return 'outside';
  };

  const pcAppsMapAll = new Map<string, number>();
  const pcAppsMapYoga = new Map<string, number>();
  const pcAppsMapDesktop = new Map<string, number>();
  const unifiedEvents: any[] = [];
  const locBreakdown = { pc: { office: 0, home: 0, outside: 0 }, mobile: { office: 0, home: 0, outside: 0 }, screenTime: { office: 0, home: 0, outside: 0 } };
  
  let rawOfficeMinutes = 0, rawHomeMinutes = 0, rawOutsideMinutes = 0;
  let lastPcStatus = null, totalPcSeconds = 0, totalGamingSeconds = 0;
  const gamesMap = new Map<string, number>();

  if (pcData && pcData.length > 0) {
    let currentApp = pcData[0].metadata?.process_name || 'Sistema';
    let startTime = new Date(pcData[0].created_at).getTime();
    let count = 0;

    for (let i = 0; i < pcData.length; i++) {
      const row = pcData[i];
      let deviceName = row.device_id === 'windows-pc' ? 'Lenovo Yoga 7 Slim' : row.device_id;
      if (row.metadata?.battery_level !== undefined) {
        lastPcStatus = { battery: row.metadata.battery_level, wifi: formatWifiName(row.metadata.wifi_ssid), lastSeen: row.created_at, isCharging: row.metadata.is_charging || false };
      }
      const priority = deviceName === 'PC Escritorio' ? 3 : 2;

      if (row.metric_type === 'usage_summary_1min') {
        const breakdown = row.metadata?.breakdown || {};
        let details: string[] = [], totalSeconds = 0;
        Object.entries(breakdown).forEach(([app, seconds]) => {
          const sec = Number(seconds);
          if (sec > 0 && app !== 'Idle (Inactivo)' && !IGNORED_APPS.includes(app)) {
            totalSeconds += sec;
            let cleanApp = app === 'System/Unknown' ? 'Sistema' : app;
            let isGame = false, gameTitle = '';
            if (cleanApp === 'League of Legends') { isGame = true; gameTitle = 'League of Legends'; }
            else if (cleanApp === 'Endfield') { isGame = true; gameTitle = 'Arknights: Endfield'; }
            if (isGame) { totalGamingSeconds += sec; gamesMap.set(gameTitle, (gamesMap.get(gameTitle) || 0) + sec); }
            const min = sec / 60;
            pcAppsMapAll.set(cleanApp, (pcAppsMapAll.get(cleanApp) || 0) + min);
            if (deviceName === 'Lenovo Yoga 7 Slim') pcAppsMapYoga.set(cleanApp, (pcAppsMapYoga.get(cleanApp) || 0) + min);
            else pcAppsMapDesktop.set(cleanApp, (pcAppsMapDesktop.get(cleanApp) || 0) + min);
            details.push(`${cleanApp} (${sec}s)`);
          }
        });
        totalPcSeconds += totalSeconds;
        if (totalSeconds > 0) {
          markSlot(row.created_at, totalSeconds, priority);
          const sT = new Date(row.created_at).getTime();
          allIntervals.push({ start: sT, end: sT + (totalSeconds * 1000) });
        }
        const wifi = row.metadata?.wifi_ssid;
        const loc = getLocationType(wifi, deviceName, undefined);
        const activeMin = totalSeconds / 60;
        if (loc === 'office') { rawOfficeMinutes += activeMin; locBreakdown.pc.office += activeMin; }
        else if (loc === 'home') { rawHomeMinutes += activeMin; locBreakdown.pc.home += activeMin; }
        else { rawOutsideMinutes += activeMin; locBreakdown.pc.outside += activeMin; }
        if (details.length > 0) {
          unifiedEvents.push({ id: row.id, time: row.created_at, device: deviceName + (loc === 'office' ? ' 🏢' : loc === 'home' ? ' 🏠' : ''), detail: details.join(', '), duration: '1m', type: 'pc', battery: row.metadata?.battery_level, wifi: formatWifiName(wifi), locationType: loc });
        }
      } else {
        if (IGNORED_APPS.includes(row.metadata?.process_name)) continue;
        const minutes = Number(row.value) || 1; 
        totalPcSeconds += minutes * 60;
        let isGame = false, gameTitle = '';
        if (row.metadata?.process_name === 'League of Legends') { isGame = true; gameTitle = 'League of Legends'; }
        else if (row.metadata?.process_name === 'Endfield') { isGame = true; gameTitle = 'Arknights: Endfield'; }
        if (isGame) { totalGamingSeconds += minutes * 60; gamesMap.set(gameTitle, (gamesMap.get(gameTitle) || 0) + (minutes * 60)); }
        markSlot(row.created_at, minutes * 60, priority);
        const sT = new Date(row.created_at).getTime();
        allIntervals.push({ start: sT, end: sT + (minutes * 60 * 1000) });
        const wifi = row.metadata?.wifi_ssid;
        const loc = getLocationType(wifi, deviceName, row.metadata?.process_name);
        if (loc === 'office') { rawOfficeMinutes += minutes; locBreakdown.pc.office += minutes; }
        else if (loc === 'home') { rawHomeMinutes += minutes; locBreakdown.pc.home += minutes; }
        else { rawOutsideMinutes += minutes; locBreakdown.pc.outside += minutes; }
        let appName = row.metadata?.process_name;
        const title = row.metadata?.window_title || '';
        if (!appName || appName === 'Unknown' || appName === 'Idle') {
          if (title && title.includes('Ubuntu')) appName = 'Terminal (WSL)';
          else if (title && title.includes('Code')) appName = 'VS Code';
          else appName = 'Sistema/Escritorio';
        }
        pcAppsMapAll.set(appName, (pcAppsMapAll.get(appName) || 0) + minutes);
        if (deviceName === 'Lenovo Yoga 7 Slim') pcAppsMapYoga.set(appName, (pcAppsMapYoga.get(appName) || 0) + minutes);
        else pcAppsMapDesktop.set(appName, (pcAppsMapDesktop.get(appName) || 0) + minutes);
        if (appName !== currentApp) {
          unifiedEvents.push({ id: pcData[i-1]?.id || row.id, time: new Date(startTime).toISOString(), device: deviceName, detail: currentApp, duration: formatDurationSec(count * 60), type: 'pc' });
          currentApp = appName; startTime = new Date(row.created_at).getTime(); count = 1;
        } else count++;
      }
    }
    if (pcData[pcData.length-1].metric_type !== 'usage_summary_1min') {
       unifiedEvents.push({ id: pcData[pcData.length-1].id, time: new Date(startTime).toISOString(), device: 'Lenovo Yoga 7 Slim', detail: currentApp, duration: formatDurationSec(count * 60), type: 'pc' });
    }
  }

  // --- B. MOBILE PROCESSING ---
  let totalReadingMinutes = 0, totalMobileSeconds = 0, lastMobileStatus = null;
  const mobileAppsMap = new Map<string, number>(), bookTimeMap = new Map<string, number>();
  const mobileLogBuffer = new Map<string, { details: string[], wifi: string, totalSec: number, appName?: string }>(); 

  if (mobileData && mobileData.length > 0) {
    for (let i = 0; i < mobileData.length; i++) {
      const currentEvent = mobileData[i];
      lastMobileStatus = { wifi: formatWifiName(currentEvent.metadata?.wifi_ssid), lastSeen: currentEvent.created_at };
      const nextEvent = mobileData[i + 1];
      let durationSec = 0;
      if (nextEvent) {
        let valid = false;
        if (currentEvent.metadata?.screen_time_today && nextEvent.metadata?.screen_time_today) {
          const t1 = parseFloat(currentEvent.metadata.screen_time_today);
          const t2 = parseFloat(nextEvent.metadata.screen_time_today);
          if (!isNaN(t1) && !isNaN(t2) && t2 > t1) { durationSec = t2 - t1; valid = true; }
        }
        if (!valid) durationSec = (new Date(nextEvent.created_at).getTime() - new Date(currentEvent.created_at).getTime()) / 1000;
      } else {
        durationSec = isToday ? (new Date().getTime() - new Date(currentEvent.created_at).getTime()) / 1000 : 30;
      }
      if (durationSec < 0) durationSec = 0;
      
      const durationMin = durationSec / 60;
      const appName = currentEvent.metadata?.app_name || 'Desconocido';
      if (!IGNORED_APPS.includes(appName) && durationSec > 5) {
         markSlot(currentEvent.created_at, durationSec, 1);
         totalMobileSeconds += durationSec;
         const sT = new Date(currentEvent.created_at).getTime();
         allIntervals.push({ start: sT, end: sT + (durationSec * 1000) });
      }
      const wifi = currentEvent.metadata?.wifi_ssid || '';
      const loc = getLocationType(wifi, 'oppo-5-lite', appName);
      if (loc === 'office') { rawOfficeMinutes += durationMin; locBreakdown.mobile.office += durationMin; }
      else if (loc === 'home') { rawHomeMinutes += durationMin; locBreakdown.mobile.home += durationMin; }
      else if (durationMin > 0) { rawOutsideMinutes += durationMin; locBreakdown.mobile.outside += durationMin; }

      if (!IGNORED_APPS.includes(appName)) {
         mobileAppsMap.set(appName, (mobileAppsMap.get(appName) || 0) + durationMin);
         const eventDate = new Date(currentEvent.created_at);
         eventDate.setSeconds(0, 0);
         const minuteKey = eventDate.toISOString();
         if (!mobileLogBuffer.has(minuteKey)) mobileLogBuffer.set(minuteKey, { details: [], wifi: wifi || '', totalSec: 0, appName });
         const entry = mobileLogBuffer.get(minuteKey)!;
         entry.details.push(`${appName} (${Math.round(durationSec)}s)`);
         entry.totalSec += durationSec;
      }
      if (appName.toLowerCase().includes('moon+') || currentEvent.metadata?.package?.includes('moonreader')) {
        totalReadingMinutes += durationMin; 
        const eventTime = new Date(currentEvent.created_at).getTime();
        let activeBook = 'Desconocido';
        if (readingData) {
          for (const read of readingData) {
            const readTime = new Date(read.created_at).getTime();
            if (readTime >= eventTime - (20 * 60 * 1000) && readTime <= eventTime + (durationSec * 1000) + (20 * 60 * 1000)) {
              activeBook = cleanBookTitle(read.metadata?.book_title); break; 
            }
          }
        }
        if (activeBook !== 'Desconocido') bookTimeMap.set(activeBook, (bookTimeMap.get(activeBook) || 0) + durationSec);
      }
    }
  }

  mobileLogBuffer.forEach((data, timeKey) => {
    const loc = getLocationType(data.wifi, 'oppo-5-lite', data.appName);
    unifiedEvents.push({ id: new Date(timeKey).getTime(), time: timeKey, device: 'Oppo 5 Lite' + (loc === 'office' ? ' 🏢' : loc === 'home' ? ' 🏠' : ''), detail: data.details.join(', '), duration: formatDurationSec(data.totalSec), type: 'mobile', wifi: formatWifiName(data.wifi), locationType: loc });
  });

  const timelineData = new Map<string, { pc: number, mobile: number }>();
  for (let i = 0; i < 24; i++) timelineData.set(i.toString().padStart(2, '0'), { pc: 0, mobile: 0 });
  minuteSlots.forEach((level, timeKey) => {
    const hour = timeKey.split(':')[0], current = timelineData.get(hour)!;
    if (level >= 2) current.pc++; else if (level === 1) current.mobile++;
  });

  const booksFinalMap = new Map<string, { title: string; percent: number; timeSpentSec: number }>();
  readingData?.forEach((row) => {
    const title = cleanBookTitle(row.metadata?.book_title);
    if (!booksFinalMap.has(title)) {
      booksFinalMap.set(title, { title, percent: row.value, timeSpentSec: 0 });
      unifiedEvents.push({ id: row.id, time: row.created_at, device: 'Cloud', detail: `Progreso: ${title} (${row.value}%)`, duration: '-', type: 'reading' });
    }
  });
  bookTimeMap.forEach((sec, title) => {
    if (booksFinalMap.has(title)) booksFinalMap.get(title)!.timeSpentSec = sec;
    else booksFinalMap.set(title, { title, percent: 0, timeSpentSec: sec });
  });

  if (booksFinalMap.size === 0 && totalReadingMinutes > 0) {
    const { data: lastBookData } = await supabase.from('metrics').select('*').eq('device_id', 'moon-reader').lt('created_at', startIso).order('created_at', { ascending: false }).limit(1);
    if (lastBookData && lastBookData.length > 0) {
      const lastBook = lastBookData[0], title = cleanBookTitle(lastBook.metadata?.book_title);
      booksFinalMap.set(title, { title, percent: lastBook.value || 0, timeSpentSec: totalReadingMinutes * 60 });
    }
  }

  const toArray = (map: Map<string, number>) => Array.from(map.entries()).map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes);
  
  allIntervals.sort((a, b) => a.start - b.start);
  let exactDedupMs = 0;
  if (allIntervals.length > 0) {
    let current = allIntervals[0];
    for (let i = 1; i < allIntervals.length; i++) {
      const next = allIntervals[i];
      if (next.start < current.end) current.end = Math.max(current.end, next.end);
      else { exactDedupMs += (current.end - current.start); current = next; }
    }
    exactDedupMs += (current.end - current.start);
  }

  const simultaneousMs = Math.max(0, ((totalPcSeconds + totalMobileSeconds) * 1000) - exactDedupMs);

  return {
    pcTotalMinutes: totalPcSeconds / 60, mobileTotalMinutes: totalMobileSeconds / 60, screenTimeMinutes: exactDedupMs / 1000 / 60, simultaneousMinutes: simultaneousMs / 1000 / 60, readingMinutes: totalReadingMinutes,
    gamingMinutes: totalGamingSeconds / 60, gamesPlayedToday: Array.from(gamesMap.entries()).map(([title, sec]) => ({ title, timeSpentSec: sec })).sort((a, b) => b.timeSpentSec - a.timeSpentSec),
    booksReadToday: Array.from(booksFinalMap.values()).sort((a, b) => b.timeSpentSec - a.timeSpentSec),
    activityTimeline: Array.from(timelineData.entries()).map(([hour, stats]) => ({ hour: `${hour}:00`, pc: stats.pc, mobile: stats.mobile })).sort((a, b) => a.hour.localeCompare(b.hour)),
    pcAppHistory: { all: toArray(pcAppsMapAll), 'Lenovo Yoga 7 Slim': toArray(pcAppsMapYoga), 'PC Escritorio': toArray(pcAppsMapDesktop) },
    topMobileApps: toArray(mobileAppsMap), recentEvents: unifiedEvents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 100),
    locationStats: { officeMinutes: rawOfficeMinutes, homeMinutes: rawHomeMinutes, outsideMinutes: rawOutsideMinutes },
    locationBreakdown: { pc: locBreakdown.pc, mobile: locBreakdown.mobile, screenTime: { office: locBreakdown.pc.office + locBreakdown.mobile.office, home: locBreakdown.pc.home + locBreakdown.mobile.home, outside: locBreakdown.pc.outside + locBreakdown.mobile.outside } },
    lastPcStatus, lastMobileStatus
  };
}

function formatDurationSec(totalSec: number) {
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = Math.round(totalSec % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
