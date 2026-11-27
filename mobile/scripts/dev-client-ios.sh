#!/usr/bin/env bash
# Reuse an unsigned iOS simulator development client across JS-only changes.
# Run in GitHub Actions with the dependencies and Maestro already installed.
set -euo pipefail
cd "$(dirname "$0")/.."

command_name=${1:-}
folder="$PWD/test-results/dev-client"
archive="$folder/ios-app.tar.gz"
bundle_id=app.navigator.mobile
metro_port=8081
metro_url="http://127.0.0.1:$metro_port"
# Expo SDK 56 generates exp+<slug> for development-client URLs.
dev_url='exp+navigator-mobile://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081&disableOnboarding=1'
mkdir -p "$folder"

validate_app() {
  local app=$1
  test -d "$app"
  test -f "$app/Info.plist"
  test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")" = "$bundle_id"
  local executable
  executable=$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$app/Info.plist")
  test -n "$executable"
  test -f "$app/$executable"
}

build_client() {
  if [ -s "$archive" ]; then
    if tar -tzf "$archive" > "$folder/ios-archive-files.txt" &&
      grep -Eq '^[^/]+\.app/Info\.plist$' "$folder/ios-archive-files.txt"; then
      echo "Reusing cached iOS development client: $archive"
      return
    fi
    echo 'Cached iOS development client is not usable; rebuilding' >&2
    rm -f "$archive"
  fi

  # Build only after a fingerprint cache miss. Debug simulator builds obtain
  # the current JS bundle from Metro, so do not embed a bundle in the archive.
  local derived_data="${RUNNER_TEMP:-$folder}/navigator-ios-dev"
  npx expo prebuild --platform ios --no-install
  (
    cd ios
    pod install | tee "$folder/ios-dev-pods.log"
  )
  local workspace app
  workspace=$(find ios -maxdepth 1 -name '*.xcworkspace' -print -quit)
  test -n "$workspace"
  SKIP_BUNDLING=1 xcodebuild -workspace "$workspace" -scheme Navigator -configuration Debug \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$derived_data" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
    | tee "$folder/ios-dev-build.log"
  app=$(find "$derived_data/Build/Products/Debug-iphonesimulator" -maxdepth 1 -type d -name '*.app' -print -quit)
  test -n "$app"
  validate_app "$app"
  tar -C "$(dirname "$app")" -czf "$archive.tmp" "$(basename "$app")"
  mv "$archive.tmp" "$archive"
  echo "Built iOS development client: $archive"
}

extract_client() {
  test -s "$archive"
  local destination="$folder/ios-app"
  mkdir -p "$destination"
  tar -xzf "$archive" -C "$destination"
  app=$(find "$destination" -maxdepth 1 -type d -name '*.app' -print -quit)
  test -n "$app"
  validate_app "$app"
}

choose_device() {
  local selector=$1
  case "$selector" in
    iPhone|iPad)
      device=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
groups = json.load(sys.stdin)["devices"]
print(next(item["udid"] for devices in reversed(list(groups.values()))
           for item in devices if item["name"].startswith(sys.argv[1])))
' "$selector")
      ;;
    *) device="$selector" ;;
  esac
  test -n "$device"
}

boot_device() {
  xcrun simctl boot "$device" || true
  xcrun simctl bootstatus "$device" -b
  xcrun simctl status_bar "$device" override --time '9:41' --dataNetwork wifi \
    --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryLevel 100 || true
}

metro_ready() {
  curl -fsS --max-time 3 "$metro_url/status" 2>/dev/null | grep -q 'packager-status:running'
}

start_metro() {
  # Relaunches keep the development server alive. Do not connect to an
  # unrelated Metro instance if port 8081 is unexpectedly occupied.
  if metro_ready; then
    local old_pid
    old_pid=$(cat "$folder/ios-metro.pid" 2>/dev/null || true)
    if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
      echo "Reusing this job's Metro development server"
      return
    fi
    echo "Unexpected Metro instance at $metro_url" >&2
    return 1
  fi

  # The GitHub Actions job owns this process and cleans it up on completion.
  # Keep it running across the screenshot and walkthrough steps.
  nohup env CI=1 EXPO_NO_TELEMETRY=1 npx expo start --dev-client --localhost --port "$metro_port" --max-workers 2 \
    > "$folder/ios-metro.log" 2>&1 </dev/null &
  local pid=$!
  printf '%s\n' "$pid" > "$folder/ios-metro.pid"
  for _ in $(seq 1 90); do
    if metro_ready; then return; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 2
  done
  tail -100 "$folder/ios-metro.log" >&2 || true
  echo 'Metro failed to start' >&2
  return 1
}

wait_for_home() {
  # A cold Metro compilation can exceed the ordinary 45-second readiness
  # timeout. Retry with the app still running instead of restarting Metro.
  local attempt
  for attempt in 1 2 3; do
    if maestro test --device "$device" -e TARGET_ID=hero-primary \
      --test-output-dir "$folder/ios-ready-$attempt" tests/capture-ready.yaml; then
      return
    fi
  done
  xcrun simctl io "$device" screenshot "$folder/ios-failed-ready.png" || true
  tail -100 "$folder/ios-metro.log" >&2 || true
  return 1
}

launch_client() {
  extract_client
  choose_device "${2:-iPhone}"
  boot_device
  xcrun simctl install "$device" "$app"
  start_metro
  xcrun simctl openurl "$device" "$dev_url"
  wait_for_home
  # Preserve the exact installed client/device and Metro URL across CI steps.
  if [ -n "${GITHUB_ENV:-}" ]; then
    {
      printf 'DEV_CLIENT_IOS_DEVICE=%s\n' "$device"
      printf 'DEV_CLIENT_IOS_APP=%s\n' "$app"
      printf 'NAVIGATOR_DEV_CLIENT_URL=%s\n' "$dev_url"
    } >> "$GITHUB_ENV"
  fi
  echo "Navigator development client ready on iOS simulator $device"
}

relaunch_client() {
  local appearance=${2:-}
  case "$appearance" in dark|light) ;; *) echo 'Usage: relaunch dark|light' >&2; exit 1 ;; esac
  choose_device "${DEV_CLIENT_IOS_DEVICE:-iPhone}"
  if [ -n "${DEV_CLIENT_IOS_APP:-}" ]; then
    app="$DEV_CLIENT_IOS_APP"
    validate_app "$app"
  else
    extract_client
  fi
  boot_device
  start_metro
  # Clean the disposable simulator's app data between recording chapters,
  # including the persisted appearance and navigation state. The native
  # binary and Metro are reused; no compilation occurs.
  xcrun simctl terminate "$device" "$bundle_id" 2>/dev/null || true
  xcrun simctl uninstall "$device" "$bundle_id" 2>/dev/null || true
  xcrun simctl install "$device" "$app"
  xcrun simctl ui "$device" appearance "$appearance"
  xcrun simctl openurl "$device" "${NAVIGATOR_DEV_CLIENT_URL:-$dev_url}"
  wait_for_home
}

case "$command_name" in
  build) build_client ;;
  launch) launch_client "$@" ;;
  relaunch) relaunch_client "$@" ;;
  *) echo 'Usage: dev-client-ios.sh build | launch [iPhone|iPad|UDID] | relaunch dark|light' >&2; exit 1 ;;
esac
