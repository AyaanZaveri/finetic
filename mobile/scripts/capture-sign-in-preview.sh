#!/usr/bin/env bash
set -euo pipefail

case "${1:?Expected android or ios}" in
  android)
    device=$(adb get-serialno)
    open_route() {
      adb -s "$device" shell am start -W -a android.intent.action.VIEW -d "$1" app.navigator.mobile >/dev/null
    }
    ;;
  ios)
    device=${DEV_CLIENT_IOS_DEVICE:?Launch the iOS development client first}
    open_route() {
      xcrun simctl openurl "$device" "$1"
    }
    ;;
  *) exit 2 ;;
esac

# Dispatch directly to the current development client. On iOS, Maestro's
# browser-based openLink path can leave an OS confirmation over the app.
open_route navigator-mobile:///movie/tt0088763
trap 'open_route navigator-mobile:/// || true' EXIT
maestro test --device "$device" --test-output-dir test-results/sign-in-preview \
  --format junit --output test-results/sign-in-report.xml tests/sign-in-preview.yaml
