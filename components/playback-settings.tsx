"use client";

import { useSettings } from "@/contexts/settings-context";
import { NumberField } from "@/components/arc/number-field/number-field";
import { Switch } from "@/components/arc/switch/switch";
import { Field, FieldGroup, FieldLabel, FieldContent, FieldDescription } from "@/components/ui/field";
import styles from "@/app/(main)/settings/settings.module.css";

export function PlaybackSettings() {
  const { playbackPreferences, updatePlaybackPreferences } = useSettings();
  return <section aria-label="Playback" className={styles.section}>
    <FieldGroup className="min-w-0 gap-6">
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="webgpu-playback">WebGPU playback</FieldLabel>
          <FieldDescription id="webgpu-playback-description">Use WebGPU for supported video files in the browser. Applies to the next video.</FieldDescription>
        </FieldContent>
        <Switch id="webgpu-playback" aria-describedby="webgpu-playback-description" checked={playbackPreferences.webGpuPlayback}
          onCheckedChange={webGpuPlayback => updatePlaybackPreferences({ webGpuPlayback })} />
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="hdr-output">HDR output</FieldLabel>
          <FieldDescription id="hdr-output-description">Use HDR with WebGPU on compatible browsers and displays. Other displays use SDR tone mapping. Applies to the next video.</FieldDescription>
        </FieldContent>
        <Switch id="hdr-output" aria-describedby="hdr-output-description" checked={playbackPreferences.hdrOutput}
          disabled={!playbackPreferences.webGpuPlayback}
          onCheckedChange={hdrOutput => updatePlaybackPreferences({ hdrOutput })} />
      </Field>
      <NumberField id="hdr-peak-nits" label="HDR peak brightness" suffix=" nits"
        description="Set this to your display's peak HDR brightness. Default: 1,000 nits. Applies to the next video."
        min={203} max={10000} step={1} largeStep={100} size="sm"
        disabled={!playbackPreferences.webGpuPlayback || !playbackPreferences.hdrOutput}
        value={playbackPreferences.hdrPeakNits}
        onValueChange={hdrPeakNits => updatePlaybackPreferences({ hdrPeakNits })} />
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="metadata-prefetch">Preload metadata</FieldLabel>
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
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="automatic-web-stream">Automatically find a playable stream</FieldLabel>
          <FieldDescription id="automatic-web-stream-description">On web, try other streams if playback fails or audio is unsupported.</FieldDescription>
        </FieldContent>
        <Switch id="automatic-web-stream" aria-describedby="automatic-web-stream-description" checked={playbackPreferences.autoSelectWebStream}
          onCheckedChange={autoSelectWebStream => updatePlaybackPreferences({ autoSelectWebStream })} />
      </Field>
    </FieldGroup>
  </section>;
}
