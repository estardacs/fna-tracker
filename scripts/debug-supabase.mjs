import { createClient } from '@supabase/supabase-js';

// Load env vars from .env.local if available, or just use the ones we saw
// Since dotenv doesn't auto-load .env.local by default usually, we might need to specify path or just hardcode for this test if we can't load it easily.
// But let's try to read it manually or assume the user runs it with env vars.
// Actually, I'll just read the file manually to be sure.

import fs from 'fs';
import path from 'path';

function loadEnv() {
  try {
    const envPath = path.resolve('.env.local');
    const envConfig = fs.readFileSync(envPath, 'utf8');
    const lines = envConfig.split('\n');
    const env = {};
    for (const line of lines) {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        env[key] = val;
      }
    }
    return env;
  } catch (e) {
    console.error('Could not read .env.local', e);
    return {};
  }
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('URL:', url);
console.log('Key (first 5 chars):', key ? key.substring(0, 5) : 'undefined');

if (!url || !key) {
  console.error('Missing URL or Key');
  process.exit(1);
}

const supabase = createClient(url, key);

async function test() {
  console.log('Attempting to fetch data...');
  try {
    const { data, error } = await supabase.from('metrics').select('*').limit(1);
    if (error) {
      console.error('Supabase Error:', error);
    } else {
      console.log('Success! Data:', data);
    }
  } catch (err) {
    console.error('Unexpected Error:', err);
  }
}

test();
