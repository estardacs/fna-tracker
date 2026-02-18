import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load env vars
try {
  const env = fs.readFileSync('.env.local', 'utf8');
  env.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      process.env[key] = val;
    }
  });
} catch (e) {}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBooks() {
  console.log("📖 Buscando títulos de libros...");

  const { data, error } = await supabase
    .from('metrics')
    .select('metadata')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error(error);
    return;
  }

  const titles = new Set();
  data.forEach(row => {
    const meta = row.metadata || {};
    if (meta.book_title) titles.add(meta.book_title);
    if (meta.app_name?.toLowerCase().includes('moon')) {
       // Search for book title in mobile metadata too if available
    }
  });

  console.log("\n📚 Títulos encontrados:");
  titles.forEach(t => console.log(`"${t}"`));
}

checkBooks();
