"use client";

import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/contexts/settings-context";
import { mediaFlowBaseUrl } from "@/lib/media/mediaflow-url";
import styles from "@/app/(main)/settings/settings.module.css";

const modes = [
  { value: "off", label: "Off" },
  { value: "in-house", label: "In-house" },
  { value: "custom", label: "Custom" },
];

export function MediaFlowSettings() {
  const { playbackPreferences: { mediaFlowMode, mediaFlowUrl, mediaFlowPassword }, updatePlaybackPreferences } = useSettings();
  const invalidUrl = Boolean(mediaFlowUrl.trim()) && !mediaFlowBaseUrl(mediaFlowUrl);
  return <section aria-labelledby="playback-mediaflow" className={styles.section}>
    <h2 id="playback-mediaflow">MediaFlow Proxy</h2>
    <p className={styles.description}>Route video streams through a proxy for cross-origin browser playback. Changes apply to the next video.</p>
    <FieldGroup className="min-w-0 gap-4">
      <div className="flex">
        <SegmentedControl label="MediaFlow Proxy" options={modes} value={mediaFlowMode}
          onValueChange={value => {
            if (value === "off" || value === "in-house" || value === "custom") updatePlaybackPreferences({ mediaFlowMode: value });
          }} />
      </div>
      {mediaFlowMode === "in-house" && <p className={styles.description}>Use Navigator’s hosted MediaFlow proxy.</p>}
      {mediaFlowMode === "custom" && <>
        <Field>
          <FieldLabel htmlFor="mediaflow-url">Proxy URL</FieldLabel>
          <Input id="mediaflow-url" dir="ltr" type="url" placeholder="https://mediaflow.example.com"
            autoComplete="off" spellCheck={false} maxLength={2048} value={mediaFlowUrl}
            aria-invalid={invalidUrl || undefined} aria-describedby="mediaflow-url-description"
            onChange={event => updatePlaybackPreferences({ mediaFlowUrl: event.target.value })} />
          <FieldDescription id="mediaflow-url-description" className={invalidUrl ? "text-destructive" : undefined}>
            {invalidUrl ? "Enter a valid HTTP or HTTPS address without a query or password." : "Use the base address of your MediaFlow server."}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="mediaflow-password">API password</FieldLabel>
          <Input id="mediaflow-password" type="password" autoComplete="off" maxLength={1024}
            value={mediaFlowPassword} onChange={event => updatePlaybackPreferences({ mediaFlowPassword: event.target.value })}
            aria-describedby="mediaflow-password-description" />
          <FieldDescription id="mediaflow-password-description">Leave blank if your proxy does not require a password.</FieldDescription>
        </Field>
      </>}
    </FieldGroup>
  </section>;
}
