"use client";

import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuGroup, DropdownMenuLabel, DropdownMenuOptions,
} from "@/components/arc/dropdown-menu/dropdown-menu";
import { PlayerSettingsMenu } from "@/components/player-settings-menu";
import playerSettingsStyles from "@/components/player-settings-menu.module.css";
import { trackOptions } from "@/lib/media/track-label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useComposedRefs } from "@/lib/compose-refs";
import { cn } from "@/lib/utils";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Slot } from "@radix-ui/react-slot";
import {
  AlertTriangleIcon,
  CaptionsOffIcon,
  DownloadIcon,
  FastForwardIcon,
  Loader2Icon,
  Maximize2Icon,
  Minimize2Icon,
  PauseIcon,
  PictureInPicture2Icon,
  PictureInPictureIcon,
  PlayIcon,
  RefreshCcwIcon,
  RepeatIcon,
  RewindIcon,
  RotateCcwIcon,
  SettingsIcon,
  SubtitlesIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import {
  MediaActionTypes,
  MediaProvider,
  timeUtils,
  useMediaDispatch,
  useMediaFullscreenRef,
  useMediaRef,
  useMediaSelector,
} from "media-chrome/react/media-store";
import * as React from "react";
import * as ReactDOM from "react-dom";

import { desktopBridge, setMacOSWindowControlsVisible } from "@/lib/desktop/bridge";
import { createDesktopMediaStore } from "@/lib/desktop/media-store";
import { boundSkipChapterLabels, chapterTrackMask } from "@/lib/media/chapter-timeline";
import { PlayerSkipTimeline } from "@/components/player-skip-timeline";
import type { SkipSegment } from "@/lib/media/skip-segments";
import { SeekPreview } from "@/components/seek-preview";
import { PreviewImage } from "@/components/preview-image";
import { attachTouchScrubbing } from "@/lib/media/touch-scrubbing";
import { createKeyboardScrubber, KEYBOARD_SEEK_STEP } from "@/lib/media/keyboard-scrubbing";
import { playerControlSelector, playerControlsActive } from "@/lib/media/control-activity";

const ROOT_NAME = "MediaPlayer";
const SEEK_NAME = "MediaPlayerSeek";
const SETTINGS_NAME = "MediaPlayerSettings";
const VOLUME_NAME = "MediaPlayerVolume";
const PLAYBACK_SPEED_NAME = "MediaPlayerPlaybackSpeed";

const FLOATING_MENU_SIDE_OFFSET = 10;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const SEEK_STEP_LONG = 10;
const SEEK_COLLISION_PADDING = 10;
const SEEK_TOOLTIP_WIDTH_FALLBACK = 240;

const SEEK_HOVER_PERCENT = "--seek-hover-percent";
const SEEK_TOOLTIP_X = "--seek-tooltip-x";
const SEEK_TOOLTIP_Y = "--seek-tooltip-y";

const SPRITE_CONTAINER_WIDTH = 224;

type Direction = "ltr" | "rtl";

const DirectionContext = React.createContext<Direction | undefined>(undefined);

function useDirection(dirProp?: Direction): Direction {
  const contextDir = React.useContext(DirectionContext);
  return dirProp ?? contextDir ?? "ltr";
}

function useLazyRef<T>(fn: () => T) {
  const ref = React.useRef<T | null>(null);

  if (ref.current === null) {
    ref.current = fn();
  }

  return ref as React.RefObject<T>;
}

interface StoreState {
  controlsVisible: boolean;
  dragging: boolean;
  seekPreviewTime: number | null;
  seekMode: "bar" | "surface" | "keyboard" | null;
  menuOpen: boolean;
  volumeIndicatorVisible: boolean;
}

interface Store {
  subscribe: (cb: () => void) => () => void;
  getState: () => StoreState;
  setState: <K extends keyof StoreState>(key: K, value: StoreState[K]) => void;
  notify: () => void;
}

function createStore(
  listenersRef: React.RefObject<Set<() => void>>,
  stateRef: React.RefObject<StoreState>,
  onValueChange?: Partial<{
    [K in keyof StoreState]: (value: StoreState[K], store: Store) => void;
  }>
): Store {
  const store: Store = {
    subscribe: (cb) => {
      listenersRef.current.add(cb);
      return () => listenersRef.current.delete(cb);
    },
    getState: () => stateRef.current,
    setState: (key, value) => {
      if (Object.is(stateRef.current[key], value)) return;
      stateRef.current[key] = value;
      onValueChange?.[key]?.(value, store);
      store.notify();
    },
    notify: () => {
      for (const cb of listenersRef.current) {
        cb();
      }
    },
  };

  return store;
}

const StoreContext = React.createContext<Store | null>(null);

function useStoreContext(consumerName: string) {
  const context = React.useContext(StoreContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``);
  }
  return context;
}

function useStoreSelector<U>(selector: (state: StoreState) => U): U {
  const storeContext = useStoreContext("useStoreSelector");

  const getSnapshot = React.useCallback(
    () => selector(storeContext.getState()),
    [storeContext, selector]
  );

  return React.useSyncExternalStore(
    storeContext.subscribe,
    getSnapshot,
    getSnapshot
  );
}

interface MediaPlayerContextValue {
  keyboardScrubber: ReturnType<typeof createKeyboardScrubber>;
  subtitleTiming?: import("@/components/player-settings-menu").SubtitleTimingAction;
  mediaId: string;
  labelId: string;
  descriptionId: string;
  dir: Direction;
  rootRef: React.RefObject<HTMLDivElement | null>;
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  portalContainer: Element | DocumentFragment | null;
  tooltipDelayDuration: number;
  tooltipSideOffset: number;
  disabled: boolean;
  isVideo: boolean;
  withoutTooltip: boolean;
  customSubtitleTracks?: CustomSubtitleTrack[];
  customSubtitlesEnabled: boolean;
  onCustomSubtitleChange?: (track: CustomSubtitleTrack | null) => void;
  chapters?: ChapterCue[];
}

const MediaPlayerContext = React.createContext<MediaPlayerContextValue | null>(
  null
);

function useMediaPlayerContext(consumerName: string) {
  const context = React.useContext(MediaPlayerContext);
  if (!context) {
    throw new Error(`\`${consumerName}\` must be used within \`${ROOT_NAME}\``);
  }
  return context;
}

interface CustomSubtitleTrack {
  id?: string;
  filename?: string;
  provider?: string;
  src: string;
  label: string;
  language: string;
  kind: string;
  active: boolean;
}

interface ChapterCue {
  startTime: number;
  endTime: number;
  text: string;
}

interface MediaPlayerRootProps
  extends Omit<React.ComponentProps<"div">, "onTimeUpdate" | "onVolumeChange"> {
  onPlay?: () => void;
  subtitleTiming?: import("@/components/player-settings-menu").SubtitleTimingAction;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (time: number) => void;
  onVolumeChange?: (volume: number) => void;
  onMuted?: (muted: boolean) => void;
  onMediaError?: (error: MediaError | null) => void;
  onPipError?: (error: unknown, state: "enter" | "exit") => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
  dir?: Direction;
  label?: string;
  tooltipDelayDuration?: number;
  tooltipSideOffset?: number;
  asChild?: boolean;
  autoHide?: boolean;
  disabled?: boolean;
  withoutTooltip?: boolean;
  customSubtitleTracks?: CustomSubtitleTrack[];
  customSubtitlesEnabled?: boolean;
  onCustomSubtitleChange?: (track: CustomSubtitleTrack | null) => void;
  chapters?: ChapterCue[];
}

function MediaPlayerRoot(props: MediaPlayerRootProps) {
  const listenersRef = useLazyRef(() => new Set<() => void>());
  const stateRef = useLazyRef<StoreState>(() => ({
    controlsVisible: true,
    dragging: false,
    seekPreviewTime: null,
    seekMode: null,
    menuOpen: false,
    volumeIndicatorVisible: false,
  }));

  const store = React.useMemo(
    () => createStore(listenersRef, stateRef),
    [listenersRef, stateRef]
  );

  const [nativeStore] = React.useState(() => desktopBridge() ? createDesktopMediaStore() : undefined);
  return (
    <MediaProvider mediaStore={nativeStore}>
      <StoreContext.Provider value={store}>
        <MediaPlayerRootImpl {...props} />
      </StoreContext.Provider>
    </MediaProvider>
  );
}

function MediaPlayerRootImpl(props: MediaPlayerRootProps) {
  const {
    onPlay,
    onPause,
    onEnded,
    onTimeUpdate,
    onFullscreenChange,
    onVolumeChange,
    onMuted,
    onMediaError,
    onPipError,
    dir: dirProp,
    label,
    tooltipDelayDuration = 600,
    tooltipSideOffset = FLOATING_MENU_SIDE_OFFSET,
    asChild,
    autoFocus = false,
    autoHide = false,
    disabled = false,
    withoutTooltip = false,
    customSubtitleTracks,
    customSubtitlesEnabled = false,
    subtitleTiming,
    onCustomSubtitleChange,
    chapters,
    children,
    className,
    ref,
    ...rootImplProps
  } = props;

  const mediaId = React.useId();
  const labelId = React.useId();
  const descriptionId = React.useId();

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const fullscreenRef = useMediaFullscreenRef();
  const composedRef = useComposedRefs(ref, rootRef, fullscreenRef);

  // Focus the playback surface once on opening, before its media loads.
  // Later playback updates must leave menus and text fields in control.
  React.useEffect(() => {
    if (autoFocus && !disabled) rootRef.current?.focus({ preventScroll: true });
  }, [autoFocus, disabled]);

  const dir = useDirection(dirProp);
  const dispatch = useMediaDispatch();
  const mediaRef = React.useRef<HTMLVideoElement | HTMLAudioElement | null>(
    null
  );

  const store = useStoreContext(ROOT_NAME);
  const [keyboardMotion] = React.useState(() => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)"));
  const keyboardDispatchRef = React.useRef(dispatch);
  React.useLayoutEffect(() => { keyboardDispatchRef.current = dispatch; }, [dispatch]);
  const [keyboardScrubber] = React.useState(() => createKeyboardScrubber({
    media: () => mediaRef.current,
    seek: time => {
      store.setState("seekPreviewTime", null);
      keyboardDispatchRef.current({ type: MediaActionTypes.MEDIA_SEEK_REQUEST, detail: time });
    },
    pause: () => keyboardDispatchRef.current({ type: MediaActionTypes.MEDIA_PAUSE_REQUEST }),
    play: () => keyboardDispatchRef.current({ type: MediaActionTypes.MEDIA_PLAY_REQUEST }),
    preview: time => {
      store.setState("seekMode", time === null ? null : "keyboard");
      store.setState("seekPreviewTime", time);
      store.setState("dragging", time !== null);
    },
    reducedMotion: () => keyboardMotion?.matches ?? false,
  }));

  React.useEffect(() => {
    const release = (event: KeyboardEvent) => keyboardScrubber.release(event.key.toLowerCase());
    const cancel = () => keyboardScrubber.cancel();
    const visibility = () => { if (document.hidden) cancel(); };
    const interrupt = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Shift"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) cancel();
    };
    document.addEventListener("keyup", release);
    document.addEventListener("keydown", interrupt, true);
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("focusin", cancel);
    document.addEventListener("visibilitychange", visibility);
    globalThis.addEventListener?.("blur", cancel);
    return () => {
      document.removeEventListener("keyup", release);
      document.removeEventListener("keydown", interrupt, true);
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("focusin", cancel);
      document.removeEventListener("visibilitychange", visibility);
      globalThis.removeEventListener?.("blur", cancel);
      keyboardScrubber.dispose();
    };
  }, [keyboardScrubber]);

  const controlsVisible = useStoreSelector((state) => state.controlsVisible);

  React.useEffect(() => {
    setMacOSWindowControlsVisible(controlsVisible);
  }, [controlsVisible]);
  React.useEffect(() => () => {
    // Returning to browsing must always restore the native window buttons.
    setMacOSWindowControlsVisible(true);
  }, []);

  const dragging = useStoreSelector((state) => state.dragging);
  const seekMode = useStoreSelector((state) => state.seekMode);
  const menuOpen = useStoreSelector((state) => state.menuOpen);

  const hideControlsTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const pointerTypeRef = React.useRef("mouse");
  const controlPointerHeldRef = React.useRef(false);
  const volumeIndicatorTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const keyboardActionThrottleRef = React.useRef<NodeJS.Timeout | null>(null);
  const lastKeyPressTimeRef = React.useRef<number>(0);

  const mediaPaused = useMediaSelector((state) => state.mediaPaused ?? true);
  const isFullscreen = useMediaSelector(
    (state) => state.mediaIsFullscreen ?? false
  );

  const [mounted, setMounted] = React.useState(false);
  React.useLayoutEffect(() => setMounted(true), []);

  const portalContainer = mounted
    ? isFullscreen
      ? rootRef.current
      : globalThis.document.body
    : null;

  const isVideo =
    (typeof HTMLVideoElement !== "undefined" &&
      mediaRef.current instanceof HTMLVideoElement) ||
    mediaRef.current?.tagName?.toLowerCase() === "mux-player" ||
    !!desktopBridge();

  const onControlsShow = React.useCallback(() => {
    store.setState("controlsVisible", true);

    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }

    if (autoHide && !mediaPaused && !menuOpen && !dragging) {
      const hideWhenIdle = () => {
        const root = rootRef.current;
        const busy = store.getState().seekPreviewTime !== null || controlPointerHeldRef.current || playerControlsActive(root);
        if (busy) {
          hideControlsTimeoutRef.current = setTimeout(hideWhenIdle, 1000);
          return;
        }
        store.setState("controlsVisible", false);
      };
      hideControlsTimeoutRef.current = setTimeout(hideWhenIdle, 3000);
    }
  }, [store.setState, autoHide, mediaPaused, menuOpen, dragging]);

  const onVolumeIndicatorTrigger = React.useCallback(() => {
    if (menuOpen) return;

    store.setState("volumeIndicatorVisible", true);

    if (volumeIndicatorTimeoutRef.current) {
      clearTimeout(volumeIndicatorTimeoutRef.current);
    }

    volumeIndicatorTimeoutRef.current = setTimeout(() => {
      store.setState("volumeIndicatorVisible", false);
    }, 2000);

    // Keyboard volume feedback is independent of the transport controls.
  }, [store.setState, menuOpen]);

  const onMouseLeave = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      rootImplProps.onMouseLeave?.(event);

      if (event.defaultPrevented || pointerTypeRef.current !== "mouse" || controlPointerHeldRef.current) return;

      if (autoHide && !mediaPaused && !menuOpen && !dragging && !playerControlsActive(rootRef.current)) {
        store.setState("controlsVisible", false);
      }
    },
    [
      store.setState,
      rootImplProps.onMouseLeave,
      autoHide,
      mediaPaused,
      menuOpen,
      dragging,
    ]
  );

  const onMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      rootImplProps.onMouseMove?.(event);

      if (event.defaultPrevented || pointerTypeRef.current !== "mouse") return;

      if (autoHide) {
        onControlsShow();
      }
    },
    [autoHide, rootImplProps.onMouseMove, onControlsShow]
  );

  const onPointerDownCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    rootImplProps.onPointerDownCapture?.(event);
    pointerTypeRef.current = event.pointerType;
    if (event.defaultPrevented || !autoHide) return;
    if ((event.target as Element).closest(playerControlSelector)) {
      controlPointerHeldRef.current = true;
      onControlsShow();
    }
  };

  const onMouseDownCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    rootImplProps.onMouseDownCapture?.(event);
    if (event.defaultPrevented || disabled || event.button !== 0 || pointerTypeRef.current !== "mouse") return;
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.hasAttribute("disabled")) return;
    const slot = button.getAttribute("data-slot");
    if (![
      "media-player-fullscreen", "media-player-play-button",
      "media-player-seek-backward", "media-player-seek-forward",
      "media-player-volume-trigger", "media-player-loop", "media-player-pip",
      "media-player-captions", "media-player-download",
    ].includes(slot ?? "")) return;
    // Cancel only mouse focus, not the click action. Space then controls
    // playback instead of activating the last clicked transport button.
    // Tab focus and keyboard activation, menus and sliders stay unchanged.
    event.preventDefault();
    rootRef.current?.focus({ preventScroll: true });
  };

  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    rootImplProps.onClickCapture?.(event);
    if (event.defaultPrevented || !autoHide || disabled) return;
    // Keyboard/assistive activation and mouse clicks retain play/pause.
    if (event.detail === 0 || pointerTypeRef.current === "mouse") return;
    if ((event.target as Element).closest(
      '[data-slot="media-player-controls"], button, a, input, select, textarea, [role="button"], [contenteditable="true"], [role="slider"], [role="menu"], [role="dialog"], [role="combobox"], [role="listbox"], [role="option"]'
    )) return;
    event.preventDefault();
    event.stopPropagation();
    if (controlsVisible) {
      if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
      store.setState("controlsVisible", false);
    } else {
      onControlsShow();
    }
  };

  React.useEffect(() => {
    const release = () => {
      if (!controlPointerHeldRef.current) return;
      controlPointerHeldRef.current = false;
      onControlsShow();
    };
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    return () => {
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
    };
  }, [onControlsShow]);

  React.useEffect(() => {
    if (!autoHide || mediaPaused || menuOpen || dragging) {
      store.setState("controlsVisible", true);
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
      return;
    }

    if (autoHide) {
      onControlsShow();
    }
  }, [
    store.setState,
    onControlsShow,
    autoHide,
    menuOpen,
    mediaPaused,
    dragging,
  ]);

  const throttledDispatch = React.useCallback(
    (action: { type: string; detail?: any }) => {
      const now = Date.now();
      const timeSinceLastKeyPress = now - lastKeyPressTimeRef.current;

      // Clear any existing throttle timeout
      if (keyboardActionThrottleRef.current) {
        clearTimeout(keyboardActionThrottleRef.current);
      }

      // If it's been less than 100ms since last key press, throttle the action
      if (timeSinceLastKeyPress < 100) {
        keyboardActionThrottleRef.current = setTimeout(() => {
          dispatch(action);
          keyboardActionThrottleRef.current = null;
        }, 50);
      } else {
        // Execute immediately if enough time has passed
        dispatch(action);
      }

      lastKeyPressTimeRef.current = now;
    },
    [dispatch]
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;

      rootImplProps.onKeyDown?.(event);

      if (event.defaultPrevented) return;
      // Application shortcuts (including Ctrl/Meta+K) belong to the global
      // handler, never to the player's bare-letter playback controls.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="listbox"], [role="option"], [role="dialog"], [role="menu"], [role="slider"], button, a[href]')) return;

      const mediaElement = mediaRef.current;
      if (!mediaElement) return;

      const isMediaFocused = document.activeElement === mediaElement;
      const isPlayerFocused =
        !!document.activeElement?.closest('[data-slot="media-player"]');

      if (!isMediaFocused && !isPlayerFocused && !(autoFocus && desktopBridge())) return;

      const key = event.key.toLowerCase();
      const volumeKey = ["arrowup", "arrowdown", "m", "audiovolumeup", "audiovolumedown", "audiovolumemute"].includes(key);
      const playbackKey = [" ", "k", "f", "arrowright", "arrowleft", "<", ">", "c", "d", "p", "r", "j", "l", "home", "end"].includes(key) || /^[0-9]$/.test(key);
      if (autoHide && playbackKey && !volumeKey) onControlsShow();

      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          event.preventDefault();
          dispatch({
            type: mediaElement.paused
              ? MediaActionTypes.MEDIA_PLAY_REQUEST
              : MediaActionTypes.MEDIA_PAUSE_REQUEST,
          });
          break;

        case "f":
          event.preventDefault();
          dispatch({
            type: (desktopBridge()?.fullscreen ?? !!document.fullscreenElement)
              ? MediaActionTypes.MEDIA_EXIT_FULLSCREEN_REQUEST
              : MediaActionTypes.MEDIA_ENTER_FULLSCREEN_REQUEST,
          });
          break;

        case "m": {
          event.preventDefault();
          onVolumeIndicatorTrigger();
          dispatch({
            type: mediaElement.muted
              ? MediaActionTypes.MEDIA_UNMUTE_REQUEST
              : MediaActionTypes.MEDIA_MUTE_REQUEST,
          });
          break;
        }

        case "arrowright":
          event.preventDefault();
          if (
            isVideo ||
            (mediaElement instanceof HTMLAudioElement && event.shiftKey)
          ) {
            keyboardScrubber.press("arrowright", event.repeat);
          }
          break;

        case "arrowleft":
          event.preventDefault();
          if (
            isVideo ||
            (mediaElement instanceof HTMLAudioElement && event.shiftKey)
          ) {
            keyboardScrubber.press("arrowleft", event.repeat);
          }
          break;

        case "arrowup":
          event.preventDefault();
          if (isVideo) {
            onVolumeIndicatorTrigger();
            throttledDispatch({
              type: MediaActionTypes.MEDIA_VOLUME_REQUEST,
              detail: Math.min(1, mediaElement.volume + 0.1),
            });
          }
          break;

        case "arrowdown":
          event.preventDefault();
          if (isVideo) {
            onVolumeIndicatorTrigger();
            throttledDispatch({
              type: MediaActionTypes.MEDIA_VOLUME_REQUEST,
              detail: Math.max(0, mediaElement.volume - 0.1),
            });
          }
          break;

        case "<": {
          event.preventDefault();
          const currentRate = mediaElement.playbackRate;
          const currentIndex = SPEEDS.indexOf(currentRate);
          const newIndex = Math.max(0, currentIndex - 1);
          const newRate = SPEEDS[newIndex] ?? 1;
          dispatch({
            type: MediaActionTypes.MEDIA_PLAYBACK_RATE_REQUEST,
            detail: newRate,
          });
          break;
        }

        case ">": {
          event.preventDefault();
          const currentRate = mediaElement.playbackRate;
          const currentIndex = SPEEDS.indexOf(currentRate);
          const newIndex = Math.min(SPEEDS.length - 1, currentIndex + 1);
          const newRate = SPEEDS[newIndex] ?? 1;
          dispatch({
            type: MediaActionTypes.MEDIA_PLAYBACK_RATE_REQUEST,
            detail: newRate,
          });
          break;
        }

        case "c":
          event.preventDefault();
          if (isVideo && mediaElement.textTracks.length > 0) {
            dispatch({
              type: MediaActionTypes.MEDIA_TOGGLE_SUBTITLES_REQUEST,
            });
          }
          break;

        case "d": {
          const hasDownload = mediaElement.querySelector(
            '[data-slot="media-player-download"]'
          );

          if (!hasDownload) break;

          event.preventDefault();
          if (mediaElement.currentSrc) {
            const link = document.createElement("a");
            link.href = mediaElement.currentSrc;
            link.download = "";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }
          break;
        }

        case "p": {
          if (desktopBridge()?.capabilities?.pip === false) break;
          event.preventDefault();
          if (isVideo && "requestPictureInPicture" in mediaElement) {
            const isPip = document.pictureInPictureElement === mediaElement;
            dispatch({
              type: isPip
                ? MediaActionTypes.MEDIA_EXIT_PIP_REQUEST
                : MediaActionTypes.MEDIA_ENTER_PIP_REQUEST,
            });
            if (isPip) {
              document.exitPictureInPicture().catch((error) => {
                onPipError?.(error, "exit");
              });
            } else {
              mediaElement.requestPictureInPicture().catch((error) => {
                onPipError?.(error, "enter");
              });
            }
          }
          break;
        }

        case "r": {
          event.preventDefault();
          mediaElement.loop = !mediaElement.loop;
          break;
        }

        case "j": {
          event.preventDefault();
          dispatch({
            type: MediaActionTypes.MEDIA_SEEK_REQUEST,
            detail: Math.max(0, mediaElement.currentTime - SEEK_STEP_LONG),
          });
          break;
        }

        case "l": {
          event.preventDefault();
          dispatch({
            type: MediaActionTypes.MEDIA_SEEK_REQUEST,
            detail: Math.min(
              mediaElement.duration,
              mediaElement.currentTime + SEEK_STEP_LONG
            ),
          });
          break;
        }

        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9": {
          event.preventDefault();
          const percent = Number.parseInt(event.key) / 10;
          const seekTime = mediaElement.duration * percent;
          dispatch({
            type: MediaActionTypes.MEDIA_SEEK_REQUEST,
            detail: seekTime,
          });
          break;
        }

        case "home": {
          event.preventDefault();
          dispatch({
            type: MediaActionTypes.MEDIA_SEEK_REQUEST,
            detail: 0,
          });
          break;
        }

        case "end": {
          event.preventDefault();
          dispatch({
            type: MediaActionTypes.MEDIA_SEEK_REQUEST,
            detail: mediaElement.duration,
          });
          break;
        }
      }
    },
    [
      throttledDispatch,
      dispatch,
      keyboardScrubber,
      rootImplProps.onKeyDown,
      onVolumeIndicatorTrigger,
      onPipError,
      disabled,
      isVideo,
      onControlsShow,
      autoHide,
      autoFocus,
    ]
  );

  // The desktop playback overlay owns shortcuts while the app is focused,
  // even after focus leaves the video (e.g. closing Ask Navigator). Embedded
  // players retain element-scoped shortcuts. Bubble after UI handlers so
  // text fields, dialogs and controls keep their own keyboard behavior.
  React.useEffect(() => {
    if (!autoFocus || !desktopBridge() || disabled) return;
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || document.hasFocus?.() === false) return;
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"], section[aria-label="Ask Navigator"]')) return;
      onKeyDown(event as unknown as React.KeyboardEvent<HTMLDivElement>);
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [autoFocus, disabled, onKeyDown]);

  // Timer lifetime follows the player, not changing media event callbacks.
  React.useEffect(() => {
    return () => {
      if (keyboardActionThrottleRef.current) clearTimeout(keyboardActionThrottleRef.current);
      if (volumeIndicatorTimeoutRef.current) clearTimeout(volumeIndicatorTimeoutRef.current);
      if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    };
  }, []);

  const onKeyUp = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      rootImplProps.onKeyUp?.(event);

      const key = event.key.toLowerCase();
      if (key === "arrowup" || key === "arrowdown") {
        onVolumeIndicatorTrigger();
      }
    },
    [rootImplProps.onKeyUp, onVolumeIndicatorTrigger]
  );

  React.useEffect(() => {
    const mediaElement = mediaRef.current;
    if (!mediaElement) return;

    const timeUpdate = () => onTimeUpdate?.(mediaElement.currentTime);
    const volumeChange = () => {
      onVolumeChange?.(mediaElement.volume);
      onMuted?.(mediaElement.muted);
    };
    const mediaError = () => onMediaError?.(mediaElement.error);
    const fullscreenChange = () => onFullscreenChange?.(!!document.fullscreenElement);

    if (onPlay) mediaElement.addEventListener("play", onPlay);
    if (onPause) mediaElement.addEventListener("pause", onPause);
    if (onEnded) mediaElement.addEventListener("ended", onEnded);
    if (onTimeUpdate) mediaElement.addEventListener("timeupdate", timeUpdate);
    if (onVolumeChange || onMuted) mediaElement.addEventListener("volumechange", volumeChange);
    if (onMediaError) mediaElement.addEventListener("error", mediaError);
    if (onFullscreenChange) document.addEventListener("fullscreenchange", fullscreenChange);

    return () => {
      if (onPlay) mediaElement.removeEventListener("play", onPlay);
      if (onPause) mediaElement.removeEventListener("pause", onPause);
      if (onEnded) mediaElement.removeEventListener("ended", onEnded);
      mediaElement.removeEventListener("timeupdate", timeUpdate);
      mediaElement.removeEventListener("volumechange", volumeChange);
      mediaElement.removeEventListener("error", mediaError);
      document.removeEventListener("fullscreenchange", fullscreenChange);
    };
  }, [
    onPlay,
    onPause,
    onEnded,
    onTimeUpdate,
    onVolumeChange,
    onMuted,
    onMediaError,
    onFullscreenChange,
  ]);

  const contextValue = React.useMemo<MediaPlayerContextValue>(
    () => ({
      keyboardScrubber,
      mediaId,
      labelId,
      descriptionId,
      dir,
      rootRef,
      mediaRef,
      portalContainer,
      tooltipDelayDuration,
      tooltipSideOffset,
      disabled,
      isVideo,
      withoutTooltip,
      customSubtitleTracks,
      customSubtitlesEnabled,
      onCustomSubtitleChange,
      chapters,
      subtitleTiming,
    }),
    [
      keyboardScrubber,
      mediaId,
      labelId,
      descriptionId,
      dir,
      portalContainer,
      tooltipDelayDuration,
      tooltipSideOffset,
      disabled,
      isVideo,
      withoutTooltip,
      customSubtitleTracks,
      customSubtitlesEnabled,
      onCustomSubtitleChange,
      chapters,
      subtitleTiming,
    ]
  );

  const RootPrimitive = asChild ? Slot : "div";

  return (
    <MediaPlayerContext.Provider value={contextValue}>
      <RootPrimitive
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        aria-disabled={disabled}
        data-disabled={disabled ? "" : undefined}
        data-controls-visible={controlsVisible ? "" : undefined}
        data-scrub-mode={seekMode ?? undefined}
        data-slot="media-player"
        data-touch-controls=""
        data-state={isFullscreen ? "fullscreen" : "windowed"}
        dir={dir}
        tabIndex={disabled ? undefined : 0}
        {...rootImplProps}
        ref={composedRef}
        onPointerDownCapture={onPointerDownCapture}
        onMouseDownCapture={onMouseDownCapture}
        onPointerMoveCapture={(event) => {
          rootImplProps.onPointerMoveCapture?.(event);
          pointerTypeRef.current = event.pointerType;
        }}
        onClickCapture={onClickCapture}
        onMouseLeave={onMouseLeave}
        onMouseMove={onMouseMove}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        className={cn(
          "dark relative isolate flex touch-none select-none flex-col overflow-hidden bg-background outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/22 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_video]:relative [&_video]:object-contain",
          "data-[state=fullscreen]:[&_video]:size-full [:fullscreen_&]:flex [:fullscreen_&]:h-full [:fullscreen_&]:max-h-screen [:fullscreen_&]:flex-col [:fullscreen_&]:justify-between",
          "[&_[data-slider]::before]:-top-4 [&_[data-slider]::before]:-bottom-2 [&_[data-slider]::before]:absolute [&_[data-slider]::before]:inset-x-0 [&_[data-slider]::before]:z-10 [&_[data-slider]::before]:h-8 [&_[data-slider]::before]:cursor-pointer [&_[data-slider]::before]:content-[''] [&_[data-slider]]:relative [&_[data-slot='media-player-seek']:not([data-hovering])::before]:cursor-default",
          "[&_video::-webkit-media-text-track-display]:top-auto! [&_video::-webkit-media-text-track-display]:bottom-[4%]! [&_video::-webkit-media-text-track-display]:mb-0! data-[state=fullscreen]:data-[controls-visible]:[&_video::-webkit-media-text-track-display]:bottom-[9%]! data-[controls-visible]:[&_video::-webkit-media-text-track-display]:bottom-[13%]! data-[state=fullscreen]:[&_video::-webkit-media-text-track-display]:bottom-[7%]!",
          className
        )}
      >
        <span id={labelId} className="sr-only">
          {label ?? "Media player"}
        </span>
        <span id={descriptionId} className="sr-only">
          {isVideo
            ? "Video player with custom controls for playback, volume, seeking, and more. Use space bar to play/pause, arrow keys (←/→) to seek, and arrow keys (↑/↓) to adjust volume."
            : "Audio player with custom controls for playback, volume, seeking, and more. Use space bar to play/pause, Shift + arrow keys (←/→) to seek, and arrow keys (↑/↓) to adjust volume."}
        </span>
        {children}
        <MediaPlayerVolumeIndicator />
      </RootPrimitive>
    </MediaPlayerContext.Provider>
  );
}

interface MediaPlayerVideoProps extends React.ComponentProps<"video"> {
  asChild?: boolean;
}

function MediaPlayerVideo(props: MediaPlayerVideoProps) {
  const { asChild, ref, ...videoProps } = props;

  const context = useMediaPlayerContext("MediaPlayerVideo");
  const dispatch = useMediaDispatch();
  const mediaRefCallback = useMediaRef();
  const registerMedia = React.useCallback((element: HTMLVideoElement | null) => {
    context.mediaRef.current = element;
    mediaRefCallback(element);
  }, [context.mediaRef, mediaRefCallback]);
  const composedRef = useComposedRefs(ref, registerMedia);

  const onPlayToggle = React.useCallback(
    (event: React.MouseEvent<HTMLVideoElement>) => {
      props.onClick?.(event);

      if (event.defaultPrevented) return;

      const mediaElement = event.currentTarget;
      if (!mediaElement) return;

      dispatch({
        type: mediaElement.paused
          ? MediaActionTypes.MEDIA_PLAY_REQUEST
          : MediaActionTypes.MEDIA_PAUSE_REQUEST,
      });
    },
    [dispatch, props.onClick]
  );

  const VideoPrimitive = asChild ? Slot : "video";

  return (
    <VideoPrimitive
      aria-describedby={context.descriptionId}
      aria-labelledby={context.labelId}
      data-slot="media-player-video"
      {...videoProps}
      id={context.mediaId}
      ref={composedRef}
      onClick={onPlayToggle}
    />
  );
}

interface MediaPlayerAudioProps extends React.ComponentProps<"audio"> {
  asChild?: boolean;
}

function MediaPlayerAudio(props: MediaPlayerAudioProps) {
  const { asChild, ref, ...audioProps } = props;

  const context = useMediaPlayerContext("MediaPlayerAudio");
  const mediaRefCallback = useMediaRef();
  const registerMedia = React.useCallback((element: HTMLAudioElement | null) => {
    context.mediaRef.current = element;
    // Mux augments audio elements with a partial video-quality API. Media
    // Chrome only needs the shared media interface for an audio element.
    const media: Omit<HTMLMediaElement, "getVideoPlaybackQuality"> | null = element;
    mediaRefCallback(media);
  }, [context.mediaRef, mediaRefCallback]);
  const composedRef = useComposedRefs(ref, registerMedia);

  const AudioPrimitive = asChild ? Slot : "audio";

  return (
    <AudioPrimitive
      aria-describedby={context.descriptionId}
      aria-labelledby={context.labelId}
      data-slot="media-player-audio"
      {...audioProps}
      id={context.mediaId}
      ref={composedRef}
    />
  );
}

interface MediaPlayerControlsProps extends React.ComponentProps<"div"> {
  asChild?: boolean;
}

function MediaPlayerControls(props: MediaPlayerControlsProps) {
  const { asChild, className, ...controlsProps } = props;

  const context = useMediaPlayerContext("MediaPlayerControls");
  const isFullscreen = useMediaSelector(
    (state) => state.mediaIsFullscreen ?? false
  );
  const controlsVisible = useStoreSelector((state) => state.controlsVisible);

  const ControlsPrimitive = asChild ? Slot : "div";

  return (
    <ControlsPrimitive
      data-disabled={context.disabled ? "" : undefined}
      data-slot="media-player-controls"
      inert={!controlsVisible}
      aria-hidden={!controlsVisible}
      data-state={isFullscreen ? "fullscreen" : "windowed"}
      data-visible={controlsVisible ? "" : undefined}
      dir={context.dir}
      className={cn(
        "dark pointer-events-none absolute right-0 bottom-0 left-0 z-50 flex items-center gap-2 px-4 py-3 opacity-0 transition-opacity duration-200 ease-[var(--ease-out)] motion-reduce:duration-100 data-[visible]:pointer-events-auto data-[visible]:opacity-100 [:fullscreen_&]:px-6 [:fullscreen_&]:py-4",
        className
      )}
      {...controlsProps}
    />
  );
}

interface MediaPlayerLoadingProps extends React.ComponentProps<"div"> {
  delayMs?: number;
  asChild?: boolean;
}

function MediaPlayerLoading(props: MediaPlayerLoadingProps) {
  const {
    delayMs = 500,
    asChild,
    className,
    children,
    ...loadingProps
  } = props;

  const isLoading = useMediaSelector((state) => state.mediaLoading ?? false);
  const isPaused = useMediaSelector((state) => state.mediaPaused ?? true);
  const hasPlayed = useMediaSelector((state) => state.mediaHasPlayed ?? false);

  const shouldShowLoading = isLoading && !isPaused;
  const shouldUseDelay = hasPlayed && shouldShowLoading;
  const loadingDelayMs = shouldUseDelay ? delayMs : 0;

  const [shouldRender, setShouldRender] = React.useState(false);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (shouldShowLoading) {
      if (loadingDelayMs > 0) {
        timeoutRef.current = setTimeout(() => {
          setShouldRender(true);
          timeoutRef.current = null;
        }, loadingDelayMs);
      } else {
        setShouldRender(true);
      }
    } else {
      setShouldRender(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [shouldShowLoading, loadingDelayMs]);

  if (!shouldRender) return null;

  const LoadingPrimitive = asChild ? Slot : "div";

  return (
    <LoadingPrimitive
      role="status"
      aria-live="polite"
      data-slot="media-player-loading"
      {...loadingProps}
      className={cn(
        "fade-in-0 zoom-in-95 pointer-events-none absolute inset-0 z-50 flex animate-in items-center justify-center duration-200",
        className
      )}
    >
      <Loader2Icon className="size-20 animate-spin stroke-[.0938rem] text-primary" />
    </LoadingPrimitive>
  );
}

interface MediaPlayerErrorProps extends React.ComponentProps<"div"> {
  error?: MediaError | null;
  label?: string;
  description?: string;
  onRetry?: () => void;
  onReload?: () => void;
  asChild?: boolean;
}

function MediaPlayerError(props: MediaPlayerErrorProps) {
  const {
    error: errorProp,
    label,
    description,
    onRetry: onRetryProp,
    onReload: onReloadProp,
    asChild,
    className,
    children,
    ...errorProps
  } = props;

  const context = useMediaPlayerContext("MediaPlayerError");
  const isFullscreen = useMediaSelector(
    (state) => state.mediaIsFullscreen ?? false
  );
  const mediaError = useMediaSelector((state) => state.mediaError);

  const error = errorProp ?? mediaError;

  const labelId = React.useId();
  const descriptionId = React.useId();

  const [actionState, setActionState] = React.useState<{
    retryPending: boolean;
    reloadPending: boolean;
  }>({
    retryPending: false,
    reloadPending: false,
  });

  const onRetry = React.useCallback(() => {
    setActionState((prev) => ({ ...prev, retryPending: true }));

    requestAnimationFrame(() => {
      const mediaElement = context.mediaRef.current;
      if (!mediaElement) {
        setActionState((prev) => ({ ...prev, retryPending: false }));
        return;
      }

      if (onRetryProp) {
        onRetryProp();
      } else {
        const currentSrc = mediaElement.currentSrc ?? mediaElement.src;
        if (currentSrc) {
          mediaElement.load();
        }
      }

      setActionState((prev) => ({ ...prev, retryPending: false }));
    });
  }, [context.mediaRef, onRetryProp]);

  const onReload = React.useCallback(() => {
    setActionState((prev) => ({ ...prev, reloadPending: true }));

    requestAnimationFrame(() => {
      if (onReloadProp) {
        onReloadProp();
      } else {
        window.location.reload();
      }
    });
  }, [onReloadProp]);

  const errorLabel = React.useMemo(() => {
    if (label) return label;

    if (!error) return "Playback Error";

    const labelMap: Record<number, string> = {
      [MediaError.MEDIA_ERR_ABORTED]: "Playback Interrupted",
      [MediaError.MEDIA_ERR_NETWORK]: "Connection Problem",
      [MediaError.MEDIA_ERR_DECODE]: "Media Error",
      [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: "Unsupported Format",
    };

    return labelMap[error.code] ?? "Playback Error";
  }, [label, error]);

  const errorDescription = React.useMemo(() => {
    if (description) return description;

    if (!error) return "An unknown error occurred";

    const descriptionMap: Record<number, string> = {
      [MediaError.MEDIA_ERR_ABORTED]: "Media playback was aborted",
      [MediaError.MEDIA_ERR_NETWORK]:
        "A network error occurred while loading the media",
      [MediaError.MEDIA_ERR_DECODE]:
        "An error occurred while decoding the media",
      [MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]:
        "The media format is not supported",
    };

    return descriptionMap[error.code] ?? "An unknown error occurred";
  }, [description, error]);

  if (!error) return null;

  const ErrorPrimitive = asChild ? Slot : "div";

  return (
    <ErrorPrimitive
      role="alert"
      aria-describedby={descriptionId}
      aria-labelledby={labelId}
      aria-live="assertive"
      data-slot="media-player-error"
      data-state={isFullscreen ? "fullscreen" : "windowed"}
      {...errorProps}
      className={cn(
        "pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 text-white backdrop-blur-sm",
        className
      )}
    >
      {children ?? (
        <div className="flex max-w-md flex-col items-center gap-4 px-6 py-8 text-center">
          <AlertTriangleIcon className="size-12 text-destructive" />
          <div className="flex flex-col gap-px text-center">
            <h3 className="font-semibold text-xl tracking-tight">
              {errorLabel}
            </h3>
            <p className="text-balance text-muted-foreground text-sm leading-relaxed">
              {errorDescription}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onRetry}
              disabled={actionState.retryPending}
            >
              {actionState.retryPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RefreshCcwIcon />
              )}
              Try again
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onReload}
              disabled={actionState.reloadPending}
            >
              {actionState.reloadPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <RotateCcwIcon />
              )}
              Reload page
            </Button>
          </div>
        </div>
      )}
    </ErrorPrimitive>
  );
}

interface MediaPlayerVolumeIndicatorProps extends React.ComponentProps<"div"> {
  asChild?: boolean;
}

function MediaPlayerVolumeIndicator(props: MediaPlayerVolumeIndicatorProps) {
  const { asChild, className, ...indicatorProps } = props;

  const mediaVolume = useMediaSelector((state) => state.mediaVolume ?? 1);
  const mediaMuted = useMediaSelector((state) => state.mediaMuted ?? false);
  const mediaVolumeLevel = useMediaSelector(
    (state) => state.mediaVolumeLevel ?? "high"
  );
  const volumeIndicatorVisible = useStoreSelector(
    (state) => state.volumeIndicatorVisible
  );

  if (!volumeIndicatorVisible) return null;

  const effectiveVolume = mediaMuted ? 0 : mediaVolume;
  const volumePercentage = Math.round(effectiveVolume * 100);
  const barCount = 10;
  const activeBarCount = Math.ceil(effectiveVolume * barCount);

  const VolumeIndicatorPrimitive = asChild ? Slot : "div";

  return (
    <VolumeIndicatorPrimitive
      role="status"
      aria-live="polite"
      aria-label={`Volume ${mediaMuted ? "muted" : `${volumePercentage}%`}`}
      data-slot="media-player-volume-indicator"
      {...indicatorProps}
      className={cn(
        "pointer-events-none absolute inset-0 z-50 flex items-center justify-center",
        className
      )}
    >
      <div className="fade-in-0 zoom-in-95 flex animate-in flex-col items-center gap-3 rounded-lg bg-black/30 px-6 py-4 text-white backdrop-blur-xl duration-200">
        <div className="flex items-center gap-2">
          {mediaVolumeLevel === "off" || mediaMuted ? (
            <VolumeXIcon className="size-6" />
          ) : mediaVolumeLevel === "high" ? (
            <Volume2Icon className="size-6" />
          ) : (
            <Volume1Icon className="size-6" />
          )}
          <span className="font-medium text-sm tabular-nums">
            {mediaMuted ? "Muted" : `${volumePercentage}%`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {Array.from({ length: barCount }, (_, index) => (
            <div
              key={index}
              className={cn(
                "w-1.5 rounded-full transition-all duration-150",
                index < activeBarCount && !mediaMuted
                  ? "scale-100 bg-white"
                  : "scale-90 bg-white/30"
              )}
              style={{
                height: `${12 + index * 2}px`,
                animationDelay: `${index * 50}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </VolumeIndicatorPrimitive>
  );
}

interface MediaPlayerControlsOverlayProps extends React.ComponentProps<"div"> {
  asChild?: boolean;
}

function MediaPlayerControlsOverlay(props: MediaPlayerControlsOverlayProps) {
  const { asChild, className, ...overlayProps } = props;

  const isFullscreen = useMediaSelector(
    (state) => state.mediaIsFullscreen ?? false
  );
  const controlsVisible = useStoreSelector((state) => state.controlsVisible);

  const OverlayPrimitive = asChild ? Slot : "div";

  return (
    <OverlayPrimitive
      data-slot="media-player-controls-overlay"
      data-state={isFullscreen ? "fullscreen" : "windowed"}
      data-visible={controlsVisible ? "" : undefined}
      {...overlayProps}
      className={cn(
        "-z-10 pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 transition-opacity duration-200 ease-[var(--ease-out)] motion-reduce:duration-100 data-[visible]:opacity-100",
        className
      )}
    />
  );
}

interface MediaPlayerPlayProps extends React.ComponentProps<typeof Button> {}

function MediaPlayerPlay(props: MediaPlayerPlayProps) {
  const { asChild, children, className, disabled, ...playButtonProps } = props;

  const context = useMediaPlayerContext("MediaPlayerPlay");
  const dispatch = useMediaDispatch();
  const mediaPaused = useMediaSelector((state) => state.mediaPaused ?? true);

  const isDisabled = disabled || context.disabled;

  const onPlayToggle = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      props.onClick?.(event);

      if (event.defaultPrevented) return;

      dispatch({
        type: mediaPaused
          ? MediaActionTypes.MEDIA_PLAY_REQUEST
          : MediaActionTypes.MEDIA_PAUSE_REQUEST,
      });
    },
    [dispatch, props.onClick, mediaPaused]
  );

  return (
    <MediaPlayerTooltip
      tooltip={mediaPaused ? "Play" : "Pause"}
      shortcut="Space"
    >
      <Button
        type="button"
        aria-controls={context.mediaId}
        aria-label={mediaPaused ? "Play" : "Pause"}
        aria-pressed={!mediaPaused}
        data-disabled={isDisabled ? "" : undefined}
        data-slot="media-player-play-button"
        data-state={mediaPaused ? "off" : "on"}
        disabled={isDisabled}
        {...playButtonProps}
        variant="ghost"
        size="icon"
        className={cn(
          "size-8 [&_svg:not([class*='fill-'])]:fill-current",
          className
        )}
        onClick={onPlayToggle}
      >
        {children ?? (mediaPaused ? <PlayIcon /> : <PauseIcon />)}
      </Button>
    </MediaPlayerTooltip>
  );
}

interface MediaPlayerSeekBackwardProps
  extends React.ComponentProps<typeof Button> {
  seconds?: number;
}

function MediaPlayerSeekBackward(props: MediaPlayerSeekBackwardProps) {
  const {
    seconds = KEYBOARD_SEEK_STEP,
    asChild,
    children,
    className,
    disabled,
    ...seekBackwardProps
  } = props;

  const context = useMediaPlayerContext("MediaPlayerSeekBackward");
  const dispatch = useMediaDispatch();
  const mediaCurrentTime = useMediaSelector(
    (state) => state.mediaCurrentTime ?? 0
  );

  const isDisabled = disabled || context.disabled;

  const onSeekBackward = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      props.onClick?.(event);

      if (event.defaultPrevented) return;

      dispatch({
        type: MediaActionTypes.MEDIA_SEEK_REQUEST,
        detail: Math.max(0, mediaCurrentTime - seconds),
      });
    },
    [dispatch, props.onClick, mediaCurrentTime, seconds]
  );

  return (
    <MediaPlayerTooltip
      tooltip={`Back ${seconds}s`}
      shortcut={context.isVideo ? ["←"] : ["Shift ←"]}
    >
      <Button
        type="button"
        aria-controls={context.mediaId}
        aria-label={`Back ${seconds} seconds`}
        data-disabled={isDisabled ? "" : undefined}
        data-slot="media-player-seek-backward"
        disabled={isDisabled}
        {...seekBackwardProps}
        variant="ghost"
        size="icon"
        className={cn("size-8", className)}
        onClick={onSeekBackward}
      >
        {children ?? <RewindIcon />}
      </Button>
    </MediaPlayerTooltip>
  );
}

interface MediaPlayerSeekForwardProps
  extends React.ComponentProps<typeof Button> {
  seconds?: number;
}

function MediaPlayerSeekForward(props: MediaPlayerSeekForwardProps) {
  const {
    seconds = KEYBOARD_SEEK_STEP,
    asChild,
    children,
    className,
    disabled,
    ...seekForwardProps
  } = props;

  const context = useMediaPlayerContext("MediaPlayerSeekForward");
  const dispatch = useMediaDispatch();
  const mediaCurrentTime = useMediaSelector(
    (state) => state.mediaCurrentTime ?? 0
  );
  const [, seekableEnd] = useMediaSelector(
    (state) => state.mediaSeekable ?? [0, 0]
  );
  const isDisabled = disabled || context.disabled;

  const onSeekForward = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      props.onClick?.(event);

      if (event.defaultPrevented) return;

      dispatch({
        type: MediaActionTypes.MEDIA_SEEK_REQUEST,
        detail: Math.min(
          seekableEnd ?? Number.POSITIVE_INFINITY,
          mediaCurrentTime + seconds
        ),
      });
    },
    [dispatch, props.onClick, mediaCurrentTime, seekableEnd, seconds]
  );

  return (
    <MediaPlayerTooltip
      tooltip={`Forward ${seconds}s`}
      shortcut={context.isVideo ? ["→"] : ["Shift →"]}
    >
      <Button
        type="button"
        aria-controls={context.mediaId}
        aria-label={`Forward ${seconds} seconds`}
        data-disabled={isDisabled ? "" : undefined}
        data-slot="media-player-seek-forward"
        disabled={isDisabled}
        {...seekForwardProps}
        variant="ghost"
        size="icon"
        className={cn("size-8", className)}
        onClick={onSeekForward}
      >
        {children ?? <FastForwardIcon />}
      </Button>
    </MediaPlayerTooltip>
  );
}

interface SeekState {
  isHovering: boolean;
  pendingSeekTime: number | null;
  hasInitialPosition: boolean;
}

interface MediaPlayerSeekProps
  extends React.ComponentProps<typeof SliderPrimitive.Root> {
  skipSegments?: SkipSegment[];
  withTime?: boolean;
  withoutChapter?: boolean;
  withoutTooltip?: boolean;
  tooltipThumbnailSrc?: string | ((time: number) => string);
  previewFrames?: boolean;
  /** Original URL, before an MSE player replaces media.src with a blob URL. */
  previewSource?: string;
  tooltipTimeVariant?: "current" | "progress";
  tooltipSideOffset?: number;
  tooltipCollisionBoundary?: Element | Element[];
  tooltipCollisionPadding?:
    | number
    | Partial<Record<"top" | "right" | "bottom" | "left", number>>;
}

function MediaPlayerSeek(props: MediaPlayerSeekProps) {
  const {
    skipSegments = [],
    withTime = false,
    withoutChapter = false,
    withoutTooltip = false,
    tooltipTimeVariant = "current",
    tooltipThumbnailSrc,
    previewFrames = false,
    previewSource,
    tooltipSideOffset,
    tooltipCollisionPadding = SEEK_COLLISION_PADDING,
    tooltipCollisionBoundary,
    className,
    disabled,
    ...seekProps
  } = props;

  const context = useMediaPlayerContext(SEEK_NAME);
  const store = useStoreContext(SEEK_NAME);
  const dispatch = useMediaDispatch();
  const mediaCurrentTime = useMediaSelector(
    (state) => state.mediaCurrentTime ?? 0
  );
  const [seekableStart = 0, seekableEnd = 0] = useMediaSelector(
    (state) => state.mediaSeekable ?? [0, 0]
  );
  const mediaBuffered = useMediaSelector((state) => state.mediaBuffered ?? []);
  const mediaEnded = useMediaSelector((state) => state.mediaEnded ?? false);

  // Use chapters from context instead of media-chrome state
  const contextChapters = context.chapters ?? [];
  const mediaChaptersCues = useMediaSelector(
    (state) => state.mediaChaptersCues ?? []
  );
  const chapterCues = React.useMemo(() => boundSkipChapterLabels(
    contextChapters.length > 0 ? contextChapters : mediaChaptersCues, skipSegments
  ), [contextChapters, mediaChaptersCues, skipSegments]);
  const mediaPreviewTime = useMediaSelector((state) => state.mediaPreviewTime);
  const mediaPreviewImage = useMediaSelector(
    (state) => state.mediaPreviewImage
  );
  const mediaPreviewCoords = useMediaSelector(
    (state) => state.mediaPreviewCoords
  );

  const seekMode = useStoreSelector((state) => state.seekMode);
  const keyboardPreviewTime = useStoreSelector((state) => state.seekPreviewTime);
  const keyboardScrubbing = seekMode === "keyboard";
  const seekRef = React.useRef<HTMLDivElement>(null);
  const keyboardRangeRef = React.useRef<HTMLSpanElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const touchScrubbingRef = React.useRef(false);
  const [touchScrubSpeed, setTouchScrubSpeed] = React.useState<number | null>(null);

  const hoverTimeRef = React.useRef(0);
  const tooltipXRef = React.useRef(0);
  const tooltipYRef = React.useRef(0);
  const seekRectRef = React.useRef<DOMRect | null>(null);
  const collisionDataRef = React.useRef<{
    padding: { top: number; right: number; bottom: number; left: number };
    boundaries: Element[];
  } | null>(null);

  const [seekState, setSeekState] = React.useState<SeekState>({
    isHovering: false,
    pendingSeekTime: null,
    hasInitialPosition: false,
  });

  const rafIdRef = React.useRef<number | null>(null);
  const seekThrottleRef = React.useRef<number | null>(null);
  const lastPointerXRef = React.useRef<number>(0);
  const previewDebounceRef = React.useRef<number | null>(null);

  const timeCache = React.useRef<Map<number, string>>(new Map());

  // Use the same transient target as the clock, including keyboard holds.
  // A prior pointer commit must not leave this slider on a stale local value.
  const displayValue = keyboardPreviewTime ?? mediaCurrentTime;
  if (keyboardScrubbing && keyboardPreviewTime !== null) hoverTimeRef.current = keyboardPreviewTime;

  const isDisabled = disabled || context.disabled;
  const tooltipDisabled =
    withoutTooltip || context.withoutTooltip || store.getState().menuOpen;

  const currentTooltipSideOffset =
    tooltipSideOffset ?? context.tooltipSideOffset;

  const getCachedTime = React.useCallback((time: number, duration: number) => {
    const roundedTime = Math.floor(time);
    const key = roundedTime + duration * 10000;

    if (timeCache.current.has(key)) {
      return timeCache.current.get(key) as string;
    }

    const formatted = timeUtils.formatTime(time, duration);
    timeCache.current.set(key, formatted);

    if (timeCache.current.size > 100) {
      timeCache.current.clear();
    }

    return formatted;
  }, []);

  const currentTime = getCachedTime(displayValue, seekableEnd);
  const duration = getCachedTime(seekableEnd, seekableEnd);
  const remainingTime = getCachedTime(seekableEnd - displayValue, seekableEnd);

  const onCollisionDataUpdate = React.useCallback(() => {
    if (collisionDataRef.current) return collisionDataRef.current;

    const padding =
      typeof tooltipCollisionPadding === "number"
        ? {
            top: tooltipCollisionPadding,
            right: tooltipCollisionPadding,
            bottom: tooltipCollisionPadding,
            left: tooltipCollisionPadding,
          }
        : { top: 0, right: 0, bottom: 0, left: 0, ...tooltipCollisionPadding };

    const boundaries = tooltipCollisionBoundary
      ? Array.isArray(tooltipCollisionBoundary)
        ? tooltipCollisionBoundary
        : [tooltipCollisionBoundary]
      : ([context.rootRef.current].filter(Boolean) as Element[]);

    collisionDataRef.current = { padding, boundaries };
    return collisionDataRef.current;
  }, [tooltipCollisionPadding, tooltipCollisionBoundary, context.rootRef]);

  const getCurrentChapterCue = React.useCallback(
    (time: number) => {
      if (withoutChapter || chapterCues.length === 0) return null;
      return chapterCues.find((c) => time >= c.startTime && time < c.endTime);
    },
    [chapterCues, withoutChapter]
  );

  const getThumbnail = React.useCallback(
    (time: number) => {
      if (tooltipDisabled) return null;

      if (tooltipThumbnailSrc) {
        const src =
          typeof tooltipThumbnailSrc === "function"
            ? tooltipThumbnailSrc(time)
            : tooltipThumbnailSrc;
        return { src, coords: null };
      }

      if (
        mediaPreviewTime !== undefined &&
        Math.abs(time - mediaPreviewTime) < 0.1 &&
        mediaPreviewImage
      ) {
        return {
          src: mediaPreviewImage,
          coords: mediaPreviewCoords ?? null,
        };
      }

      return null;
    },
    [
      tooltipThumbnailSrc,
      mediaPreviewTime,
      mediaPreviewImage,
      mediaPreviewCoords,
      tooltipDisabled,
    ]
  );

  const onPreviewUpdate = React.useCallback(
    (time: number) => {
      if (tooltipDisabled) return;

      if (previewDebounceRef.current) {
        cancelAnimationFrame(previewDebounceRef.current);
      }

      previewDebounceRef.current = requestAnimationFrame(() => {
        dispatch({
          type: MediaActionTypes.MEDIA_PREVIEW_REQUEST,
          detail: time,
        });
        previewDebounceRef.current = null;
      });
    },
    [dispatch, tooltipDisabled]
  );

  const onTooltipPositionUpdate = React.useCallback(
    (clientX: number) => {
      if (!seekRef.current) return;

      const tooltipWidth =
        tooltipRef.current?.offsetWidth ?? SEEK_TOOLTIP_WIDTH_FALLBACK;

      let x = clientX;
      // Controls can become visible during a gesture. Always anchor to the
      // current bar position, rather than the initial touch or a cached rect.
      const y = seekRef.current.getBoundingClientRect().top;

      const collisionData = onCollisionDataUpdate();
      const halfTooltipWidth = tooltipWidth / 2;

      let minLeft = 0;
      let maxRight = window.innerWidth;

      for (const boundary of collisionData.boundaries) {
        const boundaryRect = boundary.getBoundingClientRect();
        minLeft = Math.max(
          minLeft,
          boundaryRect.left + collisionData.padding.left
        );
        maxRight = Math.min(
          maxRight,
          boundaryRect.right - collisionData.padding.right
        );
      }

      if (x - halfTooltipWidth < minLeft) {
        x = minLeft + halfTooltipWidth;
      } else if (x + halfTooltipWidth > maxRight) {
        x = maxRight - halfTooltipWidth;
      }

      const viewportPadding = SEEK_COLLISION_PADDING;
      if (x - halfTooltipWidth < viewportPadding) {
        x = viewportPadding + halfTooltipWidth;
      } else if (x + halfTooltipWidth > window.innerWidth - viewportPadding) {
        x = window.innerWidth - viewportPadding - halfTooltipWidth;
      }

      tooltipXRef.current = x;
      tooltipYRef.current = y;

      if (tooltipRef.current) {
        tooltipRef.current.style.setProperty(SEEK_TOOLTIP_X, `${x}px`);
        tooltipRef.current.style.setProperty(SEEK_TOOLTIP_Y, `${y}px`);
      }

      if (!seekState.hasInitialPosition) {
        setSeekState((prev) => ({ ...prev, hasInitialPosition: true }));
      }
    },
    [onCollisionDataUpdate, seekState.hasInitialPosition]
  );

  const onHoverProgressUpdate = React.useCallback(() => {
    if (!seekRef.current || seekableEnd <= 0) return;

    const hoverPercent = Math.min(
      100,
      (hoverTimeRef.current / seekableEnd) * 100
    );
    seekRef.current.style.setProperty(
      SEEK_HOVER_PERCENT,
      `${hoverPercent.toFixed(4)}%`
    );
  }, [seekableEnd]);

  React.useEffect(() => {
    if (keyboardScrubbing || keyboardPreviewTime === null) {
      if (seekState.pendingSeekTime !== null) setSeekState(prev => ({ ...prev, pendingSeekTime: null }));
      return;
    }
    if (!touchScrubbingRef.current && seekState.pendingSeekTime !== null) {
      const diff = Math.abs(mediaCurrentTime - seekState.pendingSeekTime);
      if (diff < 0.5) {
        setSeekState((prev) => ({ ...prev, pendingSeekTime: null }));
        store.setState("seekPreviewTime", null);
      }
    }
  }, [mediaCurrentTime, seekState.pendingSeekTime, keyboardScrubbing, keyboardPreviewTime, store]);

  // The bar tracks every display frame through transforms. React and preview
  // decoders receive bounded updates independently of the display refresh rate.
  React.useEffect(() => {
    const timeline = seekRef.current;
    if (!timeline || !context.keyboardScrubber) return;
    let rect = timeline.getBoundingClientRect();
    let width = rect.width, tooltipWidth = SEEK_TOOLTIP_WIDTH_FALLBACK;
    let minX = SEEK_COLLISION_PADDING, maxX = window.innerWidth - SEEK_COLLISION_PADDING;
    let restoreTooltip: { left: string; transform: string } | null = null;
    const measure = () => {
      rect = timeline.getBoundingClientRect(); width = rect.width;
      tooltipWidth = tooltipRef.current?.offsetWidth || SEEK_TOOLTIP_WIDTH_FALLBACK;
      const collision = onCollisionDataUpdate();
      minX = SEEK_COLLISION_PADDING; maxX = window.innerWidth - SEEK_COLLISION_PADDING;
      for (const boundary of collision.boundaries) {
        const bounds = boundary.getBoundingClientRect();
        minX = Math.max(minX, bounds.left + collision.padding.left);
        maxX = Math.min(maxX, bounds.right - collision.padding.right);
      }
    };
    const restore = () => {
      timeline.removeAttribute("data-keyboard-scrubbing");
      if (restoreTooltip && tooltipRef.current) {
        tooltipRef.current.style.left = restoreTooltip.left;
        tooltipRef.current.style.transform = restoreTooltip.transform;
      }
      restoreTooltip = null;
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      measure();
    });
    resize?.observe(timeline);
    if (tooltipRef.current) resize?.observe(tooltipRef.current);
    const unsubscribe = context.keyboardScrubber.subscribe(position => {
      if (position === null) { restore(); return; }
      if (!timeline.hasAttribute("data-keyboard-scrubbing")) measure();
      const fraction = Math.max(0, Math.min(1, (position - seekableStart) / (seekableEnd - seekableStart)));
      if (keyboardRangeRef.current) keyboardRangeRef.current.style.setProperty("--keyboard-seek-inset", `${(1 - fraction) * 100}%`);
      const tooltip = tooltipRef.current;
      if (tooltip) {
        restoreTooltip ??= { left: tooltip.style.left, transform: tooltip.style.transform };
        const x = Math.max(minX + tooltipWidth / 2, Math.min(maxX - tooltipWidth / 2, rect.left + fraction * width));
        tooltip.style.setProperty(SEEK_TOOLTIP_X, `${x}px`);
        tooltip.style.setProperty(SEEK_TOOLTIP_Y, `${rect.top}px`);
        tooltip.style.left = "0px";
        tooltip.style.transform = `translateX(${x - tooltipWidth / 2}px) translateY(calc(-100% - ${currentTooltipSideOffset}px))`;
      }
      timeline.setAttribute("data-keyboard-scrubbing", "");
    });
    return () => { unsubscribe(); resize?.disconnect(); restore(); };
  }, [context.keyboardScrubber, seekableStart, seekableEnd, currentTooltipSideOffset, onCollisionDataUpdate]);

  React.useLayoutEffect(() => {
    if (!keyboardScrubbing || keyboardPreviewTime === null || !seekRef.current) return;
    const rect = seekRef.current.getBoundingClientRect();
    onTooltipPositionUpdate(rect.left + (keyboardPreviewTime - seekableStart) / (seekableEnd - seekableStart) * rect.width);
    onPreviewUpdate(keyboardPreviewTime);
  }, [keyboardScrubbing, keyboardPreviewTime, seekableStart, seekableEnd, onTooltipPositionUpdate, onPreviewUpdate]);

  React.useEffect(() => {
    if (!seekState.isHovering || tooltipDisabled) return;

    function onScroll() {
      setSeekState((prev) => ({
        ...prev,
        isHovering: false,
        hasInitialPosition: false,
      }));
      dispatch({
        type: MediaActionTypes.MEDIA_PREVIEW_REQUEST,
        detail: undefined,
      });
    }

    document.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll);
    };
  }, [dispatch, seekState.isHovering, tooltipDisabled]);

  const bufferedProgress = React.useMemo(() => {
    if (mediaBuffered.length === 0 || seekableEnd <= 0) return 0;

    if (mediaEnded) return 1;

    const containingRange = mediaBuffered.find(
      ([start, end]) => start <= mediaCurrentTime && mediaCurrentTime <= end
    );

    if (containingRange) {
      return Math.min(1, containingRange[1] / seekableEnd);
    }

    return Math.min(1, seekableStart / seekableEnd);
  }, [mediaBuffered, mediaCurrentTime, seekableEnd, mediaEnded, seekableStart]);

  const onPointerEnter = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Physical touch uses the gesture handler; Android preview messages use
    // untrusted synthetic touch events to reuse this tooltip without mouse UI.
    if (event.pointerType === "touch" && event.isTrusted) return;
    if (seekRef.current) {
      seekRectRef.current = seekRef.current.getBoundingClientRect();
    }

    collisionDataRef.current = null;
    lastPointerXRef.current = event.clientX;

    const rect = seekRectRef.current;
    if (tooltipDisabled || seekableEnd <= 0 || !rect || rect.width <= 0) return;
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    hoverTimeRef.current = seekableStart + fraction * (seekableEnd - seekableStart);
    onPreviewUpdate(hoverTimeRef.current);
    onTooltipPositionUpdate(event.clientX);
    setSeekState(previous => ({ ...previous, isHovering: true }));
  }, [seekableStart, seekableEnd, onTooltipPositionUpdate, onPreviewUpdate, tooltipDisabled]);

  const onPointerLeave = React.useCallback(() => {
    if (touchScrubbingRef.current) return;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (previewDebounceRef.current) {
      cancelAnimationFrame(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }

    setSeekState((prev) => ({
      ...prev,
      isHovering: false,
      hasInitialPosition: false,
    }));

    seekRectRef.current = null;
    collisionDataRef.current = null;

    lastPointerXRef.current = 0;

    if (!tooltipDisabled) {
      dispatch({
        type: MediaActionTypes.MEDIA_PREVIEW_REQUEST,
        detail: undefined,
      });
    }
  }, [dispatch, tooltipDisabled]);

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if ((event.pointerType === "touch" && event.isTrusted) || seekableEnd <= 0) return;

      if (!seekRectRef.current && seekRef.current) {
        seekRectRef.current = seekRef.current.getBoundingClientRect();
      }

      if (!seekRectRef.current) return;

      lastPointerXRef.current = event.clientX;

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        const seekRect = seekRectRef.current;
        if (!seekRect) {
          rafIdRef.current = null;
          return;
        }

        const clientX = lastPointerXRef.current;
        const offsetXOnSeekBar = Math.max(
          0,
          Math.min(clientX - seekRect.left, seekRect.width)
        );
        const relativeX = offsetXOnSeekBar / seekRect.width;
        const calculatedHoverTime = seekableStart + relativeX * (seekableEnd - seekableStart);

        hoverTimeRef.current = calculatedHoverTime;

        onHoverProgressUpdate();

        const wasHovering = seekState.isHovering;
        const isCurrentlyHovering =
          clientX >= seekRect.left && clientX <= seekRect.right;

        if (
          !wasHovering &&
          isCurrentlyHovering &&
          !tooltipDisabled
        ) {
          setSeekState((prev) => ({ ...prev, isHovering: true }));
        }

        if (!tooltipDisabled) {
          onPreviewUpdate(calculatedHoverTime);

          if (isCurrentlyHovering) {
            onTooltipPositionUpdate(clientX);
          }
        }

        rafIdRef.current = null;
      });
    },
    [
      onPreviewUpdate,
      onTooltipPositionUpdate,
      onHoverProgressUpdate,
      seekableEnd,
      seekableStart,
      seekState.isHovering,
      tooltipDisabled,
    ]
  );

  const onSeek = React.useCallback(
    (value: number[]) => {
      const time = value[0] ?? 0;
      store.setState("seekMode", "bar");
      store.setState("seekPreviewTime", time);

      setSeekState((prev) => ({ ...prev, pendingSeekTime: time }));

      if (!store.getState().dragging) {
        store.setState("dragging", true);
      }
    },
    [store.getState, store.setState]
  );

  const onSeekCommit = React.useCallback(
    (value: number[]) => {
      const time = value[0] ?? 0;
      store.setState("seekPreviewTime", time);
      store.setState("seekMode", null);

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (previewDebounceRef.current) {
        cancelAnimationFrame(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }

      setSeekState((prev) => ({
        ...prev,
        pendingSeekTime: time,
        isHovering: false,
        hasInitialPosition: false,
      }));

      collisionDataRef.current = null;

      if (store.getState().dragging) {
        store.setState("dragging", false);
      }

      dispatch({
        type: MediaActionTypes.MEDIA_SEEK_REQUEST,
        detail: time,
      });

      dispatch({
        type: MediaActionTypes.MEDIA_PREVIEW_REQUEST,
        detail: undefined,
      });
    },
    [dispatch, store.getState, store.setState]
  );

  React.useEffect(() => {
    return () => {
      if (seekThrottleRef.current) {
        cancelAnimationFrame(seekThrottleRef.current);
      }
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (previewDebounceRef.current) {
        cancelAnimationFrame(previewDebounceRef.current);
      }
    };
  }, []);

  // Keep listeners attached throughout the drag, including React renders caused
  // by showing controls or receiving a decoded preview frame.
  const touchCallbacksRef = React.useRef({ mediaCurrentTime, onSeek, onSeekCommit, onPreviewUpdate, onTooltipPositionUpdate, onHoverProgressUpdate, onPointerLeave });
  React.useLayoutEffect(() => {
    touchCallbacksRef.current = { mediaCurrentTime, onSeek, onSeekCommit, onPreviewUpdate, onTooltipPositionUpdate, onHoverProgressUpdate, onPointerLeave };
  });

  React.useEffect(() => {
    const root = context.rootRef.current;
    const timeline = seekRef.current;
    if (!root || !timeline || isDisabled) return;
    root.setAttribute("data-native-seek-ui", "");
    const preview = (time: number, speed: number, mode: "bar" | "surface") => {
      touchScrubbingRef.current = true;
      hoverTimeRef.current = time;
      store.setState("seekPreviewTime", time);
      store.setState("seekMode", mode);
      // Dragging the bar keeps its controls open. Surface gestures preserve
      // visibility; an idle timer must not hide controls during an active seek.
      if (mode === "bar") store.setState("dragging", true);
      const callbacks = touchCallbacksRef.current;
      // Surface gestures use SeekPreview's idle-only decoder. Sending the
      // media-controls preview request too would keep another producer busy.
      if (mode === "bar") callbacks.onPreviewUpdate(time);
      else if (previewDebounceRef.current !== null) {
        cancelAnimationFrame(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
      callbacks.onHoverProgressUpdate();
      const rect = timeline.getBoundingClientRect();
      callbacks.onTooltipPositionUpdate(rect.left + (time - seekableStart) / (seekableEnd - seekableStart) * rect.width);
      setSeekState(previous => ({ ...previous, pendingSeekTime: time, isHovering: true }));
      setTouchScrubSpeed(mode === "surface" ? speed : null);
    };
    const cancel = () => {
      touchScrubbingRef.current = false;
      setTouchScrubSpeed(null);
      store.setState("seekPreviewTime", null);
      store.setState("seekMode", null);
      setSeekState(previous => ({ ...previous, pendingSeekTime: null }));
      store.setState("dragging", false);
      touchCallbacksRef.current.onPointerLeave();
    };
    const bridge = desktopBridge();
    const session = () => (context.mediaRef.current as unknown as { controller?: { previewSession: string } } | null)?.controller?.previewSession;
    const unsubscribe = bridge?.subscribe(message => {
      if (message.type !== "scrub" || message.session !== session()) return;
      if (!message.active) {
        cancel();
        if (message.commit && Number.isFinite(message.position)) {
          const target = Math.min(seekableEnd, Math.max(seekableStart, message.position));
          store.setState("seekPreviewTime", target);
          setSeekState(previous => ({ ...previous, pendingSeekTime: target }));
        }
        return;
      }
      if (!Number.isFinite(message.position) || message.position < 0) return;
      preview(Math.min(seekableEnd, Math.max(seekableStart, message.position)), message.speed ?? 1, "surface");
    });
    const dispose = attachTouchScrubbing(root, {
      timeline, start: seekableStart, end: seekableEnd,
      currentTime: () => touchCallbacksRef.current.mediaCurrentTime,
      enabled: () => !store.getState().menuOpen,
      surfaceEnabled: () => !bridge?.capabilities?.nativeSurfaceGestures,
      preview,
      grab: () => {
        const owner = session();
        if ((bridge?.platform === "android" || bridge?.platform === "ios") && owner) bridge.send({ type: "seek-feedback", session: owner });
      },
      commit: time => {
        touchScrubbingRef.current = false;
        setTouchScrubSpeed(null);
        touchCallbacksRef.current.onSeekCommit([time]);
      },
      cancel,
    });
    const media = context.mediaRef.current;
    media?.addEventListener("emptied", cancel);
    media?.addEventListener("loadstart", cancel);
    return () => {
      dispose(); unsubscribe?.();
      media?.removeEventListener("emptied", cancel);
      media?.removeEventListener("loadstart", cancel);
      root.removeAttribute("data-native-seek-ui"); cancel();
    };
  }, [context.rootRef, context.mediaRef, isDisabled, seekableStart, seekableEnd, store]);

  // Reposition after controls/preview layout changes, even without another move.
  React.useLayoutEffect(() => {
    if (!touchScrubbingRef.current || !seekRef.current) return;
    const rect = seekRef.current.getBoundingClientRect();
    onTooltipPositionUpdate(rect.left + (hoverTimeRef.current - seekableStart) / (seekableEnd - seekableStart) * rect.width);
  });

  const currentChapterCue = getCurrentChapterCue(hoverTimeRef.current);
  const thumbnail = getThumbnail(hoverTimeRef.current);
  const hoverTime = getCachedTime(hoverTimeRef.current, seekableEnd);

  const chapterMask = React.useMemo(() => withoutChapter ? undefined
    : chapterTrackMask(chapterCues, seekableStart, seekableEnd),
    [chapterCues, seekableStart, seekableEnd, withoutChapter]);

  const spriteStyle = React.useMemo<React.CSSProperties>(() => {
    if (!thumbnail?.coords || !thumbnail?.src) {
      return {};
    }

    const coordX = thumbnail.coords[0];
    const coordY = thumbnail.coords[1];

    const spriteWidth = Number.parseFloat(thumbnail.coords[2] ?? "0");
    const spriteHeight = Number.parseFloat(thumbnail.coords[3] ?? "0");
    const scale = spriteWidth > 0 ? SPRITE_CONTAINER_WIDTH / spriteWidth : 1;

    return {
      width: `${spriteWidth}px`,
      height: `${spriteHeight}px`,
      backgroundImage: `url(${thumbnail.src})`,
      backgroundPosition: `-${coordX}px -${coordY}px`,
      backgroundRepeat: "no-repeat",
      transform: `scale(${scale})`,
      transformOrigin: "top left",
    };
  }, [thumbnail?.coords, thumbnail?.src]);

  const SeekSlider = (
    <div data-slot="media-player-seek-container" className="relative w-full">
      <SliderPrimitive.Root
        aria-controls={context.mediaId}
        aria-valuetext={`${currentTime} of ${duration}`}
        data-hovering={seekState.isHovering ? "" : undefined}
        data-scrub-mode={seekMode ?? undefined}
        data-slider=""
        data-slot="media-player-seek"
        disabled={isDisabled}
        {...seekProps}
        ref={seekRef}
        min={seekableStart}
        max={seekableEnd}
        step={0.01}
        className={cn(
          "relative flex w-full touch-none select-none items-center data-[disabled]:pointer-events-none data-[disabled]:opacity-50 group",
          className
        )}
        value={[displayValue]}
        onKeyDown={(event) => {
          seekProps.onKeyDown?.(event);
          if (event.defaultPrevented || isDisabled || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
          const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
          if (!direction) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            seekRef.current?.setAttribute("data-arrow-seeking", "");
          }
          // Pointer precision is 0.01s. Keyboard transport uses ten seconds,
          // even when the thumb still owns focus after a pointer seek.
          event.preventDefault();
          if (context.keyboardScrubber) {
            context.keyboardScrubber.press(event.key.toLowerCase(), event.repeat);
            return;
          }
          const current = context.mediaRef.current?.currentTime ?? displayValue;
          if (!Number.isFinite(current) || seekableEnd <= seekableStart) return;
          const time = Math.min(seekableEnd, Math.max(seekableStart, current + direction * KEYBOARD_SEEK_STEP));
          onSeekCommit([time]);
        }}
        onBlur={(event) => {
          seekProps.onBlur?.(event);
          seekRef.current?.removeAttribute("data-arrow-seeking");
        }}
        onValueChange={onSeek}
        onValueCommit={onSeekCommit}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerMove={onPointerMove}
      >
        <SliderPrimitive.Track data-slot="media-player-seek-track" className="relative h-[9px] w-full grow overflow-hidden rounded-full bg-white/20"
          style={{ maskImage: chapterMask, WebkitMaskImage: chapterMask }}>
          <div
            data-slot="media-player-seek-buffered"
            className="absolute h-full rounded-full bg-white/30 will-change-[width]"
            style={{
              width: `${bufferedProgress * 100}%`,
            }}
          />
          <SliderPrimitive.Range data-slot="media-player-seek-range" className="absolute h-full rounded-full bg-white will-change-[width]" />
          <span ref={keyboardRangeRef} aria-hidden="true" data-slot="media-player-keyboard-range" className="pointer-events-none absolute inset-0 rounded-full bg-white" />
          {seekState.isHovering && seekableEnd > 0 && (
            <div
              data-slot="media-player-seek-hover-range"
              className="absolute h-full rounded-full bg-white/20 will-change-[width,opacity]"
              style={{
                width: `var(${SEEK_HOVER_PERCENT}, 0%)`,
              }}
            />
          )}
          <PlayerSkipTimeline segments={skipSegments} start={seekableStart} end={seekableEnd} />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="media-player-seek-thumb"
          aria-label="Playback position"
          className="block size-3 bg-transparent opacity-0 outline-none"
        />
      </SliderPrimitive.Root>
      {!withoutTooltip &&
        !context.withoutTooltip &&
        (seekState.isHovering || keyboardScrubbing || previewFrames) &&
        seekableEnd > 0 && (
          <MediaPlayerPortal>
            <div
              ref={tooltipRef}
              data-slot="media-player-seek-tooltip"
              data-player-glass=""
              data-seek-mode={seekMode ?? undefined}
              aria-hidden={!(seekState.isHovering || keyboardScrubbing) || tooltipDisabled}
              className="dark pointer-events-none z-[var(--layer-tooltip)] rounded-xl shadow-sm [backface-visibility:hidden] [contain:layout_style] [transition:opacity_150ms_ease-in-out]"
              style={{
                "--seek-tooltip-side-offset": `${currentTooltipSideOffset}px`,
                position: "fixed" as const,
                left: `var(${SEEK_TOOLTIP_X}, 0rem)`,
                top: `var(${SEEK_TOOLTIP_Y}, 0rem)`,
                transform: `translateX(-50%) translateY(calc(-100% - ${currentTooltipSideOffset}px))`,
                opacity: !tooltipDisabled && (seekState.isHovering || keyboardScrubbing) && seekState.hasInitialPosition ? 1 : 0,
              } as React.CSSProperties}
            >
              <div
                className={cn(
                  "flex flex-col items-center rounded-[inherit] p-1 pb-0 text-foreground",
                  thumbnail && "min-h-10",
                  (thumbnail || previewFrames) && "w-[232px]",
                  !thumbnail && !previewFrames && currentChapterCue && "px-3 py-1.5"
                )}
              >
                {previewFrames && !thumbnail?.src && <SeekPreview media={context.mediaRef.current} source={previewSource} time={keyboardScrubbing || touchScrubbingRef.current ? hoverTimeRef.current : mediaPreviewTime ?? hoverTimeRef.current} duration={seekableEnd} active={(seekState.isHovering || keyboardScrubbing) && !tooltipDisabled} deferWhileMoving={seekMode === "surface"} />}
                {thumbnail?.src && (
                  <div
                    data-slot="media-player-seek-thumbnail"
                    className="relative overflow-hidden rounded-lg"
                    style={{
                      width: `${SPRITE_CONTAINER_WIDTH}px`,
                      aspectRatio: thumbnail.coords ? `${thumbnail.coords[2]} / ${thumbnail.coords[3]}` : undefined,
                    }}
                  >
                    {thumbnail.coords ? (
                      <div className="absolute top-0 left-0" style={spriteStyle} />
                    ) : (
                      <PreviewImage key={previewSource} src={thumbnail.src} alt={`Preview at ${hoverTime}`} />
                    )}
                  </div>
                )}
                {touchScrubSpeed !== null && (
                  <div className="max-w-56 px-2 pt-1 text-center text-xs font-normal text-muted-foreground">
                    {touchScrubSpeed === 1 ? "Fast scrubbing" : "Fine scrubbing"}
                  </div>
                )}
                {currentChapterCue && (
                  <div
                    data-slot="media-player-seek-chapter-title"
                    className={cn(
                      "w-full max-w-56 px-2 text-balance text-center text-sm font-medium leading-snug [overflow-wrap:anywhere]",
                      (thumbnail || previewFrames) && "pt-2"
                    )}
                  >
                    {currentChapterCue.text}
                  </div>
                )}
                <div
                  data-slot="media-player-seek-time"
                  className={cn(
                    "whitespace-nowrap text-center font-sans text-xs font-semibold tabular-nums",
                    (thumbnail || previewFrames) && (currentChapterCue ? "pt-1 pb-2" : touchScrubSpeed !== null ? "pt-0.5 pb-2" : "py-2"),
                    !(thumbnail || previewFrames || currentChapterCue) && "px-2.5 py-1"
                  )}
                >
                  {tooltipTimeVariant === "progress"
                    ? `${hoverTime} / ${duration}`
                    : hoverTime}
                </div>
              </div>
            </div>
          </MediaPlayerPortal>
        )}
    </div>
  );

  if (withTime) {
    return (
      <div className="flex w-full items-center gap-2">
        <span className="text-sm tabular-nums">{currentTime}</span>
        {SeekSlider}
        <span className="text-sm tabular-nums">{remainingTime}</span>
      </div>
    );
  }

  return SeekSlider;
}

interface MediaPlayerVolumeProps
  extends React.ComponentProps<typeof SliderPrimitive.Root> {
  asChild?: boolean;
  expandable?: boolean;
}

function MediaPlayerVolume(props: MediaPlayerVolumeProps) {
  const {
    asChild,
    expandable = false,
    className,
    disabled,
    ...volumeProps
  } = props;

  const context = useMediaPlayerContext(VOLUME_NAME);
  const store = useStoreContext(VOLUME_NAME);
  const dispatch = useMediaDispatch();
  const mediaVolume = useMediaSelector((state) => state.mediaVolume ?? 1);
  const mediaMuted = useMediaSelector((state) => state.mediaMuted ?? false);
  const mediaVolumeLevel = useMediaSelector(
    (state) => state.mediaVolumeLevel ?? "high"
  );

  const sliderId = React.useId();
  const volumeTriggerId = React.useId();

  const isDisabled = disabled || context.disabled;

  const onMute = React.useCallback(() => {
    dispatch({
      type: mediaMuted
        ? MediaActionTypes.MEDIA_UNMUTE_REQUEST
        : MediaActionTypes.MEDIA_MUTE_REQUEST,
    });
  }, [dispatch, mediaMuted]);

  const onVolumeChange = React.useCallback(
    (value: number[]) => {
      const volume = value[0] ?? 0;

      if (!store.getState().dragging) {
        store.setState("dragging", true);
      }

      dispatch({
        type: MediaActionTypes.MEDIA_VOLUME_REQUEST,
        detail: volume,
      });
    },
    [dispatch, store.getState, store.setState]
  );

  const onVolumeCommit = React.useCallback(
    (value: number[]) => {
      const volume = value[0] ?? 0;

      if (store.getState().dragging) {
        store.setState("dragging", false);
      }

      dispatch({
        type: MediaActionTypes.MEDIA_VOLUME_REQUEST,
        detail: volume,
      });
    },
    [dispatch, store]
  );

  const effectiveVolume = mediaMuted ? 0 : mediaVolume;

  return (
    <div
      data-disabled={isDisabled ? "" : undefined}
      data-slot="media-player-volume-container"
      className={cn(
        "group flex items-center",
        expandable
          ? "gap-0 group-focus-within:gap-2 group-hover:gap-1.5"
          : "gap-1.5",
        className
      )}
    >
      <MediaPlayerTooltip tooltip="Volume" shortcut="M">
        <Button
          id={volumeTriggerId}
          type="button"
          aria-controls={`${context.mediaId} ${sliderId}`}
          aria-label={mediaMuted ? "Unmute" : "Mute"}
          aria-pressed={mediaMuted}
          data-slot="media-player-volume-trigger"
          data-state={mediaMuted ? "on" : "off"}
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={isDisabled}
          onClick={onMute}
        >
          {mediaVolumeLevel === "off" || mediaMuted ? (
            <VolumeXIcon />
          ) : mediaVolumeLevel === "high" ? (
            <Volume2Icon />
          ) : (
            <Volume1Icon />
          )}
        </Button>
      </MediaPlayerTooltip>
      <SliderPrimitive.Root
        id={sliderId}
        aria-controls={context.mediaId}
        aria-valuetext={`${Math.round(effectiveVolume * 100)}% volume`}
        data-slider=""
        data-slot="media-player-volume"
        {...volumeProps}
        min={0}
        max={1}
        step={0.1}
        className={cn(
          "relative flex touch-none select-none items-center",
          expandable
            ? "w-0 opacity-0 transition-[width,opacity] duration-200 ease-in-out group-focus-within:w-16 group-focus-within:opacity-100 group-hover:w-16 group-hover:opacity-100"
            : "w-16",
          className
        )}
        disabled={isDisabled}
        value={[effectiveVolume]}
        onValueChange={onVolumeChange}
        onValueCommit={onVolumeCommit}
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-zinc-500">
          <SliderPrimitive.Range className="absolute h-full bg-primary will-change-[width]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-2.5 shrink-0 rounded-full bg-primary shadow-sm ring-ring/22 transition-[color,box-shadow] will-change-transform hover:ring-4 focus-visible:outline-hidden focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50" />
      </SliderPrimitive.Root>
    </div>
  );
}

interface MediaPlayerTimeProps extends React.ComponentProps<"div"> {
  variant?: "progress" | "remaining" | "duration";
  asChild?: boolean;
}

function MediaPlayerTime(props: MediaPlayerTimeProps) {
  const { variant = "progress", asChild, className, ...timeProps } = props;

  const context = useMediaPlayerContext("MediaPlayerTime");
  const mediaCurrentTime = useMediaSelector(
    (state) => state.mediaCurrentTime ?? 0
  );
  const [, seekableEnd = 0] = useMediaSelector(
    (state) => state.mediaSeekable ?? [0, 0]
  );

  const previewTime = useStoreSelector((state) => state.seekPreviewTime);
  const displayTime = previewTime ?? mediaCurrentTime;

  const times = React.useMemo(() => {
    if (variant === "remaining") {
      return {
        remaining: timeUtils.formatTime(
          seekableEnd - displayTime,
          seekableEnd
        ),
      };
    }

    if (variant === "duration") {
      return {
        duration: timeUtils.formatTime(seekableEnd, seekableEnd),
      };
    }

    return {
      current: timeUtils.formatTime(displayTime, seekableEnd),
      duration: timeUtils.formatTime(seekableEnd, seekableEnd),
    };
  }, [variant, displayTime, seekableEnd]);

  const TimePrimitive = asChild ? Slot : "div";

  if (variant === "remaining" || variant === "duration") {
    return (
      <TimePrimitive
        data-slot="media-player-time"
        data-variant={variant}
        dir={context.dir}
        {...timeProps}
        className={cn("text-foreground/80 text-sm tabular-nums", className)}
      >
        {times[variant]}
      </TimePrimitive>
    );
  }

  return (
    <TimePrimitive
      data-slot="media-player-time"
      data-variant={variant}
      dir={context.dir}
      {...timeProps}
      className={cn(
        "flex items-center gap-1 text-foreground/80 text-sm",
        className
      )}
    >
      <span className="tabular-nums">{times.current}</span>
      <span role="separator" aria-hidden="true" tabIndex={-1}>
        /
      </span>
      <span className="tabular-nums">{times.duration}</span>
    </TimePrimitive>
  );
}

interface MediaPlayerPlaybackSpeedProps extends React.ComponentProps<typeof Button> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  sideOffset?: number;
  speeds?: number[];
  modal?: boolean;
}

function MediaPlayerPlaybackSpeed(props: MediaPlayerPlaybackSpeedProps) {
  const {
    open,
    defaultOpen,
    onOpenChange: onOpenChangeProp,
    sideOffset = FLOATING_MENU_SIDE_OFFSET,
    speeds = SPEEDS,
    className,
    disabled,
  } = props;

  const context = useMediaPlayerContext(PLAYBACK_SPEED_NAME);
  const store = useStoreContext(PLAYBACK_SPEED_NAME);
  const dispatch = useMediaDispatch();
  const mediaPlaybackRate = useMediaSelector(
    (state) => state.mediaPlaybackRate ?? 1
  );

  const isDisabled = disabled || context.disabled;

  const onPlaybackRateChange = React.useCallback(
    (rate: number) => {
      dispatch({
        type: MediaActionTypes.MEDIA_PLAYBACK_RATE_REQUEST,
        detail: rate,
      });
    },
    [dispatch]
  );

  const onOpenChange = React.useCallback(
    (open: boolean) => {
      store.setState("menuOpen", open);
      onOpenChangeProp?.(open);
    },
    [store.setState, onOpenChangeProp]
  );

  return <DropdownMenu open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} modal={false}>
    <MediaPlayerTooltip tooltip="Playback speed" shortcut={["<", ">"]}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" disabled={isDisabled}
          aria-label="Playback speed" className={cn("h-8 w-16 aria-[expanded=true]:bg-accent/50", className)}>
          {mediaPlaybackRate}×
        </Button>
      </DropdownMenuTrigger>
    </MediaPlayerTooltip>
    <DropdownMenuContent data-player-native-glass="" container={context.rootRef.current ?? context.portalContainer} side="top" sideOffset={sideOffset}>
      <DropdownMenuOptions value={String(mediaPlaybackRate)} onValueChange={value => onPlaybackRateChange(Number(value))}
        options={speeds.map(speed => ({ value: String(speed), label: `${speed}×` }))} />
    </DropdownMenuContent>
  </DropdownMenu>;

}

interface MediaPlayerLoopProps extends React.ComponentProps<typeof Button> {}

function MediaPlayerLoop(props: MediaPlayerLoopProps) {
  const { children, className, disabled, ...loopProps } = props;

  const context = useMediaPlayerContext("MediaPlayerLoop");
  const isDisabled = disabled || context.disabled;

  const [isLooping, setIsLooping] = React.useState(() => {
    const mediaElement = context.mediaRef.current;
    return mediaElement?.loop ?? false;
  });

  React.useEffect(() => {
    const mediaElement = context.mediaRef.current;
    if (!mediaElement) return;

    setIsLooping(mediaElement.loop);

    const checkLoop = () => setIsLooping(mediaElement.loop);
    const observer = new MutationObserver(checkLoop);
    observer.observe(mediaElement, {
      attributes: true,
      attributeFilter: ["loop"],
    });

    return () => observer.disconnect();
  }, [context.mediaRef]);

  const onLoopToggle = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      props.onClick?.(event);
      if (event.defaultPrevented) return;

      const mediaElement = context.mediaRef.current;
      if (mediaElement) {
        const newLoopState = !mediaElement.loop;
        mediaElement.loop = newLoopState;
        setIsLooping(newLoopState);
      }
    },
    [context.mediaRef, props.onClick]
  );

  return (
    <MediaPlayerTooltip
      tooltip={isLooping ? "Disable loop" : "Enable loop"}
      shortcut="R"
    >
      <Button
        type="button"
        aria-controls={context.mediaId}
        aria-label={isLooping ? "Disable loop" : "Enable loop"}
        aria-pressed={isLooping}
        data-disabled={isDisabled ? "" : undefined}
        data-slot="media-player-loop"
        data-state={isLooping ? "on" : "off"}
        disabled={isDisabled}
        {...loopProps}
        variant="ghost"
        size="icon"
        className={cn("size-8", className)}
        onClick={onLoopToggle}
      >
        {children ??
          (isLooping ? (
            <RepeatIcon className="text-muted-foreground" />
          ) : (
            <RepeatIcon />
          ))}
      </Button>
    </MediaPlayerTooltip>
  );
}

interface MediaPlayerFullscreenProps
  extends React.ComponentProps<typeof Button> {}

function MediaPlayerFullscreen(props: MediaPlayerFullscreenProps) {
  const { children, className, disabled, ...fullscreenProps } = props;

  const context = useMediaPlayerContext("MediaPlayerFullscreen");
  const dispatch = useMediaDispatch();
  const isFullscreen = useMediaSelector(
    (state) => state.mediaIsFullscreen ?? false
  );

  const isDisabled = disabled || context.disabled;

  const onFullscreen = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      props.onClick?.(event);

      if (event.defaultPrevented) return;

      dispatch({
        type: isFullscreen
          ? MediaActionTypes.MEDIA_EXIT_FULLSCREEN_REQUEST
          : MediaActionTypes.MEDIA_ENTER_FULLSCREEN_REQUEST,
      });
    },
    [dispatch, props.onClick, isFullscreen]
  );

  return (
    <MediaPlayerTooltip tooltip="Fullscreen" shortcut="F">
      <Button
        type="button"
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        data-disabled={isDisabled ? "" : undefined}
        data-slot="media-player-fullscreen"
        data-state={isFullscreen ? "on" : "off"}
        disabled={isDisabled}
        {...fullscreenProps}
        variant="ghost"
        size="icon"
        className={cn("size-8", className)}
        onClick={onFullscreen}
      >
        {children ?? (isFullscreen ? <Minimize2Icon /> : <Maximize2Icon />)}
      </Button>
    </MediaPlayerTooltip>
  );
}

interface MediaPlayerPiPProps extends React.ComponentProps<typeof Button> {
  onPipError?: (error: unknown, state: "enter" | "exit") => void;
}

function MediaPlayerPiP(props: MediaPlayerPiPProps) {
  const { children, className, onPipError, disabled, ...pipButtonProps } =
    props;

  const context = useMediaPlayerContext("MediaPlayerPiP");
  const dispatch = useMediaDispatch();
  const isPictureInPicture = useMediaSelector(
    (state) => state.mediaIsPip ?? false
  );

  const pipUnavailable = useMediaSelector((state) => state.mediaPipUnavailable);
  const isDisabled = disabled || context.disabled || Boolean(pipUnavailable);

  const onPictureInPicture = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      props.onClick?.(event);

      if (event.defaultPrevented) return;

      dispatch({
        type: isPictureInPicture
          ? MediaActionTypes.MEDIA_EXIT_PIP_REQUEST
          : MediaActionTypes.MEDIA_ENTER_PIP_REQUEST,
      });

      const mediaElement = context.mediaRef.current;

      if (mediaElement instanceof HTMLVideoElement) {
        if (isPictureInPicture) {
          document.exitPictureInPicture().catch((error) => {
            onPipError?.(error, "exit");
          });
        } else {
          mediaElement.requestPictureInPicture().catch((error) => {
            onPipError?.(error, "enter");
          });
        }
      }
    },
    [dispatch, props.onClick, isPictureInPicture, onPipError, context.mediaRef]
  );

  if (desktopBridge()?.capabilities?.pip === false) return null;

  return (
    <MediaPlayerTooltip tooltip="Picture in picture" shortcut="P">
      <Button
        type="button"
        aria-controls={context.mediaId}
        aria-label={isPictureInPicture ? "Exit pip" : "Enter pip"}
        data-disabled={isDisabled ? "" : undefined}
        data-slot="media-player-pip"
        data-state={isPictureInPicture ? "on" : "off"}
        disabled={isDisabled}
        {...pipButtonProps}
        variant="ghost"
        size="icon"
        className={cn("size-8", className)}
        onClick={onPictureInPicture}
      >
        {isPictureInPicture ? (
          <PictureInPicture2Icon />
        ) : (
          <PictureInPictureIcon />
        )}
      </Button>
    </MediaPlayerTooltip>
  );
}

interface MediaPlayerCaptionsProps
  extends React.ComponentProps<typeof Button> {}

function MediaPlayerCaptions(props: MediaPlayerCaptionsProps) {
  const { children, className, disabled, ...captionsProps } = props;

  const context = useMediaPlayerContext("MediaPlayerCaptions");
  const dispatch = useMediaDispatch();
  const isSubtitlesActive = useMediaSelector(
    (state) => (state.mediaSubtitlesShowing ?? []).length > 0
  );

  const isDisabled = disabled || context.disabled;
  const onCaptionsToggle = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      props.onClick?.(event);

      if (event.defaultPrevented) return;

      dispatch({
        type: MediaActionTypes.MEDIA_TOGGLE_SUBTITLES_REQUEST,
      });
    },
    [dispatch, props.onClick]
  );

  return (
    <MediaPlayerTooltip tooltip="Captions" shortcut="C">
      <Button
        type="button"
        aria-controls={context.mediaId}
        aria-label={isSubtitlesActive ? "Disable captions" : "Enable captions"}
        aria-pressed={isSubtitlesActive}
        data-disabled={isDisabled ? "" : undefined}
        data-slot="media-player-captions"
        data-state={isSubtitlesActive ? "on" : "off"}
        disabled={isDisabled}
        {...captionsProps}
        variant="ghost"
        size="icon"
        className={cn("size-8", className)}
        onClick={onCaptionsToggle}
      >
        {children ??
          (isSubtitlesActive ? <SubtitlesIcon /> : <CaptionsOffIcon />)}
      </Button>
    </MediaPlayerTooltip>
  );
}

interface MediaPlayerDownloadProps
  extends React.ComponentProps<typeof Button> {}

function MediaPlayerDownload(props: MediaPlayerDownloadProps) {
  const { children, className, disabled, ...downloadProps } = props;

  const context = useMediaPlayerContext("MediaPlayerDownload");

  const isDisabled = disabled || context.disabled;

  const onDownload = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      props.onClick?.(event);

      if (event.defaultPrevented) return;

      const mediaElement = context.mediaRef.current;

      if (!mediaElement || !mediaElement.currentSrc) return;

      const link = document.createElement("a");
      link.href = mediaElement.currentSrc;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    [context.mediaRef, props.onClick]
  );

  return (
    <MediaPlayerTooltip tooltip="Download" shortcut="D">
      <Button
        type="button"
        aria-controls={context.mediaId}
        aria-label="Download"
        data-disabled={isDisabled ? "" : undefined}
        data-slot="media-player-download"
        disabled={isDisabled}
        {...downloadProps}
        variant="ghost"
        size="icon"
        className={cn("size-8", className)}
        onClick={onDownload}
      >
        {children ?? <DownloadIcon />}
      </Button>
    </MediaPlayerTooltip>
  );
}

interface MediaPlayerSettingsProps extends MediaPlayerPlaybackSpeedProps {}

function MediaPlayerSettings(props: MediaPlayerSettingsProps) {
  const {
    open,
    defaultOpen,
    onOpenChange: onOpenChangeProp,
    sideOffset = FLOATING_MENU_SIDE_OFFSET,
    speeds = SPEEDS,
    asChild,
    modal = false,
    className,
    disabled,
    ...settingsProps
  } = props;

  const context = useMediaPlayerContext(SETTINGS_NAME);
  const store = useStoreContext(SETTINGS_NAME);
  const dispatch = useMediaDispatch();

  const mediaPlaybackRate = useMediaSelector(
    (state) => state.mediaPlaybackRate ?? 1
  );
  const mediaRenditionList = useMediaSelector(
    (state) => state.mediaRenditionList ?? []
  );
  const selectedRenditionId = useMediaSelector(
    (state) => state.mediaRenditionSelected
  );

  const isDisabled = disabled || context.disabled;

  const onPlaybackRateChange = React.useCallback(
    (rate: number) => {
      dispatch({
        type: MediaActionTypes.MEDIA_PLAYBACK_RATE_REQUEST,
        detail: rate,
      });
    },
    [dispatch]
  );

  const onRenditionChange = React.useCallback(
    (renditionId: string) => {
      dispatch({
        type: MediaActionTypes.MEDIA_RENDITION_REQUEST,
        detail: renditionId === "auto" ? undefined : renditionId,
      });
    },
    [dispatch]
  );

  const onOpenChange = React.useCallback(
    (open: boolean) => {
      store.setState("menuOpen", open);
      if (!open) context.subtitleTiming?.onClose();
      onOpenChangeProp?.(open);
    },
    [store.setState, onOpenChangeProp, context.subtitleTiming]
  );

  return (
    <DropdownMenu modal={modal} open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <MediaPlayerTooltip tooltip="Settings">
        <DropdownMenuTrigger asChild>
          <Button type="button" aria-controls={context.mediaId} aria-label="Settings"
            data-disabled={isDisabled ? "" : undefined} data-slot="media-player-settings"
            disabled={isDisabled} {...settingsProps} variant="ghost" size="icon"
            className={cn("size-8 aria-[expanded=true]:bg-accent/50", className)}>
            <SettingsIcon />
          </Button>
        </DropdownMenuTrigger>
      </MediaPlayerTooltip>
      <DropdownMenuContent data-player-native-glass="" align="end" side="top" sideOffset={sideOffset}
        container={context.rootRef.current ?? context.portalContainer}
        aria-label="Playback settings"
        onInteractOutside={event => {
          // The timing picker is a sibling portalled dialog. Keep this menu
          // open while focus or the pointer moves into its controls.
          const target = event.target as HTMLElement;
          if (target.closest?.("[data-subtitle-timing]")) event.preventDefault();
        }}
        className={playerSettingsStyles.settingsMenu}>
        <DropdownMenuLabel className="sr-only">Playback settings</DropdownMenuLabel>
        <DropdownMenuGroup>
          <PlayerSettingsMenu speed={mediaPlaybackRate} speeds={speeds} onSpeedChange={onPlaybackRateChange}
            subtitleTiming={context.subtitleTiming}
            disabled={isDisabled} portalContainer={context.rootRef.current ?? context.portalContainer}
            quality={context.isVideo && mediaRenditionList.length > 0 ? {
              value: selectedRenditionId || "auto",
              onChange: onRenditionChange,
              options: [{ value: "auto", label: "Auto" }, ...mediaRenditionList.slice()
                .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
                .flatMap(rendition => rendition.id ? [{ value: rendition.id, label: rendition.height
                  ? `${rendition.height}p` : rendition.width ? `${rendition.width}p` : rendition.id }] : [])],
            } : undefined}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

}

interface MediaPlayerPortalProps {
  container?: Element | DocumentFragment | null;
  children?: React.ReactNode;
}

function MediaPlayerPortal(props: MediaPlayerPortalProps) {
  const { container: containerProp, children } = props;

  const context = useMediaPlayerContext("MediaPlayerPortal");
  const container = containerProp ?? context.portalContainer;

  if (!container) return null;

  return ReactDOM.createPortal(children, container);
}

interface MediaPlayerTooltipProps
  extends React.ComponentProps<typeof Tooltip>,
    Pick<React.ComponentProps<typeof TooltipContent>, "sideOffset"> {
  tooltip?: string;
  shortcut?: string | string[];
}

function MediaPlayerTooltip(props: MediaPlayerTooltipProps) {
  const {
    tooltip,
    shortcut,
    delayDuration,
    sideOffset,
    children,
    ...tooltipProps
  } = props;

  const context = useMediaPlayerContext("MediaPlayerTooltip");
  const tooltipDelayDuration = delayDuration ?? context.tooltipDelayDuration;
  const tooltipSideOffset = sideOffset ?? context.tooltipSideOffset;

  if ((!tooltip && !shortcut) || context.withoutTooltip) return <>{children}</>;

  return (
    <Tooltip {...tooltipProps} delayDuration={tooltipDelayDuration}>
      <TooltipTrigger
        className="text-foreground focus-visible:ring-ring/22"
        asChild
      >
        {children}
      </TooltipTrigger>
      <TooltipContent
        container={context.portalContainer}
        sideOffset={tooltipSideOffset}
        className="flex items-center gap-2 border px-2 py-1 data-[side=top]:mb-3.5 [&>span]:hidden"
      >
        <p>{tooltip}</p>
        {shortcut && (
          <KbdGroup>
            {(Array.isArray(shortcut) ? shortcut : [shortcut]).map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export {
  MediaPlayerRoot as MediaPlayer,
  MediaPlayerVideo,
  MediaPlayerAudio,
  MediaPlayerControls,
  MediaPlayerControlsOverlay,
  MediaPlayerLoading,
  MediaPlayerError,
  MediaPlayerVolumeIndicator,
  MediaPlayerPlay,
  MediaPlayerSeekBackward,
  MediaPlayerSeekForward,
  MediaPlayerSeek,
  MediaPlayerVolume,
  MediaPlayerTime,
  MediaPlayerPlaybackSpeed,
  MediaPlayerLoop,
  MediaPlayerFullscreen,
  MediaPlayerPiP,
  MediaPlayerCaptions,
  MediaPlayerDownload,
  MediaPlayerSettings,
  MediaPlayerPortal,
  MediaPlayerTooltip,
  //
  MediaPlayerRoot as Root,
  MediaPlayerVideo as Video,
  MediaPlayerAudio as Audio,
  MediaPlayerControls as Controls,
  MediaPlayerControlsOverlay as ControlsOverlay,
  MediaPlayerLoading as Loading,
  MediaPlayerVolumeIndicator as VolumeIndicator,
  MediaPlayerError as Error,
  MediaPlayerPlay as Play,
  MediaPlayerSeekBackward as SeekBackward,
  MediaPlayerSeekForward as SeekForward,
  MediaPlayerSeek as Seek,
  MediaPlayerVolume as Volume,
  MediaPlayerTime as Time,
  MediaPlayerPlaybackSpeed as PlaybackSpeed,
  MediaPlayerLoop as Loop,
  MediaPlayerFullscreen as Fullscreen,
  MediaPlayerPiP as PiP,
  MediaPlayerCaptions as Captions,
  MediaPlayerDownload as Download,
  MediaPlayerSettings as Settings,
  MediaPlayerPortal as Portal,
  MediaPlayerTooltip as Tooltip,
  //
  useMediaSelector as useMediaPlayer,
  useStoreSelector as useMediaPlayerStore,
};
