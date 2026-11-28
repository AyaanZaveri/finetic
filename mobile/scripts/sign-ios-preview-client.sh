#!/usr/bin/env bash
# The cached client is unsigned. Give the disposable simulator copy an app
# identity so SecureStore can use Keychain without recompiling or using a key.
set -euo pipefail
archive=${1:?Path to the cached iOS simulator archive}
work=$(mktemp -d "${TMPDIR:-/tmp}/navigator-ios-preview-sign.XXXXXX")
trap 'rm -rf "$work"' EXIT
tar -xzf "$archive" -C "$work"
app=$(find "$work" -maxdepth 1 -type d -name '*.app' -print -quit)
test -n "$app"
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
test "$bundle_id" = app.navigator.mobile
executable=$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$app/Info.plist")
# Do not alter device builds or a release app. This identity is simulator only.
xcrun vtool -show-build "$app/$executable" > "$work/build-platforms.txt"
grep -Eq 'platform +IOSSIMULATOR' "$work/build-platforms.txt"
if grep -E 'platform +[^ ]+' "$work/build-platforms.txt" | grep -qv 'IOSSIMULATOR'; then
  echo 'Expected simulator-only Mach-O slices' >&2
  exit 1
fi

cat > "$work/entitlements.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>application-identifier</key>
  <string>NAVSIM0001.app.navigator.mobile</string>
  <key>keychain-access-groups</key>
  <array>
    <string>NAVSIM0001.app.navigator.mobile</string>
  </array>
</dict>
</plist>
PLIST

# Sign nested code first. Only the app receives Keychain entitlements.
while IFS= read -r -d '' item; do
  codesign --force --sign - --timestamp=none "$item"
done < <(find "$app" -depth \( -type d -name '*.framework' -o -type f -name '*.dylib' \) -print0)
codesign --force --sign - --timestamp=none --entitlements "$work/entitlements.plist" "$app"
codesign --verify --deep --strict "$app"
tar -C "$work" -czf "$work/signed-client.tar.gz" "$(basename "$app")"
mv "$work/signed-client.tar.gz" "$archive"
echo 'Prepared simulator-only Keychain entitlements on the cached iOS client'
