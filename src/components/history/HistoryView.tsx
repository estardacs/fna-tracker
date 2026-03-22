'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { type HistoryPayload, type HistoryItem, type PeriodType } from '@/lib/history-processor';
import { cn } from '@/lib/utils';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area, LineChart, Line } from 'recharts';
import { format, parseISO, addWeeks, subWeeks, addMonths, subMonths, addYears, subYears, startOfWeek, addDays, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Moon, Footprints, Flame, UtensilsCrossed, Scale } from 'lucide-react';

// --- Components ---

function PeriodSelector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPeriod = (searchParams.get('period') as PeriodType) || 'weekly';

  const setPeriod = (period: PeriodType) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('period', period);
    params.delete('date');
    router.push(`?${params.toString()}`);
  };

  const periods: { label: string; value: PeriodType }[] = [
    { label: 'Semanal', value: 'weekly' },
    { label: 'Mensual', value: 'monthly' },
    { label: 'Anual', value: 'yearly' },
  ];

  return (
    <div className="flex items-center bg-gray-900/50 border border-gray-800 p-1 rounded-lg w-full md:w-auto overflow-x-auto no-scrollbar">
      {periods.map(({ label, value }) => (
        <button
          key={value}
          onClick={() => setPeriod(value)}
          className={cn(
            "flex-1 md:flex-none px-4 py-1.5 text-xs md:text-sm font-medium rounded-md transition-all duration-200 cursor-pointer whitespace-nowrap",
            currentPeriod === value
              ? "bg-gray-800 text-white shadow-sm"
              : "text-gray-400 hover:text-white"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DateNavigator({ currentPeriod, anchorDate }: { currentPeriod: PeriodType, anchorDate: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const navigate = (direction: 'prev' | 'next') => {
        // Use noon local time to avoid UTC midnight parsing as the previous day in Santiago timezone
        const date = parseISO(anchorDate.slice(0, 10) + 'T12:00:00');
        let newDate = date;

        if (currentPeriod === 'weekly') {
            newDate = direction === 'next' ? addWeeks(date, 1) : subWeeks(date, 1);
        } else if (currentPeriod === 'monthly') {
            newDate = direction === 'next' ? addMonths(date, 1) : subMonths(date, 1);
        } else {
            newDate = direction === 'next' ? addYears(date, 1) : subYears(date, 1);
        }

        const params = new URLSearchParams(searchParams.toString());
        params.set('date', format(newDate, 'yyyy-MM-dd'));
        router.push(`?${params.toString()}`);
    };

    const displayLabel = (() => {
        const d = parseISO(anchorDate.slice(0, 10) + 'T12:00:00');
        if (currentPeriod === 'weekly') return `Semana del ${format(startOfWeek(d, { weekStartsOn: 1 }), "d 'de' MMM", { locale: es })}`;
        if (currentPeriod === 'monthly') return format(d, "MMMM yyyy", { locale: es });
        return format(d, "yyyy");
    })();

    return (
        <div className="flex items-center gap-2 md:gap-4 bg-gray-900/50 border border-gray-800 px-2 md:px-4 py-1.5 rounded-lg w-full md:w-auto justify-between md:justify-start">
            <button onClick={() => navigate('prev')} className="p-1.5 hover:bg-gray-800 rounded-md transition-colors text-gray-400 hover:text-white cursor-pointer active:scale-90">
                <ChevronLeft size={20} />
            </button>
            <span className="text-xs md:text-sm font-medium text-gray-200 min-w-[120px] md:min-w-[160px] text-center capitalize truncate">{displayLabel}</span>
            <button onClick={() => navigate('next')} className="p-1.5 hover:bg-gray-800 rounded-md transition-colors text-gray-400 hover:text-white cursor-pointer active:scale-90">
                <ChevronRight size={20} />
            </button>
        </div>
    );
}

function SummaryStat({ label, value, colorClass, sub }: { label: string, value: string, colorClass: string, sub?: string }) {
    return (
        <div className="bg-gray-900/30 border border-gray-800/50 p-3 md:p-4 rounded-lg flex flex-col items-center justify-center text-center">
            <span className="text-[10px] md:text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</span>
            <span className={cn("text-lg md:text-2xl font-bold font-mono", colorClass)}>{value}</span>
            {sub && <span className="text-[10px] text-gray-600 font-mono mt-1">{sub}</span>}
        </div>
    );
}

function formatMinutes(minutes: number) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h ${m}m`;
}

function AggregatedList({ title, data, icon, colorClass }: { title: string, data: { name: string; minutes: number }[], icon: React.ReactNode, colorClass: string }) {
    if (!data || data.length === 0) return null;

    return (
        <div className="bg-gray-900/30 border border-gray-800/50 rounded-xl p-4 md:p-5 flex-1 min-w-[280px]">
            <h4 className="flex items-center gap-2 text-xs md:text-sm font-semibold text-gray-300 mb-4 uppercase tracking-wider">
                <span className={cn("p-1.5 rounded-md bg-opacity-10", colorClass.replace('text-', 'bg-'))}>{icon}</span>
                {title}
            </h4>
            <ul className="space-y-2">
                {data.map((item, i) => (
                    <li key={i} className="flex justify-between items-center group">
                        <span className="text-xs md:text-sm text-gray-400 truncate max-w-[65%] group-hover:text-gray-200 transition-colors" title={item.name}>
                            {item.name}
                        </span>
                        <span className="text-[10px] md:text-xs font-mono text-gray-500 bg-gray-950 px-2 py-0.5 rounded border border-gray-800 group-hover:border-gray-700">
                            {formatMinutes(item.minutes)}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function HistoryCard({ item, period }: { item: HistoryItem, period: PeriodType }) {
    const formatDate = (dateStr: string) => {
        const d = parseISO(dateStr);
        if (period === 'weekly' || period === 'monthly') return format(d, "EEEE d", { locale: es });
        return `Semana ${format(d, "w")}`;
    };

    const isDayCard = period === 'weekly' || period === 'monthly';

    return (
        <div className="bg-gray-900/40 border border-gray-800/50 rounded-lg p-4 hover:border-gray-700 hover:bg-gray-900/60 transition-all group h-full flex flex-col">
            <div className="flex justify-between items-start mb-3">
                <h4 className="text-sm font-medium text-gray-300 capitalize">{formatDate(item.dateKey)}</h4>
                <span className="text-[10px] font-mono text-gray-500 bg-gray-950 px-2 py-0.5 rounded border border-gray-800">
                    {formatMinutes(item.totalScreenTime)}
                </span>
            </div>

            <div className="flex h-1.5 w-full bg-gray-800 rounded-full overflow-hidden mb-4">
                <div style={{ width: `${(item.pcMinutes / (item.totalScreenTime || 1)) * 100}%` }} className="bg-blue-500/70" />
                <div style={{ width: `${(item.mobileMinutes / (item.totalScreenTime || 1)) * 100}%` }} className="bg-purple-500/70" />
            </div>

            <div className="space-y-1.5 text-[10px] md:text-xs mt-auto">
                {Array.from({ length: 3 }).map((_, i) => {
                    const app = item.topApps[i];
                    return app ? (
                        <div key={i} className="flex justify-between text-gray-500">
                            <span className="truncate max-w-[110px] md:max-w-[120px]" title={app.name}>{app.name}</span>
                            <span className="font-mono">{formatMinutes(app.minutes)}</span>
                        </div>
                    ) : (
                        <div key={i} className="flex justify-between text-gray-800">
                            <span>—</span>
                            <span className="font-mono">—</span>
                        </div>
                    );
                })}
                <div className="pt-1.5 border-t border-gray-800/50 mt-1 space-y-1.5">
                    <div className="flex items-center">
                        <span className={cn("flex items-center gap-1 w-16 shrink-0", item.sleepMinutes > 0 ? "text-indigo-400/80" : "text-gray-700")}>
                            <Moon className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{item.sleepMinutes > 0 ? formatMinutes(item.sleepMinutes) : '—'}</span>
                        </span>
                        <span className={cn("flex items-center gap-1 w-12 shrink-0", (item.steps ?? 0) > 0 ? "text-emerald-400/80" : "text-gray-700")}>
                            <Footprints className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{(item.steps ?? 0) >= 1000 ? `${((item.steps ?? 0) / 1000).toFixed(1)}k` : (item.steps ?? 0)}</span>
                        </span>
                        <span className={cn("flex items-center gap-1 w-14 shrink-0", item.weightKg !== null ? "text-sky-400/80" : "text-gray-700")}>
                            <Scale className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{item.weightKg !== null ? `${item.weightKg}kg` : '—'}</span>
                        </span>
                        <span className={cn("flex items-center gap-1 w-20 shrink-0", item.calories > 0 ? "text-orange-400/80" : "text-gray-700")}>
                            <Flame className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{item.calories > 0 ? `${item.calories.toFixed(0)} kcal` : '— kcal'}</span>
                        </span>
                        {isDayCard && item.calories > 0 ? (
                            <Link href={`/diet?date=${item.dateKey}`} className="flex items-center gap-1 text-amber-500/70 hover:text-amber-400 transition-colors ml-auto shrink-0" title="Ver dieta completa de este día">
                                <UtensilsCrossed className="w-2.5 h-2.5 shrink-0" />
                                <span>dieta</span>
                            </Link>
                        ) : (
                            <span className="ml-auto" />
                        )}
                    </div>
                    <div className="space-y-0.5">
                        {Array.from({ length: 4 }).map((_, i) => {
                            const f = item.topFoods[i];
                            return f ? (
                                <div key={i} className="flex justify-between text-gray-600 text-[9px] md:text-[10px]">
                                    <span className="truncate max-w-[120px]" title={f.name}>{f.name}</span>
                                    <span className="font-mono shrink-0 ml-1">{f.cal} kcal</span>
                                </div>
                            ) : (
                                <div key={i} className="flex justify-between text-gray-800 text-[9px] md:text-[10px]">
                                    <span>—</span>
                                    <span className="font-mono">—</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- Main View ---

export default function HistoryView({ data }: { data: HistoryPayload }) {
  const { period, items, totals, requestDate } = data;

  return (
    <div className="animate-in fade-in duration-500 slide-in-from-bottom-2">
      
      {/* Top Controls */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <PeriodSelector />
        <DateNavigator currentPeriod={period} anchorDate={requestDate} />
      </div>

      {/* Totals Summary Grid */}
      {(() => {
        const pl = period === 'yearly' ? '/sem' : '/día';
        const dST  = items.filter(i => i.totalScreenTime > 0).length || 1;
        const dPC  = items.filter(i => i.pcMinutes > 0).length || 1;
        const dMob = items.filter(i => i.mobileMinutes > 0).length || 1;
        const dRd  = items.filter(i => i.readingMinutes > 0).length || 1;
        const dGm  = items.filter(i => i.gamingMinutes > 0).length || 1;
        const dSl  = items.filter(i => i.sleepMinutes > 0).length || 1;
        const dCal = items.filter(i => i.calories > 0).length || 1;
        return (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4 mb-4">
              <SummaryStat label="Tiempo Total" value={formatMinutes(totals.screenTime)} colorClass="text-white"
                sub={`~${formatMinutes(Math.round(totals.screenTime / dST))}${pl}`} />
              <SummaryStat label="PC" value={formatMinutes(totals.pc)} colorClass="text-blue-400"
                sub={totals.pc > 0 ? `~${formatMinutes(Math.round(totals.pc / dPC))}${pl}` : undefined} />
              <SummaryStat label="Móvil" value={formatMinutes(totals.mobile)} colorClass="text-purple-400"
                sub={totals.mobile > 0 ? `~${formatMinutes(Math.round(totals.mobile / dMob))}${pl}` : undefined} />
              <SummaryStat label="Lectura" value={formatMinutes(totals.reading)} colorClass="text-green-400"
                sub={totals.reading > 0 ? `~${formatMinutes(Math.round(totals.reading / dRd))}${pl}` : undefined} />
              <SummaryStat label="Juego" value={formatMinutes(totals.gaming)} colorClass="text-indigo-400"
                sub={totals.gaming > 0 ? `~${formatMinutes(Math.round(totals.gaming / dGm))}${pl}` : undefined} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4 mb-8">
              {totals.totalSleepMinutes > 0 && (
                <SummaryStat label="Sueño" value={formatMinutes(totals.totalSleepMinutes)} colorClass="text-indigo-300"
                  sub={`~${formatMinutes(Math.round(totals.totalSleepMinutes / dSl))}${period === 'yearly' ? '/sem' : '/noche'}`} />
              )}
              {totals.totalCalories > 0 && (
                <SummaryStat label="Calorías" value={`${totals.totalCalories.toFixed(0)} kcal`} colorClass="text-orange-400"
                  sub={`~${Math.round(totals.totalCalories / dCal)} kcal${pl}`} />
              )}
              {totals.totalSteps > 0 && (
                <SummaryStat label="Pasos" value={totals.totalSteps >= 1000 ? `${(totals.totalSteps / 1000).toFixed(0)}k` : `${totals.totalSteps}`} colorClass="text-emerald-400" />
              )}
              {totals.avgRhr > 0 && (
                <SummaryStat label="FC Reposo" value={`${totals.avgRhr} bpm`} colorClass="text-red-400" sub="promedio" />
              )}
              {totals.totalCaloriesBurned > 0 && (
                <SummaryStat label="Kcal Quemadas" value={`${Math.round(totals.totalCaloriesBurned)}`} colorClass="text-rose-400"
                  sub={`~${Math.round(totals.totalCaloriesBurned / (items.filter(i => i.caloriesBurned > 0).length || 1))}${period === 'yearly' ? '/sem' : '/día'}`} />
              )}
              {totals.home > 0 && (
                <SummaryStat label="En Casa" value={formatMinutes(totals.home)} colorClass="text-emerald-400" />
              )}
              {totals.office > 0 && (
                <SummaryStat label="En Oficina" value={formatMinutes(totals.office)} colorClass="text-blue-500" />
              )}
              {totals.outside > 0 && (
                <SummaryStat label="Fuera" value={formatMinutes(totals.outside)} colorClass="text-orange-400" />
              )}
            </div>
          </>
        );
      })()}

      {/* Chart */}
      <div className="h-[250px] md:h-[350px] bg-gray-900/30 border border-gray-800 rounded-xl p-2 md:p-4 mb-8 relative">
         <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={items} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.2} />
                <XAxis 
                    dataKey="dateKey" 
                    tickFormatter={(val) => {
                        const d = parseISO(val);
                        if (period === 'weekly') return format(d, 'EEE', { locale: es });
                        if (period === 'monthly') return format(d, 'd', { locale: es });
                        return format(d, 'MMM', { locale: es });
                    }}
                    stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} dy={10} 
                />
                <YAxis hide />
                <Tooltip 
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6', fontSize: '12px' }}
                    labelFormatter={(val) => format(parseISO(val), "d MMM yyyy", { locale: es })}
                    formatter={(val: any) => [formatMinutes(Number(val) || 0), 'Tiempo']}
                />
                <Area type="monotone" dataKey="totalScreenTime" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorTotal)" />
            </AreaChart>
         </ResponsiveContainer>
      </div>

      {/* Weight Trend Chart */}
      {(() => {
        const weightPoints = items.filter(i => i.weightKg !== null);
        if (weightPoints.length < 2) return null;
        const weights = weightPoints.map(i => i.weightKg as number);
        const minW = Math.min(...weights);
        const maxW = Math.max(...weights);
        const domainMin = Math.floor(minW - 0.5);
        const domainMax = Math.ceil(maxW + 0.5);
        return (
          <div className="h-[160px] bg-gray-900/30 border border-gray-800 rounded-xl p-3 md:p-4 mb-6">
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Peso (kg)</p>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={weightPoints} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.2} />
                <XAxis
                  dataKey="dateKey"
                  tickFormatter={(val) => {
                    const d = parseISO(val);
                    if (period === 'weekly') return format(d, 'EEE', { locale: es });
                    if (period === 'monthly') return format(d, 'd', { locale: es });
                    return format(d, 'MMM', { locale: es });
                  }}
                  stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} dy={8}
                />
                <YAxis domain={[domainMin, domainMax]} stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} tickCount={4} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6', fontSize: '12px' }}
                  labelFormatter={(val) => format(parseISO(val), "d MMM yyyy", { locale: es })}
                  formatter={(val: any) => [`${Number(val).toFixed(1)} kg`, 'Peso']}
                  cursor={false}
                />
                <Line type="monotone" dataKey="weightKg" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })()}

      {/* Macro Trends Chart */}
      {items.some(i => i.proteinG > 0) && (
        <div className="h-[200px] bg-gray-900/30 border border-gray-800 rounded-xl p-3 md:p-4 mb-8">
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">
            Macros — Prot <span className="text-cyan-400">{Math.round(totals.totalProteinG)}g</span>
            {' · '}Carbs <span className="text-amber-400">{Math.round(totals.totalCarbsG)}g</span>
            {' · '}Grasas <span className="text-rose-400">{Math.round(totals.totalFatG)}g</span>
          </p>
          <ResponsiveContainer width="100%" height="80%">
            <AreaChart data={items} margin={{ top: 4, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gProt"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22d3ee" stopOpacity={0.4}/><stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/></linearGradient>
                <linearGradient id="gCarbs" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fbbf24" stopOpacity={0.4}/><stop offset="95%" stopColor="#fbbf24" stopOpacity={0}/></linearGradient>
                <linearGradient id="gFat"   x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fb7185" stopOpacity={0.4}/><stop offset="95%" stopColor="#fb7185" stopOpacity={0}/></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} opacity={0.2} />
              <XAxis
                dataKey="dateKey"
                tickFormatter={(val) => {
                  const d = parseISO(val);
                  if (period === 'weekly') return format(d, 'EEE', { locale: es });
                  if (period === 'monthly') return format(d, 'd', { locale: es });
                  return format(d, 'MMM', { locale: es });
                }}
                stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} dy={8}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', color: '#f3f4f6', fontSize: '11px' }}
                labelFormatter={(val) => format(parseISO(val), "d MMM yyyy", { locale: es })}
                formatter={(val: any, name: string | undefined) => {
                  const labels: Record<string, string> = { proteinG: 'Proteína', carbsG: 'Carbos', fatG: 'Grasas' };
                  return [`${Math.round(Number(val))}g`, labels[name ?? ''] ?? (name ?? '')];
                }}
              />
              <Area type="monotone" dataKey="proteinG" stroke="#22d3ee" strokeWidth={1.5} fill="url(#gProt)"  />
              <Area type="monotone" dataKey="carbsG"   stroke="#fbbf24" strokeWidth={1.5} fill="url(#gCarbs)" />
              <Area type="monotone" dataKey="fatG"     stroke="#fb7185" strokeWidth={1.5} fill="url(#gFat)"   />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Aggregated Detail Section */}
      {(totals.topApps.length > 0 || totals.topGames.length > 0 || totals.topBooks.length > 0) && (
          <div className="mb-10">
              <h3 className="text-[10px] md:text-sm font-medium text-gray-500 mb-4 uppercase tracking-widest">Actividad Destacada</h3>
              <div className="flex flex-wrap gap-4 md:gap-6">
                  <AggregatedList title="Apps" data={totals.topApps} icon={<span>📱</span>} colorClass="text-blue-400" />
                  <AggregatedList title="Juegos" data={totals.topGames} icon={<span>🎮</span>} colorClass="text-indigo-400" />
                  <AggregatedList title="Libros" data={totals.topBooks} icon={<span>📚</span>} colorClass="text-emerald-400" />
              </div>
          </div>
      )}

      {/* Detailed Items Grid */}
      <h3 className="text-[10px] md:text-sm font-medium text-gray-500 mb-4 uppercase tracking-widest">
        {period === 'weekly' ? 'Días de la Semana' : (period === 'monthly' ? 'Días del Mes' : 'Semanas del Año')}
      </h3>
      {items.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {items.map((item) => (
                <HistoryCard key={item.dateKey} item={item} period={period} />
            ))}
        </div>
      ) : (
        <div className="text-center py-16 text-gray-500 border border-dashed border-gray-800 rounded-xl bg-gray-900/20">
            No hay registros para este periodo.
        </div>
      )}

    </div>
  );
}
