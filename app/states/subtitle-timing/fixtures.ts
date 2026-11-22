export const groups = [
  { title: "Sync", states: [
    { id: "ready", label: "Original timing", seconds: 0, drift: 0, available: true },
    { id: "early", label: "Subtitles early", seconds: 0, drift: -1.4, available: true },
    { id: "late", label: "Subtitles late", seconds: 0, drift: 1.4, available: true },
    { id: "limit", label: "Delay limit", seconds: 30, drift: -31.4, available: true },
  ] },
  { title: "Availability", states: [
    { id: "unavailable", label: "Timing unavailable", seconds: 0, drift: 0, available: false },
  ] },
] as const;

export const states = groups.flatMap(group => [...group.states]);
export type State = (typeof states)[number];
export const cues = [
  { at: 4, text: "The trail goes over the ridge." },
  { at: 10, text: "We should reach the lake before dark." },
  { at: 16, text: "There’s a clearing just ahead." },
  { at: 22, text: "Listen. The wind has picked up." },
  { at: 28, text: "Let’s stop here for a minute." },
  { at: 34, text: "The others are catching up." },
];
