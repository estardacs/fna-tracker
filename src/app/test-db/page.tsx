import { createClient } from '@supabase/supabase-js';
import { unstable_noStore as noStore } from 'next/cache';

export const dynamic = 'force-dynamic';

export default async function TestDBPage() {
  noStore();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  const status = {
    urlConfigured: !!url,
    keyConfigured: !!key,
    serverTime: new Date().toISOString(),
  };

  let queryResult = null;
  let errorMsg = null;
  let recordCount = 0;

  if (url && key) {
    try {
      const supabase = createClient(url, key);
      
      // 1. Simple count
      const { count, error: countError } = await supabase
        .from('metrics')
        .select('*', { count: 'exact', head: true });
      
      if (countError) throw countError;
      recordCount = count || 0;

      // 2. Fetch last 5 records
      const { data, error } = await supabase
        .from('metrics')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      queryResult = data;

    } catch (err: any) {
      errorMsg = err.message || JSON.stringify(err);
    }
  } else {
    errorMsg = "Variables de entorno no encontradas (URL o Key faltante).";
  }

  return (
    <div className="min-h-screen bg-black text-green-400 p-8 font-mono text-sm">
      <h1 className="text-xl font-bold mb-6 text-white border-b border-gray-800 pb-2">
        Diagnóstico de Conexión Supabase (Vercel)
      </h1>

      <div className="grid gap-6">
        {/* Configuración */}
        <section className="bg-gray-900 p-4 rounded border border-gray-800">
          <h2 className="text-white mb-2 font-bold">1. Configuración de Entorno</h2>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <span>SUPABASE_URL:</span>
            <span className={status.urlConfigured ? "text-blue-400" : "text-red-500"}>
              {status.urlConfigured ? "✅ Presente" : "❌ FALTANTE"}
            </span>
            
            <span>SUPABASE_KEY:</span>
            <span className={status.keyConfigured ? "text-blue-400" : "text-red-500"}>
              {status.keyConfigured ? "✅ Presente" : "❌ FALTANTE"}
            </span>
          </div>
        </section>

        {/* Tiempo */}
        <section className="bg-gray-900 p-4 rounded border border-gray-800">
          <h2 className="text-white mb-2 font-bold">2. Tiempo del Servidor</h2>
          <p>UTC Time: <span className="text-white">{status.serverTime}</span></p>
          <p className="text-gray-500 text-xs mt-1">
            * Compara esto con la hora de tus registros. Si tus registros están en el futuro respecto a esta hora, no aparecerán en las consultas de "hoy".
          </p>
        </section>

        {/* Resultados */}
        <section className="bg-gray-900 p-4 rounded border border-gray-800">
          <h2 className="text-white mb-2 font-bold">3. Prueba de Consulta (Últimos 5 registros)</h2>
          
          {errorMsg ? (
            <div className="bg-red-900/20 border border-red-500 p-4 rounded text-red-200">
              <p className="font-bold">❌ Error:</p>
              <pre className="whitespace-pre-wrap mt-2">{errorMsg}</pre>
            </div>
          ) : (
            <div>
              <p className="mb-2">Total registros en tabla: <span className="text-white font-bold">{recordCount}</span></p>
              
              {queryResult && queryResult.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-700 text-gray-500">
                        <th className="py-2 px-2">Created At (UTC)</th>
                        <th className="py-2 px-2">Device</th>
                        <th className="py-2 px-2">Metric</th>
                        <th className="py-2 px-2">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queryResult.map((row: any) => (
                        <tr key={row.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                          <td className="py-2 px-2 text-white">{row.created_at}</td>
                          <td className="py-2 px-2">{row.device_id}</td>
                          <td className="py-2 px-2">{row.metric_type}</td>
                          <td className="py-2 px-2">{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-yellow-500">⚠️ Conexión exitosa, pero la tabla 'metrics' está vacía.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
