import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

async function checkMobileReading() {
  console.log("🔍 Buscando registros de Moon+ Reader en el móvil...")
  
  const { data, error } = await supabase
    .from('metrics')
    .select('*')
    .eq('device_id', 'oppo-5-lite')
    .ilike('metadata->>app_name', '%Moon%') // Busca "Moon" en el nombre de la app
    .limit(5)
  
  if (data && data.length > 0) {
    console.log("✅ Encontrados:", data)
  } else {
    console.log("❌ No se encontró uso de Moon+ Reader en el móvil todavía.")
    console.log("👉 Abre la app Moon+ Reader en tu Oppo y ciérrala para generar un evento.")
  }
}

checkMobileReading()