export const SUBTITLE_SIZES = [
  { value: "small", label: "Small" },
  { value: "standard", label: "Standard" },
  { value: "large", label: "Large" },
] as const;
export const SUBTITLE_OUTLINES = [
  { value: "thin", label: "Thin" },
  { value: "strong", label: "Strong" },
  { value: "none", label: "None" },
] as const;
export type SubtitleSize = typeof SUBTITLE_SIZES[number]["value"];
export type SubtitleOutline = typeof SUBTITLE_OUTLINES[number]["value"];

export function stepSubtitleSize(size: SubtitleSize, direction: -1 | 1): SubtitleSize {
  const index = SUBTITLE_SIZES.findIndex(option => option.value === size);
  return SUBTITLE_SIZES[index + direction]?.value ?? size;
}

export const SUBTITLE_WEIGHTS = [
  { value: "regular", label: "Regular" },
  { value: "medium", label: "Medium" },
  { value: "semibold", label: "Semibold" },
  { value: "bold", label: "Bold" },
] as const;
export const SUBTITLE_COLORS = [
  { value: "white", label: "White", color: "#ffffff" },
  { value: "warm-white", label: "Warm white", color: "#fff4dc" },
  { value: "yellow", label: "Yellow", color: "#ffe45c" },
  { value: "light-blue", label: "Light blue", color: "#bde7ff" },
] as const;
export type SubtitleWeight = typeof SUBTITLE_WEIGHTS[number]["value"];
export type SubtitleColor = typeof SUBTITLE_COLORS[number]["value"];

export const SUBTITLE_POSITION = { min: 5, max: 30, default: 10 } as const;
export function normalizeSubtitlePosition(value: number): number {
  return Number.isFinite(value)
    ? Math.round(Math.min(SUBTITLE_POSITION.max, Math.max(SUBTITLE_POSITION.min, value)))
    : SUBTITLE_POSITION.default;
}
