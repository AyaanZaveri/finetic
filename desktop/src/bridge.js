(() => {
  if (window.top !== window || location.origin !== __ORIGIN__) return;
  const listeners = new Set();
  const platform = __PLATFORM__;
  let session;
  let fullscreen = false;
  Object.defineProperty(window, "__navigatorDesktopReceive", {
    value(message) {
      if (message.type === "fullscreen") {
        fullscreen = message.value;
        mark();
      }
      for (const listener of [...listeners]) {
        try { listener(message); } catch (error) { console.error(error); }
      }
    },
  });
  if (platform === "windows" && window.chrome?.webview) {
    const buffers = new Map(), pending = new Map();
    const consume = (message) => {
      const buffer = buffers.get(message.slot);
      if (!buffer) { pending.set(message.slot, message); return; }
      try {
        if (message.session === session && Number.isInteger(message.width) && Number.isInteger(message.height)
            && message.width > 0 && message.width <= 640 && message.height > 0 && message.height <= 360) {
          const pixels = new Uint8ClampedArray(buffer, 0, message.width * message.height * 4);
          // Listeners must synchronously copy; this read-only slot is reused
          // only after every listener has returned and the exact sequence is acked.
          window.__navigatorDesktopReceive({ type: "glass-pixels", session: message.session,
            sequence: message.sequence, frame: new ImageData(pixels, message.width, message.height) });
        }
      } catch (error) { console.error(error); }
      finally { window.ipc.postMessage(JSON.stringify({ type: "glass-consumed", slot: message.slot, sequence: message.sequence })); }
    };
    window.chrome.webview.addEventListener("sharedbufferreceived", event => {
      const metadata = event.additionalData;
      if (metadata?.type !== "navigator-glass-buffer" || !Number.isInteger(metadata.slot) || metadata.slot < 0 || metadata.slot > 2) return;
      const previous = buffers.get(metadata.slot);
      if (previous) window.chrome.webview.releaseBuffer(previous);
      buffers.set(metadata.slot, event.getBuffer());
      const message = pending.get(metadata.slot);
      if (message) { pending.delete(metadata.slot); consume(message); }
    });
    window.chrome.webview.addEventListener("message", event => {
      const message = event.data;
      if (message?.type !== "navigator-glass-frame" || !Number.isInteger(message.slot) || message.slot < 0 || message.slot > 2
          || !Number.isSafeInteger(message.sequence) || message.sequence < 1) return;
      consume(message);
    });
    window.addEventListener("pagehide", () => {
      for (const buffer of buffers.values()) window.chrome.webview.releaseBuffer(buffer);
      buffers.clear(); pending.clear();
    }, { once: true });
  }
  Object.defineProperty(window, "navigatorDesktop", {
    value: Object.freeze({
      protocol: __PROTOCOL__,
      platform,
      capabilities: Object.freeze({ nativePreviews: true, subtitleTiming: true, nativeHdrPeak: platform === "macos" || platform === "windows", chapters: true, initialSeek: true, windowControlsVisibility: platform === "macos" || platform === "windows", videoFit: true, updates: platform === "windows" || platform === "macos", timings: platform === "windows" || platform === "macos", glass: platform === "windows", glassPixels: platform === "windows" }),
      get fullscreen() { return fullscreen; },
      send(message) {
        if (message.type === "load") session = message.session;
        window.ipc.postMessage(JSON.stringify(message));
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
  });
  // WKWebView must have an alpha background before its first paint.
  function mark() {
    if (!document.documentElement) return;
    document.documentElement.dataset.desktop = "mpv";
    document.documentElement.dataset.nativePlatform = platform;
    document.documentElement.dataset.desktopFullscreen = String(fullscreen);
    document.documentElement.style.setProperty("background", "transparent", "important");
    document.documentElement.style.colorScheme = "normal";
  }
  mark();
  if (!document.documentElement) {
    const observer = new MutationObserver(() => {
      if (document.documentElement) { mark(); observer.disconnect(); }
    });
    observer.observe(document, { childList: true, subtree: true });
  }
  document.addEventListener("DOMContentLoaded", mark, { once: true });
  if (platform === "macos" || platform === "windows") {
    // Blank header space owns window gestures. Controls keep normal input.
    document.addEventListener("mousedown", (event) => {
      if (!event.isTrusted || event.defaultPrevented || event.button !== 0 || fullscreen ||
          event.detail > 2 || (platform === "macos" && event.ctrlKey)) return;
      const target = event.target;
      if (!target?.closest || target.closest('a, button, input, textarea, select, [role="button"], [role="menu"], [role="listbox"], [role="option"], [contenteditable], [data-no-window-drag]')) return;
      if (!target.closest("[data-window-drag-region]") && event.clientY >= 20) return;
      event.preventDefault();
      window.navigatorDesktop.send(event.detail === 2
        ? { type: "window-drag", doubleClick: true }
        : { type: "window-drag" });
    });
  }
  window.addEventListener("pagehide", () => {
    if (session) window.navigatorDesktop.send({ type: "stop", session });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "F11" || (event.key === "Escape" && fullscreen)) {
      event.preventDefault();
      if (!event.repeat) window.navigatorDesktop.send({ type: "fullscreen", value: !fullscreen });
    }
  }, { capture: true });
})();
