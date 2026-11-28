import { validMediaId, type MediaType } from './home-catalog';

export type StreamTarget = { id: string; type: 'movie' } | { id: string; type: 'series'; season: number; episode: number };
type EpisodeCoordinates = { season: number; number: number };

export function detailStreamTarget(type: MediaType, id: string, routeEpisode?: EpisodeCoordinates, selectedEpisode?: EpisodeCoordinates): StreamTarget | null {
  if (!validMediaId(id)) return null;
  if (type === 'movie') return { id, type };
  const episode = routeEpisode ?? selectedEpisode;
  if (!episode || !validEpisode(episode.season, episode.number)) return null;
  return { id, type, season: episode.season, episode: episode.number };
}

export function validEpisode(season: number, episode: number) {
  return Number.isSafeInteger(season) && season >= 0 && season <= 10000 &&
    Number.isSafeInteger(episode) && episode >= 1 && episode <= 10000;
}

export type StreamChoice = {
  addonId: string;
  addonName: string;
  addonLogo?: string;
  addonIndex: number;
  url?: string;
  externalUrl?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  name?: string;
  title?: string;
  description?: string;
  behaviorHints?: {
    filename?: string; videoSize?: number; videoHash?: string; notWebReady?: boolean;
    proxyHeaders?: { request?: Record<string, string>; response?: Record<string, string> };
  };
  subtitles?: Array<{ id: string; url: string; lang: string; label?: string }>;
};

export type StreamSnapshot = {
  streams: StreamChoice[];
  addons: Array<{ id: string; name: string; logo?: string }>;
  pending: number;
  total: number;
  complete: boolean;
  signedIn: boolean | null;
  error?: string;
};

export const streamFilterGroups = [
  { label: 'Resolution', options: ['2160p', '1440p', '1080p', '720p', '480p'] },
  { label: 'Source', options: ['bluray', 'remux', 'webdl', 'webrip', 'hdtv', 'dvd'] },
  { label: 'Dynamic range', options: ['dolby-vision', 'hdr10plus', 'hdr10', 'hdr', 'sdr'] },
  { label: 'Audio', options: ['atmos', 'truehd', 'dts-x', 'dts-hd'] },
  { label: 'Video codec', options: ['hevc', 'h264', 'av1'] },
] as const;

export const streamFilterLabels: Record<string, string> = {
  bluray: 'Blu-ray', remux: 'Remux', webdl: 'WEB-DL', webrip: 'WEBRip', hdtv: 'HDTV', dvd: 'DVD',
  'dolby-vision': 'Dolby Vision', hdr10plus: 'HDR10+', hdr10: 'HDR10', hdr: 'HDR', sdr: 'SDR',
  atmos: 'Dolby Atmos', truehd: 'TrueHD', 'dts-x': 'DTS:X', 'dts-hd': 'DTS-HD',
  hevc: 'HEVC / H.265', h264: 'H.264', av1: 'AV1',
};

/** OR within each selected facet and AND between facets. */
export function matchesStreamFilters(tags: ReadonlySet<string>, selected: readonly string[]) {
  return streamFilterGroups.every(group => {
    const active = group.options.filter(option => selected.includes(option));
    return active.length === 0 || active.some(option => tags.has(option));
  });
}

// Portable presentation rules from the web selector. Add-on metadata is
// descriptive, not verification of the underlying video.
const RESOLUTION = /(?<![a-z0-9])(4320p|2160p|1440p|1080p|720p|576p|480p|360p|8k|4k|uhd)(?![a-z0-9])/i;
const SOURCE = /(?<![a-z0-9])(web[ ._-]*dl|web[ ._-]*rip|blu[ ._-]*ray|bd[ ._-]*rip|br[ ._-]*rip|dvd[ ._-]*rip|hdtv|remux|hdcam|cam|telesync|telecine)(?![a-z0-9])/i;
const STAR_RUN = /[★☆⭐](?:[\uFE0F \t]*[★☆⭐])*\uFE0F?/u;
const FILENAME = /\.(mkv|mp4|webm|avi|mov|m4v|m2ts|ts)\b/i;
const MEDIA_FILENAME = /\.(?:mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|m3u8)$/i;
const RELEASE_START = /\b(?:\d{3,4}p|4k|8k|uhd|blu[ .-]?ray|bd[ .-]?rip|br[ .-]?rip|web[ .-]?(?:dl|rip)|hdtv|remux|dvd[ .-]?rip)\b/i;
const VIDEO_CODEC = /\b(?:[hx][ .-]?26[45]|avc|hevc|av1|vp9|mpeg[ .-]?2|xvid|divx|vc[ .-]?1)\b/i;
const AUDIO_CODEC = /\b(?:aac|opus|vorbis|mp3|flac|pcm|dts(?:[ .:-]?(?:hd|ma|hra|x))?|true[ .-]?hd|e?[ .-]?ac[ .-]?3|ddp?|atmos)\b/i;
const CODEC_TAGS = /\b(?:[hx][ .-]?26[45]|avc|hevc|av1|vp9|mpeg[ .-]?2|xvid|divx|vc[ .-]?1|aac|opus|vorbis|mp3|flac|pcm|dts(?:[ .:-]?(?:hd|ma|hra|x))?|true[ .-]?hd|e?[ .-]?ac[ .-]?3|ddp?|atmos|dv|dovi|hdr10\+?|hdr|dolby[ .-]?vision|[0-9][ .][01]|(?:8|10|12)[ .-]?bit)\b/gi;
const SOURCE_LABELS: Record<string, string> = {
  webdl: 'WebDL', webrip: 'WebRip', bluray: 'BluRay', bdrip: 'BDRip', brrip: 'BRRip',
  dvdrip: 'DVDRip', hdtv: 'HDTV', remux: 'Remux', hdcam: 'HDCAM', cam: 'CAM', telesync: 'Telesync', telecine: 'Telecine',
};
function cleanText(value = '') {
  return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').split(/\r\n|\r|\n/)
    .map(line => line.replace(/[^\S\r\n]+/g, ' ').trim()).filter(Boolean).join('\n');
}
function normalizeResolution(raw?: string) {
  const value = raw?.toLowerCase();
  return value === '8k' ? '4320p' : value === '4k' || value === 'uhd' ? '2160p' : value;
}
export function getStreamPresentation(stream: Pick<StreamChoice, 'name' | 'title' | 'description' | 'behaviorHints'>) {
  const filename = cleanText(stream.behaviorHints?.filename);
  const display = [cleanText(stream.name), cleanText(stream.title || stream.description)].filter(Boolean).join('\n');
  const searchable = [display, filename].filter(Boolean).join('\n');
  const resolution = normalizeResolution(searchable.match(RESOLUTION)?.[1]);
  const rawSource = searchable.match(SOURCE)?.[1];
  const source = rawSource ? SOURCE_LABELS[rawSource.toLowerCase().replace(/[ ._-]/g, '')] : undefined;
  const rating = display.split('\n').filter(line => !FILENAME.test(line)).join('\n').match(STAR_RUN)?.[0];
  const stars = rating ? Array.from(rating.matchAll(/[★☆⭐]/gu), match => match[0] !== '☆') : [];
  const lightning = display.includes('⚡');
  const details = Array.from(new Set(display.split('\n').flatMap(line => {
    if (line === filename) return [];
    if (FILENAME.test(line)) return [line];
    if (!RESOLUTION.test(line) && !SOURCE.test(line) && !STAR_RUN.test(line) && !line.includes('⚡')) return line ? [line] : [];
    const remainder = line.replace(RESOLUTION, '').replace(SOURCE, '').replace(/⚡\uFE0F?/gu, '')
      .replace(STAR_RUN, '').replace(/[〈〉〈〉‹›⟨⟩()[\]<>]/g, '').replace(/\s+/g, ' ').trim();
    return remainder ? [remainder] : [];
  })));
  return { resolution, source, lightning, stars, details };
}

export function getSourceLabel(stream: StreamChoice) {
  return stream.name || stream.addonName || 'Stream';
}

export function isSelectableStream(stream: StreamChoice) {
  return [stream.url, stream.externalUrl].some(value => {
    try {
      const url = new URL(value || '');
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  });
}

// Match the web selector: inspect release tags, not words in the title prefix.
function releaseContext(raw: string) {
  const text = raw.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/_+/g, ' ');
  const tags = Array.from(text.matchAll(/\[([^\]]+)\]/g), match => match[1]);
  let start = text.search(RELEASE_START);
  const videoStart = text.search(VIDEO_CODEC);
  if (videoStart >= 0 && (start < 0 || videoStart < start)) {
    const prefix = text.slice(videoStart, start < 0 ? undefined : start);
    const onlyTags = prefix.replace(CODEC_TAGS, '').replace(/[\s.\-+:[\](),|/]/g, '') === '';
    if (onlyTags && (start >= 0 || AUDIO_CODEC.test(prefix) || tags.length)) start = videoStart;
  }
  let tail = start >= 0 ? text.slice(start) : '';
  if (!tail && (/^\s*(?:audio|video|codecs?)\s*:/i.test(text) || (AUDIO_CODEC.test(text) && /\b[1-7][ .][01]\b/.test(text)))) tail = text;
  return [...tags, tail].join(' ');
}

/** Prefer structured release metadata, then fall back to add-on text. */
export function getStreamFilterTags(stream: Pick<StreamChoice, 'name' | 'title' | 'description' | 'behaviorHints' | 'url'>): Set<string> {
  let urlFilename = stream.url?.split(/[?#]/, 1)[0]?.split('/').pop();
  try { if (urlFilename) urlFilename = decodeURIComponent(urlFilename); } catch { /* keep malformed escapes intact */ }
  if (!urlFilename || !MEDIA_FILENAME.test(urlFilename)) urlFilename = undefined;
  const contexts = [stream.behaviorHints?.filename, urlFilename, stream.title, stream.description, stream.name]
    .filter((value): value is string => !!value).map(releaseContext);
  const tags = new Set<string>();
  const firstMatches = (patterns: Array<[RegExp, string]>) => {
    for (const text of contexts) {
      const matches = patterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
      if (matches.length) return matches;
    }
    return [];
  };
  const resolution = contexts.map(text => normalizeResolution(text.match(RESOLUTION)?.[1])).find(Boolean);
  if (resolution) tags.add(resolution);
  for (const tag of firstMatches([
    [/\b(?:blu[ .-]?ray|bd[ .-]?rip|br[ .-]?rip)\b/i, 'bluray'], [/\bremux\b/i, 'remux'],
    [/\bweb[ .-]?dl\b/i, 'webdl'], [/\bweb[ .-]?rip\b/i, 'webrip'], [/\bhdtv(?:rip)?\b/i, 'hdtv'],
    [/\bdvd[ .-]?(?:rip|mux)\b/i, 'dvd'],
  ])) tags.add(tag);
  const ranges = firstMatches([
    [/\b(?:dv|dovi|dolby[ .-]?vision)\b/i, 'dolby-vision'], [/\bhdr10(?:\+|[ .-]?plus)/i, 'hdr10plus'],
    [/\bhdr10\b(?!\+|[ .-]?plus)/i, 'hdr10'], [/\b(?:hdr|hlg)\b/i, 'hdr'], [/\bsdr\b/i, 'sdr'],
  ]);
  ranges.forEach(tag => tags.add(tag));
  if (ranges.some(tag => tag !== 'sdr')) tags.add('hdr');
  for (const tag of firstMatches([
    [/\batmos\b/i, 'atmos'], [/\btrue[ .-]?hd\b/i, 'truehd'],
    [/\bdts[ .:-]?x\b/i, 'dts-x'], [/\bdts[ .-]?hd\b/i, 'dts-hd'],
  ])) tags.add(tag);
  for (const tag of firstMatches([
    [/\b(?:hevc|[hx][ .-]?265)\b/i, 'hevc'], [/\b(?:avc|[hx][ .-]?264)\b/i, 'h264'], [/\bav1\b/i, 'av1'],
  ])) tags.add(tag);
  return tags;
}

export function filterStreams(streams: StreamChoice[], search: string, addonId: string | null, filters: string[]) {
  const query = search.trim().toLowerCase();
  return streams.filter(stream => {
    if (addonId !== null && stream.addonId !== addonId) return false;
    if (!query && !filters.length) return true;
    const tags = getStreamFilterTags(stream);
    const text = [stream.name, stream.title, stream.description, stream.addonName, stream.behaviorHints?.filename,
      tags.has('2160p') ? '2160p 4k uhd' : ''].filter(Boolean).join(' ').toLowerCase();
    return (!query || text.includes(query)) && matchesStreamFilters(tags, filters);
  });
}
