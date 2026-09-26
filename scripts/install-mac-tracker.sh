#!/bin/zsh -l
# macOS counterpart of start-tracker.vbs: runs track-activity.mjs as a LaunchAgent, so it
# starts silently at login and launchd relaunches it whenever it stops, for any reason.
#
#   scripts/install-mac-tracker.sh              install (or reinstall) and start
#   scripts/install-mac-tracker.sh --uninstall  stop and remove
#
# Keep the repo outside Desktop/Documents/Downloads: those folders are privacy-protected
# and a LaunchAgent cannot read them without Full Disk Access.

set -euo pipefail

LABEL="cl.fconcha.fna-tracker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
# bootout returns before the job is fully unloaded, and bootstrapping it again in that
# window fails with "5: Input/output error".
for _ in {1..20}; do
  launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
  sleep 0.5
done

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$PLIST"
  echo "Removed $LABEL."
  exit 0
fi

# launchd starts with a bare PATH, so node must be an absolute path. Resolved from the
# login shell at install time; rerun this script after switching Node versions.
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "node not found in the login shell PATH." >&2
  exit 1
fi

[[ -f "$PROJECT_DIR/.env.local" ]] || { echo "Missing $PROJECT_DIR/.env.local" >&2; exit 1; }
[[ -d "$PROJECT_DIR/node_modules" ]] || { echo "Run 'npm install' in $PROJECT_DIR first." >&2; exit 1; }

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$PROJECT_DIR/scripts/track-activity.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <!-- Unconditional: the tracker exits 0 on SIGTERM, which a SuccessfulExit=false
         policy would treat as a deliberate stop and never restart. -->
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <!-- The tracker keeps its own truncated tracker.log; stderr only catches crashes. -->
    <key>StandardOutPath</key>
    <string>/dev/null</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/fna-tracker.log</string>
    <!-- Not Background: that class gets CPU throttling and timer coalescing, which
         stretches the one-second sampling ticks. -->
    <key>ProcessType</key>
    <string>Standard</string>
</dict>
</plist>
EOF

launchctl bootstrap "$DOMAIN" "$PLIST"
echo "Installed $LABEL with $NODE_BIN. Log: $PROJECT_DIR/tracker.log"
