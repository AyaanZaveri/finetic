#!/usr/bin/env bash
set -euo pipefail

base_url="${WORKBENCH_URL:-http://127.0.0.1:3000/states/player-selection}"
capture_dir="${WORKBENCH_CAPTURE_DIR:-workbench-captures}"
mkdir -p "$capture_dir"

init_script="$(mktemp -t windows-workbench.XXXXXX)"
trap 'rm -f "$init_script"' EXIT
cat > "$init_script" <<'JS'
if (location.pathname === "/states/player-selection") {
  window.navigatorDesktop = {
    protocol: 1, platform: "windows", engine: "mpv", fullscreen: false,
    capabilities: { glass: true, glassPixels: true },
    send() {}, subscribe() { return () => {}; },
  };
  const setPlatform = () => {
    document.documentElement.dataset.nativePlatform = "windows";
    document.documentElement.dataset.nativePlaying = "";
  };
  if (document.documentElement) setPlatform();
  else document.addEventListener("DOMContentLoaded", setPlatform, { once: true });
}
JS

agent-browser --init-script "$init_script" open "$base_url?__stage=1&__state=closed"
agent-browser set viewport 1280 900
agent-browser wait --fn 'Boolean(document.querySelector("[data-player-toolbar]"))'
agent-browser wait --fn '![...document.querySelectorAll("[role=status]")].some(node => /^Fetching (audio|subtitles)$/.test(node.textContent.trim()))'

for state in fetching-subtitles fetching-audio; do
  case "$state" in
    fetching-subtitles) label="Fetching subtitles" ;;
    fetching-audio) label="Fetching audio" ;;
  esac
  agent-browser open "$base_url?__stage=1&__state=$state"
  agent-browser wait --fn "[...document.querySelectorAll('[role=status]')].some(node => node.textContent.trim() === '$label' && node.getBoundingClientRect().width > 0)"
  agent-browser screenshot "$capture_dir/$state.png"
done

check_drawer() {
  local state="$1" heading="$2" expected_width="$3"
  agent-browser open "$base_url?__stage=1&__state=$state"
  agent-browser wait --fn "(() => {
    const drawer = document.querySelector('[data-player-selection-drawer]');
    if (!drawer || window.navigatorDesktop?.platform !== 'windows') return false;
    const style = getComputedStyle(drawer);
    const rect = drawer.getBoundingClientRect();
    return drawer.querySelector('[data-slot=drawer-title]')?.textContent === '$heading'
      && !drawer.hasAttribute('data-player-native-glass')
      && !drawer.querySelector('[data-browser-glass-frame]')
      && style.backdropFilter === 'blur(12px)'
      && Math.abs(rect.width - $expected_width) < 1
      && rect.right <= innerWidth - 15
      && rect.left >= 15;
  })()"
}

check_drawer episodes Episodes 480
agent-browser screenshot "$capture_dir/episodes.png"
check_drawer streams Streams 480
agent-browser screenshot "$capture_dir/streams.png"
check_drawer chapters Chapters 480
agent-browser screenshot "$capture_dir/chapters.png"

agent-browser set viewport 390 844
check_drawer streams Streams 358
agent-browser screenshot "$capture_dir/streams-narrow.png"
