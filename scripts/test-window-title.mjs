import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const POWERSHELL_PATH = '/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0//powershell.exe';

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

$lii = New-Object Win32+LASTINPUTINFO
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
[void][Win32]::GetLastInputInfo([ref]$lii)
$idleMs = [Environment]::TickCount - $lii.dwTime

$hwnd = [Win32]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[void][Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
$windowTitle = $sb.ToString()

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

async function test() {
  try {
    const encodedCommand = Buffer.from(psCommand, 'utf16le').toString('base64');
    const { stdout, stderr } = await execAsync(`"${POWERSHELL_PATH}" -EncodedCommand ${encodedCommand}`);
    
    if (stderr) console.error("stderr:", stderr);
    
    console.log("Raw Output:", stdout);
    const data = JSON.parse(stdout.trim());
    console.log("Parsed Data:", data);
  } catch (error) {
    console.error("Error:", error);
  }
}

test();