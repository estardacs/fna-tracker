/**
 * Windows and macOS activity tracker.
 *
 * Emits one `usage_summary_1min` row per active minute, matching the shape the
 * dashboard already expects from the retired machines:
 *
 *   metadata: { breakdown: {processName: seconds}, wifi_ssid, battery_level, timestamp }
 *
 * Runs Node natively on Windows (no WSL). A single long-lived PowerShell process does
 * the per-second sampling and prints one JSON line per minute — spawning powershell.exe
 * 60 times a minute would recompile the Win32 interop every time.
 *
 * Setup on a new machine:
 *   1. Install Node for Windows.
 *   2. npm install @supabase/supabase-js dotenv
 *   3. Put NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local
 *      next to this script (or set them as environment variables).
 *   4. node scripts/track-activity.mjs   — or use start-tracker.vbs for silent autostart.
 *
 * Override the device name with DEVICE_ID if this is not the Zenbook.
 *
 * On macOS the sampler is scripts/mac-sampler.swift, compiled on first run (needs the
 * Xcode Command Line Tools); install-mac-tracker.sh sets it up as a LaunchAgent. macOS
 * hides the SSID from unprivileged processes, so the Mac reports its gateway's MAC and
 * NETWORK_MAP translates known routers into the SSIDs the dashboard already understands:
 *
 *   NETWORK_MAP=<home-mac>=Depto 402;<office-mac>=IF-Comunidad
 *
 * TRACKER_DRY_RUN=1 logs each row instead of inserting it. On macOS, TRACKER_WINDOW_SECONDS
 * and TRACKER_IDLE_SECONDS shorten the sampling window and idle cutoff for testing.
 */
import { createClient } from '@supabase/supabase-js';
import { execFileSync, spawn } from 'child_process';
import { createServer } from 'net';
import { createInterface } from 'readline';
import { existsSync, appendFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [join(process.cwd(), '.env.local'), join(here, '.env.local'), join(here, '..', '.env.local')]) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const IS_MAC = process.platform === 'darwin';
const DEVICE_ID = process.env.DEVICE_ID || (IS_MAC ? 'MacBook' : 'Zenbook');
const IDLE_THRESHOLD_MS = 3 * 60 * 1000;
const DRY_RUN = process.env.TRACKER_DRY_RUN === '1';
const MAC_SAMPLER_SOURCE = join(here, 'mac-sampler.swift');
const MAC_SAMPLER_BINARY = join(here, '.bin', 'mac-sampler');

// An unlisted router is reported as 'Desconocido', which the dashboard counts as Fuera.
const NETWORK_MAP = new Map(
  (process.env.NETWORK_MAP || '').split(';').map(entry => entry.split('='))
    .filter(pair => pair.length === 2)
    .map(([mac, ssid]) => [mac.trim().toLowerCase(), ssid.trim()]),
);

// start-tracker.vbs runs this with no console window, so stdout goes nowhere. Everything
// is mirrored to tracker.log in the project root, which is the only way to find out why
// a hidden tracker stopped reporting.
const LOG_FILE = join(here, '..', 'tracker.log');
const LOG_MAX_BYTES = 1024 * 1024;

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  process.stdout.write(line + '\n');
  try {
    // Truncate rather than rotate: this is a diagnostic tail, not an audit trail.
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > LOG_MAX_BYTES) writeFileSync(LOG_FILE, '');
    appendFileSync(LOG_FILE, line + '\n');
  } catch {
    // Never let a logging problem take down the tracker.
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!DRY_RUN && (!supabaseUrl || !supabaseKey)) {
  log('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const supabase = DRY_RUN ? null : createClient(supabaseUrl, supabaseKey);

// Samples the foreground process once a second and prints an aggregate every 60 ticks.
// Idle seconds are dropped rather than attributed to whatever window happened to be
// focused, so a minute spent away from the keyboard emits nothing at all.
const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@
Add-Type -TypeDefinition $code -Language CSharp

$acc = @{}
$tick = 0

while ($true) {
    Start-Sleep -Milliseconds 1000
    $tick++

    $lii = New-Object Win32+LASTINPUTINFO
    $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
    [void][Win32]::GetLastInputInfo([ref]$lii)
    $idleMs = [Environment]::TickCount - $lii.dwTime

    if ($idleMs -lt ${IDLE_THRESHOLD_MS}) {
        $hwnd = [Win32]::GetForegroundWindow()
        $procId = 0
        [void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId)
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($p) {
            $n = $p.ProcessName
            if ($acc.ContainsKey($n)) { $acc[$n] = $acc[$n] + 1 } else { $acc[$n] = 1 }
        }
    }

    if ($tick -ge 60) {
        if ($acc.Count -gt 0) {
            # Get-NetConnectionProfile's Name is the SSID on a wireless adapter. A desktop
            # on Ethernet has no Wi-Fi profile, and the dashboard maps 'Ethernet/Off' to Casa.
            $wifi = (Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|Wireless|WLAN' } | Select-Object -First 1).Name
            if (-not $wifi) { $wifi = 'Ethernet/Off' }

            $battery = Get-CimInstance Win32_Battery | Select-Object -First 1
            $level = if ($battery) { [int]$battery.EstimatedChargeRemaining } else { 100 }
            # BatteryStatus 2 means running on AC power.
            $charging = if ($battery) { $battery.BatteryStatus -eq 2 } else { $true }

            $payload = @{
                breakdown     = $acc
                wifi_ssid     = $wifi
                battery_level = $level
                is_charging   = $charging
            }
            $payload | ConvertTo-Json -Compress -Depth 4
            [Console]::Out.Flush()
        }
        $acc = @{}
        $tick = 0
    }
}
`;

function networkMetadata(sample) {
  if (!IS_MAC) return { wifi_ssid: sample.wifi_ssid };
  const mac = sample.gateway_mac;
  return {
    wifi_ssid: (mac && NETWORK_MAP.get(mac)) || 'Desconocido',
    gateway_mac: mac,
    network_source: 'gateway_mac',
  };
}

async function publish(sample) {
  const network = networkMetadata(sample);
  const row = {
    device_id: DEVICE_ID,
    metric_type: 'usage_summary_1min',
    value: 1,
    unit: 'minute',
    metadata: {
      breakdown: sample.breakdown,
      ...network,
      battery_level: sample.battery_level,
      is_charging: sample.is_charging,
      timestamp: new Date().toISOString(),
    },
  };

  if (DRY_RUN) {
    log(`[tracker] dry run ${JSON.stringify(row)}`);
    return;
  }

  const { error } = await supabase.from('metrics').insert([row]);
  if (error) {
    log(`[tracker] insert failed: ${error.message}`);
    return;
  }
  const apps = Object.entries(sample.breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, secs]) => `${name} ${secs}s`)
    .join(', ');
  log(`[tracker] ${new Date().toLocaleTimeString()}  ${apps}  |  ${network.wifi_ssid}  ${sample.battery_level}%`);
}

let child = null;
let restartDelay = 1000;

// Recompiles only when the source is newer, so a git pull picks up sampler changes
// on the next restart without a manual build step.
function ensureMacSampler() {
  if (existsSync(MAC_SAMPLER_BINARY) && statSync(MAC_SAMPLER_BINARY).mtimeMs >= statSync(MAC_SAMPLER_SOURCE).mtimeMs) return;
  log('[tracker] compiling mac-sampler.swift');
  execFileSync('/usr/bin/swiftc', ['-O', MAC_SAMPLER_SOURCE, '-o', MAC_SAMPLER_BINARY], { stdio: 'pipe' });
}

function spawnSampler() {
  if (IS_MAC) {
    const idleSeconds = process.env.TRACKER_IDLE_SECONDS || String(IDLE_THRESHOLD_MS / 1000);
    return spawn(MAC_SAMPLER_BINARY, [process.env.TRACKER_WINDOW_SECONDS || '60', idleSeconds]);
  }
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    windowsHide: true,
  });
}

function startSampler() {
  child = spawnSampler();

  createInterface({ input: child.stdout }).on('line', line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    try {
      publish(JSON.parse(trimmed));
      restartDelay = 1000; // a clean sample means the sampler is healthy again
    } catch (e) {
      log(`[tracker] could not parse sample: ${e.message}`);
    }
  });

  child.stderr.on('data', d => {
    // PowerShell writes a CLIXML preamble to stderr on startup. It is not an error, and
    // logging it on every sampler restart would bury the messages that do matter.
    const text = String(d).trim();
    if (!text || text.startsWith('#< CLIXML')) return;
    log(`[tracker] powershell: ${text}`);
  });

  // The sampler loops forever, so any exit is a failure. Back off up to a minute so a
  // persistent problem does not spin, and keep the process alive across sleep/resume.
  child.on('exit', code => {
    log(`[tracker] sampler exited (${code}), restarting in ${restartDelay / 1000}s`);
    setTimeout(startSampler, restartDelay);
    restartDelay = Math.min(restartDelay * 2, 60000);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child) child.kill();
    process.exit(0);
  });
}

// Single-instance guard. Two trackers running at once (a terminal left open plus the
// autostart copy) would each insert a row per minute and double every screen-time
// figure. Binding a loopback port is atomic and, unlike a PID file, cannot be left
// stale by a hard kill or a power loss.
const LOCK_PORT = 47615;
const lock = createServer();

lock.once('error', err => {
  if (err.code === 'EADDRINUSE') {
    log('[tracker] another instance is already running — exiting.');
    process.exit(0);
  }
  throw err;
});

lock.listen(LOCK_PORT, '127.0.0.1', () => {
  // ASCII only: Get-Content reads the log as ANSI by default, so an em dash arrives
  // mangled on the one screen you would read when something has gone wrong.
  log(`[tracker] running as "${DEVICE_ID}" - one row per active minute.`);
  if (IS_MAC) {
    try {
      ensureMacSampler();
    } catch (e) {
      log(`[tracker] could not compile mac-sampler.swift: ${e.stderr || e.message}`);
      process.exit(1);
    }
  }
  startSampler();
});
