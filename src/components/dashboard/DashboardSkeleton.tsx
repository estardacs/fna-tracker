export default function DashboardSkeleton() {
  return (
    // The main container no longer has the animation class itself
    <div className="animate-pulse space-y-12">
      
      {/* Each section now gets its own animation with a delay */}
      <div style={{ animationDelay: '0ms' }} className="opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {[...Array(5)].map((_, i) => {
            const isLong = i >= 3; // Reading and Games
            return (
              <div key={i} className="bg-gray-900/50 p-6 rounded-xl border border-gray-800 h-full min-h-[160px] flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div className="h-3.5 w-24 bg-gray-800 rounded"></div>
                  <div className="h-8 w-8 bg-gray-800/40 rounded-lg"></div>
                </div>
                
                <div className="mt-auto">
                  <div className="h-9 w-36 bg-gray-700/40 rounded mb-4"></div>
                  <div className="space-y-2">
                    {isLong ? (
                      <div className="pl-2 border-l-2 border-gray-800/50 space-y-2">
                        <div className="h-3 w-3/4 bg-gray-800 rounded"></div>
                        <div className="flex gap-2">
                          <div className="h-4 w-12 bg-purple-500/10 rounded"></div>
                          <div className="h-4 w-14 bg-blue-500/10 rounded"></div>
                        </div>
                      </div>
                    ) : (
                      <div className="h-3.5 w-20 bg-gray-800/40 rounded"></div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ animationDelay: '150ms' }} className="opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
        <section className="h-96 bg-gray-900/50 rounded-xl border border-gray-800 p-8 flex items-end gap-2">
          {[...Array(24)].map((_, i) => (
            <div 
              key={i} 
              className="flex-1 bg-gray-800/10 rounded-t"
              style={{ height: `${[40, 20, 10, 5, 5, 10, 30, 60, 80, 70, 50, 40, 60, 90, 85, 60, 40, 30, 50, 70, 60, 40, 20, 10][i]}%` }}
            ></div>
          ))}
        </section>
      </div>

      <div style={{ animationDelay: '300ms' }} className="opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-gray-900/50 rounded-xl border border-gray-800 h-[600px] p-6 space-y-6">
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 bg-gray-800 rounded"></div>
                <div className="h-5 w-32 bg-gray-800 rounded"></div>
              </div>
              <div className="space-y-4">
                {[...Array(10)].map((_, j) => (
                  <div key={j} className="space-y-2">
                    <div className="flex justify-between">
                      <div className="h-3.5 w-1/2 bg-gray-800/50 rounded"></div>
                      <div className="h-3.5 w-12 bg-gray-800/50 rounded"></div>
                    </div>
                    <div className="h-1.5 w-full bg-gray-800/20 rounded-full"></div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ animationDelay: '450ms' }} className="opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]">
        <section className="h-40 bg-gray-900/50 rounded-xl border border-gray-800 p-6 flex items-end gap-1">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="flex-1 bg-gray-800/20 rounded h-24"></div>
          ))}
        </section>
      </div>

    </div>
  );
}
