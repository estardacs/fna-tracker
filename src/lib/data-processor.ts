import { createClient } from '@supabase/supabase-js';
import { startOfDay, endOfDay, format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { unstable_noStore as noStore } from 'next/cache';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const TIMEZONE = 'America/Santiago';

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
  debugInfo?: {
    serverTime: string;
    queryStart: string;
    queryEnd: string;
    timezone: string;
  };
};

export async function getDailyStats(dateStr?: string): Promise<DashboardStats> {
  noStore(); // Opt out of static rendering and data caching (Vercel fix)
  const now = new Date();
  let targetDate = toZonedTime(now, TIMEZONE);

  if (dateStr) {
    targetDate = new Date(dateStr + 'T12:00:00'); 
  }

  const startSantiago = startOfDay(targetDate);
  const endSantiago = endOfDay(targetDate);
  const startIso = startSantiago.toISOString();
  const endIso = endSantiago.toISOString();

  // Fetch Data
  const { data: pcData } = await supabase
    .from('metrics')
    .select('*')
    .in('device_id', ['windows-pc', 'Lenovo Yoga 7 Slim', 'PC Escritorio'])
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: true });

  const { data: mobileData } = await supabase
    .from('metrics')
    .select('*')
    .eq('device_id', 'oppo-5-lite')
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: true });

  const { data: readingData } = await supabase
    .from('metrics')
    .select('*')
    .eq('device_id', 'moon-reader')
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: true });

  // --- PROCESSING: THE TIMELINE MASTER ---
  
  // Mapa de Slots de Minutos (Clave: "HH:mm", Valor: Nivel de Prioridad)
  // Niveles: 3 = PC Escritorio, 2 = Laptop, 1 = Móvil
  const minuteSlots = new Map<string, number>(); 
  
  // Helpers
  const markSlot = (isoTime: string, durationSec: number, level: number) => {
    const startDate = toZonedTime(new Date(isoTime), TIMEZONE);
    const startMin = startDate.getHours() * 60 + startDate.getMinutes();
    const durationMin = Math.ceil(durationSec / 60); // Redondear hacia arriba para ocupar el slot

    for (let i = 0; i < durationMin; i++) {
      const currentMin = startMin + i;
      if (currentMin >= 1440) break; // Fin del día

      const h = Math.floor(currentMin / 60).toString().padStart(2, '0');
      const m = (currentMin % 60).toString().padStart(2, '0');
      const key = `${h}:${m}`;

      const currentLevel = minuteSlots.get(key) || 0;
      if (level > currentLevel) {
        minuteSlots.set(key, level);
      }
    }
  };

  const formatDurationSec = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.round(totalSec % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getLocationType = (wifi: string | undefined): 'office' | 'home' | 'outside' => {
    if (!wifi || wifi === 'Sin SSID' || wifi === 'Desconocido' || wifi === 'Ethernet') return 'outside';
    if (wifi === 'GeCo') return 'office';
    return 'home';
  };

  // --- A. PC PROCESSING ---
  
  // Stats (Estos se mantienen completos para el historial)
  const pcAppsMapAll = new Map<string, number>();
  const pcAppsMapYoga = new Map<string, number>();
  const pcAppsMapDesktop = new Map<string, number>();
  const unifiedEvents: any[] = [];
  
  // Vars for Context (Using raw minutes for distribution)
  let rawOfficeMinutes = 0;
  let rawHomeMinutes = 0;
  let rawOutsideMinutes = 0;
  let lastPcStatus = null;

  if (pcData && pcData.length > 0) {
    let currentApp = pcData[0].metadata?.process_name || 'Sistema';
    let startTime = new Date(pcData[0].created_at).getTime();
    let count = 0;

    for (let i = 0; i < pcData.length; i++) {
      const row = pcData[i];
      let deviceName = row.device_id === 'windows-pc' ? 'Lenovo Yoga 7 Slim' : row.device_id;
      
      // Update Status
      if (row.metadata?.battery_level !== undefined) {
        lastPcStatus = {
          battery: row.metadata.battery_level,
          wifi: row.metadata.wifi_ssid || 'Desconocido',
          lastSeen: row.created_at,
          isCharging: row.metadata.is_charging || false
        };
      }

      // Priority Level
      const priority = deviceName === 'PC Escritorio' ? 3 : 2;

      // NEW BATCH FORMAT
      if (row.metric_type === 'usage_summary_1min') {
        const breakdown = row.metadata?.breakdown || {};
        let details: string[] = [];
        let totalSeconds = 0;

        Object.entries(breakdown).forEach(([app, seconds]) => {
          const sec = Number(seconds);
          if (sec > 0 && app !== 'Idle (Inactivo)') {
            totalSeconds += sec;
            let cleanApp = app === 'System/Unknown' ? 'Sistema' : app;
            
            // Apps History (Full)
            const min = sec / 60;
            pcAppsMapAll.set(cleanApp, (pcAppsMapAll.get(cleanApp) || 0) + min);
            if (deviceName === 'Lenovo Yoga 7 Slim') pcAppsMapYoga.set(cleanApp, (pcAppsMapYoga.get(cleanApp) || 0) + min);
            else pcAppsMapDesktop.set(cleanApp, (pcAppsMapDesktop.get(cleanApp) || 0) + min);

            details.push(`${cleanApp} (${sec}s)`);
          }
        });

        // Mark Timeline Slots (Crucial)
        if (totalSeconds > 0) {
          markSlot(row.created_at, totalSeconds, priority);
        }

        // Context (Raw Sum for Location bar proportions)
        const wifi = row.metadata?.wifi_ssid;
        const loc = getLocationType(wifi);
        const activeMin = totalSeconds / 60;
        if (loc === 'office') rawOfficeMinutes += activeMin;
        else if (loc === 'home') rawHomeMinutes += activeMin;
        else rawOutsideMinutes += activeMin;

        // Logs
        if (details.length > 0) {
          unifiedEvents.push({
            id: row.id, time: row.created_at, device: deviceName + (loc === 'office' ? ' 🏢' : loc === 'home' ? ' 🏠' : ''),
            detail: details.join(', '), duration: '1m', type: 'pc',
            battery: row.metadata?.battery_level, wifi: wifi, locationType: loc
          });
        }
      } 
      else {
        // OLD FORMAT
        const minutes = Number(row.value) || 1; 
        
        // Mark Timeline
        markSlot(row.created_at, minutes * 60, priority);

        // Context
        const wifi = row.metadata?.wifi_ssid;
        const loc = getLocationType(wifi);
        if (loc === 'office') rawOfficeMinutes += minutes;
        else if (loc === 'home') rawHomeMinutes += minutes;
        else rawOutsideMinutes += minutes;

        // Apps History
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

        // Logs (Grouped)
        if (appName !== currentApp) {
          unifiedEvents.push({
            id: pcData[i-1]?.id || row.id, time: new Date(startTime).toISOString(), device: deviceName,
            detail: currentApp, duration: formatDurationSec(count * 60), type: 'pc'
          });
          currentApp = appName;
          startTime = new Date(row.created_at).getTime();
          count = 1;
        } else {
          count++;
        }
      }
    }
    if (pcData.length > 0 && pcData[pcData.length-1].metric_type !== 'usage_summary_1min') {
       unifiedEvents.push({
        id: pcData[pcData.length-1].id, time: new Date(startTime).toISOString(), device: 'Lenovo Yoga 7 Slim',
        detail: currentApp, duration: formatDurationSec(count * 60), type: 'pc'
       });
    }
  }

  // --- B. MOBILE PROCESSING ---
  let totalReadingMinutes = 0;
  const mobileAppsMap = new Map<string, number>();
  const bookTimeMap = new Map<string, number>();
  const mobileLogBuffer = new Map<string, { details: string[], wifi: string, totalSec: number }>(); 
  let lastMobileStatus = null;

  if (mobileData && mobileData.length > 0) {
    for (let i = 0; i < mobileData.length; i++) {
      const currentEvent = mobileData[i];
      lastMobileStatus = { wifi: currentEvent.metadata?.wifi_ssid || 'Desconocido', lastSeen: currentEvent.created_at };
      const nextEvent = mobileData[i + 1];
      
      let durationSec = 0;
      // Duration Logic
      if (nextEvent) {
        let valid = false;
        if (currentEvent.metadata?.screen_time_today && nextEvent.metadata?.screen_time_today) {
          const t1 = parseFloat(currentEvent.metadata.screen_time_today);
          const t2 = parseFloat(nextEvent.metadata.screen_time_today);
          if (!isNaN(t1) && !isNaN(t2) && t2 > t1) { durationSec = t2 - t1; valid = true; }
        }
        if (!valid) durationSec = (new Date(nextEvent.created_at).getTime() - new Date(currentEvent.created_at).getTime()) / 1000;
      } else {
        durationSec = (new Date().getTime() - new Date(currentEvent.created_at).getTime()) / 1000;
      }
      if (durationSec > 30 * 60) durationSec = 0; 
      if (durationSec < 0) durationSec = 0;

      const durationMin = durationSec / 60;
      const appName = currentEvent.metadata?.app_name || 'Desconocido';
      
      // Mark Timeline (Priority 1)
      // Only mark if meaningful activity (not Launcher)
      if (appName !== 'Lanzador del sistema' && appName !== 'Pantalla Apagada' && durationSec > 5) {
         markSlot(currentEvent.created_at, durationSec, 1);
      }

      // Context logic for mobile (Just accumulation for bar, not deduplicated yet)
      const wifi = currentEvent.metadata?.wifi_ssid || '';
      const loc = getLocationType(wifi);
      if (loc === 'office') rawOfficeMinutes += durationMin;
      else if (loc === 'home') rawHomeMinutes += durationMin;
      else if (durationMin > 0) rawOutsideMinutes += durationMin;

      // Apps History
      if (appName !== 'Lanzador del sistema' && appName !== 'Pantalla Apagada') {
         mobileAppsMap.set(appName, (mobileAppsMap.get(appName) || 0) + durationMin);
         
         const eventDate = new Date(currentEvent.created_at);
         eventDate.setSeconds(0, 0);
         const minuteKey = eventDate.toISOString();
         if (!mobileLogBuffer.has(minuteKey)) mobileLogBuffer.set(minuteKey, { details: [], wifi: wifi || '', totalSec: 0 });
         const entry = mobileLogBuffer.get(minuteKey)!;
         entry.details.push(`${appName} (${Math.round(durationSec)}s)`);
         entry.totalSec += durationSec;
      }

      // Reading Logic
      if (appName.toLowerCase().includes('moon+') || currentEvent.metadata?.package?.includes('moonreader')) {
        // Here we keep total reading minutes separate/raw because reading can happen while PC is on (multitasking?)
        // But for deduplication, we rely on the Timeline Master.
        totalReadingMinutes += durationMin; 
        
        const eventTime = new Date(currentEvent.created_at).getTime();
        let activeBook = 'Desconocido';
        if (readingData) {
          for (const read of readingData) {
            const readTime = new Date(read.created_at).getTime();
            if (readTime <= eventTime + (5 * 60 * 1000)) {
              activeBook = read.metadata?.book_title?.replace(/\.(epub|pdf|mobi)$/i, '').trim() || 'Desconocido';
              break; 
            }
          }
        }
        if (activeBook !== 'Desconocido') bookTimeMap.set(activeBook, (bookTimeMap.get(activeBook) || 0) + durationSec);
      }
    }
  }

  // Flush Mobile Logs
  mobileLogBuffer.forEach((data, timeKey) => {
    const loc = getLocationType(data.wifi);
    unifiedEvents.push({
      id: new Date(timeKey).getTime(), time: timeKey, 
      device: 'Oppo 5 Lite' + (loc === 'office' ? ' 🏢' : loc === 'home' ? ' 🏠' : ''),
      detail: data.details.join(', '), duration: formatDurationSec(data.totalSec), 
      type: 'mobile', wifi: data.wifi, locationType: loc
    });
  });

  // --- C. FINAL AGGREGATION FROM TIMELINE MASTER ---
  
  let dedupPcMinutes = 0;
  let dedupMobileMinutes = 0;
  const timelineData = new Map<string, { pc: number, mobile: number }>();

  // Init chart
  for (let i = 0; i < 24; i++) {
    timelineData.set(i.toString().padStart(2, '0'), { pc: 0, mobile: 0 });
  }

  minuteSlots.forEach((level, timeKey) => {
    const hour = timeKey.split(':')[0];
    const current = timelineData.get(hour)!;

    if (level >= 2) { // PC (Desktop or Laptop)
      dedupPcMinutes++;
      current.pc++;
    } else if (level === 1) { // Mobile
      dedupMobileMinutes++;
      current.mobile++;
    }
  });

  // Reading Books
  const booksFinalMap = new Map<string, { title: string; percent: number; timeSpentSec: number }>();
  readingData?.forEach((row) => {
    const title = row.metadata?.book_title?.replace(/\.(epub|pdf|mobi)$/i, '').trim() || 'Desconocido';
    if (!booksFinalMap.has(title)) {
      booksFinalMap.set(title, { title, percent: row.value, timeSpentSec: 0 });
      unifiedEvents.push({ id: row.id, time: row.created_at, device: 'Cloud', detail: `Progreso: ${title} (${row.value}%)`, duration: '-', type: 'reading' });
    }
  });
  bookTimeMap.forEach((sec, title) => {
    if (booksFinalMap.has(title)) booksFinalMap.get(title)!.timeSpentSec = sec;
    else booksFinalMap.set(title, { title, percent: 0, timeSpentSec: sec });
  });

  // Helper Array
  const toArray = (map: Map<string, number>) => Array.from(map.entries()).map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes);

  return {
    pcTotalMinutes: dedupPcMinutes, // DEDUPLICATED
    mobileTotalMinutes: dedupMobileMinutes, // DEDUPLICATED
    readingMinutes: totalReadingMinutes, // Raw reading time (usually accurate as is)
    
    booksReadToday: Array.from(booksFinalMap.values()).sort((a, b) => b.timeSpentSec - a.timeSpentSec),
    
    activityTimeline: Array.from(timelineData.entries()).map(([hour, stats]) => ({
      hour: `${hour}:00`, pc: stats.pc, mobile: stats.mobile
    })).sort((a, b) => a.hour.localeCompare(b.hour)),
    
    pcAppHistory: {
      all: toArray(pcAppsMapAll),
      'Lenovo Yoga 7 Slim': toArray(pcAppsMapYoga),
      'PC Escritorio': toArray(pcAppsMapDesktop)
    },
    
    topMobileApps: toArray(mobileAppsMap),
    recentEvents: unifiedEvents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 20),
    
    // Note: Location Stats are still raw sum because deduping location context is complex without separating PC/Mobile slots
    // For now, raw sum is a good "presence" indicator.
    locationStats: { officeMinutes: rawOfficeMinutes, homeMinutes: rawHomeMinutes, outsideMinutes: rawOutsideMinutes },
    
    lastPcStatus,
    lastMobileStatus,
    debugInfo: {
      serverTime: new Date().toISOString(),
      queryStart: startIso,
      queryEnd: endIso,
      timezone: TIMEZONE
    }
  };
}
