#!/usr/bin/env bash
set -euo pipefail
sdk=${ANDROID_HOME:-/usr/local/lib/android/sdk}
if [ ! -d "$sdk" ]; then
  echo "Android SDK directory not found: $sdk" >&2
  exit 1
fi
manager=$(find "$sdk/cmdline-tools" -path '*/bin/sdkmanager' -type f -print | sort | tail -1)
test -n "$manager"
manager_dir=$(dirname "$manager")
{
  printf '%s\n' "$manager_dir" "$sdk/platform-tools" "$sdk/emulator"
} >> "$GITHUB_PATH"
{
  printf 'ANDROID_HOME=%s\n' "$sdk"
  printf 'ANDROID_SDK_ROOT=%s\n' "$sdk"
} >> "$GITHUB_ENV"
# The SDK image includes platform tools; make sure the emulator is present.
"$manager" --sdk_root="$sdk" --install 'platform-tools' 'emulator'
