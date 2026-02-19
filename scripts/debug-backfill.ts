
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { getDailyStats } from '../src/lib/data-processor';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function runBackfill() {
  console.log("--- DEBUG RUN: 16 Feb ---");
  const date = '2026-02-16';
  
  // This will trigger the logs in data-processor.ts
  await getDailyStats(date);
}

runBackfill();
