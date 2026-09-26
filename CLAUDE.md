# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at localhost:3000
npm run build    # Build for production (also type-checks)
npm run lint     # Run ESLint

# Rebuild daily_summary from raw metrics. Reuses getDailyStats(), so results match the
# dashboard exactly. Never deletes anything. Skips days that already have a summary
# unless --force is passed.
npm run backfill -- --from=2026-03-17 --to=2026-09-23 --dry-run
npm run backfill -- --from=2026-03-17 --to=2026-09-23

# Delete raw metrics for days that are already summarized. Dry run by default;
# --confirm actually deletes. Deliberately manual — never wire this to a schedule.
npm run prune-metrics -- --from=2026-03-17 --to=2026-09-23
npm run prune-metrics -- --from=2026-03-17 --to=2026-09-23 --confirm
```

Ad-hoc SQL against the linked project (uses the Management API, no DB password needed):

```bash
supabase db query --linked -o json "select count(*) from daily_summary"
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
- Reads directly from the raw **`metrics`** table for today
- For **past dates** via `?date=`, `getDailyStats()` fetches raw metrics first. If raw metrics exist, processes them fully (chart + logs visible). If no raw metrics, falls back to `daily_summary` via `buildStatsFromSummary()` (aggregate totals only — chart and event log will be empty).
- `src/lib/data-processor.ts` processes all raw rows in-memory on each request
- The page has `export const dynamic = 'force-dynamic'` — no caching ever
- A client component `RealtimeRefresher` calls `router.refresh()` every **30 seconds** to poll for new data

### Layer 2 — History (`/history`)
- Reads exclusively from the pre-aggregated **`daily_summary`** table
- `src/lib/history-processor.ts` queries this table; all periods (weekly/monthly/yearly) use it
- **Raw `metrics` are retained by default.** `daily_summary` stores `activity_timeline` (24 hourly buckets) and `recent_events` (up to 100 events) so charts and logs work without them, but deletion is now opt-in (`deleteRaw: true`, or the `prune-metrics` script) rather than automatic — see the warning in the Edge Function section
- The `/history` page **triggers summarization on every load** by calling the Edge Function directly (`triggerSummarize()`), in batches of 5 days — ensures yesterday is always summarized before displaying history
- A Supabase Edge Function (`supabase/functions/summarize-daily/`) also runs nightly via `pg_cron` (see `supabase/migrations/20260924000001_setup_cron.sql`) to aggregate pending days into `daily_summary`, then rolls up into `weekly_summary`, `monthly_summary`, `yearly_summary`. The secret comes from Supabase Vault. Check health with `select * from cron.job_run_details order by start_time desc limit 5;`

### Data Flow

```
Devices
  └──→ metrics (raw) ──→ [live dashboard: today only]
             │                └──→ [getDailyStats for past dates: tries daily_summary first]
             │
             └──→ [summarize-daily Edge Fn: /history load + nightly pg_cron, batched]
                        │
                        ├──→ daily_summary  ──→ [ALL history views: weekly/monthly/yearly]
                        ├──→ weekly_summary ──→ [rolled up, but NOT queried by history-processor]
                        ├──→ monthly_summary  (same — rolled up but not currently read)
                        └──→ yearly_summary   (same — rolled up but not currently read)
                  (raw metrics KEPT by default; pruning is a separate manual step)
```

---

## Routes & Pages

| Route | File | Type | Description |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Server | Main dashboard. Accepts `?date=yyyy-MM-dd` for historical day view |
| `/history` | `src/app/history/page.tsx` | Server | History view. Accepts `?period=weekly\|monthly\|yearly&date=yyyy-MM-dd` |
| `/test-db` | `src/app/test-db/page.tsx` | Server | Debug page: shows env var status + last 5 raw metrics records |
| `/api/track/wearable` | `src/app/api/track/wearable/route.ts` | API | POST endpoint for Xiaomi Band data ingestion |
| `/api/summarize` | `src/app/api/summarize/route.ts` | API | POST endpoint that triggers the `summarize-daily` Edge Function. Called internally by the history page. |

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

Exports three functions:
- `getDailyStats(dateStr?)` — core stats for one day
- `getWeeklyStats()` — 7-day grid data (past days from `daily_summary`, today from live)
- `getReadingStreak(todayHasReading)` — counts consecutive days with reading from `daily_summary`; called in `DashboardContent` to show "Racha: N días seguidos" badge on the reading KPI

`getDailyStats(dateStr?)` logic:

1. For **past dates**: queries `daily_summary` first → if found, returns via `buildStatsFromSummary()` (reconstructs `DashboardStats` from the summary row; note: per-device app breakdown and recent events are unavailable in this path)
2. For **today** (or no summary found): converts `dateStr` to Santiago-local day boundaries, queries `metrics` table in a **single fetch** for all device IDs, then filters in-memory
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
- `cleanBookTitle()` normalizes filenames (strips extensions, replaces `-_` with spaces). Special case: any title containing `"shadow-slave"` or `"shadow slave"` → `"Shadow Slave"`

### Deduplication (`screenTimeMinutes`)
- Both PC and mobile events push `{start, end}` intervals into `allIntervals[]`
- After processing, intervals are sorted and merged (overlapping intervals combined)
- `exactDedupMs` = sum of merged intervals = true deduplicated screen time
- `simultaneousMinutes` = (totalPcMs + totalMobileMs) − exactDedupMs

### Location Detection
Based on `metadata.wifi_ssid` on each event. There are only **four** location categories
(`office`, `home`, `outside`, `university`) because `daily_summary` has one column each —
adding a fifth means a migration plus changes to the rollups and charts.

| SSID | Category | Shown as |
|---|---|---|
| `IF-Comunidad` | `office` | **Diio** — current workplace |
| `GeCo` | `office` | **Oficina** — former workplace, last seen 2026-08-19 |
| contains `Depto 402`, or `Ethernet/Off` | `home` | Casa |
| `eduroam` | `university` | Universidad |
| anything else | `outside` | Fuera |

`GeCo` is kept because 9051 raw rows between February and August depend on it; that
network no longer exists for the user, so the rule can never match new data.

Office SSIDs live in the `OFFICE_SSIDS` set — once in `data-processor.ts`, mirrored once
in the Edge Function. Adding a workplace means editing those two sets. The *display*
names are separate, in `formatWifiName` (Next.js only), since two offices share one
category but should not share a label.

> **Known limitation — `Ethernet/Off` is ambiguous.** A wired connection carries no SSID,
> so the Zenbook cannot distinguish one location from another; it is assumed to be Home,
> which holds because the Zenbook lives at home.
>
> **The MacBook (`device_id = 'MacBook'`) identifies networks by gateway MAC instead.**
> macOS 14.4+ redacts the SSID for processes without Location Services, so the Mac
> tracker reads the default gateway's MAC (no permission needed) and `NETWORK_MAP` in its
> `.env.local` translates known routers into the SSIDs above
> (`<home-mac>=Depto 402;<office-mac>=IF-Comunidad`). Unknown routers report
> `Desconocido` → Fuera. This also covers a wired connection at the office. The raw MAC
> is kept in `metadata.gateway_mac`, with `metadata.network_source = 'gateway_mac'`.

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

`getHistoryData(period, dateStr?)` queries only `daily_summary` for all periods:
- `weekly` / `monthly` → queries `daily_summary` for the date range of that week/month
- `yearly` → calls `getYearlyFromDailySummary()`, which queries **all of `daily_summary` for the year** and groups rows by week (Monday) in-memory. **Does NOT use `weekly_summary`.**

Returns a `HistoryPayload` with individual `items[]` and `totals` (aggregated across the period). The `topApps`, `topGames`, `topBooks` in totals merge the JSONB summary columns from all rows (top 10 apps, top 5 games/books).

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

| `device_id` | Display Name | Data Source | Status |
|---|---|---|---|
| `Zenbook` | Zenbook | `scripts/track-activity.mjs` (Windows, native Node) | **active** |
| `oppo-5-lite` | Oppo 5 Lite / Teléfono | Android app (MacroDroid/Tasker) | active |
| `moon-reader` | Cloud (reading) | Moon+ Reader sync | active |
| `windows-pc` | Lenovo Yoga 7 Slim | Legacy id, older metric format | retired |
| `Lenovo Yoga 7 Slim` | Lenovo Yoga 7 Slim | Same laptop, newer format | retired (sold, May 2026) |
| `PC Escritorio` | PC Escritorio | Desktop PC screen activity | retired (sold, May 2026) |
| `xiaomi-band` | Xiaomi Band | Via `/api/track/wearable` POST | no data recorded |

Retired ids stay in `PC_DEVICE_IDS` so historical days still resolve. **No PC data exists
between 2026-05-20 and the day the Zenbook starts reporting** — both machines were sold,
so those days are mobile-only in the data, not broken.

Adding a machine means editing `PC_DEVICE_IDS` in `src/lib/data-processor.ts` **and** the
mirrored list in the Edge Function. Everything downstream (tabs in `AppsList`, per-device
breakdowns) is derived from whichever devices actually reported, so nothing else changes.

### PC tracker

`scripts/track-activity.mjs` runs Node natively on Windows (no WSL) and writes one
`usage_summary_1min` row per active minute:

```
metadata: { breakdown: {processName: seconds}, wifi_ssid, battery_level, is_charging, timestamp }
```

A single long-lived `powershell.exe` does per-second sampling and prints one JSON line per
minute — spawning it 60 times a minute would recompile the Win32 interop every time.
Set `DEVICE_ID` to override the device name; it defaults to `Zenbook`.

**A second counts when the session is active, which means either recent input (<3 min) or
audio playing.** Input alone was the original rule and it silently dropped films and long
videos: `GetLastInputInfo` only sees keyboard and mouse, so a two-hour movie registered
its first three minutes and nothing else.

The Mac's rule — count while the display is on — does not transfer, because this machine's
power plan never sleeps the display (`VIDEOIDLE = 0` on both AC and battery), so it would
count all night. Audio is the available substitute: `IAudioMeterInformation.GetPeakValue`
on the default output device keeps reporting peaks while anything plays. Measured silence
reads 0 and real playback 0.0003–0.05, so `AUDIO_PEAK_THRESHOLD` sits at 0.0001.

Audio alone would run forever if music is left playing, and there is no display-off signal
to stop it, so `AUDIO_MAX_IDLE_MS` caps that branch at 4 hours — longer than any film,
short enough to bound an unattended machine. The meter is rebuilt (at most every 30s) when
it returns -1, which happens when the default output device changes.

> Consequence: the Zenbook and the MacBook measure differently. The Mac counts whenever
> the display is on, the Zenbook needs input or audio. Silent reading on the Mac counts;
> on the Zenbook it stops after 3 minutes.

On macOS (`device_id = 'MacBook'`) the sampler is `scripts/mac-sampler.swift`, run as a
LaunchAgent by `scripts/install-mac-tracker.sh`. It has **no idle cutoff**: a second
counts whenever the display is on and the session unlocked, so a video watched without
touching anything is counted in full. Walking away without locking overcounts until the
display sleeps (10 min on the MacBook, which locks immediately on display sleep).
`scripts/start-tracker.vbs` launches it hidden at login via `shell:startup`.

---

## Edge Function: `summarize-daily`

Located at `supabase/functions/summarize-daily/index.ts`. This is a **Deno** runtime function (not Node.js). It:

1. Authenticates via `X-Secret` header **or** `Authorization: Bearer <SUMMARIZER_SECRET>` (both accepted)
2. Processes every pending day using a self-contained copy of the data processing logic (intentionally duplicated — cannot import from Next.js `src/lib/`)
3. Upserts into `daily_summary`
4. Deletes the raw `metrics` for that day **only when the request body sets `deleteRaw: true`** — this is permanent
5. Rolls up `daily_summary` into `weekly_summary`, `monthly_summary`, `yearly_summary`

Request body (all optional): `{ "maxDays": 15, "deleteRaw": false }`. It processes at most
`maxDays` pending days per invocation and returns `{ processed, remaining, done }`, so a
backlog is drained by calling it until `done` is `true`. Each day commits independently,
so re-invoking resumes exactly where the previous call stopped.

Required Supabase env vars for the function: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUMMARIZER_SECRET`.

**Deploying** requires pointing at the import map explicitly, or the bundler fails on
`date-fns-tz` with "Relative import path not prefixed with /":

```bash
supabase functions deploy summarize-daily --import-map supabase/functions/deno.json
```

> **Warning:** If you modify data processing logic in `src/lib/data-processor.ts`, you must mirror those changes in the Edge Function or historical data will be calculated differently.

> **Warning:** Adding a field to the `daily_summary` upsert without a matching migration
> breaks summarization completely and silently. This is exactly what happened on
> 2026-03-17: the function started writing `university_minutes`, the column did not
> exist, every upsert threw, and 191 days went unsummarized before anyone noticed.

---

## Wearable API (`/api/track/wearable`)

Simple POST endpoint for the Xiaomi Band. Validates `secret === 'fna-tracker-upload-key'` (hardcoded). Accepts `{type, value, data, secret}` and inserts into `metrics` with `device_id = 'xiaomi-band'`.

---

## Diet system & MCP server

Tables: `food_items` (53 rows, per-100g macros plus a reference serving), `diet_log`
(one row per food eaten), `meal_combos` + `combo_items` (saved meals), `diet_goals`
(single row, id=1), `health_weight_log`. The `/diet` page and `/api/diet/*` routes drive
the UI; `recipes`/`recipe_ingredients` were dropped in `20260925000000` — never used.

Three fields exist specifically to keep the data honest:

- **`diet_log.status`** — `planned` vs `confirmed`. Logging an intended day and then
  eating something else is the mistake this whole system exists to catch, so totals and
  `progress` count only confirmed rows.
- **`food_items.source`** — `label` / `web` / `estimated`, with `verified_at`. NULL means
  unknown, which is what the pre-existing items are.
- **`diet_goals.tdee_calories`** plus height, birth year, sex and activity factor, so
  `recalculate_tdee` can redo Mifflin-St Jeor as weight drops instead of leaving a figure
  that was only true the day it was computed.

`meal_combos.servings` divides a batch-cooked recipe: logging one portion of a 4-serving
meal prep scales every ingredient by ¼.

### `/api/mcp`

Streamable HTTP MCP server (`mcp-handler` v2), so Claude Desktop, Claude Code and — if
`static_headers` is enabled on the account — mobile can all log meals by chat. Eleven
tools: `search_foods`, `log_food`, `list_combos`, `log_combo`, `create_food`,
`day_summary`, `confirm_day`, `delete_entry`, `progress`, `log_weight`,
`recalculate_tdee`.

All logic lives in `src/lib/diet-service.ts`; the route is a thin wrapper, so replacing
bearer auth with OAuth touches one function. **Tools never accept macro values for an
existing food** — they take an id and the server derives everything from `*_per_100g`,
so a model cannot invent nutrition data.

Auth is a fixed bearer token in `MCP_TOKEN`, checked inside the route. `middleware.ts`
gates every other `POST /api/*` on an admin cookie that no MCP client can present, so
`/api/mcp` is listed in `PUBLIC_WRITE_PATHS` — exempt from the cookie check, not from
authentication.

Test locally with the inspector, or by hand:

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

> **Security note:** every diet table has an `anon_all` RLS policy granting full read and
> write to the anon key, which ships in the browser bundle. The Next.js middleware is the
> only real gate, and it does not protect direct PostgREST access. Tightening this means
> moving the API routes to `service_role`.

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL       # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY  # Supabase anon key (safe for browser)
MCP_TOKEN                      # Bearer token for the /api/mcp server (Claude Desktop / mobile)
SUMMARIZER_SECRET              # Secret for authenticating calls to summarize-daily Edge Function
                               # Used by: /history page, /api/summarize route, and the Edge Function itself
```

`NEXT_PUBLIC_*` vars are used in both client and server code via `createClient()`. The Edge Function additionally uses `SUPABASE_SERVICE_ROLE_KEY` (server-only, set in Supabase dashboard).

---

## Key Patterns & Gotchas

- **PostgREST caps every response at 1000 rows** and `.limit(10000)` does *not* raise that
  ceiling — it is a server setting (`db-max-rows`) and applies to `service_role` too, and
  to `DELETE` as well as `SELECT`. Never read a day of `metrics` with a single query:
  use the paginated `fetchAllMetrics()` in `src/lib/data-processor.ts` (mirrored in the
  Edge Function). Always include a tie-breaker `.order('id')` alongside `.order('created_at')`,
  or rows sharing a timestamp get skipped or duplicated across page boundaries.
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
