'use client';

import { MapPin, Wifi, Battery, BatteryCharging } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

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
  breakdown?: {
    pc: { office: number; home: number; outside: number };
    mobile: { office: number; home: number; outside: number };
    screenTime: { office: number; home: number; outside: number };
  };
  screenTimeTotal?: number;
};

export default function LocationCard({ officeMinutes, homeMinutes, outsideMinutes, lastStatus, lastMobileStatus, screenTimeTotal }: Props) {
  
  // Calculate Adjustment Ratio if exact total is provided
  const rawTotal = officeMinutes + homeMinutes + outsideMinutes;
  const ratio = (screenTimeTotal && rawTotal > 0) ? screenTimeTotal / rawTotal : 1;

  const adjOffice = officeMinutes * ratio;
  const adjHome = homeMinutes * ratio;
  const adjOutside = outsideMinutes * ratio;

  const data = [
    { name: 'Oficina', value: adjOffice, color: '#3b82f6' }, 
    { name: 'Casa', value: adjHome, color: '#10b981' },   
    { name: 'Fuera', value: adjOutside, color: '#f97316' }, 
  ].filter(d => d.value > 0);

  const total = screenTimeTotal || rawTotal;

  // Unify Status Logic
  const primaryStatus = lastStatus || lastMobileStatus; 
  // Prefer PC status if available, else Mobile. 
  // Assumption: They are likely together or one is the primary context.

  return (
    <div className="bg-gray-900/50 p-4 md:p-6 rounded-xl border border-gray-800 h-[450px] md:h-[600px] flex flex-col">
      
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <MapPin className="w-4 h-4 md:w-5 md:h-5 text-gray-400" />
        <h3 className="text-gray-200 text-sm md:text-base font-semibold">Contexto</h3>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        
        {/* Chart Container - Balanced Space */}
        <div className="flex-1 relative min-h-[180px] md:min-h-[220px] max-h-[260px] mt-2 mb-2">
          {total === 0 ? (
             <div className="h-full flex items-center justify-center text-gray-500 text-xs md:text-sm italic">
               Sin datos de ubicación
             </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    paddingAngle={6}
                    dataKey="value"
                    stroke="none"
                    cornerRadius={4}
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0.5rem', color: '#f8fafc', fontSize: '10px', padding: '6px' }}
                    itemStyle={{ color: '#e2e8f0' }}
                    formatter={(value: any) => [formatTime(value || 0), 'Tiempo']}
                    separator=": "
                    cursor={false}
                    position={{ y: 0 }} 
                  />
                </PieChart>
              </ResponsiveContainer>
              
              {/* Center Text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="flex flex-col items-center">
                   <span className="text-xl md:text-2xl font-mono font-medium text-gray-400 tracking-tight leading-none">
                    {Math.floor(total / 60)}<span className="text-xs ml-0.5">h</span>
                    {Math.round(total % 60)}<span className="text-xs ml-0.5">m</span>
                  </span>
                  <span className="text-[8px] md:text-[10px] text-gray-500 uppercase tracking-widest font-medium mt-1 opacity-70">Total</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Compact Legend - Moved closer */}
        <div className="flex justify-center gap-3 md:gap-4 pt-1 pb-3 md:pb-4 border-b border-gray-800/50">
          <LegendItem label="Oficina" value={adjOffice} color="bg-blue-500" total={total} />
          <LegendItem label="Casa" value={adjHome} color="bg-emerald-500" total={total} />
          <LegendItem label="Fuera" value={adjOutside} color="bg-orange-500" total={total} />
        </div>

        {/* Dual Status Footer */}
        <div className="mt-3 md:mt-4 flex flex-col gap-2">
          {/* PC Status */}
          {lastStatus && (
            <div className="bg-black/20 rounded-lg px-2 md:px-3 py-1.5 md:py-2 border border-gray-800/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`p-1 md:p-1.5 rounded-md bg-gray-950 ${lastStatus.wifi === 'Oficina' ? 'text-blue-400' : lastStatus.wifi === 'Desconocido' || lastStatus.wifi === 'Sin SSID' ? 'text-orange-400' : 'text-emerald-400'}`}>
                  <Wifi className="w-3 h-3 md:w-3.5 md:h-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-gray-200 text-[10px] md:text-[11px] font-medium truncate max-w-[100px] md:max-w-[120px] leading-tight">{lastStatus.wifi}</p>
                  <p className="text-[8px] md:text-[9px] text-gray-500 uppercase tracking-tighter">Wi-Fi PC</p>
                </div>
              </div>
              <div className="flex items-center gap-2 border-l border-gray-800/50 pl-2 md:pl-3">
                <div className={`${lastStatus.isCharging ? 'text-yellow-400' : getBatteryColor(lastStatus.battery)}`}>
                  {lastStatus.isCharging ? <BatteryCharging className="w-3 h-3 md:w-3.5 md:h-3.5" /> : <Battery className="w-3 h-3 md:w-3.5 md:h-3.5" />}
                </div>
                <p className="text-gray-200 text-[10px] md:text-[11px] font-mono">{lastStatus.battery}%</p>
              </div>
            </div>
          )}

          {/* Mobile Status */}
          {lastMobileStatus && (
            <div className="bg-black/20 rounded-lg px-2 md:px-3 py-1.5 md:py-2 border border-gray-800/50 flex items-center gap-2">
              <div className={`p-1 md:p-1.5 rounded-md bg-gray-950 ${lastMobileStatus.wifi === 'Oficina' ? 'text-blue-400' : lastMobileStatus.wifi === 'Desconocido' || lastMobileStatus.wifi === 'Sin SSID' ? 'text-orange-400' : 'text-emerald-400'}`}>
                <Wifi className="w-3 h-3 md:w-3.5 md:h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-gray-200 text-[10px] md:text-[11px] font-medium truncate max-w-[150px] md:max-w-[180px] leading-tight">{lastMobileStatus.wifi}</p>
                <p className="text-[8px] md:text-[9px] text-gray-500 uppercase tracking-tighter">Wi-Fi Teléfono</p>
              </div>
            </div>
          )}

          <div className="text-[8px] md:text-[9px] text-gray-600 text-center mt-1 font-mono">
            Últ. sinc: {formatLastSeen(lastStatus?.lastSeen || lastMobileStatus?.lastSeen || '')}
          </div>
        </div>

      </div>
    </div>
  );
}

function LegendItem({ label, value, color, total }: any) {
  if (value === 0) return null;
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <div className="flex flex-col leading-none">
        <span className="text-[10px] text-gray-400 uppercase">{label}</span>
        <span className="text-xs font-bold text-gray-200">{pct}%</span>
      </div>
    </div>
  );
}

function formatLastSeen(isoString: string) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(isoString));
}

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

function getBatteryColor(level: number) {
  if (level > 50) return 'text-green-400';
  if (level > 20) return 'text-yellow-400';
  return 'text-red-400';
}
