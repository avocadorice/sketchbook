#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
app="${1:-$HOME/Applications/Sketchbook.app}"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
clang -fobjc-arc -fno-modules -O2 -mmacosx-version-min=14 -framework Cocoa -framework WebKit mac/Sketchbook.m -o "$app/Contents/MacOS/Sketchbook"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Sketchbook</string><key>CFBundleIdentifier</key><string>com.barney.sketchbook.app</string><key>CFBundleName</key><string>Sketchbook</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>
PLIST
if [ -n "${SKETCHBOOK_URL:-}" ]; then
  /usr/libexec/PlistBuddy -c "Add :SketchbookURL string $SKETCHBOOK_URL" "$app/Contents/Info.plist"
fi
codesign --force --deep --sign - "$app"
printf '%s\n' "$app"
