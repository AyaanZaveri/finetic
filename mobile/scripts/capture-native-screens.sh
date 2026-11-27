#!/usr/bin/env bash
set -euo pipefail
platform=$1
folder=$2
device=${3:-}
mkdir -p "$folder"
app_id=app.navigator.mobile
# Deep links address real Cinemeta records. The app fetches all metadata and
# artwork at runtime; no sample catalog or simulated screenshot is used.
if [ "$platform" = android ]; then
  appearance() { adb shell cmd uimode night "$1"; }
  launch() {
    adb shell am force-stop "$app_id"
    if [ -z "$1" ]; then
      adb shell am start -n "$app_id/.MainActivity"
    else
      adb shell am start -a android.intent.action.VIEW -d "navigator-mobile:///$1" -p "$app_id"
    fi
  }
  shot() { timeout 20 adb exec-out screencap -p > "$folder/$1.png"; }
  ensure_device() {
    if [ "$(timeout 5 adb get-state 2>/dev/null || true)" = device ]; then return 0; fi
    timeout 10 adb reconnect offline || true
    sleep 4
    if [ "$(timeout 5 adb get-state 2>/dev/null || true)" = device ]; then return 0; fi
    echo 'Android emulator disconnected. Restarting the disposable test device.'
    free -m || true
    sudo dmesg | tail -40 || true
    if test -f test-results/emulator.pid; then
      pid=$(cat test-results/emulator.pid)
      if ps -p "$pid" -o comm= | grep -Eq 'qemu|emulator'; then kill "$pid" 2>/dev/null || true; fi
    fi
    timeout 10 adb kill-server || true
    sleep 3
    bash scripts/prepare-android-device.sh
  }
  dark=yes; light=no
elif [ "$platform" = ios ]; then
  test -n "$device"
  appearance() { xcrun simctl ui "$device" appearance "$1"; }
  launch() {
    xcrun simctl terminate "$device" "$app_id" 2>/dev/null || true
    if [ -z "$1" ]; then
      xcrun simctl launch "$device" "$app_id"
    else
      xcrun simctl openurl "$device" "navigator-mobile:///$1"
    fi
  }
  shot() { xcrun simctl io "$device" screenshot "$folder/$1.png"; }
  ensure_device() { return 0; }
  dark=dark; light=light
else
  echo "Unknown platform: $platform" >&2
  exit 1
fi
validate_png() {
  python3 - "$1" <<'PYPNG'
from pathlib import Path
import sys
p = Path(sys.argv[1])
if not p.is_file() or p.stat().st_size < 1024 or p.open('rb').read(8) != b'\x89PNG\r\n\x1a\n':
    raise SystemExit(1)
PYPNG
}
capture() {
  local name=$1 route=$2 attempt
  for attempt in 1 2; do
    if ensure_device && appearance "$mode" && launch "$route"; then
      sleep 12
      if shot "$name" && validate_png "$folder/$name.png"; then return 0; fi
    fi
    rm -f "$folder/$name.png"
    echo "Attempt $attempt failed: $name"
  done
  return 1
}
result=0
mode=$dark
capture home-dark '' || result=1
capture movie-detail 'movie/tt0088763' || result=1
capture series-detail 'series/tt12324366' || result=1
capture episode-detail 'series/tt12324366/1/1' || result=1
capture search 'search' || result=1
capture settings 'settings' || result=1
mode=$light
capture home-light '' || result=1
capture movie-light 'movie/tt0088763' || result=1
capture series-light 'series/tt12324366' || result=1
ensure_device && appearance "$dark" || result=1
exit "$result"
