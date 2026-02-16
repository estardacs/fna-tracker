import { supabase } from '@/lib/supabase'

export default async function Home() {
  // 1. Pedir los datos a Supabase
  const { data: metrics, error } = await supabase
    .from('metrics')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return <p>Error cargando datos...</p>;

  return (
    <main className="p-8 min-h-screen bg-slate-900 text-white">
      <h1 className="text-3xl font-bold mb-8 text-emerald-400">Mi Dashboard de Vida</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {metrics?.map((m) => (
          <div key={m.id} className="p-6 bg-slate-800 rounded-xl border border-slate-700 shadow-xl">
            <p className="text-slate-400 text-sm uppercase font-semibold">{m.metric_type}</p>
            <h2 className="text-4xl font-bold my-2">
              {m.value} <span className="text-lg font-normal text-slate-500">{m.unit}</span>
            </h2>
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-slate-700">
              <span className="text-xs text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
                {m.device_id}
              </span>
              <span className="text-xs text-slate-500">
                {new Date(m.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}