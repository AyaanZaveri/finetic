export const narratedSample = "/images/subtitle-timing-demo.mp4";

export const timingStates = [
    { id: "timing-ready", label: "Original timing", seconds: 0, drift: 0, available: true },
    { id: "timing-early", label: "Subtitles early", seconds: 0, drift: -1.4, available: true },
    { id: "timing-late", label: "Subtitles late", seconds: 0, drift: 1.4, available: true },
    { id: "timing-limit", label: "Delay limit", seconds: 30, drift: -31.4, available: true },
    { id: "timing-unavailable", label: "Timing unavailable", seconds: 0, drift: 0, available: false },
] as const;

// These cues follow the narration in the demo clip.
const cues = [
    { at: 4, text: "The trail goes over the ridge." },
    { at: 10, text: "We should reach the lake before dark." },
    { at: 16, text: "There’s a clearing just ahead." },
    { at: 22, text: "Listen. The wind has picked up." },
    { at: 28, text: "Let’s stop here for a minute." },
    { at: 34, text: "The others are catching up." },
].map(cue => ({ ...cue, positionTop: false }));

export function narrationSubtitleAt(time: number) {
    return cues.find(cue => time >= cue.at && time < cue.at + 2.3) ?? null;
}
