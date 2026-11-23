#!/usr/bin/env bash
set -euo pipefail

base_url="${WORKBENCH_URL:-http://127.0.0.1:3000/states/player-selection}"
capture_dir="${WORKBENCH_CAPTURE_DIR:-workbench-captures}"
mkdir -p "$capture_dir"

init_script="$(mktemp -t windows-workbench.XXXXXX)"
trap 'rm -f "$init_script"' EXIT
cat > "$init_script" <<'JS'
if (location.pathname === "/states/player-selection") {
  const listeners = new Set();
  window.navigatorDesktop = {
    protocol: 1, platform: "windows", engine: "mpv", fullscreen: false,
    capabilities: { glass: true, glassPixels: true },
    send(message) {
      if (message.type !== "glass" || message.session !== "workbench") return;
      window.workbenchGlassActive = message.active;
      if (!message.active) return;
      // Exercise the real Windows glass consumer with a high-contrast frame.
      const frame = new ImageData(320, 180);
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          const offset = (y * frame.width + x) * 4;
          frame.data.set(x < 240 ? [210, 90, 55, 255] : [45, 100, 220, 255], offset);
        }
      }
      requestAnimationFrame(() => {
        if (window.workbenchGlassActive) for (const listener of listeners) {
          listener({ type: "glass-pixels", session: "workbench", frame });
        }
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const setPlatform = () => {
    document.documentElement.dataset.nativePlatform = "windows";
    document.documentElement.dataset.nativePlaying = "";
  };
  if (document.documentElement) setPlatform();
  else document.addEventListener("DOMContentLoaded", setPlatform, { once: true });
}
JS

wait_for() {
  if agent-browser wait --fn "$1"; then return; fi
  agent-browser snapshot || true
  agent-browser screenshot "$capture_dir/failure.png" || true
  agent-browser eval --stdin <<'JS' || true
({
  url: location.href,
  viewport: [innerWidth, innerHeight],
  platform: window.navigatorDesktop?.platform,
  motion: window.workbenchGlassMotion,
  statuses: [...document.querySelectorAll("[role=status]")].map(node => ({
    text: node.textContent, width: node.getBoundingClientRect().width,
  })),
  drawer: [...document.querySelectorAll("[data-player-selection-drawer]")].map(node => ({
    text: node.querySelector("[data-slot=drawer-title]")?.textContent,
    width: node.getBoundingClientRect().width,
    blur: getComputedStyle(node).backdropFilter,
    left: node.getBoundingClientRect().left,
    right: node.getBoundingClientRect().right,
  })),
})
JS
  return 1
}

agent-browser --init-script "$init_script" open "$base_url?__stage=1&__state=closed"
agent-browser set viewport 1280 900
wait_for 'Boolean(document.querySelector("[data-player-toolbar]"))'
wait_for '![...document.querySelectorAll("[role=status]")].some(node => /^Fetching (audio|subtitles)$/.test(node.textContent.trim()))'

for state in fetching-subtitles fetching-audio; do
  case "$state" in
    fetching-subtitles) label="Fetching subtitles" ;;
    fetching-audio) label="Fetching audio" ;;
  esac
  agent-browser open "$base_url?__stage=1&__state=$state"
  wait_for "[...document.querySelectorAll('[role=status]')].some(node => node.textContent.trim() === '$label' && node.getBoundingClientRect().width > 0)"
  agent-browser screenshot "$capture_dir/$state.png"
done

check_drawer() {
  local state="$1" heading="$2" expected_width="$3"
  agent-browser open "$base_url?__stage=1&__state=$state&__windowsGlass=1"
  wait_for "(() => {
    const drawer = document.querySelector('[data-player-selection-drawer]');
    if (!drawer || window.navigatorDesktop?.platform !== 'windows') return false;
    const style = getComputedStyle(drawer);
    const rect = drawer.getBoundingClientRect();
    const canvas = drawer.querySelector(':scope > [data-browser-glass-frame]');
    if (!canvas || canvas.width !== 320 || !window.workbenchGlassActive) return false;
    const pixels = canvas.getContext('2d');
    const red = pixels.getImageData(160, 90, 1, 1).data;
    const edge = pixels.getImageData(239, 90, 1, 1).data;
    const tint = getComputedStyle(drawer, '::after');
    return drawer.querySelector('[data-slot=drawer-title]')?.textContent === '$heading'
      && drawer.hasAttribute('data-player-native-glass')
      && drawer.hasAttribute('data-browser-glass')
      && style.backdropFilter === 'none'
      && red[0] > 190 && edge[0] < 190 && edge[2] > 65
      && tint.display !== 'none' && tint.width === drawer.clientWidth + 'px'
      && Math.abs(canvas.getBoundingClientRect().left) < 1
      && Math.abs(canvas.getBoundingClientRect().top) < 1
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
agent-browser eval --stdin <<'JS'
(() => {
  const drawer = document.querySelector('[data-player-selection-drawer]');
  const canvas = drawer.querySelector(':scope > [data-browser-glass-frame]');
  window.workbenchGlassMotion = { samples: 0, maxError: 0, done: false };
  // Slow this one CSS transition down to get enough intermediate frames on CI.
  // There is only one video sample, so geometry must update independently.
  drawer.style.transition = "transform 900ms linear";
  requestAnimationFrame(() => {
    const originalLeft = drawer.getBoundingClientRect().left;
    const end = performance.now() + 1100;
    drawer.style.transform = "translateX(100px)";
    const sample = () => {
      const movement = drawer.getBoundingClientRect().left - originalLeft;
      if (movement > 15 && movement < 85) {
        window.workbenchGlassMotion.samples++;
        window.workbenchGlassMotion.maxError = Math.max(window.workbenchGlassMotion.maxError, Math.abs(canvas.getBoundingClientRect().left));
      }
      if (performance.now() < end) requestAnimationFrame(() => setTimeout(sample, 0));
      else window.workbenchGlassMotion.done = true;
    };
    requestAnimationFrame(() => setTimeout(sample, 0));
  });
})()
JS
wait_for 'window.workbenchGlassMotion?.done && window.workbenchGlassMotion.samples >= 2 && window.workbenchGlassMotion.maxError < 4'

agent-browser set viewport 390 844
check_drawer streams Streams 358
agent-browser screenshot "$capture_dir/streams-narrow.png"

agent-browser set viewport 1280 900
agent-browser open "$base_url?__stage=1&__state=playing&__windowsGlass=1"
wait_for 'document.querySelector("video")?.paused === false'
agent-browser eval --stdin <<'JS'
(() => {
  const root = document.querySelector('[data-slot="media-player"]');
  root.focus();
  root.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
})()
JS
wait_for 'document.querySelector("video")?.playbackRate === 2 && Boolean(document.querySelector("[data-slot=media-player-speed-boost][data-browser-glass] canvas"))'
agent-browser screenshot "$capture_dir/speed-pill.png"
agent-browser eval --stdin <<'JS'
document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }))
JS
wait_for 'document.querySelector("video")?.playbackRate === 1 && !document.querySelector("[data-slot=media-player-speed-boost]")'
