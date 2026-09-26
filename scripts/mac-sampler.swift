// macOS counterpart of the PowerShell sampler in track-activity.mjs.
//
// Samples the frontmost app once a second and prints one JSON line per window:
//
//   {"breakdown": {appName: seconds}, "gateway_mac", "battery_level", "is_charging"}
//
// Unlike the Windows sampler there is no idle cutoff: a second counts whenever the
// display is on and the session unlocked, so a long video watched without touching
// anything is counted in full. The display sleeping or the screen locking is what ends
// a session. Needs no TCC permission: frontmost app, display and lock state, battery
// and the ARP table are all readable by an unprivileged process. The SSID is not (macOS 14.4+ redacts it without
// Location Services), which is why the network is identified by the gateway's MAC.
//
// Usage: mac-sampler [windowSeconds=60]

import AppKit
import CoreGraphics
import IOKit.ps

let arguments = CommandLine.arguments
let windowSeconds = arguments.count > 1 ? Int(arguments[1]) ?? 60 : 60

// Frontmost while the screen is locked or the screensaver runs; not real usage.
let ignoredApps: Set<String> = ["loginwindow", "ScreenSaverEngine"]

var accumulated: [String: Int] = [:]
var tick = 0

func screenInUse() -> Bool {
    if CGDisplayIsAsleep(CGMainDisplayID()) != 0 { return false }
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
    if session["CGSSessionScreenIsLocked"] as? Bool == true { return false }
    // False while another user is logged in through fast user switching.
    return session[kCGSessionOnConsoleKey as String] as? Bool ?? true
}

func run(_ executable: String, _ args: [String]) -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = args
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return "" }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return String(decoding: data, as: UTF8.self)
}

func gatewayMac() -> String? {
    let route = run("/sbin/route", ["-n", "get", "default"])
    guard let gatewayLine = route.split(separator: "\n").first(where: { $0.contains("gateway:") }) else { return nil }
    let gateway = gatewayLine.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces)

    // "? (192.168.1.1) at 0:1a:2b:3c:4d:5e on en0 ifscope [ethernet]"
    let arp = run("/usr/sbin/arp", ["-n", gateway])
    let words = arp.split(separator: " ")
    guard let atIndex = words.firstIndex(of: "at"), atIndex + 1 < words.count else { return nil }
    let mac = String(words[atIndex + 1])
    return mac.contains(":") ? normalizeMac(mac) : nil
}

// arp drops leading zeros ("0:1a:2b:..."), which would make the same router look
// different depending on the tool that read it.
func normalizeMac(_ mac: String) -> String {
    mac.split(separator: ":").map { $0.count == 1 ? "0\($0)" : String($0) }.joined(separator: ":").lowercased()
}

func batteryStatus() -> (level: Int, onAC: Bool) {
    let info = IOPSCopyPowerSourcesInfo().takeRetainedValue()
    let sources = IOPSCopyPowerSourcesList(info).takeRetainedValue() as Array
    for source in sources {
        guard let description = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any],
              let current = description[kIOPSCurrentCapacityKey] as? Int,
              let max = description[kIOPSMaxCapacityKey] as? Int, max > 0 else { continue }
        let onAC = (description[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue
        return (current * 100 / max, onAC)
    }
    return (100, true)
}

func emit() {
    let battery = batteryStatus()
    var payload: [String: Any] = [
        "breakdown": accumulated,
        "battery_level": battery.level,
        "is_charging": battery.onAC,
    ]
    payload["gateway_mac"] = gatewayMac() ?? NSNull()
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

// A Timer on the main run loop, not sleep(): NSWorkspace only refreshes
// frontmostApplication while the run loop processes its notifications.
let timer = Timer(timeInterval: 1.0, repeats: true) { _ in
    tick += 1

    if screenInUse(),
       let name = NSWorkspace.shared.frontmostApplication?.localizedName,
       !ignoredApps.contains(name) {
        accumulated[name, default: 0] += 1
    }

    if tick >= windowSeconds {
        if !accumulated.isEmpty { emit() }
        accumulated = [:]
        tick = 0
    }
}
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
