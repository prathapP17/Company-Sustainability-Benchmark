#!/bin/zsh
# Removes the weekly refresh job installed by ops/launchd/install.sh.
set -euo pipefail
LABEL="com.corporate-sustainability-intelligence.refresh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed $LABEL."
