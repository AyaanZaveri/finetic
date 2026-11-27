#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results/screens
capture() {
  local name=$1 route=$2
  adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081/--/$route" -p host.exp.exponent
  sleep 6
  timeout 15 adb exec-out screencap -p > "test-results/screens/$name.png"
  test -s "test-results/screens/$name.png"
}
# Save independent screenshot evidence before the longer accessibility flow.
# Route navigation uses the same Expo Router links as the app.
capture home ''
capture movie-detail 'movie/tmdb%3A812583'
capture series-detail 'series/tmdb%3A225171'
capture search 'search'
capture settings 'settings'
capture home ''
