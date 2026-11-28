#!/usr/bin/env bash
# Capture both system appearances from the live, already-launched native client.
# Do not reinstall the app, restart Metro, or rebuild the native binary.
set -euo pipefail
cd "$(dirname "$0")/.."
platform=${1:?android, ios, or ipad}
folder="test-results/hero-preview"
mkdir -p "$folder"
flow=tests/hero-preview.yaml
case "$platform" in
  android) device=$(adb get-serialno) ;;
  ios) device=${DEV_CLIENT_IOS_DEVICE:?} ;;
  ipad) device=${DEV_CLIENT_IOS_DEVICE:?}; flow=tests/hero-preview-ipad.yaml ;;
  *) echo "Unknown platform: $platform" >&2; exit 2 ;;
esac

set_appearance() {
  local appearance=$1
  if [ "$platform" = android ]; then
    local night=no
    if [ "$appearance" = dark ]; then night=yes; fi
    adb shell cmd uimode night "$night"
  else
    xcrun simctl ui "$device" appearance "$appearance"
  fi
}

result=0
for appearance in dark light; do
  mkdir -p "$folder/$appearance"
  # Give the OS appearance notification and tinted wordmark images time to settle.
  if ! set_appearance "$appearance"; then result=1; continue; fi
  sleep 5
  if ! maestro test --device "$device" --test-output-dir "$folder/$appearance" "$flow"; then
    result=1
  fi
done
# The longer walkthroughs start in dark mode.
set_appearance dark || result=1
exit "$result"
