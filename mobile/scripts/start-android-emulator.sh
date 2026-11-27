#!/usr/bin/env bash
set -euo pipefail
name=${1:-navigator-ci}
mkdir -p test-results
sudo chmod 666 /dev/kvm
image='system-images;android-35;google_apis;x86_64'
sdkmanager --install "$image"
echo no | avdmanager create avd --force --name "$name" --package "$image" --device pixel_6
adb start-server
nohup emulator -avd "$name" -no-window -gpu swiftshader -no-snapshot -no-audio -no-boot-anim -accel on -memory 2048 > test-results/emulator.log 2>&1 &
pid=$!
for i in $(seq 1 150); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo 'Emulator exited before boot' >&2
    tail -n 80 test-results/emulator.log
    exit 1
  fi
  if [[ "$(timeout 5 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)" == '1' ]]; then
    adb shell input keyevent 82
    adb devices -l
    exit 0
  fi
  sleep 2
done
adb devices -l
cat test-results/emulator.log | tail -80
exit 1
