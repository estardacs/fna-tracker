/**
 * End-to-end checks for the macOS tracker. Switches the frontmost app (Finder, then
 * Calculator), so do not type while it runs. Nothing is written to Supabase: the anon
 * key cannot delete, so a test row could not be cleaned up.
 *
 * The lock screen is not covered: `pmset displaysleepnow` wakes straight back up on a
 * Mac with Apple Watch unlock or recent input, so it cannot hold a lock long enough.
 *
 *   node scripts/test-mac-tracker.mjs
 */
import { execFileSync, spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLER = join(here, '.bin', 'mac-sampler');
const TRACKER = join(here, 'track-activity.mjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];

function check(name, expected, actual, pass) {
  results.push({ name, expected: String(expected), actual: String(actual), pass });
}

function currentGatewayMac() {
  const gateway = execFileSync('/sbin/route', ['-n', 'get', 'default']).toString().match(/gateway: (\S+)/)[1];
  const mac = execFileSync('/usr/sbin/arp', ['-n', gateway]).toString().match(/ at (\S+)/)[1];
  return mac.split(':').map(part => part.padStart(2, '0')).join(':').toLowerCase();
}

// Collects stdout lines from a process until `count` JSON objects arrive or time runs out.
function collectJson(command, args, env, count, timeoutMs, onStart) {
  return new Promise(resolve => {
    const child = spawn(command, args, { env: { ...process.env, ...env } });
    const found = [];
    let buffer = '';
    const finish = () => { child.kill(); resolve(found); };
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const start = line.indexOf('{');
        if (start < 0) continue;
        try { found.push(JSON.parse(line.slice(start))); } catch { continue; }
        if (found.length >= count) finish();
      }
    });
    setTimeout(finish, timeoutMs);
    onStart?.();
  });
}

// `open -a` returns before a cold-launched app takes focus, so Calculator is launched
// hidden first and activation is done through AppleScript, which waits for it.
const activate = app => execFileSync('osascript', ['-e', `tell application "${app}" to activate`]);

async function switchApps() {
  await sleep(500);
  activate('Finder');
  await sleep(3000);
  activate('Calculator');
  await sleep(3000);
}

const gatewayMac = currentGatewayMac();
execFileSync('open', ['-g', '-a', 'Calculator']);
await sleep(2000);

// 1. Sampler follows the frontmost app and reports battery + gateway.
const [sample] = await collectJson(SAMPLER, ['8'], {}, 1, 15000, switchApps);
execFileSync('osascript', ['-e', 'quit app "Calculator"']);
const apps = Object.keys(sample?.breakdown || {});
check('sampler: emits a window', '1 JSON line', sample ? '1 JSON line' : 'nothing', !!sample);
check('sampler: sees Finder', 'Finder in breakdown', apps.join(', '), apps.includes('Finder'));
check('sampler: sees Calculator', 'Calculadora/Calculator', apps.join(', '), apps.some(a => /^Calcula/.test(a)));
const total = Object.values(sample?.breakdown || {}).reduce((a, b) => a + b, 0);
// No keyboard or mouse input happens during the run, so this also proves there is no idle cutoff.
check('sampler: every second counted without input', 8, total, total === 8);
check('sampler: gateway MAC', gatewayMac, sample?.gateway_mac, sample?.gateway_mac === gatewayMac);
check('sampler: battery in 0..100', '0..100', sample?.battery_level, sample?.battery_level >= 0 && sample?.battery_level <= 100);
check('sampler: is_charging boolean', 'boolean', typeof sample?.is_charging, typeof sample?.is_charging === 'boolean');

// 3 + 4. Tracker maps the gateway to an SSID; an unknown router becomes Desconocido.
const trackerEnv = { TRACKER_DRY_RUN: '1', TRACKER_WINDOW_SECONDS: '3' };
for (const [label, networkMap, expectedSsid] of [
  ['known router', `${gatewayMac}=Depto 402`, 'Depto 402'],
  ['unknown router', 'aa:bb:cc:dd:ee:ff=IF-Comunidad', 'Desconocido'],
]) {
  const [row] = await collectJson('node', [TRACKER], { ...trackerEnv, NETWORK_MAP: networkMap }, 1, 20000);
  check(`tracker (${label}): wifi_ssid`, expectedSsid, row?.metadata?.wifi_ssid, row?.metadata?.wifi_ssid === expectedSsid);
  check(`tracker (${label}): device_id`, 'MacBook', row?.device_id, row?.device_id === 'MacBook');
  check(`tracker (${label}): network_source`, 'gateway_mac', row?.metadata?.network_source, row?.metadata?.network_source === 'gateway_mac');
}

console.table(results.map(r => ({ result: r.pass ? 'PASS' : 'FAIL', check: r.name, expected: r.expected, actual: r.actual })));
process.exit(results.every(r => r.pass) ? 0 : 1);
