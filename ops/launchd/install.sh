#!/bin/zsh
# Installs (or with --print, only shows) a weekly launchd job that runs
# `npm run refresh -- --trigger schedule` for this project every Monday 07:00.
# Output goes to data/logs/refresh.log. Remove it with ops/launchd/uninstall.sh.
set -euo pipefail

LABEL="com.corporate-sustainability-intelligence.refresh"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NPM="$(command -v npm || true)"
if [[ -z "$NPM" ]]; then echo "npm not found on PATH" >&2; exit 1; fi
NODE_DIR="$(dirname "$(command -v node)")"

read -r -d '' CONTENT <<PLISTEOF || true
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>WorkingDirectory</key><string>${PROJECT_DIR}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NPM}</string><string>run</string><string>refresh</string><string>--</string><string>--trigger</string><string>schedule</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${NODE_DIR}:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${PROJECT_DIR}/data/logs/refresh.log</string>
  <key>StandardErrorPath</key><string>${PROJECT_DIR}/data/logs/refresh.log</string>
</dict>
</plist>
PLISTEOF

if [[ "${1:-}" == "--print" ]]; then
  echo "Would write $PLIST:"; echo; echo "$CONTENT"; exit 0
fi

mkdir -p "$PROJECT_DIR/data/logs" "$HOME/Library/LaunchAgents"
echo "$CONTENT" > "$PLIST"
plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: runs every Monday at 07:00 (while you are logged in)."
echo "Run it now with: launchctl kickstart gui/$(id -u)/$LABEL"
