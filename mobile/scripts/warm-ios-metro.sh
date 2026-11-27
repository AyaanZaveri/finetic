#!/usr/bin/env bash
# Prepare Metro's actual iOS manifest and bundle before opening a cold simulator.
# This is JavaScript compilation only; the native development binary is reused.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == macOS ]]
folder="$PWD/test-results/dev-client"
mkdir -p "$folder"
origin=http://127.0.0.1:8081
nohup env CI=1 EXPO_NO_TELEMETRY=1 REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 npx expo start --dev-client --localhost --port 8081 --max-workers 2 > "$folder/ios-metro.log" 2>&1 </dev/null &
pid=$!
printf '%s\n' "$pid" > "$folder/ios-metro.pid"
ready=false
for _ in $(seq 1 60); do
  if curl -fsS --max-time 4 "$origin/status" 2>/dev/null | grep -q 'packager-status:running'; then ready=true; break; fi
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$ready" != true ]; then
  tail -100 "$folder/ios-metro.log" >&2
  exit 1
fi
# The development client requests this same manifest. Warming its launch asset
# avoids the simulator's initial request expiring during cold JS compilation.
if curl -fsS --retry 1 --max-time 60 -H 'expo-platform: ios' -H 'expo-protocol-version: 0' -H 'Accept: application/expo+json' "$origin/" -o "$folder/ios-manifest.json"; then
  bundle=$(python3 - "$folder/ios-manifest.json" <<'PY'
import json, sys, urllib.parse
with open(sys.argv[1]) as f: manifest=json.load(f)
p=urllib.parse.urlsplit(manifest['launchAsset']['url'])
assert p.scheme=='http' and p.hostname in {'localhost','127.0.0.1'} and p.port==8081
print(urllib.parse.urlunsplit(('http','127.0.0.1:8081',p.path,p.query,'')))
PY
  ) || bundle=''
  if [ -n "$bundle" ] && curl -fsS --max-time 240 "$bundle" -o /dev/null; then
    echo 'Warm iOS Metro bundle ready.'
  else
    echo 'Metro bundle prewarm did not complete; the client will retry on launch.'
  fi
else
  echo 'Metro manifest prewarm did not complete; the client will retry on launch.'
fi
