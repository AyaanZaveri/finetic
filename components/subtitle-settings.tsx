"use client";

import { useSettings } from "@/contexts/settings-context";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/arc/select/select";
import { Slider } from "@/components/arc/slider/slider";
import { SUBTITLE_POSITION } from "@/lib/subtitle-appearance";
import Image from "next/image";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { SubtitleText } from "@/components/subtitle-text";
import { SUBTITLE_OUTLINES, SUBTITLE_SIZES, SUBTITLE_WEIGHTS, SUBTITLE_COLORS, type SubtitleOutline, type SubtitleSize, type SubtitleWeight, type SubtitleColor } from "@/lib/subtitle-appearance";
import styles from "@/app/(main)/settings/settings.module.css";

export function SubtitleSettings() {
  const { subtitleSize, setSubtitleSize, subtitleOutline, setSubtitleOutline, subtitleWeight, setSubtitleWeight, subtitleColor, setSubtitleColor, subtitlePosition, setSubtitlePosition, resetSubtitleAppearance } = useSettings();
  return <section aria-labelledby="subtitle-appearance-title" className={`${styles.section} ${styles.subtitleSettings}`}>
    <h2 id="subtitle-appearance-title">Appearance</h2>
    <FieldGroup className="min-w-0">
      <figure className={styles.subtitlePreviewFigure} aria-labelledby="subtitle-preview-title">
        <div className={styles.subtitlePreview}>
          <Image src="/images/subtitle-preview.jpg" alt="" fill unoptimized
            sizes="(max-width: 680px) 100vw, 680px" className={styles.subtitlePreviewImage} />
          <SubtitleText size={subtitleSize} outline={subtitleOutline} weight={subtitleWeight} color={subtitleColor} style={{ bottom: `${subtitlePosition}%` }} className={styles.subtitlePreviewText}>
            {"Every story\nstarts somewhere."}
          </SubtitleText>
        </div>
        <figcaption id="subtitle-preview-title" className="sr-only">Subtitle preview</figcaption>
      </figure>
      <Field>
        <FieldLabel asChild><span>Text size</span></FieldLabel>
        <div className="flex"><SegmentedControl label="Subtitle text size" value={subtitleSize}
          onValueChange={value => setSubtitleSize(value as SubtitleSize)} options={[...SUBTITLE_SIZES]} /></div>
      </Field>
      <FieldGroup className={styles.pairedFields}>
        <Field><Select id="subtitle-weight" label="Font weight" value={subtitleWeight}
          options={[...SUBTITLE_WEIGHTS]} onValueChange={value => setSubtitleWeight(value as SubtitleWeight)} /></Field>
        <Field><Select id="subtitle-color" label="Text color" value={subtitleColor}
          options={SUBTITLE_COLORS.map(({ value, label, color }) => ({ value, label,
            icon: <span aria-hidden="true" className={styles.subtitleSwatch} style={{ backgroundColor: color }} /> }))}
          onValueChange={value => setSubtitleColor(value as SubtitleColor)} /></Field>
      </FieldGroup>
      <Field>
        <FieldLabel asChild><span>Outline</span></FieldLabel>
        <div className="flex"><SegmentedControl label="Subtitle outline" value={subtitleOutline}
          onValueChange={value => setSubtitleOutline(value as SubtitleOutline)} options={[...SUBTITLE_OUTLINES]} /></div>
      </Field>
      <Field>
        <Slider label="Position from bottom" value={subtitlePosition} onValueChange={setSubtitlePosition}
          min={SUBTITLE_POSITION.min} max={SUBTITLE_POSITION.max} step={1} largeStep={5} format={value => `${value}%`} />
        <FieldDescription>Captions set to appear at the top stay there.</FieldDescription>
      </Field>
      <div className="flex"><Button type="button" variant="ghost" size="sm" onClick={resetSubtitleAppearance}
        disabled={subtitleSize === "standard" && subtitleOutline === "thin" && subtitleWeight === "medium" && subtitleColor === "white" && subtitlePosition === SUBTITLE_POSITION.default}>
        Reset to defaults
      </Button></div>
    </FieldGroup>
  </section>;
}
