import { KEYBOARD_SEEK_STEP } from "./keyboard-scrubbing";

export const KEYBOARD_SEEK_SECONDS = { min: 1, max: 60, default: KEYBOARD_SEEK_STEP } as const;

export interface PlaybackPreferences {
  keyboardSeekBackwardSeconds: number;
  keyboardSeekForwardSeconds: number;
  continueWatchingPrefetch: boolean;
  metadataPrefetch: boolean;
  episodeAutoplay: boolean;
  episodePrefetch: boolean;
  autoSelectWebStream: boolean;
  webGpuPlayback: boolean;
  nativeWebGpuDecoding: boolean;
  hdrOutput: boolean;
  hdrPeakNits: number;
  nativeHdrPeakNits: number | null;
  audioLanguage: string;
  subtitleLanguage: string;
  subtitleMode: "normal" | "forced";
  subtitlesEnabledByDefault: boolean;
}
export const DEFAULT_PLAYBACK_PREFERENCES: PlaybackPreferences = {
  keyboardSeekBackwardSeconds: KEYBOARD_SEEK_SECONDS.default,
  keyboardSeekForwardSeconds: KEYBOARD_SEEK_SECONDS.default,
  continueWatchingPrefetch: true, metadataPrefetch: true,
  episodeAutoplay: true, episodePrefetch: true,
  autoSelectWebStream: false, webGpuPlayback: true, nativeWebGpuDecoding: false, hdrOutput: false, hdrPeakNits: 1000, nativeHdrPeakNits: null,
  audioLanguage: "en", subtitleLanguage: "en", subtitleMode: "normal", subtitlesEnabledByDefault: false,
};
export const PLAYBACK_PREFERENCES_KEY = "navigator-playback-preferences";
// Retain valid preferences from earlier versions without offering every ISO code.
const supportedLanguageCodes = "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(" ");
// A practical shortlist for playback preferences. Explicit names keep this
// menu usable even in browsers with a smaller Intl.DisplayNames database.
export const PLAYBACK_LANGUAGE_LABELS: Record<string, string> = {
  en: "English", ar: "Arabic", bn: "Bengali", bs: "Bosnian", bg: "Bulgarian",
  ca: "Catalan", zh: "Chinese", hr: "Croatian", cs: "Czech", da: "Danish",
  nl: "Dutch", et: "Estonian", fi: "Finnish", fr: "French", de: "German",
  el: "Greek", he: "Hebrew", hi: "Hindi", hu: "Hungarian", is: "Icelandic",
  id: "Indonesian", it: "Italian", ja: "Japanese", ko: "Korean", lv: "Latvian",
  lt: "Lithuanian", ms: "Malay", no: "Norwegian", fa: "Persian", pl: "Polish",
  pt: "Portuguese", "pt-BR": "Portuguese (Brazil)", ro: "Romanian", ru: "Russian",
  sr: "Serbian", sk: "Slovak", sl: "Slovenian", es: "Spanish", sv: "Swedish",
  tl: "Tagalog", ta: "Tamil", te: "Telugu", th: "Thai", tr: "Turkish",
  uk: "Ukrainian", ur: "Urdu", vi: "Vietnamese",
};
export const PLAYBACK_LANGUAGES = Object.keys(PLAYBACK_LANGUAGE_LABELS);
function language(value: unknown): string {
  if (typeof value !== "string") return "en";
  try {
    const canonical = Intl.getCanonicalLocales(value.trim().replaceAll("_", "-"))[0];
    return canonical && supportedLanguageCodes.includes(canonical.split("-")[0]) ? canonical : "en";
  } catch { return "en"; }
}
function normalizeSeekSeconds(value: unknown) {
  const { min, max, default: defaultSeconds } = KEYBOARD_SEEK_SECONDS;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(min, Math.min(max, value)))
    : defaultSeconds;
}
export function normalizePlaybackPreferences(value: unknown): PlaybackPreferences {
  const candidate = value && typeof value === "object"
    ? value as Partial<PlaybackPreferences> & { macHdrPeakNits?: unknown; keyboardSeekSeconds?: unknown }
    : {};
  const nativePeak = candidate.nativeHdrPeakNits === undefined ? candidate.macHdrPeakNits : candidate.nativeHdrPeakNits;
  return {
    keyboardSeekBackwardSeconds: normalizeSeekSeconds(candidate.keyboardSeekBackwardSeconds ?? candidate.keyboardSeekSeconds),
    keyboardSeekForwardSeconds: normalizeSeekSeconds(candidate.keyboardSeekForwardSeconds ?? candidate.keyboardSeekSeconds),
    continueWatchingPrefetch: candidate.continueWatchingPrefetch !== false, metadataPrefetch: candidate.metadataPrefetch !== false,
    episodeAutoplay: candidate.episodeAutoplay !== false,
    episodePrefetch: candidate.episodePrefetch !== false,
    autoSelectWebStream: candidate.autoSelectWebStream === true,
    webGpuPlayback: candidate.webGpuPlayback !== false,
    nativeWebGpuDecoding: candidate.nativeWebGpuDecoding === true,
    hdrOutput: candidate.hdrOutput === true,
    hdrPeakNits: typeof candidate.hdrPeakNits === "number" && Number.isFinite(candidate.hdrPeakNits)
      ? Math.round(Math.max(203, Math.min(10000, candidate.hdrPeakNits))) : 1000,
    nativeHdrPeakNits: typeof nativePeak === "number" && Number.isFinite(nativePeak)
      ? Math.round(Math.max(203, Math.min(10000, nativePeak))) : null,
    audioLanguage: language(candidate.audioLanguage), subtitleLanguage: language(candidate.subtitleLanguage),
    subtitleMode: candidate.subtitleMode === "forced" ? "forced" : "normal",
    subtitlesEnabledByDefault: candidate.subtitlesEnabledByDefault === true,
  };
}
let memory = { ...DEFAULT_PLAYBACK_PREFERENCES };
export function readPlaybackPreferences(): PlaybackPreferences {
  let stored: string | null;
  try { stored = localStorage.getItem(PLAYBACK_PREFERENCES_KEY); }
  catch { return { ...memory }; }
  try { return stored ? normalizePlaybackPreferences(JSON.parse(stored)) : { ...DEFAULT_PLAYBACK_PREFERENCES }; }
  catch { return { ...DEFAULT_PLAYBACK_PREFERENCES }; }
}
export function savePlaybackPreferences(value: PlaybackPreferences) {
  memory = normalizePlaybackPreferences(value);
  try { localStorage.setItem(PLAYBACK_PREFERENCES_KEY, JSON.stringify(memory)); } catch { /* Keep session preferences if storage is unavailable. */ }
}
