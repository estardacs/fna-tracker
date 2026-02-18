'use client';

import { Monitor, Smartphone, LayoutGrid, Laptop, PcCase } from 'lucide-react';
import { clsx } from 'clsx';
import { useState } from 'react';

type AppItem = { name: string; minutes: number };

type AppsListProps = {
  title: string;
  type: 'pc' | 'mobile';
  apps: AppItem[] | { 
    all: AppItem[]; 
    'Lenovo Yoga 7 Slim': AppItem[]; 
    'PC Escritorio': AppItem[] 
  };
};

export default function AppsList({ title, apps, type }: AppsListProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'Lenovo Yoga 7 Slim' | 'PC Escritorio'>('all');

  const Icon = type === 'pc' ? Monitor : Smartphone;
  const colorClass = type === 'pc' ? 'text-blue-400' : 'text-emerald-400';
  const barClass = type === 'pc' ? 'bg-blue-500' : 'bg-emerald-500';

  // Determinar qué lista mostrar
  let currentList: AppItem[] = [];
  
  if (Array.isArray(apps)) {
    currentList = apps;
  } else {
    currentList = apps[activeTab] || [];
  }

  const maxVal = Math.max(...currentList.map(a => a.minutes), 1);
  const totalMinutes = currentList.reduce((acc, curr) => acc + curr.minutes, 0);

  return (
    <div className="bg-gray-900/50 p-6 rounded-xl border border-gray-800 h-[600px] flex flex-col">
      <div className="flex flex-col gap-4 mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <Icon className={clsx("w-5 h-5", colorClass)} />
          <h3 className="text-gray-200 font-semibold">{title}</h3>
        </div>

        {/* Tabs solo para PC */}
        {!Array.isArray(apps) && (
          <div className="flex gap-1 bg-gray-950/50 p-1 rounded-lg border border-gray-800">
            <TabButton 
              active={activeTab === 'all'} 
              onClick={() => setActiveTab('all')} 
              icon={<LayoutGrid className="w-3 h-3" />}
              label="Todos"
            />
            <TabButton 
              active={activeTab === 'Lenovo Yoga 7 Slim'} 
              onClick={() => setActiveTab('Lenovo Yoga 7 Slim')} 
              icon={<Laptop className="w-3 h-3" />}
              label="Laptop"
            />
            <TabButton 
              active={activeTab === 'PC Escritorio'} 
              onClick={() => setActiveTab('PC Escritorio')} 
              icon={<Monitor className="w-3 h-3" />}
              label="PC"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-0 space-y-4">
        {currentList.length === 0 ? (
          <p className="text-gray-500 text-sm italic">Sin actividad registrada.</p>
        ) : (
          currentList.map((app, idx) => (
            <div key={idx} className="group">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-300 truncate max-w-[70%] group-hover:text-white transition-colors" title={app.name}>
                  {app.name}
                </span>
                <span className="text-gray-400 font-mono text-xs">
                  {formatTime(app.minutes)}
                </span>
              </div>
              <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                <div 
                  className={clsx("h-full rounded-full opacity-80 transition-all duration-500", barClass)} 
                  style={{ width: `${(app.minutes / maxVal) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-800 flex justify-between items-center text-sm">
         <span className="text-gray-400">Total Activo</span>
         <span className="text-white font-mono font-bold">{formatTime(totalMinutes)}</span>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[10px] font-medium transition-colors cursor-pointer",
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

function formatTime(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  const s = Math.round((totalMinutes % 1) * 60);
  
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  const ss = s.toString().padStart(2, '0');
  
  return `${hh}:${mm}:${ss}`;
}
