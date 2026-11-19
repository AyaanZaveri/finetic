"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSettings } from "@/contexts/settings-context";
import { PlaybackLanguageSettings } from "./playback-language-settings";
import { NumberField } from "@/components/arc/number-field/number-field";
import { Switch } from "@/components/arc/switch/switch";
import { Field, FieldGroup, FieldLabel, FieldContent, FieldDescription } from "@/components/ui/field";
import { desktopBridge, type DesktopBridge } from "@/lib/desktop/bridge";
import styles from "@/app/(main)/settings/settings.module.css";

export function PlaybackSettings() {
  const { playbackPreferences, updatePlaybackPreferences } = useSettings();
  const [desktop, setDesktop] = useState<DesktopBridge>();
  useEffect(() => setDesktop(desktopBridge()), []);
  const hdrBrightnessDisabled = !playbackPreferences.webGpuPlayback || !playbackPreferences.hdrOutput;
  const automaticMacPeak = playbackPreferences.macHdrPeakNits === null;
  return <>
    <section aria-labelledby="playback-episodes" className={styles.section}>
      <h2 id="playback-episodes" className="text-lg font-medium">Episodes</h2>
      <FieldGroup className="min-w-0 gap-6">
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
    <section aria-labelledby="playback-startup" className={styles.section}>
      <h2 id="playback-startup" className="text-lg font-medium">Startup and recovery</h2>
      <FieldGroup className="min-w-0 gap-6">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="metadata-prefetch">Preload title details</FieldLabel>
            <FieldDescription id="metadata-prefetch-description">Prepare title details and episode names in the background.</FieldDescription>
          </FieldContent>
          <Switch id="metadata-prefetch" aria-describedby="metadata-prefetch-description" checked={playbackPreferences.metadataPrefetch}
            onCheckedChange={metadataPrefetch => updatePlaybackPreferences({ metadataPrefetch })} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="continue-watching-prefetch">Preload Continue Watching</FieldLabel>
            <FieldDescription id="continue-watching-prefetch-description">Find streams in the background so you can resume sooner.</FieldDescription>
          </FieldContent>
          <Switch id="continue-watching-prefetch" aria-describedby="continue-watching-prefetch-description" checked={playbackPreferences.continueWatchingPrefetch}
            onCheckedChange={continueWatchingPrefetch => updatePlaybackPreferences({ continueWatchingPrefetch })} />
        </Field>
        {!desktop && <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="automatic-web-stream">Automatically find a playable stream</FieldLabel>
            <FieldDescription id="automatic-web-stream-description">On web, try other streams if playback fails or audio is unsupported.</FieldDescription>
          </FieldContent>
          <Switch id="automatic-web-stream" aria-describedby="automatic-web-stream-description" checked={playbackPreferences.autoSelectWebStream}
            onCheckedChange={autoSelectWebStream => updatePlaybackPreferences({ autoSelectWebStream })} />
        </Field>}
      </FieldGroup>
    </section>
    {desktop ? desktop.platform === "macos" && <section aria-labelledby="playback-video" className={styles.section}>
      <h2 id="playback-video" className="text-lg font-medium">Native HDR</h2>
      <p className={styles.credits}>Navigator uses macOS HDR for compatible videos and displays.</p>
      {desktop.capabilities?.macHdrPeak && <FieldGroup className="min-w-0 gap-6">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="mac-hdr-auto">Automatic HDR peak brightness</FieldLabel>
            <FieldDescription id="mac-hdr-auto-description">Use the display’s current HDR headroom. Changes apply to the next video.</FieldDescription>
          </FieldContent>
          <Switch id="mac-hdr-auto" aria-describedby="mac-hdr-auto-description" checked={automaticMacPeak}
            onCheckedChange={automatic => updatePlaybackPreferences({ macHdrPeakNits: automatic ? null : 1000 })} />
        </Field>
        {!automaticMacPeak && <NumberField id="mac-hdr-peak-nits" label="Native HDR peak brightness" suffix=" nits"
          description="Set a tone-mapping target up to the display’s HDR capability. macOS controls the brightness the display can deliver."
          min={203} max={10000} step={1} buttonStep={50} largeStep={100} size="sm"
          value={playbackPreferences.macHdrPeakNits ?? 1000}
          onValueChange={macHdrPeakNits => updatePlaybackPreferences({ macHdrPeakNits })} />}
      </FieldGroup>}
    </section> : <section aria-labelledby="playback-video" className={styles.section}>
      <h2 id="playback-video" className="text-lg font-medium">Video and HDR</h2>
      <p className={styles.credits}>Changes in this section apply to the next video.</p>
      <FieldGroup className="min-w-0 gap-6">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="webgpu-playback">WebGPU playback</FieldLabel>
            <FieldDescription id="webgpu-playback-description">Use WebGPU for supported video files in the browser.</FieldDescription>
          </FieldContent>
          <Switch id="webgpu-playback" aria-describedby="webgpu-playback-description" checked={playbackPreferences.webGpuPlayback}
            onCheckedChange={webGpuPlayback => updatePlaybackPreferences({ webGpuPlayback })} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="webgpu-native-decoding">Browser decoding with WebGPU</FieldLabel>
            <FieldDescription id="webgpu-native-decoding-description">Experimental. Try browser decoding when HDR output is off and the browser supports the audio.</FieldDescription>
          </FieldContent>
          <Switch id="webgpu-native-decoding" aria-describedby="webgpu-native-decoding-description" checked={playbackPreferences.nativeWebGpuDecoding}
            disabled={!playbackPreferences.webGpuPlayback || playbackPreferences.hdrOutput}
            onCheckedChange={nativeWebGpuDecoding => updatePlaybackPreferences({ nativeWebGpuDecoding })} />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="hdr-output">HDR output</FieldLabel>
            <FieldDescription id="hdr-output-description">Use HDR with WebGPU on compatible browsers and displays. Other displays use SDR tone mapping.</FieldDescription>
          </FieldContent>
          <Switch id="hdr-output" aria-describedby="hdr-output-description" checked={playbackPreferences.hdrOutput}
            disabled={!playbackPreferences.webGpuPlayback}
            onCheckedChange={hdrOutput => updatePlaybackPreferences({ hdrOutput })} />
        </Field>
        <div className="flex flex-col gap-2 border-l-2 pl-4">
          <NumberField id="hdr-peak-nits" label="HDR peak brightness" suffix=" nits"
            description="Set this to your display's peak HDR brightness. Default: 1,000 nits."
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
