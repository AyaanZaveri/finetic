"use client";

import { Globe2 } from "lucide-react";
import { useSettings } from "@/contexts/settings-context";
import { PLAYBACK_LANGUAGES, PLAYBACK_LANGUAGE_LABELS } from "@/lib/media/playback-preferences";
import { trackFlagPath } from "@/lib/media/track-flags";
import { trackLanguage } from "@/lib/media/track-label";
import { Select } from "@/components/arc/select/select";
import { Switch } from "@/components/arc/switch/switch";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldContent } from "@/components/ui/field";
import styles from "@/app/(main)/settings/settings.module.css";

function languageOption(value: string) {
  const track = trackLanguage(value);
  return {
    value, label: PLAYBACK_LANGUAGE_LABELS[value] || (track.badge ? track.label : value.toUpperCase()),
    badge: track.badge || value.toUpperCase(), flag: track.flag || trackFlagPath(value), isLanguage: true,
  };
}
const languages = PLAYBACK_LANGUAGES.map(languageOption)
  .sort((a, b) => Number(b.value === "en") - Number(a.value === "en") || a.label.localeCompare(b.label));

function LanguageSelect({ id, label, value, onChange }: { id: string; label: string; value: string; onChange(value: string): void }) {
  const language = languageOption(value);
  // Retain a stored regional language (e.g. pt-BR) alongside the base languages.
  const options = languages.some(option => option.value === value) ? languages : [language, ...languages];
  return <Field>
    <Select id={id} label={label} value={value} onValueChange={onChange}
      options={options.map(option => ({
        ...option,
        icon: option.flag ? <img src={option.flag} width={18} height={12} alt="" draggable={false} className="h-3 w-[18px] shrink-0 rounded-[2px] object-contain" /> : <Globe2 aria-hidden="true" />,
      }))} />
  </Field>;
}

export function PlaybackLanguageSettings({ kind }: { kind: "audio" | "subtitles" }) {
  const { playbackPreferences: preferences, updatePlaybackPreferences: update } = useSettings();
  return <section aria-labelledby="playback-language-title" className={styles.section}>
    <h2 id="playback-language-title">{kind === "audio" ? "Languages" : "Defaults"}</h2>
    <FieldGroup className="min-w-0 gap-6">
      {kind === "audio" ? <LanguageSelect id="preferred-audio-language" label="Audio language" value={preferences.audioLanguage}
        onChange={audioLanguage => update({ audioLanguage })} /> : <>
      <LanguageSelect id="preferred-subtitle-language" label="Subtitle language" value={preferences.subtitleLanguage}
        onChange={subtitleLanguage => update({ subtitleLanguage })} />
      <Field><Select id="preferred-subtitle-type" label="Subtitle type" value={preferences.subtitleMode}
        options={[{ value: "normal", label: "Normal subtitles" }, { value: "forced", label: "Forced subtitles only" }]}
        onValueChange={value => update({ subtitleMode: value === "forced" ? "forced" : "normal" })} />
        {preferences.subtitleMode === "forced" && <FieldDescription>Foreign dialogue and on-screen text only.</FieldDescription>}
      </Field>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="subtitles-on-by-default">Subtitles on by default</FieldLabel>
        </FieldContent>
        <Switch id="subtitles-on-by-default" checked={preferences.subtitlesEnabledByDefault}
          onCheckedChange={subtitlesEnabledByDefault => update({ subtitlesEnabledByDefault })} />
      </Field>
      </>}
    </FieldGroup>
  </section>;
}
