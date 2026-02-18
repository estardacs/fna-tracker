import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// Load env vars
try {
  const env = fs.readFileSync('.env.local', 'utf8');
  env.split('\n').forEach(line => {
    const [key, val] = line.split('=');
    if (key && val) process.env[key.trim()] = val.trim();
  });
} catch (e) {
  console.log('No .env.local found, hoping vars are set.');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkGames() {
  console.log("🔍 Searching for games in last 1000 records...");

  const { data, error } = await supabase
    .from('metrics')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    console.error("Error:", error);
    return;
  }

  const matches = new Set();

  data.forEach(row => {
    const meta = row.metadata || {};
    const breakdown = meta.breakdown || {};
    
    // Check Process Name
    const proc = (meta.process_name || '').toLowerCase();
    if (proc.includes('league') || proc.includes('lol') || proc.includes('arknights') || proc.includes('endfield')) {
      matches.add(`Process: ${meta.process_name}`);
    }

    // Check Breakdown
    Object.keys(breakdown).forEach(app => {
      const lower = app.toLowerCase();
      if (lower.includes('league') || lower.includes('lol') || lower.includes('arknights') || lower.includes('endfield')) {
        matches.add(`Breakdown: ${app}`);
      }
    });
  });

  console.log("\n🎮 FOUND MATCHES:");
  matches.forEach(m => console.log(m));
}

checkGames();
