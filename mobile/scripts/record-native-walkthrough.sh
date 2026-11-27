#!/usr/bin/env bash
# Capture the actual installed release app. Maestro drives touches; the OS
# recorder captures the frames at native quality (not Maestro's low bitrate).
set -euo pipefail
platform=${1:?android or ios}
folder=${2:?output folder}
app=${3:-}
app_id=app.navigator.mobile
mkdir -p "$folder"
folder=$(cd "$folder" && pwd)
recorder_pid=''
recording_chapter=''
touches_previous=''
touches_modified=0
remote_video=/sdcard/navigator-walkthrough.mp4
remote_pidfile=/data/local/tmp/navigator-walkthrough.pid

if [ "$platform" = ios ]; then
  test -d "$app"
  device=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; groups=json.load(sys.stdin)["devices"]; print(next(item["udid"] for devices in reversed(list(groups.values())) for item in devices if item["name"].startswith("iPhone")))')
  xcrun simctl boot "$device" || true
  xcrun simctl bootstatus "$device" -b
  xcrun simctl status_bar "$device" override --time '9:41' --dataNetwork wifi --wifiMode active --wifiBars 3 --cellularMode active --cellularBars 4 --batteryLevel 100 || true
elif [ "$platform" = android ]; then
  device=$(adb get-serialno 2>/dev/null || true)
else
  echo "Unknown platform: $platform" >&2
  exit 1
fi

# Never upload a zero-byte or unfinalized movie as a completed recording.
validate_mp4() {
  python3 - "$1" <<'PY' || return 1
import pathlib, struct, sys
p = pathlib.Path(sys.argv[1])
if not p.is_file() or p.stat().st_size < 4096:
    raise SystemExit("No usable video: " + str(p))
boxes = set()
length = p.stat().st_size
with p.open('rb') as f:
    pos = 0
    while pos + 8 <= length:
        f.seek(pos)
        size, kind = struct.unpack('>I4s', f.read(8))
        header = 8
        if size == 1:
            size = struct.unpack('>Q', f.read(8))[0]
            header = 16
        elif size == 0:
            size = length - pos
        if size < header or pos + size > length:
            break
        boxes.add(kind)
        pos += size
if not {b'ftyp', b'moov', b'mdat'} <= boxes:
    raise SystemExit("Unfinalized MP4: " + str(p))
PY
  if command -v ffprobe >/dev/null 2>&1; then
    ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name:format=duration -of json "$1" | python3 -c '
import json, sys
info = json.load(sys.stdin)
streams = info.get("streams", [])
if not streams or not streams[0].get("width", 0) or not streams[0].get("height", 0) or float(info.get("format", {}).get("duration", 0)) <= 0:
    raise SystemExit("Video has no valid dimensions or duration")
print(json.dumps(info))'
  fi
}

restore_touches() {
  if [ "$touches_modified" != 1 ]; then return 0; fi
  if [ "$touches_previous" = null ] || [ -z "$touches_previous" ]; then
    timeout 5 adb shell settings delete system show_touches || true
  else
    timeout 5 adb shell settings put system show_touches "$touches_previous" || true
  fi
  local restored
  restored=$(timeout 5 adb shell settings get system show_touches 2>/dev/null | tr -d '\r\n' || true)
  if [ "$restored" != "$touches_previous" ] && [ -n "$restored" ]; then
    echo "Android show_touches restoration could not be confirmed (expected $touches_previous, got $restored)" >&2
  fi
  touches_modified=0
}

stop_recorder() {
  if [ -z "$recorder_pid" ]; then restore_touches; return 0; fi
  local pid=$recorder_pid chapter=$recording_chapter remote_pid
  if [ "$platform" = android ]; then
    remote_pid=$(timeout 5 adb shell cat "$remote_pidfile" 2>/dev/null | tr -d '\r\n' || true)
    if [[ "$remote_pid" =~ ^[0-9]+$ ]]; then
      timeout 5 adb shell kill -INT "$remote_pid" || true
    fi
  else
    kill -INT "$pid" 2>/dev/null || true
  fi
  # Give the encoder time to flush its MP4 index after SIGINT.
  for _ in $(seq 1 30); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then kill -TERM "$pid" 2>/dev/null || true; fi
  wait "$pid" 2>/dev/null || true
  recorder_pid=''
  recording_chapter=''
  restore_touches
  if [ "$platform" = android ]; then
    timeout 90 adb pull "$remote_video" "$folder/navigator-walkthrough-$chapter.mp4" || true
  fi
  local video="$folder/navigator-walkthrough-$chapter.mp4"
  if ! validate_mp4 "$video"; then
    echo "Could not finalize $chapter video" >&2
    if [ -f "$video" ]; then mv "$video" "$folder/navigator-walkthrough-$chapter.unfinalized"; fi
    return 1
  fi
  return 0
}
cleanup() {
  stop_recorder || true
  restore_touches
  if [ "$platform" = ios ]; then xcrun simctl shutdown "$device" || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

prepare_chapter() {
  local chapter=$1 night
  if [ "$platform" = ios ]; then
    xcrun simctl terminate "$device" "$app_id" 2>/dev/null || true
    xcrun simctl uninstall "$device" "$app_id" 2>/dev/null || true
    xcrun simctl install "$device" "$app" || return 1
    xcrun simctl ui "$device" appearance "$chapter" || return 1
    xcrun simctl launch "$device" "$app_id" || return 1
  else
    if [ "$(timeout 5 adb get-state 2>/dev/null || true)" != device ]; then
      echo 'Android emulator disconnected before walkthrough' >&2
      timeout 10 adb reconnect offline || true
      sleep 4
      if [ "$(timeout 5 adb get-state 2>/dev/null || true)" != device ]; then
        echo 'Restarting the disposable Android CI emulator' >&2
        if test -f test-results/emulator.pid; then
          local old_pid
          old_pid=$(cat test-results/emulator.pid)
          if ps -p "$old_pid" -o comm= | grep -Eq 'qemu|emulator'; then kill "$old_pid" 2>/dev/null || true; fi
        fi
        timeout 10 adb kill-server || true
        sleep 3
        bash scripts/prepare-android-device.sh || return 1
      fi
    fi
    device=$(adb get-serialno) || return 1
    adb shell pm clear "$app_id" || return 1
    night=no
    if [ "$chapter" = dark ]; then night=yes; fi
    adb shell cmd uimode night "$night" || return 1
    adb shell am start -n "$app_id/.MainActivity" || return 1
  fi
  # Start the clip after live Home is rendered, rather than filming a splash.
  maestro test --device "$device" -e TARGET_ID=hero-primary --test-output-dir "$folder/$chapter-ready" tests/capture-ready.yaml
}

start_recorder() {
  local chapter=$1 video="$folder/navigator-walkthrough-$1.mp4"
  recording_chapter=$chapter
  if [ "$platform" = android ]; then
    # Make taps and drag trajectories visible in the Android screen capture.
    # Restore the device setting after finishing, including on flow failure.
    touches_previous=$(timeout 5 adb shell settings get system show_touches | tr -d '\r\n') || return 1
    timeout 5 adb shell settings put system show_touches 1 || return 1
    touches_modified=1
    # API 35 supports --time-limit 0. Use 8 Mbps for a readable, fluid 720p
    # portrait clip while avoiding the stock 180-second limit.
    adb shell "rm -f '$remote_video' '$remote_pidfile'; echo \$\$ > '$remote_pidfile'; exec screenrecord --bit-rate 8000000 --time-limit 0 '$remote_video'" > "$folder/$chapter-recorder.log" 2>&1 &
  else
    xcrun simctl io "$device" recordVideo --codec=h264 --force "$video" > "$folder/$chapter-recorder.log" 2>&1 &
  fi
  recorder_pid=$!
  for _ in $(seq 1 20); do
    if ! kill -0 "$recorder_pid" 2>/dev/null; then return 1; fi
    if [ "$platform" = android ]; then
      if timeout 5 adb shell test -f "$remote_video"; then sleep 1; return 0; fi
    elif [ -f "$video" ]; then
      sleep 1
      return 0
    fi
    sleep 1
  done
  echo "Recorder did not start for $chapter" >&2
  return 1
}

result=0
for chapter in dark light; do
  if ! prepare_chapter "$chapter"; then
    echo "Could not prepare $chapter Home" >&2
    printf '1\n' > "$folder/$chapter-status.txt"
    result=1
    continue
  fi
  if ! start_recorder "$chapter"; then
    echo "Could not start $chapter native recording" >&2
    stop_recorder || true
    printf '1\n' > "$folder/$chapter-status.txt"
    result=1
    continue
  fi
  # Even if an assertion fails, finalize and retain the real partial clip.
  chapter_status=0
  maestro test --device "$device" --format junit --output "$folder/$chapter-report.xml" --test-output-dir "$folder/$chapter" --debug-output "$folder/$chapter" "tests/walkthrough-$chapter.yaml" || chapter_status=$?
  stop_recorder || chapter_status=1
  printf '%s\n' "$chapter_status" > "$folder/$chapter-status.txt"
  if [ "$chapter_status" -ne 0 ]; then result=1; fi
done
exit "$result"
