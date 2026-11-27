#!/usr/bin/env bash
set -euo pipefail
platform=$1
# Wait for Metro's first device bundle, not just the listening socket. The
# simulator can display a splash for a few minutes on a clean runner.
for i in $(seq 1 240); do
  if grep -Eq "${platform} Bundled|${platform} bundling complete" test-results/metro.log; then
    exit 0
  fi
  if grep -Eiq 'bundling failed|unable to resolve module|syntaxerror' test-results/metro.log; then
    tail -n 60 test-results/metro.log
    exit 1
  fi
  sleep 2
done
tail -n 60 test-results/metro.log
exit 1
