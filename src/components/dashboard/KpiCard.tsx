import { ReactNode } from 'react';

type KpiCardProps = {
  title: string;
  value: string;
  icon: ReactNode;
  subtext: ReactNode;
  isLongText?: boolean;
};

export default function KpiCard({ title, value, icon, subtext, isLongText = false }: KpiCardProps) {
  return (
    <div className="bg-gray-900/50 p-4 md:p-6 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors group h-full">
      <div className="flex justify-between items-start mb-3 md:mb-4">
        <span className="text-gray-400 text-[10px] md:text-sm font-medium uppercase tracking-wider">{title}</span>
        <div className="p-1.5 md:p-2 bg-gray-800/50 rounded-lg group-hover:bg-gray-800 transition-colors">
          {icon}
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-2xl md:text-4xl font-bold text-gray-100 tracking-tight mb-1">{value}</span>
        <div className={`text-xs md:text-sm text-gray-500 ${isLongText ? '' : 'truncate'}`}>
          {subtext}
        </div>
      </div>
    </div>
  );
}
