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
  family=$device
  case "$family" in
    iPhone|iPad)
      app=${4:?Supply the simulator app to install}
      device=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; groups=json.load(sys.stdin)["devices"]; print(next(item["udid"] for devices in reversed(list(groups.values())) for item in devices if item["name"].startswith(sys.argv[1])))' "$family")
      xcrun simctl boot "$device" || true
      xcrun simctl bootstatus "$device" -b
      trap 'xcrun simctl shutdown "$device" || true' EXIT
      xcrun simctl status_bar "$device" override --time '9:41' --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryLevel 100 || true
      xcrun simctl install "$device" "$app"
      ;;
    *) test -n "$device" ;;
  esac
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
  python3 - "$1" "${family:-}" <<'PYPNG'
from pathlib import Path
import sys
p = Path(sys.argv[1])
import struct
data = p.read_bytes()
if len(data) < 1024 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[-8:-4] != b'IEND':
    raise SystemExit('Incomplete screenshot: ' + str(p))
width, height = struct.unpack('>II', data[16:24])
if sys.argv[2] == 'iPad' and max(width, height) / min(width, height) > 1.65:
    raise SystemExit(f'Unexpected iPad screenshot dimensions: {width} x {height}')
PYPNG
}
wait_for_screen() {
  local route=$1 target
  case "$route" in
    '') target=hero-primary ;;
    movie/*) target=title-detail-name ;;
    series/*/*/*) target=episode-detail-name ;;
    series/*) target=title-detail-name ;;
    search) target=search-input ;;
    settings) target=settings-page ;;
    *) return 1 ;;
  esac
  if [ "$platform" = ios ]; then
    # The simulator can show a system confirmation for a custom URL scheme.
    # Wait for an actual application accessibility element, not a splash.
    maestro test --device "$device" -e TARGET_ID="$target" --test-output-dir "$folder/../readiness" tests/capture-ready.yaml
  else
    local attempt
    for attempt in 1 2 3; do
      if timeout 12 adb shell uiautomator dump /sdcard/navigator-screen.xml >/dev/null 2>&1 &&
        timeout 5 adb shell cat /sdcard/navigator-screen.xml | grep -F "$target" >/dev/null; then return 0; fi
      sleep 3
    done
    return 1
  fi
}
capture() {
  local name=$1 route=$2 attempt
  for attempt in 1 2; do
    if ensure_device && appearance "$mode" && launch "$route"; then
      sleep 12
      if wait_for_screen "$route" && shot "$name" && validate_png "$folder/$name.png"; then return 0; fi
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
if [ "${family:-}" = iPad ]; then
  # Confirm that a live detail rendered with both tablet columns, then capture
  # the loaded movie and the visible Home rail using Maestro's device driver.
  tablet_results="$folder/../tablet"
  maestro test --device "$device" --test-output-dir "$tablet_results" tests/tablet-layout.yaml || result=1
  for name in movie-tablet-columns home-tablet-catalog; do
    captured=$(find "$tablet_results" -name "$name.png" -print -quit)
    if [ -n "$captured" ] && validate_png "$captured"; then
      cp "$captured" "$folder/$name.png"
    else
      result=1
    fi
  done
fi
exit "$result"
