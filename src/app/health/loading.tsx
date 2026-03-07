export default function HealthLoading() {
  return (
    <div className="animate-pulse space-y-8 mt-8">
      {/* KPIs */}
      <div style={{ animationDelay: '0ms' }} className="opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-gray-900/50 p-4 md:p-6 rounded-xl border border-gray-800 min-h-[120px] flex flex-col gap-3">
              <div className="flex justify-between">
                <div className="h-3 w-20 bg-gray-800 rounded" />
                <div className="h-7 w-7 bg-gray-800/40 rounded-lg" />
              </div>
              <div className="h-8 w-28 bg-gray-700/40 rounded mt-auto" />
              <div className="h-3 w-16 bg-gray-800/40 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* HR Chart */}
      <div style={{ animationDelay: '150ms' }} className="opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
        <div className="h-[220px] bg-gray-900/50 rounded-xl border border-gray-800" />
      </div>

      {/* Stress + Sleep */}
      <div style={{ animationDelay: '300ms' }} className="opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-[220px] bg-gray-900/50 rounded-xl border border-gray-800" />
          <div className="h-[220px] bg-gray-900/50 rounded-xl border border-gray-800" />
        </div>
      </div>

      {/* Weight + Workouts */}
      <div style={{ animationDelay: '450ms' }} className="opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-[220px] bg-gray-900/50 rounded-xl border border-gray-800" />
          <div className="h-[220px] bg-gray-900/50 rounded-xl border border-gray-800" />
        </div>
      </div>

      {/* Weekly grid */}
      <div style={{ animationDelay: '550ms' }} className="opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
        <div className="h-28 bg-gray-900/50 rounded-xl border border-gray-800" />
      </div>
    </div>
  );
}
