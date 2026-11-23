(function installWebScrub(document, window, bridge) {
  // Native owns decoding and directional gestures. The existing React seek UI
  // owns the tooltip, layout, fonts and thumbnail presentation.
  const slot = name => `[data-slot="media-player-${name}"]`;
  let active = false, owner = '', seek, root, tooltip, wanted, pointerX = 0;
  let media, legacyFrame, legacyContainer, requestTimer, requestTicket = 0, lastBucket;
  let lastSrc = '';
  const find = () => {
    media = document.querySelector('navigator-mpv');
    seek = document.querySelector(slot('seek'));
    root = seek?.closest('[data-slot="media-player"]');
    return !!(media?.controller && seek && root);
  };
  const box = () => document.querySelector(slot('seek-thumbnail'));
  const markTooltip = () => {
    const time = document.querySelector(slot('seek-time'));
    const next = time?.parentElement?.parentElement;
    if (!next) return;
    if (tooltip && tooltip !== next) tooltip.removeAttribute('data-native-scrub-tooltip');
    tooltip = next;
    if (active) {
      tooltip.setAttribute('data-native-scrub-tooltip', '');
      const half = Math.max(0, tooltip.getBoundingClientRect().width / 2);
      const x = Math.max(half + 8, Math.min(window.innerWidth - half - 8, pointerX));
      tooltip.style.setProperty('--navigator-native-scrub-x', `${x}px`);
    }
  };
  const clearLegacy = () => {
    requestTicket++;
    clearTimeout(requestTimer); requestTimer = undefined;
    legacyFrame?.remove(); legacyContainer?.removeAttribute('data-native-preview-compat');
    legacyFrame = legacyContainer = null; lastBucket = undefined; lastSrc = '';
  };
  const renderLegacy = src => {
    const container = box();
    if (!container || container.dataset.nativePreviewProvider === 'android') return;
    if (container !== legacyContainer) {
      legacyFrame?.remove(); legacyContainer?.removeAttribute('data-native-preview-compat');
      legacyContainer = container;
      legacyFrame = document.createElement('img');
      legacyFrame.alt = ''; legacyFrame.draggable = false;
      legacyFrame.setAttribute('data-native-preview-image', '');
      container.appendChild(legacyFrame);
      // Stop the old HLS/DASH browser fallback from competing for a decoder.
      for (const video of container.querySelectorAll('mux-video,video')) {
        video.pause?.(); video.removeAttribute('src'); video.load?.();
      }
    }
    container.setAttribute('data-native-preview-compat', '');
    if (src) { lastSrc = src; legacyFrame.src = src; }
  };
  const requestLegacy = () => {
    requestTimer = undefined;
    // Deployed clients force manifest streams into a browser decoder. This
    // compatibility path goes away automatically when the updated React ships.
    const container = box();
    const browserFallback = container?.querySelector?.('mux-video,video');
    if (wanted == null || !media?.controller || (!browserFallback && !/\.(m3u8|mpd)(?:[?#]|$)/i.test(media.src || '')) || container?.dataset.nativePreviewProvider === 'android') return;
    const time = document.querySelector(slot('seek-time'));
    if (!time || time.parentElement.parentElement.getAttribute('aria-hidden') === 'true') {
      requestTimer = setTimeout(requestLegacy, 60); return;
    }
    const bucket = Math.max(0, Math.floor(wanted / 2) * 2);
    if (lastBucket === bucket) return;
    lastBucket = bucket;
    renderLegacy(lastSrc);
    const ticket = ++requestTicket;
    media.controller.preview(bucket).then(src => {
      if (ticket === requestTicket && wanted != null && src) renderLegacy(src);
    });
  };
  const scheduleLegacy = () => {
    if (requestTimer == null) requestTimer = setTimeout(requestLegacy, 60);
  };
  const pointer = (type, position, duration) => {
    const rect = seek.getBoundingClientRect();
    // Off-bar previews and the playhead share the precision-adjusted time.
    // Only a direct timeline drag is anchored to the finger.
    seek.dispatchEvent(new window.PointerEvent(type, { bubbles: true, pointerType: 'touch',
      pointerId: 931, isPrimary: true, clientX: rect.left + Math.max(0, Math.min(1, position / duration)) * rect.width,
      clientY: rect.top + rect.height / 2, relatedTarget: null }));
  };
  const reset = () => {
    if (active && seek?.isConnected) pointer('pointerout', 0, 1);
    root?.removeAttribute('data-native-web-scrub');
    tooltip?.removeAttribute('data-native-scrub-tooltip');
    active = false; wanted = null; owner = '';
    clearLegacy();
  };
  const receive = message => {
    if (message.type === 'ready' && owner && message.session !== owner) reset();
    if (message.type === 'thumbnail-frame' && message.session === media?.controller?.previewSession && wanted != null && message.src?.startsWith('data:image/jpeg;base64,')) renderLegacy(message.src);
    if (message.type !== 'scrub') return;
    if (!message.active) { if (message.session === owner) reset(); return; }
    if (!Number.isFinite(message.position) || !Number.isFinite(message.duration) || message.duration <= 0 || !Number.isFinite(message.x) || !find() || message.session !== media.controller.previewSession) return;
    if (owner && owner !== message.session) reset();
    // Updated React consumes the same native event for range, time and preview.
    // Older deployed clients keep the synthetic-pointer compatibility path.
    if (root.hasAttribute?.('data-native-seek-ui')) return;
    owner = message.session;
    const entering = !active;
    active = true; wanted = message.position;
    const rect = seek.getBoundingClientRect();
    pointerX = rect.left + Math.max(0, Math.min(1, wanted / message.duration)) * rect.width;
    root.setAttribute('data-native-web-scrub', '');
    root.style.setProperty('--navigator-native-scrub-right', `${100 - Math.max(0, Math.min(1, wanted / message.duration)) * 100}%`);
    if (entering) pointer('pointerover', wanted, message.duration);
    pointer('pointermove', wanted, message.duration);
    markTooltip(); scheduleLegacy();
  };
  const onHover = event => {
    if (active || !event.isTrusted || !event.target.closest?.(slot('seek')) || !find()) return;
    const rect = seek.getBoundingClientRect();
    if (!(rect.width > 0 && media.duration > 0)) return;
    wanted = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * media.duration;
    scheduleLegacy();
  };
  const onLeave = event => {
    if (!active && event.target.closest?.(slot('seek')) && !seek?.contains(event.relatedTarget)) {
      wanted = null; clearLegacy();
      const controller = media?.controller;
      if (controller?.cancelScrubPreview) controller.cancelScrubPreview();
      else controller?.cancelPreview();
    }
  };
  const onVisibility = () => { if (document.hidden) reset(); };
  const observer = new MutationObserver(() => {
    if (active) { if (!seek?.isConnected) reset(); else markTooltip(); }
  });
  observer.observe(document, { subtree: true, childList: true });
  document.addEventListener('pointerover', onHover, true);
  document.addEventListener('pointermove', onHover, true);
  document.addEventListener('pointerout', onLeave, true);
  document.addEventListener('visibilitychange', onVisibility);
  const unsubscribe = bridge.subscribe(receive);
  return { reset, dispose() {
    reset(); observer.disconnect(); unsubscribe();
    document.removeEventListener('pointerover', onHover, true);
    document.removeEventListener('pointermove', onHover, true);
    document.removeEventListener('pointerout', onLeave, true);
    document.removeEventListener('visibilitychange', onVisibility);
  } };
})
