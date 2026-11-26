"use client";

import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettings } from "@/contexts/settings-context";
import { PlaybackLanguageSettings } from "./playback-language-settings";
import { MediaFlowSettings } from "./settings/mediaflow-settings";
import { NumberField } from "@/components/arc/number-field/number-field";
import { Switch } from "@/components/arc/switch/switch";
import { Field, FieldGroup, FieldLabel, FieldContent, FieldDescription } from "@/components/ui/field";
import { desktopBridge, type DesktopBridge } from "@/lib/desktop/bridge";
import { KEYBOARD_SEEK_SECONDS } from "@/lib/media/playback-preferences";
import styles from "@/app/(main)/settings/settings.module.css";

const seekFieldProps = {
  suffix: (seconds: number) => seconds === 1 ? " second" : " seconds",
  min: KEYBOARD_SEEK_SECONDS.min,
  max: KEYBOARD_SEEK_SECONDS.max,
  step: 1,
  size: "sm",
} as const;

const defaultSeek = {
  keyboardSeekBackwardSeconds: KEYBOARD_SEEK_SECONDS.default,
  keyboardSeekForwardSeconds: KEYBOARD_SEEK_SECONDS.default,
};
const seekResetLabel = `Reset both skips to ${KEYBOARD_SEEK_SECONDS.default} seconds`;

export function PlaybackSettings() {
  const { playbackPreferences, updatePlaybackPreferences } = useSettings();
  const [desktop, setDesktop] = useState<DesktopBridge>();
  useEffect(() => setDesktop(desktopBridge()), []);
  const hdrBrightnessDisabled = !playbackPreferences.webGpuPlayback || !playbackPreferences.hdrOutput;
  const automaticNativePeak = playbackPreferences.nativeHdrPeakNits === null;
  const seekIsDefault = playbackPreferences.keyboardSeekBackwardSeconds === defaultSeek.keyboardSeekBackwardSeconds
    && playbackPreferences.keyboardSeekForwardSeconds === defaultSeek.keyboardSeekForwardSeconds;
  return <>
    <section aria-labelledby="playback-episodes" className={styles.section}>
      <h2 id="playback-episodes">Episodes</h2>
      <FieldGroup className={styles.episodeOptions}>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="episode-autoplay">Autoplay next episode</FieldLabel>
          </FieldContent>
          <Switch id="episode-autoplay" checked={playbackPreferences.episodeAutoplay}
            onCheckedChange={episodeAutoplay => updatePlaybackPreferences({ episodeAutoplay })} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="episode-prefetch">Preload next episode</FieldLabel>
          </FieldContent>
          <Switch id="episode-prefetch" checked={playbackPreferences.episodePrefetch}
            onCheckedChange={episodePrefetch => updatePlaybackPreferences({ episodePrefetch })} />
        </Field>
      </FieldGroup>
    </section>
    <PlaybackLanguageSettings kind="audio" />
    <section aria-labelledby="playback-seeking" className={styles.section}>
      <h2 id="playback-seeking">Seeking</h2>
      <div className="flex flex-wrap items-end gap-3">
        <FieldGroup className={styles.seekOptions}>
          <NumberField {...seekFieldProps} id="keyboard-seek-backward" label="Skip backward"
            labelAdornment={<><Kbd aria-hidden="true"><ArrowLeft /></Kbd><span className="sr-only">Left arrow key</span></>}
            value={playbackPreferences.keyboardSeekBackwardSeconds}
            onValueChange={keyboardSeekBackwardSeconds => updatePlaybackPreferences({ keyboardSeekBackwardSeconds })} />
          <NumberField {...seekFieldProps} id="keyboard-seek-forward" label="Skip forward"
            labelAdornment={<><Kbd aria-hidden="true"><ArrowRight /></Kbd><span className="sr-only">Right arrow key</span></>}
            value={playbackPreferences.keyboardSeekForwardSeconds}
            onValueChange={keyboardSeekForwardSeconds => updatePlaybackPreferences({ keyboardSeekForwardSeconds })} />
        </FieldGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="sm"
              className={`${styles.seekReset} rounded-(--radius-control) aria-disabled:opacity-50 aria-disabled:hover:bg-(--surface) aria-disabled:hover:shadow-none`}
              aria-label={seekResetLabel} aria-disabled={seekIsDefault}
              onClick={() => updatePlaybackPreferences(defaultSeek)}>
              <RotateCcw aria-hidden="true" />
              <span>Reset both</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>{seekResetLabel}</TooltipContent>
        </Tooltip>
      </div>
    </section>
    <section aria-labelledby="playback-startup" className={styles.section}>
      <h2 id="playback-startup">Loading and recovery</h2>
      <FieldGroup className="min-w-0 gap-6">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="metadata-prefetch">Preload title details</FieldLabel>
          </FieldContent>
          <Switch id="metadata-prefetch" checked={playbackPreferences.metadataPrefetch}
            onCheckedChange={metadataPrefetch => updatePlaybackPreferences({ metadataPrefetch })} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="continue-watching-prefetch">Preload Continue Watching</FieldLabel>
            <FieldDescription id="continue-watching-prefetch-description">Find streams before you resume</FieldDescription>
          </FieldContent>
          <Switch id="continue-watching-prefetch" aria-describedby="continue-watching-prefetch-description" checked={playbackPreferences.continueWatchingPrefetch}
            onCheckedChange={continueWatchingPrefetch => updatePlaybackPreferences({ continueWatchingPrefetch })} />
        </Field>
        {!desktop && <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="automatic-web-stream">Automatically find a playable stream</FieldLabel>
            <FieldDescription id="automatic-web-stream-description">Try another stream if playback fails or the audio is unsupported</FieldDescription>
          </FieldContent>
          <Switch id="automatic-web-stream" aria-describedby="automatic-web-stream-description" checked={playbackPreferences.autoSelectWebStream}
            onCheckedChange={autoSelectWebStream => updatePlaybackPreferences({ autoSelectWebStream })} />
        </Field>}
      </FieldGroup>
    </section>
    {!desktop && <MediaFlowSettings />}
    {desktop ? (desktop.platform === "macos" || desktop.platform === "windows") && <section aria-labelledby="playback-video" className={styles.section}>
      <h2 id="playback-video">Native HDR</h2>
      <p className={styles.description}>HDR turns on for supported videos and displays</p>
      {(desktop.capabilities?.nativeHdrPeak || desktop.capabilities?.macHdrPeak) && <FieldGroup className="min-w-0 gap-6">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="native-hdr-auto">Automatic HDR peak brightness</FieldLabel>
            <FieldDescription id="native-hdr-auto-description">Use the system’s HDR peak. Changes apply to the next video.</FieldDescription>
          </FieldContent>
          <Switch id="native-hdr-auto" aria-describedby="native-hdr-auto-description" checked={automaticNativePeak}
            onCheckedChange={automatic => updatePlaybackPreferences({ nativeHdrPeakNits: automatic ? null : 1000 })} />
        </Field>
        {!automaticNativePeak && <NumberField id="native-hdr-peak-nits" label="Native HDR peak brightness" suffix=" nits"
          description="Set a tone-mapping target within your display’s HDR range"
          min={203} max={10000} step={1} buttonStep={50} largeStep={100} size="sm"
          value={playbackPreferences.nativeHdrPeakNits ?? 1000}
          onValueChange={nativeHdrPeakNits => updatePlaybackPreferences({ nativeHdrPeakNits })} />}
      </FieldGroup>}
    </section> : <section aria-labelledby="playback-video" className={styles.section}>
      <h2 id="playback-video">Video and HDR</h2>
      <p className={styles.description}>Changes apply to the next video</p>
      <FieldGroup className="min-w-0 gap-6">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="webgpu-playback">WebGPU playback</FieldLabel>
          </FieldContent>
          <Switch id="webgpu-playback" checked={playbackPreferences.webGpuPlayback}
            onCheckedChange={webGpuPlayback => updatePlaybackPreferences({ webGpuPlayback })} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="webgpu-native-decoding">Browser decoding with WebGPU</FieldLabel>
            <FieldDescription id="webgpu-native-decoding-description">Experimental. Turn off HDR output and use a supported audio format.</FieldDescription>
          </FieldContent>
          <Switch id="webgpu-native-decoding" aria-describedby="webgpu-native-decoding-description" checked={playbackPreferences.nativeWebGpuDecoding}
            disabled={!playbackPreferences.webGpuPlayback || playbackPreferences.hdrOutput}
            onCheckedChange={nativeWebGpuDecoding => updatePlaybackPreferences({ nativeWebGpuDecoding })} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="hdr-output">HDR output</FieldLabel>
            <FieldDescription id="hdr-output-description">Requires WebGPU and a compatible browser and display. Falls back to SDR.</FieldDescription>
          </FieldContent>
          <Switch id="hdr-output" aria-describedby="hdr-output-description" checked={playbackPreferences.hdrOutput}
            disabled={!playbackPreferences.webGpuPlayback}
            onCheckedChange={hdrOutput => updatePlaybackPreferences({ hdrOutput })} />
        </Field>
        <div className="flex flex-col gap-2 border-l-2 pl-4">
          <NumberField id="hdr-peak-nits" label="HDR peak brightness" suffix=" nits"
            description="Match your display’s HDR peak. The default is 1,000 nits."
            min={203} max={10000} step={1} buttonStep={50} largeStep={100} size="sm"
            disabled={hdrBrightnessDisabled}
            value={playbackPreferences.hdrPeakNits}
            onValueChange={hdrPeakNits => updatePlaybackPreferences({ hdrPeakNits })}
            trailingAction={
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="outline" size="icon"
                    className="size-(--control-height-sm) rounded-(--radius-control) aria-disabled:opacity-50"
                    aria-label="Reset peak brightness to 1,000 nits"
                    aria-disabled={hdrBrightnessDisabled || playbackPreferences.hdrPeakNits === 1000}
                    onClick={() => updatePlaybackPreferences({ hdrPeakNits: 1000 })}>
                    <RotateCcw aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent sideOffset={6}>Reset to 1,000 nits</TooltipContent>
              </Tooltip>
            } />
        </div>
      </FieldGroup>
    </section>}
  </>;
}
