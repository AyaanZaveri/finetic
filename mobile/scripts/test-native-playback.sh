#!/usr/bin/env bash
set -euo pipefail
# Called only for the disposable CI emulator/simulator by mobile-playback.yml.
platform=${1:?Specify android or ios}
device=${2:?Specify the installed app device}
case "$platform" in android|ios) ;; *) exit 2 ;; esac
folder="test-results/playback"
mkdir -p "$folder"
result=0
run_case() {
  local fixture=$1 flow=$2
  local destination="$folder/$fixture"
  mkdir -p "$destination"
  echo "Testing $fixture: $flow"
  if ! maestro test --device "$device" -e FIXTURE="$fixture" \
    --format junit --output "$destination/report.xml" \
    --test-output-dir "$destination" --debug-output "$destination" \
    "tests/playback/$flow.yaml" | tee "$destination/maestro.log"; then
    result=1
    return
  fi
  local evidence
  case "$flow" in
    supported) evidence='preview-displayed.png' ;;
    chapters) evidence='chapter-images-displayed.png' ;;
    unsupported) evidence='unsupported-source.png' ;;
    probe)
      # A probe must take precisely one branch and leave corresponding evidence.
      if [ -n "$(find "$destination" -name 'codec-rejected.png' -print -quit)" ]; then
        evidence='codec-rejected.png'
      else
        evidence='preview-displayed.png'
      fi
      ;;
  esac
  if [ -z "$(find "$destination" -name "$evidence" -print -quit)" ]; then
    echo "Missing playback evidence: $destination/$evidence" >&2
    result=1
  fi
}

# Required baseline uses real frames and thumbnails, not fixture screenshots.
run_case mp4-avc supported
run_case mp4-chapters chapters
if [ "$platform" = android ]; then
  # Media3 supports these containers; the emulator must demonstrate playback.
  run_case mkv-avc supported
  run_case webm-vp9 supported
else
  # AVPlayer baseline does not promise these containers. Record what this
  # simulator can render or explicitly rejects, rather than assume support.
  run_case mkv-avc probe
  run_case webm-vp9 probe
fi
# HEVC decoder availability is device/OS dependent. Require a native frame and
# preview, or an explicit unsupported error, and preserve which was observed.
run_case mp4-hevc probe
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### $platform native media results"
    echo
    echo '| Fixture | Required outcome | Observed |'
    echo '|---|---|---|'
    for name in mp4-avc mp4-chapters mkv-avc webm-vp9 mp4-hevc; do
      dest="$folder/$name"
      expected='Playback and preview'
      if [ "$name" = mp4-chapters ]; then
        expected='Playback, preview and chapter images'
      elif [ "$name" = mp4-hevc ]; then
        expected='Compatibility probe'
      elif [ "$platform" = ios ] && [[ "$name" = mkv-avc || "$name" = webm-vp9 ]]; then
        expected='Compatibility probe (AVPlayer usually rejects)'
      fi
      observed='FAILED or incomplete; see logs'
      # The screenshots only exist if their preceding native-event assertions
      # passed. The final report must also show no failed or errored tests.
      if [ -f "$dest/report.xml" ] && python3 - "$dest/report.xml" <<'PY'
import sys
from xml.etree import ElementTree as ET
root = ET.parse(sys.argv[1]).getroot()
cases = list(root.iter("testcase"))
sys.exit(0 if cases and not any(case.find("failure") is not None or case.find("error") is not None or case.find("skipped") is not None for case in cases) else 1)
PY
      then
        if [ -n "$(find "$dest" -name 'codec-rejected.png' -print -quit)" ]; then
          observed='Rejected (not playable)'
        elif [ -n "$(find "$dest" -name 'unsupported-source.png' -print -quit)" ]; then
          observed='Expected rejection (not playable)'
        elif [ -n "$(find "$dest" -name 'preview-displayed.png' -print -quit)" ]; then
          observed='Rendered and extracted preview'
          if [ "$name" = mp4-chapters ]; then observed='Rendered and extracted chapter images'; fi
        fi
      fi
      echo "| $name | $expected | $observed |"
    done
    echo
    echo 'Simulator evidence does not establish audio output quality, HDR, hardware decoding, or device-wide codec support.'
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit "$result"
