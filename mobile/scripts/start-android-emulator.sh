#!/usr/bin/env bash
set -euo pipefail
name=${1:-navigator-ci}
# Use the same explicit AVD home in both Java avdmanager and the emulator.
export ANDROID_USER_HOME="${RUNNER_TEMP:-/tmp}/navigator-android-home"
export ANDROID_AVD_HOME="$ANDROID_USER_HOME/avd"
unset ANDROID_SDK_HOME
mkdir -p "$ANDROID_AVD_HOME"
mkdir -p test-results
sudo chmod 666 /dev/kvm
image='system-images;android-35;google_apis;x86_64'
sdkmanager --install "$image"
echo no | avdmanager create avd --force --name "$name" --package "$image" --device pixel_6 --path "$ANDROID_AVD_HOME/$name.avd"
# Some CLI versions write the ini into the default user directory.
if [ ! -f "$ANDROID_AVD_HOME/$name.ini" ]; then
  printf "path=%s\npath.rel=avd/%s.avd\ntarget=android-35\n" "$ANDROID_AVD_HOME/$name.avd" "$name" > "$ANDROID_AVD_HOME/$name.ini"
fi
test -f "$ANDROID_AVD_HOME/$name.avd/config.ini"
emulator -list-avds | grep -Fx "$name"
adb start-server
nohup emulator -avd "$name" -no-window -gpu swiftshader -cores 2 -no-snapshot -no-audio -no-boot-anim -accel on -memory "${NAVIGATOR_EMULATOR_MEMORY:-4096}" > test-results/emulator.log 2>&1 &
pid=$!
printf "%s\n" "$pid" > test-results/emulator.pid
for i in $(seq 1 150); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo 'Emulator exited before boot' >&2
    tail -n 80 test-results/emulator.log
    exit 1
  fi
  if [[ "$(timeout 5 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)" == '1' ]]; then
    adb shell settings put global anr_show_background 0
    adb shell input keyevent 82
    sleep 12
    adb devices -l
    exit 0
  fi
  sleep 2
done
adb devices -l
cat test-results/emulator.log | tail -80
exit 1
