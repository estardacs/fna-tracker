'use client';

import { Smartphone, Monitor, BookOpen, Clock, Wifi, Battery, MapPin, LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import { clsx } from 'clsx';

type Event = {
  id: number;
  time: string;
  device: string;
  detail: string;
  duration: string;
  type: 'pc' | 'mobile' | 'reading';
  battery?: number;
  wifi?: string;
  locationType?: 'office' | 'home' | 'outside';
};

export default function RecentActivity({ events }: { events: Event[] }) {
  const [filter, setFilter] = useState<'all' | 'pc' | 'mobile'>('all');

  const filteredEvents = (filter === 'all' 
    ? events 
    : events.filter(e => e.type === filter)).slice(0, 20);

  return (
    <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-800 h-[600px] flex flex-col">
      <div className="flex flex-col gap-4 mb-6 shrink-0">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-gray-400" />
          <h3 className="text-gray-200 font-semibold">Log de Actividad</h3>
        </div>

        {/* Filtros */}
        <div className="flex gap-1 bg-gray-950/50 p-1 rounded-lg border border-gray-800">
          <FilterButton 
            active={filter === 'all'} 
            onClick={() => setFilter('all')} 
            icon={<LayoutGrid className="w-3 h-3" />}
            label="Todos"
          />
          <FilterButton 
            active={filter === 'pc'} 
            onClick={() => setFilter('pc')} 
            icon={<Monitor className="w-3 h-3" />}
            label="PC"
          />
          <FilterButton 
            active={filter === 'mobile'} 
            onClick={() => setFilter('mobile')} 
            icon={<Smartphone className="w-3 h-3" />}
            label="Móvil"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar min-h-0">
        {filteredEvents.length === 0 ? (
          <p className="text-gray-500 text-sm italic">Sin datos para este filtro.</p>
        ) : (
          filteredEvents.map((e) => {
            const loc = e.locationType;
            return (
              <div key={e.id} className="flex gap-4 items-start group relative border-l-2 border-gray-800 pl-12 pb-8 last:pb-0">
                
                {/* Icono de Tipo */}
                <div className="absolute left-[7px] top-0 bg-black rounded-full p-1.5 border-2 border-gray-800 z-20 shrink-0">
                  {e.type === 'pc' && <Monitor className="w-3.5 h-3.5 text-blue-500" />}
                  {e.type === 'mobile' && <Smartphone className="w-3.5 h-3.5 text-emerald-500" />}
                  {e.type === 'reading' && <BookOpen className="w-3.5 h-3.5 text-purple-500" />}
                </div>

                <div className="flex-1 min-w-0 -mt-1">
                  <div className="flex justify-between items-center mb-1.5">
                    <div className="flex items-center gap-2 max-w-full">
                      <span className="text-xs font-mono text-gray-400 shrink-0">{formatTime(e.time)}</span>
                      <span className="text-xs text-gray-300 font-medium truncate min-w-0">{e.device}</span>
                      
                      {/* Badge de Ubicación Dinámica */}
                      {loc && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1 shrink-0 ${
                          loc === 'office' ? 'bg-blue-500/10 text-blue-400' : 
                          loc === 'home' ? 'bg-green-500/10 text-green-400' : 
                          'bg-orange-500/10 text-orange-400'
                        }`}>
                          <MapPin className="w-3 h-3" />
                          {loc === 'office' ? 'Oficina' : loc === 'home' ? 'Casa' : 'Fuera'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Detalles (Badges) */}
                  {e.detail.includes(',') ? (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {e.detail.split(',').map((item, idx) => (
                        <span key={idx} className="text-[11px] bg-gray-800/50 text-gray-300 px-2 py-1 rounded border border-gray-700/50 break-words">
                          {item.trim()}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-300 mb-2 break-words group-hover:text-white transition-colors">
                      {e.detail}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    {e.duration !== '-' && <span className="bg-gray-800 px-1.5 py-0.5 rounded font-mono">{e.duration}</span>}
                    {e.wifi && <span className="flex items-center gap-1 text-blue-400/70"><Wifi className="w-3 h-3" /> {e.wifi}</span>}
                    {e.battery !== undefined && <span className="flex items-center gap-1"><Battery className="w-3 h-3" /> {e.battery}%</span>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatTime(isoString: string) {
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function FilterButton({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10px] font-medium transition-colors",
        active 
          ? "bg-gray-800 text-white shadow-sm" 
          : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
