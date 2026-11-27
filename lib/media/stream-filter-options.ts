export const streamFilterGroups = [
  { label: "Resolution", options: [
    { value: "2160p", label: "2160p" },
    { value: "1440p", label: "1440p" },
    { value: "1080p", label: "1080p" },
    { value: "720p", label: "720p" },
    { value: "480p", label: "480p" },
  ] },
  { label: "Source", options: [
    { value: "bluray", label: "Blu-ray" },
    { value: "remux", label: "Remux" },
    { value: "webdl", label: "WEB-DL" },
    { value: "webrip", label: "WEBRip" },
    { value: "hdtv", label: "HDTV" },
    { value: "dvd", label: "DVD" },
  ] },
  { label: "Dynamic range", options: [
    { value: "dolby-vision", label: "Dolby Vision" },
    { value: "hdr10plus", label: "HDR10+" },
    { value: "hdr10", label: "HDR10" },
    { value: "hdr", label: "HDR" },
    { value: "sdr", label: "SDR" },
  ] },
  { label: "Audio", options: [
    { value: "atmos", label: "Dolby Atmos" },
    { value: "truehd", label: "TrueHD" },
    { value: "dts-x", label: "DTS:X" },
    { value: "dts-hd", label: "DTS-HD" },
  ] },
  { label: "Video codec", options: [
    { value: "hevc", label: "HEVC / H.265" },
    { value: "h264", label: "H.264" },
    { value: "av1", label: "AV1" },
  ] },
] as const;

/** Alternatives within a group match any selected tag; different groups must all match. */
export function matchesStreamFilters(tags: ReadonlySet<string>, selected: readonly string[]) {
  return streamFilterGroups.every(group => {
    const active = group.options.filter(option => selected.includes(option.value));
    return active.length === 0 || active.some(option => tags.has(option.value));
  });
}
