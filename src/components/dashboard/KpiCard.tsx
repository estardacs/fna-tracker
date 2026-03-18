import { ReactNode } from 'react';

type KpiCardProps = {
  title: string;
  value: string;
  icon: ReactNode;
  subtext: ReactNode;
  isLongText?: boolean;
  avgMinutes?: number;
  currentMinutes?: number;
};

export default function KpiCard({ title, value, icon, subtext, isLongText = false, avgMinutes, currentMinutes }: KpiCardProps) {
  let deltaBadge: ReactNode = null;
  if (avgMinutes != null && currentMinutes != null && avgMinutes > 0) {
    const deltaPct = ((currentMinutes - avgMinutes) / avgMinutes) * 100;
    const absStr = `${Math.abs(Math.round(deltaPct))}%`;
    if (deltaPct > 2) {
      deltaBadge = (
        <span className="inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">
          ↑ +{absStr}
        </span>
      );
    } else if (deltaPct < -2) {
      deltaBadge = (
        <span className="inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
          ↓ -{absStr}
        </span>
      );
    }
  }

  return (
    <div className="bg-gray-900/50 p-4 md:p-6 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors group h-full">
      <div className="flex justify-between items-start mb-3 md:mb-4">
        <span className="text-gray-400 text-xs md:text-sm font-medium uppercase tracking-wider">{title}</span>
        <div className="p-1.5 md:p-2 bg-gray-800/50 rounded-lg group-hover:bg-gray-800 transition-colors">
          {icon}
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-2xl md:text-4xl font-bold text-gray-100 tracking-tight mb-1">{value}</span>
        {deltaBadge && <div className="mb-1">{deltaBadge}</div>}
        <div className={`text-xs md:text-sm text-gray-500 ${isLongText ? '' : 'truncate'}`}>
          {subtext}
        </div>
      </div>
    </div>
  );
}
