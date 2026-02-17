import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Esto le dice a Node que busque específicamente el archivo de Next.js
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Error: No se encontraron las variables en .env.local")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function test() {
  const { data, error } = await supabase
    .from('metrics')
    .insert([
      { 
        device_id: 'ubuntu-check', 
        metric_type: 'test-final', 
        value: 100 
      }
    ])
  
  if (error) console.log('Error ❌:', error.message)
  else console.log('¡Confirmado! ✅ Dato insertado sin flags extra.')
}

test()