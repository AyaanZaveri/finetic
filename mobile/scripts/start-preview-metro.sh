#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results
EXPO_PUBLIC_MOBILE_FIXTURES=1 EXPO_NO_TELEMETRY=1 CI=1 REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 nohup npx expo start --go --lan --port 8081 --max-workers 2 --no-dev > test-results/metro.log 2>&1 &
for i in $(seq 1 90); do
  if curl --noproxy '*' --max-time 4 -fsS http://127.0.0.1:8081/status 2>/dev/null | grep -q 'packager-status:running'; then
    exit 0
  fi
  sleep 2
done
tail -n 40 test-results/metro.log
exit 1
