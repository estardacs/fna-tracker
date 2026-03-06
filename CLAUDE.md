# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at localhost:3000
npm run build    # Build for production (also type-checks)
npm run lint     # Run ESLint
```

No test suite exists. Use `/test-db` route in browser to verify Supabase connectivity and inspect recent raw records.

---

## Project Overview

**Fña Tracker** is a personal life dashboard. It aggregates screen time from multiple devices (PCs, phone, e-reader, smartband) and displays real-time stats in a dark-themed dashboard. The user lives in **Santiago, Chile** — all times must be handled in `America/Santiago` timezone (CLST, UTC-3 or UTC-4 depending on daylight saving). The entire UI is in **Spanish**.

The app is deployed on **Vercel** and connected to a **Supabase** backend.

---

## Architecture: The Two-Layer Data Strategy

This is the most critical architectural concept. There are **two completely separate data sources** depending on which view you're rendering:

### Layer 1 — Live Dashboard (`/`)
- Reads directly from the raw **`metrics`** table
- `src/lib/data-processor.ts` processes all raw rows in-memory on each request
- The page has `export const dynamic = 'force-dynamic'` — no caching ever
- A client component `RealtimeRefresher` calls `router.refresh()` every **30 seconds** to poll for new data
- This is the "live" view; data is as fresh as the last device ping

### Layer 2 — History (`/history`)
- Reads from pre-aggregated **`daily_summary`** and **`weekly_summary`** tables
- `src/lib/history-processor.ts` queries these tables; they are pre-computed
- **Raw `metrics` are deleted after summarization** — historical dates have no raw data
- A Supabase Edge Function (`supabase/functions/summarize-daily/`) runs nightly to aggregate yesterday into `daily_summary`, then rolls up into `weekly_summary`, `monthly_summary`, `yearly_summary`

### Data Flow

```
Devices
  └──→ metrics (raw) ──→ [live dashboard reads directly]
             │
             └──→ [summarize-daily Edge Fn, runs nightly]
                        │
                        ├──→ daily_summary  ──→ [history weekly/monthly view]
                        ├──→ weekly_summary ──→ [history yearly view]
                        ├──→ monthly_summary
                        └──→ yearly_summary
                  (raw metrics deleted after summarization)
```

---

## Routes & Pages

| Route | File | Type | Description |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Server | Main dashboard. Accepts `?date=yyyy-MM-dd` for historical day view |
| `/history` | `src/app/history/page.tsx` | Server | History view. Accepts `?period=weekly\|monthly\|yearly&date=yyyy-MM-dd` |
| `/test-db` | `src/app/test-db/page.tsx` | Server | Debug page: shows env var status + last 5 raw metrics records |
| `/api/track/wearable` | `src/app/api/track/wearable/route.ts` | API | POST endpoint for Xiaomi Band data ingestion |

All pages use `export const dynamic = 'force-dynamic'`.

---

## Component Architecture

The app follows a **Server Component + Client Island** pattern:

- **Server Components** fetch data from Supabase on the server and pass it as props
- **Client Components** handle interactivity (charts, filters, navigation, auto-refresh)

### Dashboard Components (`src/components/dashboard/`)

| Component | Type | Role |
|---|---|---|
| `DashboardContent` | Server | Fetches `getDailyStats()` + `getWeeklyStats()` in parallel; renders the full dashboard grid |
| `DashboardSkeleton` | Server | Staggered skeleton with CSS `fadeIn` animation delays (0ms, 150ms, 300ms, 450ms) |
| `KpiCard` | Server | Metric card; `isLongText` prop disables truncation for Books/Games subtext |
| `ActivityChart` | Client | Recharts `AreaChart` — PC (blue) vs Mobile (green) minutes per hour. Uses `mounted` state to avoid SSR hydration mismatch |
| `AppsList` | Client | Scrollable list with progress bars. PC mode has 3 tabs: All / Lenovo Yoga 7 Slim / PC Escritorio |
| `LocationCard` | Client | Recharts `PieChart` donut (Office/Home/Outside). Shows PC battery + WiFi and mobile WiFi status. Applies a ratio adjustment to align raw minutes with deduplicated screen time |
| `RecentActivity` | Client | Timeline log (max 20 events). Filterable by All / PC / Mobile |
| `WeeklyGrid` | Client | 7-day grid showing hours + primary device icon (Monitor/Smartphone/Scale) |
| `DateNavigator` | Client | Prev/next day buttons + "Hoy" button. Future dates are disabled |
| `SantiagoClock` | Client | Live clock in `America/Santiago` timezone, updates every second |
| `RealtimeRefresher` | Client | Invisible component; calls `router.refresh()` every 30s |
| `FadeIn` | Client | Wraps content in a fade+slide-up entrance animation (10ms delay then CSS transition) |

### History Components (`src/components/history/`)

| Component | Type | Role |
|---|---|---|
| `HistoryView` | Client | Full history UI: period selector, date navigator, area chart, aggregated top lists, item grid |
| `HistoryButton` | Client | "Ver Historial" button in dashboard header using `useTransition` for pending state |

---

## Data Processing (`src/lib/data-processor.ts`)

`getDailyStats(dateStr?)` is the core function. It:

1. Converts `dateStr` (or today) to Santiago-local day boundaries, then back to UTC for Supabase queries
2. Queries `metrics` table in a **single fetch** for all device IDs, then filters in-memory
3. Processes each device type separately, then merges for unified stats

### PC Processing
- Handles two metric formats:
  - `usage_summary_1min` — has a `metadata.breakdown` object `{appName: seconds}` for that minute
  - Other types — single `process_name` + `value` (minutes) per row; sequential rows are grouped into app sessions
- Maps `device_id = 'windows-pc'` → display name `'Lenovo Yoga 7 Slim'`
- Tracks `lastPcStatus` from `metadata.battery_level`, `metadata.wifi_ssid`, `metadata.is_charging`

### Mobile Processing
- Duration calculated as difference between consecutive events' `screen_time_today` field (preferred) or timestamp difference as fallback
- Last event of the day uses `isToday ? elapsed since last ping : 30s default`
- Groups events into per-minute buckets (`mobileLogBuffer`) for the activity log

### Reading (Moon+ Reader)
- Separate `device_id = 'moon-reader'` records contain `metadata.book_title` and `value` (percentage)
- Cross-referenced with mobile Moon+ app events within a ±20-minute window to calculate actual reading time per book
- Fallback: if no book found in current day's reading data, queries the last `moon-reader` record before today

### Deduplication (`screenTimeMinutes`)
- Both PC and mobile events push `{start, end}` intervals into `allIntervals[]`
- After processing, intervals are sorted and merged (overlapping intervals combined)
- `exactDedupMs` = sum of merged intervals = true deduplicated screen time
- `simultaneousMinutes` = (totalPcMs + totalMobileMs) − exactDedupMs

### Location Detection
Based on `metadata.wifi_ssid` on each event:
- `'GeCo'` → **Oficina** (Office)
- Contains `'Depto 402'` OR equals `'Ethernet/Off'` → **Casa** (Home)
- `'PC Escritorio'` device always uses Home as default when SSID is not GeCo
- Everything else → **Fuera** (Outside)

### Game Detection
Hardcoded in `data-processor.ts`:
- `process_name === 'League of Legends'` → game
- `process_name === 'Endfield'` → display as `'Arknights: Endfield'`

### Filtered Apps (never shown in stats)
```
'Lanzador del sistema', 'Pantalla Apagada', 'Reloj', 'Clock', 'Barra lateral inteligente'
```

### `minuteSlots` — Hourly Activity Timeline
Each minute of the day gets a "level": PC Escritorio=3, Laptop=2, Mobile=1. This powers the hourly activity chart (PC minutes per hour vs mobile minutes per hour).

---

## History Processing (`src/lib/history-processor.ts`)

`getHistoryData(period, dateStr?)` queries pre-aggregated tables:
- `weekly` / `monthly` → queries `daily_summary` table (field: `date`)
- `yearly` → queries `weekly_summary` table (field: `week_start_date`)

Returns a `HistoryPayload` with individual `items[]` and `totals` (aggregated across the period). The `topApps`, `topGames`, `topBooks` in totals merge the JSONB summary columns from all rows.

Navigation uses `requestDate` (anchor date) passed through `?date=` query param. Period switching clears the date param.

---

## Database Schema (Supabase)

### Raw Data
```sql
metrics
  id, created_at (UTC), device_id, metric_type, value, metadata (JSONB)
```

### Summary Tables (Screen Time)
```sql
daily_summary
  date (UNIQUE), pc_total_minutes, mobile_total_minutes, reading_minutes, gaming_minutes,
  screentime_minutes (deduplicated), simultaneous_minutes,
  office_minutes, home_minutes, outside_minutes,
  pc_app_summary (JSONB), mobile_app_summary (JSONB), games_summary (JSONB), books_summary (JSONB),
  location_breakdown (JSONB)

weekly_summary   → week_start_date (Monday), total_* columns, app/game/book JSONB summaries
monthly_summary  → month_start_date
yearly_summary   → year (INT)
```

### Health Tables (not yet integrated into dashboard UI)
```sql
health_daily_metrics  → date (UNIQUE), steps, calories, heart_rate_timeline (JSONB), stress_timeline (JSONB)
health_workouts       → activity_type, start/end_time, heart_rate_series (JSONB), route_path (JSONB)
health_sleep_sessions → date, duration_minutes, sleep phases (minutes_deep/light/rem/awake), sleep_stages_timeline (JSONB)
```
Health tables use RLS: anon INSERT allowed (for MacroDroid), SELECT requires authenticated role.

---

## Device IDs

| `device_id` | Display Name | Data Source |
|---|---|---|
| `windows-pc` | Lenovo Yoga 7 Slim | PC screen activity script |
| `Lenovo Yoga 7 Slim` | Lenovo Yoga 7 Slim | Same PC, newer format |
| `PC Escritorio` | PC Escritorio | Desktop PC screen activity |
| `oppo-5-lite` | Oppo 5 Lite / Teléfono | Android app (MacroDroid/Tasker) |
| `moon-reader` | Cloud (reading) | Moon+ Reader sync |
| `xiaomi-band` | Xiaomi Band | Via `/api/track/wearable` POST |

---

## Edge Function: `summarize-daily`

Located at `supabase/functions/summarize-daily/index.ts`. This is a **Deno** runtime function (not Node.js). It:

1. Authenticates via `Authorization: Bearer <SUMMARIZER_SECRET>` header
2. Processes yesterday's raw metrics using a self-contained copy of the data processing logic (intentionally duplicated — cannot import from Next.js `src/lib/`)
3. Upserts into `daily_summary`
4. **Deletes all raw `metrics` rows for that day** — this is permanent
5. Rolls up `daily_summary` into `weekly_summary`, `monthly_summary`, `yearly_summary`

Required Supabase env vars for the function: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUMMARIZER_SECRET`.

> **Warning:** If you modify data processing logic in `src/lib/data-processor.ts`, you must mirror those changes in the Edge Function or historical data will be calculated differently.

---

## Wearable API (`/api/track/wearable`)

Simple POST endpoint for the Xiaomi Band. Validates `secret === 'fna-tracker-upload-key'` (hardcoded). Accepts `{type, value, data, secret}` and inserts into `metrics` with `device_id = 'xiaomi-band'`.

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL       # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY  # Supabase anon key (safe for browser)
```

Both are used in client and server code via `createClient()`. The Edge Function uses `SUPABASE_SERVICE_ROLE_KEY` (server-only, set in Supabase dashboard).

---

## Key Patterns & Gotchas

- **`cn()` utility** (`src/lib/utils.ts`): combines `clsx` + `tailwind-merge`. Use this for conditional Tailwind classes.
- **Recharts on SSR**: `ActivityChart` uses a `mounted` state guard before rendering to avoid hydration mismatch. This pattern should be followed for any new Recharts components.
- **No shared imports between Next.js and Deno**: The Edge Function is fully self-contained. Processing logic changes must be applied in both places.
- **`Suspense` key prop**: Both pages pass a key to `<Suspense>` so the skeleton re-triggers on navigation (e.g., `key={targetDate}`).
- **`date-fns-tz` for timezone handling**: Always use `toZonedTime()` to convert UTC dates to Santiago local time before using `startOfDay()`/`endOfDay()`. Never use raw `new Date()` comparisons for day boundaries.
- **`usage_summary_1min` vs single-row format**: The PC script changed format at some point. `data-processor.ts` handles both in the same loop — check `row.metric_type === 'usage_summary_1min'` branch.
- **LocationCard ratio adjustment**: The donut chart minutes are raw (summed from PC + mobile, may double-count simultaneous usage). They are multiplied by `screenTimeTotal / rawTotal` ratio to visually match the KPI card's deduplicated screen time.
- **React Compiler** is enabled (`reactCompiler: true` in `next.config.ts`). Avoid patterns that break it (mutable refs during render, etc.).
- **Fonts**: Geist Sans + Geist Mono loaded via `next/font`. CSS variables `--font-geist-sans` and `--font-geist-mono`.
- **PWA-ready**: `layout.tsx` includes manifest, themeColor, and Apple web app metadata. Icon is `/sand-clock.svg`.
