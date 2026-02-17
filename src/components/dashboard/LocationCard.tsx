import { MapPin, Battery, BatteryCharging, Wifi, Laptop, Smartphone } from 'lucide-react';

type Props = {
  officeMinutes: number;
  homeMinutes: number;
  outsideMinutes: number;
  lastStatus: {
    battery: number;
    wifi: string;
    lastSeen: string;
    isCharging: boolean;
  } | null;
  lastMobileStatus?: {
    wifi: string;
    lastSeen: string;
  } | null;
};

export default function LocationCard({ officeMinutes, homeMinutes, outsideMinutes, lastStatus, lastMobileStatus }: Props) {
  const total = officeMinutes + homeMinutes + outsideMinutes;
  
  const getPct = (min: number) => total > 0 ? (min / total) * 100 : 0;
  const officePct = getPct(officeMinutes);
  const homePct = getPct(homeMinutes);
  const outsidePct = getPct(outsideMinutes);
  
  return (
    <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-800 h-[600px] flex flex-col">
      
      <div className="flex items-center gap-2 mb-6 shrink-0">
        <MapPin className="w-5 h-5 text-gray-400" />
        <h3 className="text-gray-200 font-semibold">Contexto & Estado</h3>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-0 flex flex-col gap-6">
        {/* Balance Bar - 3 Segmentos */}
        <div>
          <div className="flex justify-between text-[10px] text-gray-400 mb-2 uppercase tracking-tighter">
            <span>🏢 Oficina ({Math.round(officePct)}%)</span>
            <span>🏠 Casa ({Math.round(homePct)}%)</span>
            <span>🚶 Fuera ({Math.round(outsidePct)}%)</span>
          </div>
          <div className="h-3 w-full bg-gray-800 rounded-full overflow-hidden flex">
            <div className="h-full bg-blue-500" style={{ width: `${officePct}%` }} />
            <div className="h-full bg-emerald-500" style={{ width: `${homePct}%` }} />
            <div className="h-full bg-orange-500" style={{ width: `${outsidePct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 mt-1 font-mono">
            <span>{formatTime(officeMinutes)}</span>
            <span>{formatTime(homeMinutes)}</span>
            <span>{formatTime(outsideMinutes)}</span>
          </div>
        </div>

        {/* System Status (PC) */}
        {lastStatus ? (
          <div className="bg-black/30 p-4 rounded-lg border border-gray-800/50">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-3 uppercase tracking-wider font-medium border-b border-gray-800/50 pb-2">
              <Laptop className="w-3 h-3" /> Estado PC Actual
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-gray-900 ${lastStatus.wifi === 'GeCo' ? 'text-blue-400' : 'text-emerald-400'}`}>
                  <Wifi className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-gray-200 text-sm font-medium truncate">{lastStatus.wifi}</p>
                  <p className="text-[10px] text-gray-500">Red Wi-Fi</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-gray-900 ${lastStatus.isCharging ? 'text-yellow-400' : getBatteryColor(lastStatus.battery)}`}>
                  {lastStatus.isCharging ? <BatteryCharging className="w-5 h-5 animate-pulse" /> : <Battery className="w-5 h-5" />}
                </div>
                <div>
                  <p className="text-gray-200 text-sm font-medium">{lastStatus.battery}%</p>
                  <p className="text-[10px] text-gray-500">{lastStatus.isCharging ? 'Cargando' : 'Batería'}</p>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-800/50 text-[10px] text-gray-600 text-right font-mono">
              Último latido: {new Date(lastStatus.lastSeen).toLocaleTimeString()}
            </div>
          </div>
        ) : null}

        {/* Mobile Status */}
        {lastMobileStatus ? (
          <div className="bg-black/30 p-4 rounded-lg border border-gray-800/50">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-3 uppercase tracking-wider font-medium border-b border-gray-800/50 pb-2">
              <Smartphone className="w-3 h-3" /> Estado Teléfono
            </div>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-gray-900 ${lastMobileStatus.wifi === 'GeCo' ? 'text-blue-400' : 'text-emerald-400'}`}>
                <Wifi className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-gray-200 text-sm font-medium truncate">{lastMobileStatus.wifi}</p>
                <p className="text-[10px] text-gray-500">Red Wi-Fi</p>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-800/50 text-[10px] text-gray-600 text-right font-mono">
              Último latido: {new Date(lastMobileStatus.lastSeen).toLocaleTimeString()}
            </div>
          </div>
        ) : null}

      </div>
    </div>
  );
}

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const s = Math.round((minutes % 1) * 60);
  
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  
  return `${hh}:${mm}:${ss}`;
}

function getBatteryColor(level: number) {
  if (level > 50) return 'text-green-400';
  if (level > 20) return 'text-yellow-400';
  return 'text-red-400';
}
