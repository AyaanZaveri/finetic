#!/usr/bin/env bash
set -euo pipefail
# All commands run only on the disposable GitHub Actions emulator.
NAVIGATOR_EMULATOR_MEMORY=3072 bash scripts/start-android-emulator.sh navigator-ci
adb shell wm size 720x1600
adb shell wm density 280
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural
for i in $(seq 1 15); do
  if [[ "$(adb shell settings get secure navigation_mode | tr -d '\r')" == 2 ]]; then exit 0; fi
  sleep 1
done
exit 1
