import { createMediaStore } from "media-chrome/media-store/media-store";
import { stateMediator } from "media-chrome/media-store/state-mediator";
import { desktopBridge } from "../desktop/bridge";

export function createPlayerMediaStore() {
  const native = desktopBridge();
  return createMediaStore({
    documentElement: native ? undefined : globalThis.document,
    stateMediator: {
      ...stateMediator,
      mediaCurrentTime: {
        ...stateMediator.mediaCurrentTime,
        mediaEvents: [...(stateMediator.mediaCurrentTime.mediaEvents ?? []), "emptied"],
      },
      mediaSeekable: {
        ...stateMediator.mediaSeekable,
        // WebGPU and native playback can expose the range with a late duration.
        mediaEvents: [...(stateMediator.mediaSeekable.mediaEvents ?? []), "durationchange"],
      },
      // Native fullscreen keeps the video and web view in the same OS window.
      ...(native && {
        mediaIsFullscreen: {
          get: () => native.fullscreen,
          set: (value: boolean) => native.send({ type: "fullscreen", value }),
          rootEvents: ["navigatorfullscreenchange"],
        },
        mediaFullscreenUnavailable: { get: () => undefined },
      }),
    },
  });
}
