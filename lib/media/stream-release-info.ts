import type { StremioStream } from '@/types/stremio';

export interface StreamReleaseInfo {
  videoCodecs: string[];
  audioCodecs: string[];
  resolution?: string;
  dynamicRange?: 'dolby-vision-hdr10' | 'dolby-vision' | 'hdr10' | 'hdr';
  bitDepth?: number;
  source?: string;
  container?: string;
  noAudio?: boolean;
  videoOnly?: boolean;
  audioOnly?: boolean;
}

const video: Array<[RegExp, string]> = [
  [/\b(?:h[ ._-]?264|avc)\b/i, 'H.264'], [/\b(?:h[ ._-]?265|hevc)\b/i, 'H.265'],
  [/\bx264\b/i, 'x264'], [/\bx265\b/i, 'x265'], [/\bav1\b/i, 'AV1'], [/\bvp9\b/i, 'VP9'],
  [/\bmpeg[ ._-]?2\b/i, 'MPEG-2'], [/\bxvid\b/i, 'Xvid'], [/\bdivx\b/i, 'DivX'], [/\bvc[ ._-]?1\b/i, 'VC-1'],
];
const audio: Array<[RegExp, string]> = [
  [/\bdts[ ._-]?hd[ ._-]?(?:ma|hra|master[ ._-]?audio)\b/i, 'DTS-HD'], [/\bdts[ ._-]?hd\b/i, 'DTS-HD'],
  [/\bdts[ ._-]?:?x\b/i, 'DTS:X'], [/\btrue[ ._-]?hd\b/i, 'TrueHD'], [/\bddp(?:[ ._-]?\d(?:\.\d)?)?\b/i, 'DDP'],
  [/\bdd\s*\+|dolby[ ._-]?digital[ ._-]?plus|\be[ ._-]?ac[ ._-]?3\b/i, 'EAC3'],
  [/(?<!e[ .-])\bac[ ._-]?3\b|\bdd(?!\s*\+|p|[ .-]+digital[ .-]+plus)\b/i, 'AC3'], [/\baac\b/i, 'AAC'], [/\bopus\b/i, 'Opus'],
  [/\bvorbis\b/i, 'Vorbis'], [/\bflac\b/i, 'FLAC'], [/\bpcm\b/i, 'PCM'], [/\bmp3\b/i, 'MP3'], [/\bdts\b/i, 'DTS'],
];

function releaseContexts(stream: StremioStream, extended = false) {
  const filename = stream.behaviorHints?.filename;
  const basename = stream.url?.split(/[?#]/, 1)[0]?.split('/').pop();
  const mediaName = (v?: string) => v && /\.(?:mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|m3u8)$/i.test(v) ? v : undefined;
  let urlName = basename;
  try { if (urlName) urlName = decodeURIComponent(urlName); } catch { /* keep malformed escapes intact */ }
  urlName = mediaName(urlName);
  const inputs = [filename, urlName, stream.title, stream.description, stream.name].filter((v): v is string => Boolean(v));
  const parsed = inputs.map(raw => {
    const text = raw.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/_+/g, ' ');
    const tags = [...text.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    // A resolution/source starts a release tail; words in the movie-name prefix
    // (e.g. AAC (2020) 1080p) must not become codec declarations.
    let start = text.search(extended
      ? /\b(?:\d{3,4}p|4k|8k|uhd|blu[ ._-]?ray|bd[ ._-]?rip|br[ ._-]?rip|web[ ._-]?(?:dl|rip)|hdtv|remux|dvd[ ._-]?rip)\b/i
      : /\b(?:\d{3,4}p|4k|8k|bluray|blu[ ._-]?ray|web[ ._-]?(?:dl|rip)|hdtv|remux|dvdrip)\b/i);
    const videoStart = Math.min(...video.map(([pattern]) => text.search(pattern)).filter(index => index >= 0));
    if (Number.isFinite(videoStart) && (start < 0 || videoStart < start)) {
      const section = text.slice(videoStart, start < 0 ? undefined : start);
      // Preserve codec-first metadata such as H264 AAC 1080p, but not a
      // codec-like title followed by a year or prose.
      const technicalOnly = section
        .replace(/\b(?:h[ .-]?26[45]|avc|hevc|x26[45]|av1|vp9|mpeg[ .-]?2|xvid|divx|vc[ .-]?1|aac|opus|vorbis|mp3|flac|pcm|dts(?:[ .:-]?(?:hd|ma|hra|x))?|true[ .-]?hd|e?[ .-]?ac[ .-]?3|ddp?|atmos|dv|dovi|hdr10\+?|hdr|dolby[ .-]?vision|[0-9][ .][01]|(?:8|10|12)[ .-]?bit)\b/gi, '')
        .replace(/[\s.\-+:[\](),|/]/g, '') === '';
      if (technicalOnly && (start >= 0 || audio.some(([pattern]) => pattern.test(section)) || tags.length)) start = videoStart;
    }
    let tail = start >= 0 ? text.slice(start) : '';
    if (!tail && (/^\s*(?:audio|video|codecs?)\s*:/i.test(text)
      || (audio.some(([pattern]) => pattern.test(text)) && /\b[1-7][ .][01]\b/.test(text)))) tail = text;
    const context = [...tags, tail].join(' ');
    return { context, structured: Boolean(context.trim()) };
  });
  return { parsed, inputs, filename, urlName, mediaName };
}

export function parseStreamReleaseInfo(stream: StremioStream): StreamReleaseInfo {
  const result: StreamReleaseInfo = { videoCodecs: [], audioCodecs: [] };
  const { parsed, inputs, filename, urlName, mediaName } = releaseContexts(stream);
  // Filename and meaningful media URL are authoritative; lower-priority text fills absent fields.
  const field = <T,>(get: (p: typeof parsed[number]) => T | undefined): T | undefined => {
    for (const p of parsed) { const value = get(p); if (value !== undefined) return value; }
    return undefined;
  };
  const codecs = (p: typeof parsed[number], entries: Array<[RegExp, string]>) => p.context ? entries.filter(([r]) => r.test(p.context)).map(([, label]) => label) : [];
  result.videoCodecs = [...new Set(field(p => { const values = codecs(p, video); return values.length ? values : undefined; }) || [])];
  const audioCodecs = [...new Set(field(p => { const values = codecs(p, audio); return values.length ? values : undefined; }) || [])];
  result.audioCodecs = audioCodecs.filter(codec => codec !== 'DTS' || !audioCodecs.some(specific => ['DTS-HD', 'DTS:X'].includes(specific)));
  result.resolution = field(p => p.context.match(/\b(2160p|1080p|720p|576p|480p|4320p|4k|8k)\b/i)?.[1].toLowerCase());
  result.dynamicRange = field(p => /\b(?:dv|dovi|dolby[ ._-]?vision)\b/i.test(p.context)
    ? /\bhdr10\b/i.test(p.context) ? 'dolby-vision-hdr10' : 'dolby-vision'
    : /\bhdr10\b/i.test(p.context) ? 'hdr10' : /\bhdr\b/i.test(p.context) ? 'hdr' : undefined);
  result.bitDepth = field(p => Number(p.context.match(/\b(8|10|12)[ ._-]?bit\b/i)?.[1]) || undefined);
  result.source = field(p => p.context.match(/\b(bluray|blu[ ._-]?ray|web[ ._-]?dl|web[ ._-]?rip|hdtv|remux|dvdrip)\b/i)?.[1].replace(/[ ._-]/g, '').toLowerCase());
  const primary = filename || urlName || inputs.find(input => mediaName(input));
  result.container = primary?.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
  const metadata = parsed.filter(p => p.structured).map(p => p.context).join(' ');
  if (/\bno[ ._-]?audio\b|\bsilent[ ._-]?video\b/i.test(metadata)) result.noAudio = true;
  if (/\bvideo[ ._-]?only\b/i.test(metadata)) result.videoOnly = true;
  if (/\baudio[ ._-]?only\b/i.test(metadata)) result.audioOnly = true;
  return result;
}

// Filter only explicit release tags. These labels describe the add-on's
// metadata, not verified decoder capabilities or the actual media bitstream.
export function getStreamFilterTags(stream: StremioStream): Set<string> {
  const { parsed } = releaseContexts(stream, true);
  const firstMatches = (patterns: Array<[RegExp, string]>): string[] => {
    for (const { context } of parsed) {
      const matches = patterns.filter(([pattern]) => pattern.test(context)).map(([, label]) => label);
      if (matches.length) return matches;
    }
    return [];
  };
  const tags = new Set<string>();
  const resolution = parsed.map(({ context }) => context.match(/\b(4320p|2160p|1440p|1080p|720p|576p|480p|360p|8k|4k|uhd)\b/i)?.[1].toLowerCase()).find(Boolean);
  if (resolution) tags.add(resolution === '4k' || resolution === 'uhd' ? '2160p' : resolution === '8k' ? '4320p' : resolution);
  for (const tag of firstMatches([
    [/\b(?:blu[ .-]?ray|bd[ .-]?rip|br[ .-]?rip)\b/i, 'bluray'],
    [/\bremux\b/i, 'remux'],
    [/\bweb[ .-]?dl\b/i, 'webdl'],
    [/\bweb[ .-]?rip\b/i, 'webrip'],
    [/\bhdtv(?:rip)?\b/i, 'hdtv'],
    [/\bdvd[ .-]?(?:rip|mux)\b/i, 'dvd'],
  ])) tags.add(tag);
  const ranges = firstMatches([
    [/\b(?:dv|dovi|dolby[ .-]?vision)\b/i, 'dolby-vision'],
    [/\bhdr10(?:\+|[ .-]?plus)/i, 'hdr10plus'],
    [/\bhdr10\b(?!\+|[ .-]?plus)/i, 'hdr10'],
    [/\b(?:hdr|hlg)\b/i, 'hdr'],
    [/\bsdr\b/i, 'sdr'],
  ]);
  for (const tag of ranges) tags.add(tag);
  if (ranges.some(tag => tag !== 'sdr')) tags.add('hdr');
  for (const tag of firstMatches([
    [/\batmos\b/i, 'atmos'],
    [/\btrue[ .-]?hd\b/i, 'truehd'],
    [/\bdts[ .:-]?x\b/i, 'dts-x'],
    [/\bdts[ .-]?hd\b/i, 'dts-hd'],
  ])) tags.add(tag);
  for (const tag of firstMatches([
    [/\b(?:hevc|[hx][ .-]?265)\b/i, 'hevc'],
    [/\b(?:avc|[hx][ .-]?264)\b/i, 'h264'],
    [/\bav1\b/i, 'av1'],
  ])) tags.add(tag);
  return tags;
}
