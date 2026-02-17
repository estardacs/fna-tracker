import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const POWERSHELL_PATH = '/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0//powershell.exe';

const psCommand = `
$code = '[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }'
Add-Type -MemberDefinition $code -Name Win32 -Namespace User32
$lii = New-Object User32.Win32+LASTINPUTINFO
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
Start-Sleep -Seconds 2
[void][User32.Win32]::GetLastInputInfo([ref]$lii)
[Environment]::TickCount - $lii.dwTime
`;

async function getIdleTime() {
  try {
    // We need to be careful with escaping for the shell. 
    // Passing the command encoded as Base64 is often safer to avoid shell escaping hell.
    const encodedCommand = Buffer.from(psCommand, 'utf16le').toString('base64');
    const { stdout, stderr } = await execAsync(`"${POWERSHELL_PATH}" -EncodedCommand ${encodedCommand}`);
    
    if (stderr) {
      console.error("Stderr:", stderr);
    }
    
    const idleMs = parseInt(stdout.trim(), 10);
    console.log(`Windows Idle Time: ${idleMs} ms (${(idleMs / 1000).toFixed(1)} seconds)`);
    return idleMs;
  } catch (error) {
    console.error("Error executing PowerShell:", error);
  }
}

getIdleTime();
