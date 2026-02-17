import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

// Load env vars
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Error: variables not found in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const execAsync = promisify(exec);

const POWERSHELL_PATH = '/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0//powershell.exe';
const IDLE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

// PowerShell script to get Idle Time + Active Window Title + Process Name
const psCommand = `
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

    [DllImport("user32.dll")] 
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count); 

    [DllImport("user32.dll", SetLastError=true)] 
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
'@

Add-Type -TypeDefinition $code -Language CSharp

# Get Idle Time
$lii = New-Object Win32+LASTINPUTINFO
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
[void][Win32]::GetLastInputInfo([ref]$lii)
$idleMs = [Environment]::TickCount - $lii.dwTime

# Get Active Window
$hwnd = [Win32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
$windowTitle = $sb.ToString()

# Get Process Name
$pidOut = 0
[void][Win32]::GetWindowThreadProcessId($hwnd, [ref]$pidOut)
$processName = (Get-Process -Id $pidOut).ProcessName

# Output as JSON
$obj = @{
    idle_ms = $idleMs
    window_title = $windowTitle
    process_name = $processName
}
$obj | ConvertTo-Json -Compress
`;

async function getSystemStatus() {
  try {
    // Encode command to avoid shell escaping issues
    const encodedCommand = Buffer.from(psCommand, 'utf16le').toString('base64');
    const { stdout } = await execAsync(`"${POWERSHELL_PATH}" -EncodedCommand ${encodedCommand}`);
    return JSON.parse(stdout.trim());
  } catch (error) {
    console.error("Error checking system status:", error.message);
    return null;
  }
}

function sanitizeWindowTitle(processName, windowTitle) {
  const browsers = ['chrome', 'msedge', 'firefox', 'brave', 'opera'];
  const proc = processName.toLowerCase();

  // If it's a browser, censor the specific tab title
  if (browsers.some(b => proc.includes(b))) {
    return "Web Browsing (" + processName + ")";
  }
  
  // Return full title for other apps (VS Code, Spotify, etc.)
  return windowTitle || "Unknown Window";
}

async function track() {
  const status = await getSystemStatus();
  
  if (!status) return;

  const idleMs = status.idle_ms;
  const processName = status.process_name || "Unknown";
  const rawTitle = status.window_title || "";
  const safeTitle = sanitizeWindowTitle(processName, rawTitle);

  console.log(`⏱️  Idle: ${(idleMs / 1000).toFixed(1)}s | App: ${processName} | Window: ${safeTitle}`);

  if (idleMs < IDLE_THRESHOLD_MS) {
    
    const { error } = await supabase
      .from('metrics')
      .insert([
        { 
          device_id: 'windows-pc', 
          metric_type: 'active_minutes', 
          value: 1,
          unit: 'minute',
          metadata: { 
            idle_ms: idleMs, 
            process_name: processName,
            window_title: safeTitle, // Privacy-filtered title
            timestamp: new Date().toISOString() 
          }
        }
      ]);

    if (error) console.error('❌ Supabase Error:', error.message);
    else console.log('🚀 Logged activity.');
  } else {
    console.log("💤 User is idle. Skipping log.");
  }
}

// Run immediately then every 60s
track();
setInterval(track, 60 * 1000);
