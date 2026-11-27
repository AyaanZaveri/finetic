#!/usr/bin/env bash
# Reuse a fingerprint-matched native development APK. The current JavaScript
# and assets are always served by Metro from this workflow's checkout.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${GITHUB_ACTIONS:-}" != true ] || [ "${RUNNER_OS:-}" != Linux ]; then
  echo 'This script is for the disposable Linux GitHub Actions runner only.' >&2
  exit 1
fi

apk=test-results/dev-client/android.apk
app_id=app.navigator.mobile
scheme=exp+navigator-mobile
metro_url=http://127.0.0.1:8081
# SDK 56 supports the generated scheme + expo-development-client path.
# The launcher also recognizes the onboarding parameter after an app data reset.
dev_url="$scheme://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableOnboarding=1"
mkdir -p test-results/dev-client

require_dependencies() {
  test -d node_modules/expo-dev-client || {
    echo 'Install the pinned mobile dependencies before building the development client.' >&2
    exit 1
  }
}

build_apk() {
  require_dependencies
  if [ -s "$apk" ] && unzip -tq "$apk" >/dev/null; then
    echo 'Reusing the restored Android development client APK.'
    return 0
  fi
  echo 'No usable cached Android development client. Compiling the native APK.'
  rm -f "$apk"
  npx --no-install expo prebuild --platform android --no-install --clean
  # Only the CI x86_64 emulator architecture is needed in this artifact.
  (
    cd android
    ./gradlew :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-daemon
  ) 2>&1 | tee test-results/dev-client/android-build.log
  test -s android/app/build/outputs/apk/debug/app-debug.apk
  cp android/app/build/outputs/apk/debug/app-debug.apk "$apk"
  unzip -tq "$apk" >/dev/null
}

metro_ready() {
  curl -fsS --max-time 5 "$metro_url/status" 2>/dev/null | grep -Fxq 'packager-status:running'
}

start_metro() {
  require_dependencies
  local pid
  if [ -f test-results/dev-client/metro.pid ]; then
    pid=$(cat test-results/dev-client/metro.pid)
    if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && metro_ready; then
      echo 'Reusing Metro for this checkout.'
      return 0
    fi
  fi
  if metro_ready; then
    echo 'Unexpected Metro server on 127.0.0.1:8081. Refusing to test another checkout.' >&2
    exit 1
  fi
  # The development client uses adb reverse instead of an Expo tunnel.
  CI=1 EXPO_NO_TELEMETRY=1 REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 \
    nohup npx --no-install expo start --dev-client --localhost --port 8081 \
      --scheme "$scheme" --max-workers 2 \
      > test-results/dev-client/metro.log 2>&1 </dev/null &
  pid=$!
  printf '%s\n' "$pid" > test-results/dev-client/metro.pid
  for _ in $(seq 1 90); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    if metro_ready; then return 0; fi
    sleep 2
  done
  tail -n 100 test-results/dev-client/metro.log >&2
  echo 'Metro did not start on port 8081.' >&2
  exit 1
}

device_ready() {
  [ "$(timeout 5 adb get-state 2>/dev/null || true)" = device ]
}

prepare_device() {
  test -s "$apk" || { echo "Missing development APK: $apk" >&2; exit 1; }
  if ! device_ready; then
    timeout 10 adb reconnect offline || true
    sleep 2
  fi
  if ! device_ready; then
    if [ -f test-results/emulator.pid ]; then
      local old_pid
      old_pid=$(cat test-results/emulator.pid)
      if [[ "$old_pid" =~ ^[0-9]+$ ]] && ps -p "$old_pid" -o comm= | grep -Eq 'qemu|emulator'; then
        kill "$old_pid" 2>/dev/null || true
      fi
    fi
    timeout 10 adb kill-server || true
    sleep 3
    NAVIGATOR_EMULATOR_MEMORY=3072 bash scripts/start-android-emulator.sh navigator-ci
  fi
  # Match the standalone recording dimensions and system gesture navigation.
  adb shell wm size 720x1600
  adb shell wm density 280
  if ! adb install -r "$apk"; then
    # An earlier CI APK may have used a different debug signing key. This is a
    # disposable test emulator, not a user device.
    adb uninstall "$app_id" || true
    adb install "$apk"
  fi
  adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural
  for _ in $(seq 1 15); do
    if [[ "$(adb shell settings get secure navigation_mode | tr -d '\r')" == 2 ]]; then break; fi
    sleep 1
  done
  test "$(adb shell settings get secure navigation_mode | tr -d '\r')" = 2
  adb reverse tcp:8081 tcp:8081
}

open_project() {
  device_ready || { echo 'Android emulator is offline.' >&2; return 1; }
  adb reverse tcp:8081 tcp:8081
  adb shell am force-stop "$app_id"
  # Preserve the ampersand in the URI through the remote shell.
  adb shell "am start -W -a android.intent.action.VIEW -d '$dev_url' -p '$app_id'"
  local device attempt
  device=$(adb get-serialno)
  # The first launch bundles on demand. A warm launch is much faster. Require
  # actual app content instead of accepting the development launcher or splash.
  for attempt in $(seq 1 3); do
    if maestro test --device "$device" -e TARGET_ID=hero-primary \
        --test-output-dir "test-results/dev-client/android-ready-$attempt" tests/capture-ready.yaml; then
      return 0
    fi
    if ! device_ready; then break; fi
    sleep 2
  done
  tail -n 100 test-results/dev-client/metro.log >&2
  return 1
}

export_ci_environment() {
  local device
  device=$(adb get-serialno)
  if [ -n "${GITHUB_ENV:-}" ]; then
    {
      printf 'NAVIGATOR_DEV_CLIENT_URL=%s\n' "$dev_url"
      printf 'NAVIGATOR_DEV_CLIENT_APK=%s\n' "$PWD/$apk"
      printf 'ANDROID_SERIAL=%s\n' "$device"
    } >> "$GITHUB_ENV"
  fi
}

case "${1:-all}" in
  build)
    build_apk
    ;;
  launch)
    start_metro
    prepare_device
    open_project
    export_ci_environment
    ;;
  relaunch)
    start_metro
    if ! device_ready; then prepare_device; fi
    case "${2:-}" in
      dark) adb shell cmd uimode night yes ;;
      light) adb shell cmd uimode night no ;;
      '') ;;
      *) echo 'Unknown appearance, expected dark or light.' >&2; exit 2 ;;
    esac
    open_project
    export_ci_environment
    ;;
  all)
    build_apk
    start_metro
    prepare_device
    open_project
    export_ci_environment
    ;;
  *)
    echo "Usage: $0 {build|launch|relaunch [dark|light]|all}" >&2
    exit 2
    ;;
esac
