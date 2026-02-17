import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

async function check() {
  console.log("🔍 Buscando dispositivos activos recientemente...")
  
  const { data, error } = await supabase
    .from('metrics')
    .select('device_id, created_at, metric_type')
    .order('created_at', { ascending: false })
    .limit(10)
  
  if (data && data.length > 0) {
    console.log("📡 Última actividad recibida:", JSON.stringify(data, null, 2))
  } else {
    console.log("⚠️ No hay actividad reciente.")
  }
}
check()