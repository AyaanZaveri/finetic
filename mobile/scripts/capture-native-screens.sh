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
  dark=dark; light=light
else
  echo "Unknown platform: $platform" >&2
  exit 1
fi
capture() {
  launch "$2"
  sleep 12
  shot "$1"
  test -s "$folder/$1.png"
}
appearance "$dark"
capture home-dark ''
capture movie-detail 'movie/tt0088763'
capture series-detail 'series/tt22202452'
capture search 'search'
capture settings 'settings'
appearance "$light"
capture home-light ''
appearance "$dark"
