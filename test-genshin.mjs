import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
try {
  const env = fs.readFileSync('.env.local', 'utf8');
  env.split('\n').forEach(line => {
    const [key, val] = line.split('=');
    if (key && val) process.env[key.trim()] = val.trim();
  });
} catch (e) {}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, error } = await supabase
    .from('metrics')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return console.error(error);
  const matches = new Set();
  data.forEach(row => {
    const meta = row.metadata || {};
    const breakdown = meta.breakdown || {};
    const proc = (meta.process_name || '').toLowerCase();
    if (proc.includes('genshin')) matches.add(`Process: ${meta.process_name}`);
    Object.keys(breakdown).forEach(app => {
      if (app.toLowerCase().includes('genshin')) matches.add(`Breakdown: ${app}`);
    });
  });
  console.log("Matches:", Array.from(matches));
}
check();
