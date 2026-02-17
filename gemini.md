# Fña Tracker (fna-tracker)

## Project Overview
**Fña Tracker** is a personal analytics dashboard designed to track, aggregate, and visualize the user's digital life. It monitors time spent on PC, mobile devices, and reading activities, providing a unified view of daily productivity and habits.

## Tech Stack
- **Framework:** Next.js 16.1 (App Router)
- **Language:** TypeScript / Node.js
- **Database:** Supabase (PostgreSQL)
- **Styling:** Tailwind CSS v4
- **Visualization:** Recharts
- **Icons:** Lucide React
- **Data Collection:** PowerShell (Windows), Node.js scripts

## Architecture

### 1. Data Collection
- **Windows PC:**
  - `scripts/track-activity.mjs`: A Node.js script that executes embedded PowerShell commands.
  - Captures: Idle time, Active Window Title, Process Name.
  - Frequency: Runs every minute.
  - Privacy: Sanitizes browser window titles to protect specific tab details.
- **Mobile (`oppo-5-lite`):**
  - Data is expected to be pushed to Supabase from an external source (likely an Android automation tool like Tasker or a custom app).
  - Metrics: Screen time, App usage, WiFi SSID (for location context).
- **Reading (`moon-reader`):**
  - Tracks reading sessions and book progress, likely via webhooks or sync from Moon+ Reader.

### 2. Data Storage (Supabase)
- **Table:** `metrics`
- **Key Columns:**
  - `device_id`: Identifies the source (e.g., `windows-pc`, `Lenovo Yoga 7 Slim`, `oppo-5-lite`).
  - `metric_type`: Type of data (e.g., `active_minutes`, `usage_summary_1min`).
  - `value`: Numerical value (minutes, percentage).
  - `metadata`: JSONB column storing rich context (app name, window title, WiFi SSID, battery level).

### 3. Data Processing (`src/lib/data-processor.ts`)
- **Aggregation Strategy:** "Timeline Master"
  - Deduplicates time overlapping between devices.
  - **Priority:** Desktop > Laptop > Mobile.
  - **Granularity:** Minute-level slots.
- **Context Inference:**
  - **Location:** Derived from WiFi SSID (`GeCo` = Office, Others = Home, No SSID = Outside).
- **Timezone:** Hardcoded to `America/Santiago`.

### 4. Frontend (Dashboard)
- **Entry Point:** `src/app/page.tsx`
- **Features:**
  - Real-time KPIs (PC Time, Mobile Time, Reading Time).
  - Activity Timeline Chart.
  - App Usage breakdown (PC vs Mobile).
  - Recent Activity Log.
  - Historical View (via date query param).

## Key Files & Directories
| Path | Description |
|------|-------------|
| `src/app/page.tsx` | Main dashboard view. Fetches data server-side using `getDailyStats`. |
| `src/lib/data-processor.ts` | **Core Logic.** Aggregates raw Supabase metrics into dashboard stats. Handles deduplication and timezone conversion. |
| `scripts/track-activity.mjs` | Windows activity tracker. Runs as a background process to log PC usage. |
| `src/lib/supabase.ts` | Supabase client initialization. |
| `src/components/dashboard/` | UI components for the dashboard (Charts, Lists, KPI Cards). |

## Setup & Configuration

### Environment Variables (`.env.local`)
Required for both the Next.js app and the tracking script:
```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### Running the Project
1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Start Development Server:**
   ```bash
   npm run dev
   ```
3. **Start Activity Tracker (Windows):**
   ```bash
   node scripts/track-activity.mjs
   ```

## Conventions
- **Language:** The UI is in **Spanish**.
- **Timezone:** Data is processed and displayed in **Chile/Santiago** time.
- **Styling:** Dark mode default with neon accents (Blue/Purple).
- **Deployment:** Vercel (recommended).
