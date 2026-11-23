#!/bin/bash
set -euo pipefail

results="$PWD/update-results/macos"
mkdir -p "$results"
temp=$(mktemp -d "${RUNNER_TEMP}/navigator-update.XXXXXX")
app="$HOME/Applications/Navigator.app"
executable="$app/Contents/MacOS/navigator-desktop"
plist="$app/Contents/Info.plist"
profile="$HOME/Library/Application Support/Navigator Desktop"
recording=
old_pid=
new_pid=

finish() {
    result=$?
    if [[ -n "$recording" ]]; then
        touch "$temp/record.stop"
        wait "$recording" || true
    fi
    if [[ -s "$results/frame-0000.jpg" ]] && command -v ffmpeg >/dev/null; then
        if ffmpeg -nostdin -loglevel error -framerate 4 -i "$results/frame-%04d.jpg" \
            -vf 'scale=trunc(iw/2)*2:trunc(ih/2)*2' -c:v libx264 -pix_fmt yuv420p "$results/restart-to-update.mp4"; then
            rm "$results"/frame-*.jpg
        fi
    fi
    /usr/bin/log show --last 10m --style compact --predicate 'subsystem == "org.sparkle-project.Sparkle"' >"$results/sparkle.log" 2>&1 || true
    for pid in "$old_pid" "$new_pid"; do
        if [[ -n "$pid" ]]; then kill -TERM "$pid" 2>/dev/null || true; fi
    done
    exit "$result"
}
trap finish EXIT

exec > >(tee "$results/update.log") 2>&1
if [[ -e "$app" || -e "$profile" ]]; then printf '%s\n' 'Run on a fresh macOS runner.' >&2; exit 1; fi
archive="$temp/Navigator-0.6.7-macos-arm64.zip"
curl -fsSL --retry 3 -o "$archive" 'https://github.com/AyaanZaveri/navigator/releases/download/release-v0.6.7/Navigator-0.6.7-macos-arm64.zip'
printf '%s  %s\n' '06c9b55bc06e36648232e79be327a19e2f3324e7e0ebf92fd486c98ee3d18d06' "$archive" | shasum -a 256 -c -
mkdir -p "$HOME/Applications" "$profile"
ditto -x -k "$archive" "$HOME/Applications"
printf 'Keep the existing profile\n' > "$profile/update-profile-marker.txt"
[[ $(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$plist") == '0.6.7' ]]
clang -fobjc-arc -Wall -Wextra -Werror -framework ApplicationServices -framework Foundation -o "$temp/update-ui" scripts/macos-update-ui.m
open -n "$app"
for ((attempt=0; attempt<120; attempt++)); do
    old_pid=$(pgrep -f -x "$executable" || true)
    [[ -z "$old_pid" ]] || break
    sleep 0.25
done
[[ -n "$old_pid" ]]
old_names=('Update ready. Restart to update.' 'Restart to update')
deadline=$((SECONDS+150))
while true; do
    code=0
    "$temp/update-ui" "$old_pid" find "${old_names[@]}" || code=$?
    if [[ "$code" == 0 ]]; then break; fi
    if [[ "$code" != 1 || "$SECONDS" -ge "$deadline" ]] || ! kill -0 "$old_pid" 2>/dev/null; then
        printf '%s\n' 'Could not reach Restart to update in the installed macOS app.' >&2
        screencapture -x "$results/failed.png" || true
        exit 1
    fi
    sleep 0.5
done

(
    for ((frame=0; frame<360; frame++)); do
        [[ ! -e "$temp/record.stop" ]] || break
        screencapture -x -t jpg "$(printf '%s/frame-%04d.jpg' "$results" "$frame")" 2>"$results/capture-error.txt" || break
        sleep 0.20
    done
) &
recording=$!
sleep 0.6
start=$SECONDS
"$temp/update-ui" "$old_pid" press "${old_names[@]}"
echo "Clicked Restart to update on PID $old_pid"
deadline=$((SECONDS+100))
while ((SECONDS < deadline)); do
    new_pid=$(pgrep -f -x "$executable" | awk -v old="$old_pid" '$0 != old { print; exit }' || true)
    if [[ -n "$new_pid" ]] && ! kill -0 "$old_pid" 2>/dev/null &&
        [[ $(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$plist" 2>/dev/null) == '0.6.8' ]] &&
        "$temp/update-ui" "$new_pid" find 'Sign in' 'Navigator home'; then
        break
    fi
    sleep 0.25
done
[[ "$SECONDS" -lt "$deadline" ]]
[[ $(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$plist") == '0.6.8' ]]
codesign --verify --deep --strict "$app"
[[ $(cat "$profile/update-profile-marker.txt") == 'Keep the existing profile' ]]
printf '{"oldPid":%s,"newPid":%s,"sourceVersion":"0.6.7","installedVersion":"0.6.8","appReadySeconds":%s}\n' \
    "$old_pid" "$new_pid" "$((SECONDS-start))" | tee "$results/result.json"
sleep 0.6
